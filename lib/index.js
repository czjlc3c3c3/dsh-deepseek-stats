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

const NAME = 'deepseek-stats'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const SYNC_INTERVAL_MS = 6 * 3600000
const BJ_OFFSET = 8 * 3600000
const DAY_MS = 86400000

// Builtin fallback prices (CNY per 1M tokens, idle; peak = ×factor)
const BUILTIN_PRICES = {
  'deepseek-v4-flash-vision-exp': { hit: 0.05, miss: 1.5, out: 4.5 },
  'deepseek-v4-flash': { hit: 0.05, miss: 1.5, out: 4.5 },
  'deepseek-v4-pro': { hit: 0.15, miss: 4.5, out: 13.5 },
}
const PRICE_ALIASES = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
  'deepseek-v3': 'deepseek-v4-pro',
}

export const inject = ['webServer']

export function apply(ctx) {
  let activePrices = {
    'deepseek-v4-flash-vision-exp': { ...BUILTIN_PRICES['deepseek-v4-flash-vision-exp'] },
    'deepseek-v4-flash': { ...BUILTIN_PRICES['deepseek-v4-flash'] },
    'deepseek-v4-pro': { ...BUILTIN_PRICES['deepseek-v4-pro'] },
  }
  let priceState = { source: 'builtin', at: 0, factor: 2, error: null }

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
    const t = p.h * 60 + p.m
    if ((t >= 540 && t < 720) || (t >= 840 && t < 1080)) return priceState.factor || 1
    return 1
  }
  const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六']
  function windowInfo(ms) {
    const isPeak = factorAt(ms) === (priceState.factor || 2)
    let lead = null
    let next = null
    for (let d = -8; d <= 8; d++) {
      for (const edge of [540, 720, 840, 1080]) {
        const dayStartShift = Math.floor((ms + BJ_OFFSET) / DAY_MS) * DAY_MS + d * DAY_MS
        const candMs = dayStartShift + edge * 60000 - BJ_OFFSET
        const p = bjParts(candMs)
        if (p.dow < 1 || p.dow > 5) continue
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
    return { isPeak: isPeak, factor: isPeak ? (priceState.factor || 2) : 1, startAt: startAt, endAt: endAt, nextLabel: nextLabel, nextAt: endAt, msUntil: endAt === null ? null : Math.max(0, endAt - ms) }
  }

  // ---- pricing ----
  function priceOf(model) {
    let m = String(model || '').toLowerCase().trim()
    if (PRICE_ALIASES[m]) m = PRICE_ALIASES[m]
    if (activePrices[m]) return activePrices[m]
    if (m.indexOf('v4-pro') >= 0) return activePrices['deepseek-v4-pro']
    if (m.indexOf('v4-flash') >= 0) return activePrices['deepseek-v4-flash']
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
      const m = (seg.match(/\d+(?:\.\d+)?/g) || []).map(Number)
      return [m[0], m[1], m[2]]
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
    const all = [].concat(hit.idle, hit.peak, miss.idle, miss.peak, out.idle, out.peak)
    for (const v of all) { if (!(v > 0) || !isFinite(v)) return null }
    const f = miss.peak[0] / miss.idle[0]
    if (!(f > 1.1)) return null
    return {
      tables: {
        'deepseek-v4-flash': { hit: hit.idle[0], miss: miss.idle[0], out: out.idle[0] },
        'deepseek-v4-pro': { hit: hit.idle[1], miss: miss.idle[1], out: out.idle[1] },
        'deepseek-v4-flash-vision-exp': { hit: hit.idle[2], miss: miss.idle[2], out: out.idle[2] },
      },
      factor: Math.round(f * 100) / 100,
    }
  }

  async function syncPrices() {
    try {
      const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error('官方页 HTTP ' + res.status)
      const html = await res.text()
      const parsed = parsePricingHtml(html)
      if (!parsed) throw new Error('价目解析失败（页面结构可能已变化）')
      activePrices = {
        'deepseek-v4-flash-vision-exp': { ...parsed.tables['deepseek-v4-flash-vision-exp'] },
        'deepseek-v4-flash': { ...parsed.tables['deepseek-v4-flash'] },
        'deepseek-v4-pro': { ...parsed.tables['deepseek-v4-pro'] },
      }
      priceState = { source: 'official', at: Date.now(), factor: parsed.factor, error: null }
      console.log('[deepseek-stats] 官方价目同步成功：高峰 ×' + parsed.factor + '，flash 输出 ' + parsed.tables['deepseek-v4-flash'].out + '元/M')
    } catch (e) {
      priceState = { source: 'builtin', at: Date.now(), factor: priceState.factor || 2, error: String((e && e.message) || e) }
      console.error('[deepseek-stats] 官方价目同步失败（使用内置价目）: ' + priceState.error)
    }
  }
  syncPrices()
  const priceSyncTimer = setInterval(syncPrices, SYNC_INTERVAL_MS)
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
  function backfillToday() {
    const sessionQuery = ctx.get('sessionQuery')
    if (!sessionQuery) return
    Promise.resolve()
      .then(() => sessionQuery.listSessions())
      .then((all) => {
        const runs = []
        for (const s of (all || []).slice(0, 40)) {
          runs.push(sessionQuery.readSession(s.header.id).catch(() => null))
        }
        return Promise.all(runs)
      })
      .then((snaps) => {
        let folded = 0
        for (const snap of snaps || []) {
          if (!snap || !snap.events) continue
          for (const ev of snap.events) {
            if (!ev || ev.type !== 'assistant/message') continue
            if (ev.time >= startMs) continue
            if (dayKey(ev.time) !== startDay) continue
            foldUsage(ev, ev.time)
            folded++
          }
        }
        if (folded > 0) console.log('[deepseek-stats] 回填今日用量事件 ' + folded + ' 条')
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
