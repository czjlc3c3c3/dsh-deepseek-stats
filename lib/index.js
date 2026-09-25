// dsh-deepseek-stats — host half: official DeepSeek balance + today usage +
// peak/valley CNY costing with official-price auto sync (every 6h).
//
// Serves same-origin JSON:
//   GET /plugins/deepseek-stats/state    — full snapshot (15s balance cache)
//   GET /plugins/deepseek-stats/refresh  — force balance refresh (2s cooldown)
//
// Costs: (inputMiss + cacheWrite) × miss + cacheRead × hit + output × out,
// per 1M tokens, × window factor (peak = official factor, default 2).
// Peak windows: Beijing Mon–Fri 09:00-12:00 / 14:00-18:00; else idle ×1.

import { readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const NAME = 'deepseek-stats'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const SYNC_INTERVAL_MS = 6 * 3600000
const BJ_OFFSET = 8 * 3600000
const DAY_MS = 86400000

// Builtin fallback prices (CNY per 1M tokens, idle; peak = ×factor)
// 2026-09-10 官方页：deepseek-flash（DeepSeek-V4.1-Flash）0.02 / 1 / 4；
// deepseek-v4-pro（DeepSeek-V4-Pro-0813）0.15 / 4.5 / 13.5
const BUILTIN_PRICES = {
  'deepseek-flash': { hit: 0.02, miss: 1, out: 4 },
  'deepseek-v4-pro': { hit: 0.15, miss: 4.5, out: 13.5 },
}
// 旧名/实验名 → 现行官方模型名。官方说明：旧名 deepseek-v4-flash、
// deepseek-v4-flash-vision-exp 仍可调用，但已由 V4.1 Flash 提供服务并按其价格计费；
// 实验模型名 deepseek-v4.1-flash-expires-on-0910 已转正为 deepseek-flash。
const PRICE_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-v4.1-flash-expires-on-0910': 'deepseek-flash',
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
  'deepseek-v3': 'deepseek-v4-pro',
}

// 中国法定节假日（内置兜底，2026 全年；来源 holiday-cn，口径=国务院公告）。
// 官方峰谷规则（2026-09 官方页脚注）：北京时间周一至周五「不含中国法定节假日」
// 09:00-12:00 / 14:00-18:00 为高峰；其余时段（含周末与法定节假日全天）为空闲。
// 调休上班日都落在周末 → 按周末规则仍为空闲，故 work 仅作界面展示，不参与计价。
const BUILTIN_HOLIDAYS = {
  2026: {
    '元旦': ['2026-01-01', '2026-01-02', '2026-01-03'],
    '春节': ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23'],
    '清明节': ['2026-04-04', '2026-04-05', '2026-04-06'],
    '劳动节': ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'],
    '端午节': ['2026-06-19', '2026-06-20', '2026-06-21'],
    '中秋节': ['2026-09-25', '2026-09-26', '2026-09-27'],
    '国庆节': ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
    work: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
  },
}
const HOLIDAY_SYNC_INTERVAL_MS = 24 * 3600000
// 启动回填的会话上限（仅在 mtime 预筛不可用时的全量兜底路径生效）
const BACKFILL_MAX_SESSIONS = 500
// 节假日表同步源（按序尝试）：holiday-cn 是社区维护的国务院公告镜像，含法定节假日与调休上班日
const HOLIDAY_URLS = [
  (y) => 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/' + y + '.json',
  (y) => 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/' + y + '.json',
]

export const inject = ['webServer']

export function apply(ctx) {
  // 初始价表直接从内置表派生，避免新增模型时漏登记
  let activePrices = {}
  for (const key of Object.keys(BUILTIN_PRICES)) activePrices[key] = { ...BUILTIN_PRICES[key] }
  let priceState = { source: 'builtin', at: 0, factor: 2, error: null }

  // ---- 法定节假日表（决定高峰/空闲；内置兜底 + 每日同步） ----
  let holidayOff = new Map()   // 'YYYY-MM-DD' -> 节假日名（全天空闲）
  let holidayWork = new Set()  // 'YYYY-MM-DD' 调休上班日（均落周末，仍按空闲；仅界面展示）
  let holidayState = { source: 'builtin', at: 0, error: null, years: [], count: 0 }
  for (const table of Object.values(BUILTIN_HOLIDAYS)) {
    for (const [name, dates] of Object.entries(table)) {
      if (name === 'work') { for (const d of dates) holidayWork.add(d); continue }
      for (const d of dates) holidayOff.set(d, name)
    }
  }
  holidayState = { source: 'builtin', at: Date.now(), error: null, years: Object.keys(BUILTIN_HOLIDAYS).map(Number), count: holidayOff.size }

  async function syncHolidays() {
    const year = bjParts(Date.now()).y
    const years = [year, year + 1]
    const off = new Map(holidayOff)
    const work = new Set(holidayWork)
    const okYears = []
    let lastErr = null
    for (const y of years) {
      let data = null
      for (const mk of HOLIDAY_URLS) {
        try {
          const res = await fetch(mk(y), { signal: AbortSignal.timeout(15000) })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const json = await res.json()
          if (!json || !Array.isArray(json.days)) throw new Error('结构不符')
          data = json
          break
        } catch (e) { lastErr = String((e && e.message) || e) }
      }
      if (!data) continue
      okYears.push(y)
      for (const day of data.days) {
        if (!day || typeof day.date !== 'string') continue
        if (day.isOffDay) off.set(day.date, day.name || '节假日')
        else work.add(day.date)
      }
    }
    if (okYears.length > 0) {
      holidayOff = off
      holidayWork = work
      holidayState = { source: 'sync', at: Date.now(), error: null, years: okYears, count: off.size }
      console.log('[deepseek-stats] 节假日表同步成功：' + okYears.join('/') + '，法定休假日 ' + off.size + ' 天')
    } else {
      holidayState = { source: 'builtin', at: Date.now(), error: lastErr || '同步失败', years: Object.keys(BUILTIN_HOLIDAYS).map(Number), count: holidayOff.size }
      console.error('[deepseek-stats] 节假日表同步失败（使用内置表）: ' + holidayState.error)
    }
  }

  function holidayNameAt(ms) { return holidayOff.get(dayKey(ms)) || null }

  // ---- Beijing time helpers ----
  function pad2(n) { return String(n).padStart(2, '0') }
  function bjParts(ms) {
    const d = new Date(ms + BJ_OFFSET)
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() }
  }
  function dayKey(ms) { const p = bjParts(ms); return p.y + '-' + pad2(p.mo) + '-' + pad2(p.d) }
  function factorAt(ms) {
    const p = bjParts(ms)
    if (p.dow < 1 || p.dow > 5) return 1
    if (holidayOff.has(dayKey(ms))) return 1   // 中国法定节假日：全天按空闲计费
    const t = p.h * 60 + p.m
    if ((t >= 540 && t < 720) || (t >= 840 && t < 1080)) return priceState.factor || 1
    return 1
  }
  const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六']
  function windowInfo(ms) {
    const isPeak = factorAt(ms) === (priceState.factor || 2)
    const key = dayKey(ms)
    const p0 = bjParts(ms)
    const offName = holidayOff.get(key) || null
    const dayType = offName ? 'holiday' : (p0.dow === 0 || p0.dow === 6 ? (holidayWork.has(key) ? 'makeup' : 'weekend') : 'workday')
    let lead = null
    let next = null
    for (let d = -14; d <= 14; d++) {
      for (const edge of [540, 720, 840, 1080]) {
        const dayStartShift = Math.floor((ms + BJ_OFFSET) / DAY_MS) * DAY_MS + d * DAY_MS
        const candMs = dayStartShift + edge * 60000 - BJ_OFFSET
        const p = bjParts(candMs)
        if (p.dow < 1 || p.dow > 5) continue
        if (holidayOff.has(dayKey(candMs))) continue   // 节假日内没有高峰边界
        if (candMs <= ms) { if (lead === null || candMs > lead.ms) lead = { ms: candMs, p: p } }
        else if (next === null || candMs < next.ms) next = { ms: candMs, p: p }
      }
    }
    const startAt = lead ? lead.ms : null
    const endAt = next ? next.ms : null
    let nextLabel = null
    if (next) {
      const nowP = bjParts(ms)
      const isToday = next.p.y === nowP.y && next.p.mo === nowP.mo && next.p.d === nowP.d
      nextLabel = (isToday ? '' : '周' + WEEK_NAMES[next.p.dow] + ' ') + pad2(next.p.h) + ':' + pad2(next.p.m)
    }
    return { isPeak: isPeak, factor: isPeak ? (priceState.factor || 2) : 1, startAt: startAt, endAt: endAt, nextLabel: nextLabel, nextAt: endAt, msUntil: endAt === null ? null : Math.max(0, endAt - ms), dayType: dayType, holidayName: offName }
  }

  // ---- pricing ----
  function priceOf(model) {
    let m = String(model || '').toLowerCase().trim()
    if (PRICE_ALIASES[m]) m = PRICE_ALIASES[m]
    if (activePrices[m]) return activePrices[m]
    if (m.indexOf('pro') >= 0) return activePrices['deepseek-v4-pro'] || null
    // 宽松兜底：flash 系列（含旧名 v4-flash、v4.1-flash-*、实验/新变体）按 flash 计价
    if (m.indexOf('flash') >= 0) return activePrices['deepseek-flash'] || null
    return null
  }
  function costCny(model, inMiss, inHit, inWrite, out, factor) {
    const p = priceOf(model)
    if (!p) return null
    return ((inMiss + inWrite) * p.miss + inHit * p.hit + out * p.out) / 1e6 * factor
  }

  // ---- official price sync: at startup + every 6h; fall back to builtin ----
  function parsePricingHtml(html) {
    const text = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
    function nums(seg) {
      return (seg.match(/\d+(?:\.\d+)?/g) || []).map(Number)
    }
    function block(from, to) {
      const s = text.indexOf(from)
      if (s < 0) return null
      const t = to ? text.indexOf(to, s + from.length) : text.length
      if (to && t < 0) return null
      const seg = text.slice(s + from.length, t)
      const pos = seg.indexOf('高峰时段')
      if (pos < 0) return null
      return { idle: nums(seg.slice(0, pos)), peak: nums(seg.slice(pos)) }
    }
    const hit = block('缓存命中', '缓存未命中')
    const miss = block('缓存未命中', '百万tokens输出')
    const out = block('百万tokens输出', '并发限制')
    if (!hit || !miss || !out) return null
    // 列名取自官方表头「模型 <id> (n) <id> (n) … BASE URL」，列序即价格列序。
    // 官方 2026-09-10 起为 2 列（deepseek-flash / deepseek-v4-pro），此前为 3 列：
    // 这里不再硬编码列数，官方增删模型都能跟着走。
    const at = text.indexOf('BASE URL')
    const head = at > 0 ? text.slice(Math.max(0, at - 200), at) : ''
    const columns = []
    for (const name of (head.match(/deepseek[0-9a-z.\-]*/gi) || [])) {
      const id = name.toLowerCase()
      if (columns.indexOf(id) < 0) columns.push(id)
    }
    const width = Math.min(hit.idle.length, hit.peak.length, miss.idle.length, miss.peak.length, out.idle.length, out.peak.length)
    // 表头模型数必须与价格列数一致，否则宁可保守回退内置价，也不猜列名
    if (width < 1 || columns.length !== width) return null
    const tables = {}
    for (let i = 0; i < width; i++) {
      const row = { hit: hit.idle[i], miss: miss.idle[i], out: out.idle[i] }
      for (const v of [row.hit, row.miss, row.out, hit.peak[i], miss.peak[i], out.peak[i]]) {
        if (!(v > 0) || !isFinite(v)) return null
      }
      tables[columns[i]] = row
    }
    const f = miss.peak[0] / miss.idle[0]
    if (!(f > 1.1)) return null
    return { tables: tables, factor: Math.round(f * 100) / 100 }
  }

  async function syncPrices() {
    try {
      const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error('官方页 HTTP ' + res.status)
      const html = await res.text()
      const parsed = parsePricingHtml(html)
      if (!parsed) throw new Error('价目解析失败（页面结构可能已变化）')
      const official = parsed.tables
      // 内置表打底：官方页未列出的（旧名/实验模型）继续用内置价，不被整体覆盖丢掉
      const merged = {}
      for (const key of Object.keys(BUILTIN_PRICES)) merged[key] = official[key] ? { ...official[key] } : { ...BUILTIN_PRICES[key] }
      for (const key of Object.keys(official)) if (!merged[key]) merged[key] = { ...official[key] }
      activePrices = merged
      priceState = { source: 'official', at: Date.now(), factor: parsed.factor, error: null }
      console.log('[deepseek-stats] 官方价目同步成功：高峰 ×' + parsed.factor + '，模型 ' + Object.keys(official).join(' / '))
    } catch (e) {
      priceState = { source: 'builtin', at: Date.now(), factor: priceState.factor || 2, error: String((e && e.message) || e) }
      console.error('[deepseek-stats] 官方价目同步失败（使用内置价目）: ' + priceState.error)
    }
  }
  syncPrices()
  const priceSyncTimer = setInterval(syncPrices, SYNC_INTERVAL_MS)
  // 节假日表：启动同步一次 + 每 24h 刷新（失败保留内置表；次年安排公布后自动补上）
  syncHolidays()
  const holidaySyncTimer = setInterval(syncHolidays, HOLIDAY_SYNC_INTERVAL_MS)
  const retryTimers = new Set()
  // 启动后前几次失败多为网络未就绪的瞬时故障：30s → 2min → 8min 退避重试，成功后停止
  function schedulePriceRetry(delay) {
    if (delay > 600000) return
    const id = setTimeout(() => {
      retryTimers.delete(id)
      if (priceState.source !== 'official') {
        syncPrices()
        schedulePriceRetry(delay * 4)
      }
    }, delay)
    retryTimers.add(id)
  }
  schedulePriceRetry(30000)
  ctx.effect(() => () => {
    clearInterval(priceSyncTimer)
    clearInterval(holidaySyncTimer)
    for (const id of retryTimers) clearTimeout(id)
    retryTimers.clear()
  })

  // ---- today usage (local fold, Beijing midnight rollover) ----
  let anchor = { day: null, models: {}, lastModel: null, unknownCount: 0, peakTokens: 0, idleTokens: 0, count: 0 }
  function rollDay(ms) {
    const key = dayKey(ms)
    if (anchor.day !== key) {
      anchor = { day: key, models: {}, lastModel: null, unknownCount: 0, peakTokens: 0, idleTokens: 0, count: 0 }
    }
  }
  rollDay(Date.now())

  function foldUsage(ev, ts) {
    const data = ev.data || {}
    const usage = data.usage
    const source = data.message && data.message.source
    if (!usage || !source) return
    rollDay(ts)
    const model = source.model || source.provider || 'unknown'
    const inMiss = usage.inputTokens || 0
    const inHit = usage.cacheReadTokens || 0
    const inWrite = usage.cacheWriteTokens || 0
    const out = usage.outputTokens || 0
    const t = inMiss + inHit + inWrite + out
    let rec = anchor.models[model]
    if (!rec) rec = anchor.models[model] = { inMiss: 0, inHit: 0, inWrite: 0, out: 0, reasoning: 0, costCny: 0, priced: true, count: 0 }
    rec.inMiss += inMiss
    rec.inHit += inHit
    rec.inWrite += inWrite
    rec.out += out
    rec.reasoning += usage.reasoningTokens || 0
    rec.count += 1
    const cost = costCny(model, inMiss, inHit, inWrite, out, factorAt(ts))
    rec.costCny += cost || 0
    if (cost === null) { rec.priced = false; anchor.unknownCount += 1 }
    if (factorAt(ts) === (priceState.factor || 2)) anchor.peakTokens += t; else anchor.idleTokens += t
    anchor.count += 1
    anchor.lastModel = model
  }

  // best-effort backfill of today's already-persisted usage events
  const startMs = Date.now()
  const startDay = dayKey(startMs)
  const startDayStartMs = (() => { const p = bjParts(startMs); return Date.UTC(p.y, p.mo - 1, p.d) - BJ_OFFSET })()
  let backfillState = { at: 0, mode: 'none', sessions: 0, candidates: 0, scanned: 0, events: 0 }

  // 会话日志根目录：优先问持久化服务，其次 dshHomePath('sessions')，最后按 DSH_HOME 约定
  function sessionsRoot() {
    const persistence = ctx.get('sessionPersistence')
    if (persistence && typeof persistence.root === 'string' && persistence.root) return persistence.root
    const homePath = ctx.get('dshHomePath')
    if (typeof homePath === 'function') { try { return homePath('sessions') } catch { /* 落到约定路径 */ } }
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    return join(home, 'sessions')
  }

  // 今日被写过的会话目录名（= 会话 id）。失败返回 null，调用方退回全量。
  function activeSessionDirs(root, dayStartMs) {
    const ids = new Set()
    const walk = (dir, depth) => {
      if (depth > 3) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { walk(p, depth + 1); continue }
        if (!/^session(\.v\d+)?\.jsonl\.zstd$/.test(e.name)) continue
        let st
        try { st = statSync(p) } catch { continue }
        if (st.mtimeMs >= dayStartMs) ids.add(basename(dir))
      }
    }
    try { walk(root, 0) } catch { return null }
    return ids
  }

  function backfillToday() {
    const sessionQuery = ctx.get('sessionQuery')
    if (!sessionQuery) return
    backfillState = { at: Date.now(), mode: 'none', sessions: 0, candidates: 0, scanned: 0, events: 0 }
    Promise.resolve()
      .then(() => sessionQuery.listSessions())
      .then((all) => {
        const headers = (all || []).filter((s) => s && s.header && s.header.id)
        const normalize = (v) => String(v).replace(/^session-/, '')
        const byId = new Map(headers.map((s) => [s.header.id, s.header.id]))
        const byNorm = new Map(headers.map((s) => [normalize(s.header.id), s.header.id]))
        let mode = 'all'
        let ids = []
        const dirs = activeSessionDirs(sessionsRoot(), startDayStartMs)
        if (dirs && dirs.size > 0) {
          for (const dir of dirs) {
            const hit = byId.get(dir) || byNorm.get(normalize(dir))
            if (hit) ids.push(hit)
          }
          if (ids.length > 0) mode = 'mtime'
        }
        if (mode === 'all') ids = headers.map((s) => s.header.id)
        if (ids.length > BACKFILL_MAX_SESSIONS) ids = ids.slice(0, BACKFILL_MAX_SESSIONS)
        backfillState = { at: Date.now(), mode: mode, sessions: headers.length, candidates: ids.length, scanned: 0, events: 0 }
        return Promise.all(ids.map((id) => sessionQuery.readSession(id).catch(() => null)))
      })
      .then((snaps) => {
        let folded = 0
        let scanned = 0
        for (const snap of snaps || []) {
          if (!snap || !snap.events) continue
          scanned++
          for (const ev of snap.events) {
            if (!ev || ev.type !== 'assistant/message') continue
            if (ev.time >= startMs) continue
            if (dayKey(ev.time) !== startDay) continue
            foldUsage(ev, ev.time)
            folded++
          }
        }
        backfillState.scanned = scanned
        backfillState.events = folded
        console.log('[deepseek-stats] 回填今日用量：' + (backfillState.mode === 'mtime' ? '按今日活跃会话' : '全量') + '选 ' + backfillState.candidates + '/' + backfillState.sessions + ' 个，成功 ' + scanned + '，折叠 ' + folded + ' 条')
      })
      .catch((e) => console.error('[deepseek-stats] 回填失败（忽略）: ' + String((e && e.message) || e)))
  }
  backfillToday()
  ctx.on('session/event', (session, ev) => {
    if (!ev || ev.type !== 'assistant/message') return
    foldUsage(ev, ev.time || Date.now())
  })

  // ---- balance (official /user/balance, 15s cache) ----
  let balanceState = null
  let balanceAt = 0
  let balanceError = null
  let keyState = { ok: false, source: null }
  let balanceBusy = null
  let lastForceRefresh = 0

  async function fetchBalance(force) {
    if (!force && balanceState && Date.now() - balanceAt < 15000) return balanceState
    if (balanceBusy) return balanceBusy
    balanceBusy = (async () => {
      const credentials = ctx.get('credentials')
      if (!credentials) throw new Error('credentials 服务不可用')
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
      if (!resolved) { keyState = { ok: false, source: null }; throw new Error('未找到 DEEPSEEK_API_KEY（credentials.resolve 未命中）') }
      keyState = { ok: true, source: resolved.source }
      const res = await fetch(BALANCE_URL, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + resolved.value, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { throw new Error('余额响应解析失败 HTTP ' + res.status) }
      if (!res.ok || (json && json.error)) {
        throw new Error('HTTP ' + res.status + ' ' + String((json && json.error && (json.error.message || json.error.type)) || ''))
      }
      const infos = json && json.balance_infos
      let info = null
      for (const b of infos || []) { if (b.currency === 'CNY') { info = b; break } }
      if (!info && infos && infos[0]) info = infos[0]
      if (!info) throw new Error('余额响应缺少 balance_infos')
      balanceState = {
        currency: info.currency,
        total: Number(info.total_balance) || 0,
        granted: Number(info.granted_balance) || 0,
        topped: Number(info.topped_up_balance) || 0,
        at: Date.now(),
      }
      balanceAt = Date.now()
      balanceError = null
      return balanceState
    })().finally(() => { balanceBusy = null })
    return balanceBusy
  }

  function snapshot() {
    rollDay(Date.now())
    const rows = []
    let tokens = 0, cost = 0, count = 0, pricedAll = true
    for (const m of Object.keys(anchor.models)) {
      const r = anchor.models[m]
      const t = r.inMiss + r.inHit + r.inWrite + r.out
      tokens += t
      count += r.count
      if (!r.priced) pricedAll = false
      cost += r.costCny || 0
      rows.push({ model: m, tokens: t, inMiss: r.inMiss, inHit: r.inHit, inWrite: r.inWrite, output: r.out, reasoning: r.reasoning, costCny: r.priced ? r.costCny : null, count: r.count, priced: r.priced })
    }
    rows.sort((a, b) => b.tokens - a.tokens)
    return {
      day: anchor.day,
      rows,
      totals: { tokens, costCny: rows.length ? cost : null, count, pricedAll },
      lastModel: anchor.lastModel,
      unknownCount: anchor.unknownCount,
      peakTokens: anchor.peakTokens,
      idleTokens: anchor.idleTokens,
      window: windowInfo(Date.now()),
      price: { source: priceState.source, at: priceState.at, factor: priceState.factor, error: priceState.error },
      holiday: { source: holidayState.source, at: holidayState.at, years: holidayState.years, count: holidayState.count, error: holidayState.error },
      backfill: { at: backfillState.at, mode: backfillState.mode, sessions: backfillState.sessions, candidates: backfillState.candidates, scanned: backfillState.scanned, events: backfillState.events },
      keyState: { ok: keyState.ok, source: keyState.source },
      balance: balanceState ? { currency: balanceState.currency, total: balanceState.total, granted: balanceState.granted, topped: balanceState.topped, at: balanceState.at } : null,
      balanceError,
      gen: Date.now(),
    }
  }

  function writeJson(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }

  const stateRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/deepseek-stats/state',
    handler: async (req, res) => {
      try {
        await fetchBalance(false)
      } catch (e) { balanceError = String((e && e.message) || e) }
      writeJson(res, snapshot())
    },
  })
  const refreshRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/deepseek-stats/refresh',
    handler: async (req, res) => {
      const now = Date.now()
      if (now - lastForceRefresh >= 2000) {
        lastForceRefresh = now
        try { await fetchBalance(true) } catch (e) { balanceError = String((e && e.message) || e) }
      }
      writeJson(res, snapshot())
    },
  })
  ctx.effect(() => () => { stateRoute(); refreshRoute() })
}
