// dsh-deepseek-stats — client half: floating balance/usage widget.
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load).
// Serves wall-clock data from the host routes:
//   GET /plugins/deepseek-stats/state    — snapshot, polling every 10s
//   GET /plugins/deepseek-stats/refresh  — force balance refresh
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-stats',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    var STATE_URL = '/plugins/deepseek-stats/state';
    var REFRESH_URL = '/plugins/deepseek-stats/refresh';

    function fmtTokens(n) {
      if (n == null) return '—';
      if (n >= 1e6) { var v = (n / 1e6).toFixed(1).replace(/\.0$/, ''); return v + 'M'; }
      if (n >= 1e3) { var v2 = (n / 1e3).toFixed(1).replace(/\.0$/, ''); return v2 + 'K'; }
      return String(Math.round(n));
    }
    function fmtCny(v) {
      if (v == null) return '—';
      if (v < 1) return '¥' + v.toFixed(4);
      if (v < 100) return '¥' + v.toFixed(2);
      return '¥' + Math.round(v * 100) / 100;
    }
    function fmtTime(ms) {
      if (!ms) return '—';
      var d = new Date(ms + 8 * 3600000);
      var p = function (x) { return String(x).padStart(2, '0'); };
      return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
    }
    function fmtShort(ms) {
      if (!ms) return '—';
      var d = new Date(ms + 8 * 3600000);
      var p = function (x) { return String(x).padStart(2, '0'); };
      return p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }
    function fmtDur(ms) {
      if (ms == null) return '';
      var min = Math.max(1, Math.round(ms / 60000));
      var h = Math.floor(min / 60);
      var m = min % 60;
      if (h >= 1) return h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
      return m + 'm';
    }
    function shortModel(m) {
      if (!m) return '—';
      return String(m).replace(/^deepseek-/, '');
    }

    var CSS = [
      '.dsbal-widget{position:fixed;top:14px;right:14px;width:322px;z-index:900;pointer-events:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);overflow:hidden;user-select:none;}',
      '.dsbal-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;}',
      '.dsbal-head.dragging{cursor:grabbing;}',
      '.dsbal-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none;}',
      '.dsbal-title{font-weight:600;font-size:13px;flex:none;margin-right:2px;}',
      '.dsbal-sum{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto;}',
      '.dsbal-ring{margin-left:auto;flex:none;display:flex;align-items:center;justify-content:center;cursor:help;}',
      '.dsbal-ring svg{display:block;}',
      '.dsbal-ring-bg{stroke:var(--dsw-alias-border-l1);}',
      '.dsbal-ring-fg{transition:stroke-dashoffset 1s linear;}',
      '.dsbal-ring.idle .dsbal-ring-fg{stroke:var(--dsw-alias-state-success-primary);}',
      '.dsbal-ring.peak .dsbal-ring-fg{stroke:var(--dsw-alias-state-error-primary);}',
      '.dsbal-ring text{font-size:10px;font-weight:600;}',
      '.dsbal-ring.idle text{fill:var(--dsw-alias-state-success-primary);}',
      '.dsbal-ring.peak text{fill:var(--dsw-alias-state-error-primary);}',
      '.dsbal-btn{border:none;background:none;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;padding:2px 3px;line-height:1;flex:none;}',
      '.dsbal-btn:hover{color:var(--dsw-alias-label-primary);}',
      '.dsbal-btn.spinning{color:var(--dsw-alias-brand-primary);animation:dsbal-spin .9s linear infinite;}',
      '@keyframes dsbal-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}',
      '.dsbal-body{max-height:520px;overflow:auto;}',
      '.dsbal-card{margin:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;}',
      '.dsbal-brand{font-weight:700;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:6px;}',
      '.dsbal-brand .tag{font-size:10px;font-weight:500;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px;}',
      '.dsbal-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:5px 0;}',
      '.dsbal-key{color:var(--dsw-alias-label-secondary);}',
      '.dsbal-val{font-size:13px;font-variant-numeric:tabular-nums;word-break:break-all;}',
      '.dsbal-balance{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;}',
      '.dsbal-sub{font-size:11px;color:var(--dsw-alias-label-secondary);margin:2px 0;}',
      '.dsbal-div{height:1px;background:var(--dsw-alias-border-l1);margin:8px 0;}',
      '.dsbal-mline{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);padding:2px 0;}',
      '.dsbal-mline .name{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsbal-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 12px 9px;color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.dsbal-note{padding:0 12px 8px;color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.dsbal-warn{color:var(--dsw-alias-state-warn-primary);}',
      '.dsbal-err{color:var(--dsw-alias-state-error-primary);}'
    ].join('');

    function WindowRing(props) {
      var w = props.w;
      var now = React.useState(Date.now());
      var setNow = now[1]; now = now[0];
      React.useEffect(function () {
        var id = setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { clearInterval(id); };
      }, []);
      var isPeak = w ? w.isPeak : false;
      var frac = 1;
      if (w && w.startAt && w.endAt) {
        var total = w.endAt - w.startAt;
        frac = total > 0 ? Math.max(0, Math.min(1, (w.endAt - now) / total)) : 1;
      }
      var remainMs = w && w.endAt ? Math.max(0, w.endAt - now) : 0;
      var R = 13.5;
      var C = 2 * Math.PI * R;
      var factor = w ? w.factor : 2;
      var title = w ? ('DeepSeek 峰谷计价：北京时间 周一至周五 09:00-12:00、14:00-18:00 为高峰时段，价格为空闲价 ×' + factor + '；其余时间（含周末、夜间）空闲 ×1。当前 ' + (isPeak ? '高峰（×' + factor + ' 价）' : '空闲（×1 价）') + ' · 本时段剩余 ' + Math.round(frac * 100) + '%（' + fmtDur(remainMs) + '）') : '计算时段…';
      return React.createElement('span', { className: 'dsbal-ring' + (isPeak ? ' peak' : ' idle'), title: title },
        React.createElement('svg', { width: 34, height: 34, viewBox: '0 0 34 34' },
          React.createElement('circle', { className: 'dsbal-ring-bg', cx: 17, cy: 17, r: R, strokeWidth: 3, fill: 'none' }),
          React.createElement('circle', { className: 'dsbal-ring-fg', cx: 17, cy: 17, r: R, strokeWidth: 3, fill: 'none', strokeDasharray: String(C), strokeDashoffset: String(C * (1 - frac)), strokeLinecap: 'round', transform: 'rotate(-90 17 17)' }),
          React.createElement('text', { x: 17, y: 17, textAnchor: 'middle', dominantBaseline: 'central' }, isPeak ? '高峰' : '空闲')
        )
      );
    }

    function Widget() {
      var dataState = React.useState(null);
      var setData = dataState[1];
      var data = dataState[0];
      var loadingState = React.useState(true);
      var setLoading = loadingState[1];
      var loading = loadingState[0];
      var errorState = React.useState(null);
      var setError = errorState[1];
      var error = errorState[0];
      var collState = React.useState(false);
      var setCollapsed = collState[1];
      var collapsed = collState[0];
      var posState = React.useState(null);
      var setPos = posState[1];
      var pos = posState[0];
      var dragState = React.useState(false);
      var setDragging = dragState[1];
      var dragging = dragState[0];
      var refState = React.useState(false);
      var setRefreshing = refState[1];
      var refreshing = refState[0];
      var dragStart = React.useRef(null);

      React.useEffect(function () {
        var alive = true;
        function load() {
          fetch(STATE_URL, { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (!alive) return; setData(d); setError(null); })
            .catch(function (e) { if (alive) setError(String((e && e.message) || e)); })
            .finally(function () { if (alive) setLoading(false); });
        }
        load();
        var id = setInterval(load, 10000);
        return function () { alive = false; clearInterval(id); };
      }, []);

      function doRefresh() {
        if (refreshing) return;
        var started = Date.now();
        setRefreshing(true);
        fetch(REFRESH_URL, { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (d) { setData(d); setError(null); })
          .catch(function (e) { setError(String((e && e.message) || e)); })
          .finally(function () {
            var wait = 600 - (Date.now() - started);
            if (wait > 0) setTimeout(function () { setRefreshing(false); }, wait);
            else setRefreshing(false);
          });
      }

      function isButtonTarget(e) {
        var el = e.target;
        while (el && el !== e.currentTarget) {
          if (el.tagName && el.tagName === 'BUTTON') return true;
          el = el.parentNode;
        }
        return false;
      }
      function onDown(e) {
        if (e.button !== 0) return;
        if (isButtonTarget(e)) return;
        var rect = e.currentTarget.getBoundingClientRect();
        dragStart.current = { sx: e.clientX, sy: e.clientY, bx: rect.left, by: rect.top };
        setDragging(true);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      }
      function onMove(e) {
        if (!dragging || !dragStart.current) return;
        var d = dragStart.current;
        setPos({ x: Math.max(0, d.bx + e.clientX - d.sx), y: Math.max(0, d.by + e.clientY - d.sy) });
      }
      function onUp() { setDragging(false); }

      var w = data ? data.window : null;
      var bal = data ? data.balance : null;
      var usage = data ? data.rows : [];
      var totals = data ? data.totals : null;
      var price = data ? data.price : null;

      var head = React.createElement('div', { className: 'dsbal-head' + (dragging ? ' dragging' : ''), onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp },
        React.createElement('span', { className: 'dsbal-dot' }),
        React.createElement('span', { className: 'dsbal-title' }, '模型额度'),
        collapsed ? React.createElement('span', { className: 'dsbal-sum' },
          (bal ? fmtCny(bal.total) : '…'),
          ' · ', fmtTokens(totals ? totals.tokens : null),
          (totals && totals.costCny != null) ? ' ' + fmtCny(totals.costCny) : null
        ) : null,
        React.createElement(WindowRing, { w: w }),
        React.createElement('button', { className: 'dsbal-btn' + (refreshing ? ' spinning' : ''), title: refreshing ? '刷新中…' : '刷新余额', onClick: doRefresh, disabled: refreshing }, '⟳'),
        React.createElement('button', { className: 'dsbal-btn', title: collapsed ? '展开详情' : '收起', onClick: function () { setCollapsed(!collapsed); } }, collapsed ? '▸' : '▾')
      );

      if (collapsed || (!data && loading)) {
        return React.createElement('div', { className: 'dsbal-widget', style: pos ? { left: pos.x, top: pos.y, right: 'auto' } : null }, head);
      }

      var children = [head];
      if (data) {
        var priceNote = null;
        if (price) {
          if (price.source === 'official') {
            priceNote = '价源 官方（' + fmtShort(price.at) + ' 同步 · 高峰 ×' + price.factor + ' · 每 6h 自动同步）';
          } else {
            priceNote = '价源 内置（官方价格页同步失败' + (price.error ? '：' + String(price.error).slice(0, 80) : '') + '）';
          }
        }
        var body = React.createElement('div', { className: 'dsbal-body' },
          React.createElement('div', { className: 'dsbal-card' },
            React.createElement('div', { className: 'dsbal-brand' }, 'DeepSeek', React.createElement('span', { className: 'tag' }, '官方余额')),
            React.createElement('div', { className: 'dsbal-row' },
              React.createElement('span', { className: 'dsbal-key' }, '当前模型'),
              React.createElement('span', { className: 'dsbal-val' }, shortModel(data.lastModel || '—'))),
            React.createElement('div', { className: 'dsbal-row' },
              React.createElement('span', { className: 'dsbal-key' }, '账户余额'),
              React.createElement('span', { className: 'dsbal-balance' }, bal ? fmtCny(bal.total) : (data.balanceError ? '—' : '…'))),
            React.createElement('div', { className: 'dsbal-sub' }, bal ? ('充值 ' + fmtCny(bal.topped) + ' · 赠送 ' + fmtCny(bal.granted)) : (data.balanceError ? '余额获取失败' : '获取中…')),
            React.createElement('div', { className: 'dsbal-div' }),
            React.createElement('div', { className: 'dsbal-row' },
              React.createElement('span', { className: 'dsbal-key' }, '今日消耗'),
              React.createElement('span', { className: 'dsbal-val' }, fmtTokens(totals ? totals.tokens : null) + ' tokens')),
            React.createElement('div', { className: 'dsbal-sub' }, '成本 ' + fmtCny(totals ? totals.costCny : null) + (data.unknownCount > 0 ? ' · 含 ' + data.unknownCount + ' 步未计价' : '')),
            React.createElement('div', { className: 'dsbal-sub' }, '高峰 ' + fmtTokens(data.peakTokens) + ' · 空闲 ' + fmtTokens(data.idleTokens)),
            usage.slice(0, 6).map(function (r) {
              return React.createElement('div', { className: 'dsbal-mline', key: r.model },
                React.createElement('span', { className: 'name' }, shortModel(r.model)),
                React.createElement('span', null, fmtTokens(r.tokens) + (r.priced ? ' ' + fmtCny(r.costCny) : ' 未计价')));
            })
          ),
          React.createElement('div', { className: 'dsbal-note' }, w ? (w.isPeak ? '当前 高峰时段（价格×' + (w.factor || 2) + '）· 空闲 ' + (w.nextLabel || '') + ' 开始（' + fmtDur(w.msUntil) + ' 后）' : '当前 空闲时段（价格×1）· 高峰 ' + (w.nextLabel || '') + ' 开始（' + fmtDur(w.msUntil) + ' 后）') : '计算时段…'),
          priceNote ? React.createElement('div', { className: 'dsbal-note' }, priceNote) : null,
          React.createElement('div', { className: 'dsbal-foot' },
            React.createElement('span', null, '今日总计 ' + fmtTokens(totals ? totals.tokens : null) + ' tokens'),
            React.createElement('span', null, '更新于 ' + fmtTime(data ? data.gen : null)))
        );
        children.push(body);
      }
      if (error) {
        children.push(React.createElement('div', { className: 'dsbal-note dsbal-err' }, '加载错误: ' + error));
      }
      if (data && !data.keyState.ok) {
        children.push(React.createElement('div', { className: 'dsbal-note dsbal-warn' }, '未配置 DEEPSEEK_API_KEY（可在 DSH 凭据中设置）'));
      } else if (data && data.balanceError && !data.balance) {
        children.push(React.createElement('div', { className: 'dsbal-note dsbal-err' }, data.balanceError));
      }
      return React.createElement('div', { className: 'dsbal-widget', style: pos ? { left: pos.x, top: pos.y, right: 'auto' } : null }, children);
    }

    function apply(ctx) {
      var slots = ctx.get('slots');
      if (!slots) return;
      var style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'dsbalance-widget', order: 500 },
          function () { return React.createElement(Widget); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  }
});
