/* ==========================================================================
 * HUGOFXLAB /terminal client — REAL Binance klines REST + aggTrade WS.
 * Canvas chart (candles/heikin/bars/line/area), indikatoriai (EMA/SMA/VWAP/BB/
 * Volume/CVD iš live aggTrade), drawing tools, widgets (book/tape/fp/split),
 * alerts, snapshot, mode badge, log/auto scale. Jokių demo duomenų.
 * ========================================================================== */
(function () {
  'use strict';

  var REST = 'https://fapi.binance.com';
  var WSS = 'wss://fstream.binance.com/stream?streams=';
  var $ = function (id) { return document.getElementById(id); };
  var GREEN = '#2ebd85', RED = '#e0483e';
  var PADL = 6, PADR = 74, PADT = 26, PADB = 24;

  // ------------------------------------------------------------------ toast
  function toast(msg) {
    if (window.__toast) { window.__toast(msg); return; }
    var t = $('toast');
    if (!t) { alert(msg); return; }
    var el = document.createElement('div');
    el.className = 'toast__item';
    el.textContent = msg;
    t.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // ------------------------------------------------------------ ind math
  function ema(src, n) {
    var k = 2 / (n + 1), out = [], e = src[0];
    for (var i = 0; i < src.length; i++) { e = i ? src[i] * k + e * (1 - k) : src[0]; out.push(e); }
    return out;
  }
  function sma(src, n) {
    var out = [], s = 0;
    for (var i = 0; i < src.length; i++) {
      s += src[i];
      if (i >= n) s -= src[i - n];
      out.push(i >= n - 1 ? s / n : null);
    }
    return out;
  }
  function heikin(bars) {
    var out = [];
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      var hc = (b.o + b.h + b.l + b.c) / 4;
      var ho = i ? (out[i - 1].o + out[i - 1].c) / 2 : (b.o + b.c) / 2;
      out.push({ t: b.t, o: ho, c: hc, h: Math.max(b.h, ho, hc), l: Math.min(b.l, ho, hc), v: b.v });
    }
    return out;
  }
  function niceStep(raw) {
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * mag;
  }
  function fmt(p) {
    if (PREC_OVERRIDE != null && PREC_OVERRIDE !== 'auto') return trimNum(p, PREC_OVERRIDE);
    return p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(4);
  }
  var PREC_OVERRIDE = null;
  function trimNum(p, prec) {
    var s = p.toFixed(prec);
    return s;
  }
  function hexToRgb(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function withAlpha(hex, a) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a == null ? 1 : a) + ')';
  }
  // ========================================================== Chart objektas
  function makeChart(cfg) {
    var C = {
      cv: cfg.canvas, sym: cfg.sym, tf: cfg.tf || '1h',
      ctype: 'candle', bars: [], ws: null, lastPrice: 0,
      cvd: 0, cvdSeries: [], tps: 0, tpsCount: 0, tpsAt: 0,
      inds: { vol: true }, drawings: [], tool: 'cursor',
      magnet: false, lock: false, hide: false, log: false, auto: true,
      drag: null, hover: null, dirty: true,
      view: { left: 0, width: 0, follow: true, yZoom: 1, yShift: 0 }
    };
    var ctx = C.cv.getContext('2d');

    function resize() {
      var r = C.cv.parentElement.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      C.cv.width = Math.max(400, r.width) * dpr;
      C.cv.height = Math.max(300, r.height) * dpr;
      C.cv.style.width = r.width + 'px';
      C.cv.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      C.W = r.width; C.H = r.height;
      C.dirty = true;
    }
    window.addEventListener('resize', resize);
    resize();

    var loadingEl = document.getElementById('chart-loading');
    function setLoading(on) { if (loadingEl) { if (on) loadingEl.removeAttribute('hidden'); else loadingEl.setAttribute('hidden', ''); } }

    async function load() {
      setLoading(true);
      try {
        var r = await fetch(REST + '/fapi/v1/klines?symbol=' + C.sym + '&interval=' + C.tf + '&limit=300');
        if (!r.ok) { toast('Klines HTTP ' + r.status); return; }
        var raw = await r.json();
        C.bars = raw.map(function (k) { return { t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }; });
        C.lastPrice = C.bars.length ? C.bars[C.bars.length - 1].c : 0;
        C.dirty = true;
      } catch (e) { toast('Klines error: ' + e.message); }
      finally { setLoading(false); }
    }

    function connect() {
      // Atjunk seną, jei buvo (legacy tiesioginis WS, naudojamas tik kai nėra FeedManager)
      if (C.feedUnsubscribe) { try { C.feedUnsubscribe(); } catch (e) {} C.feedUnsubscribe = null; }
      if (C.ws) { C.ws.onclose = null; try { C.ws.close(); } catch (e) {} C.ws = null; }

      // Pirmenybė: FeedManager (vienas WS per simbolį, broadcast'inamas visiems chart'ams)
      if (window.HgfxFeed && window.HgfxFeed.FeedManager) {
        if (!C._feedManagerInstance) C._feedManagerInstance = window.__hgfxFeedManager;
        if (!C._feedManagerInstance) C._feedManagerInstance = new window.HgfxFeed.FeedManager();
        C.feedUnsubscribe = C._feedManagerInstance.subscribe(C.sym, function (trade) {
          // trade: { tradeId, symbol, price, qty, aggressor, ts, venue }
          latency = Date.now() - trade.ts;
          onTrade(C, {
            e: 'aggTrade', a: trade.tradeId, s: trade.symbol,
            p: String(trade.price), q: String(trade.qty),
            T: trade.ts, m: trade.aggressor === 'sell', E: trade.ts
          });
          C.dirty = true;
        });
        return;
      }
      // Fallback: tiesioginis WS (jei feed.js neužsikrovė – legacy kelias)
      var s = C.sym.toLowerCase() + '@aggTrade';
      try { C.ws = new WebSocket(WSS + s); } catch (e) { return; }
      C.ws.onmessage = function (ev) {
        var d;
        try { d = JSON.parse(ev.data).data; } catch (e) { return; }
        if (!d || d.e !== 'aggTrade') return;
        latency = Date.now() - d.E;
        onTrade(C, d);
        C.dirty = true;
      };
      C.ws.onclose = function () { setTimeout(connect, 2000); };
      C.ws.onerror = function () { try { C.ws.close(); } catch (e) {} };
    }
    function onTrade(C, d) {
      var p = +d.p, q = +d.q;
      C.lastPrice = p;
      C.cvd += d.m ? -q : q;
      C.tpsCount++;
      var now = Date.now();
      if (now - C.tpsAt >= 1000) { C.tps = C.tpsCount; C.tpsCount = 0; C.tpsAt = now; }
      // įlastas į dabartinę žvakę (pagal tf ms)
      var tfMs = TFMS[C.tf] || 3600000;
      var t0 = d.T - d.T % tfMs;
      var b = C.bars.length ? C.bars[C.bars.length - 1] : null;
      if (b && b.t === t0) {
        b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); b.c = p; b.v += q;
      } else if (!b || t0 > b.t) {
        C.bars.push({ t: t0, o: b ? b.c : p, h: p, l: p, c: p, v: q });
        if (C.bars.length > 400) C.bars.shift();
      }
      C.cvdSeries.push(C.cvd);
      if (C.cvdSeries.length > 400) C.cvdSeries.shift();
      // tape widget
//@@T19-KEEP@@
      if (C.tapeEl) {
        var row = document.createElement('div');
        row.className = 'tw-row ' + (d.m ? 'sell' : 'buy');
        row.textContent = fmt(p) + '  ' + q.toFixed(4) + '  ' + new Date(d.T).toISOString().slice(11, 19);
        C.tapeEl.prepend(row);
        while (C.tapeEl.children.length > 50) C.tapeEl.lastChild.remove();
      }
      if (C === main) checkAlerts(p);
    }

    function setTf(tf) {
      C.tf = tf;
      if (C === main) {
        document.querySelectorAll('#ivals .btn').forEach(function (b) {
          b.setAttribute('aria-checked', String(b.getAttribute('data-ival') === tf));
        });
      }
      load();
    }

    C.load = load; C.connect = connect; C.setTf = setTf; C.onTrade = onTrade;
    C.ctx = ctx;
    return C;
  }

  var TFMS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  var latency = 0;
  var cv = $('cv');
  var main = makeChart({ canvas: cv, sym: 'BTCUSDT', tf: '1h' });
  // ================================================================ Settings bakendra
  // `main.s` = efektyvūs nustatymai (pane→workspace→default) su fallback dabartinėm
  // spalvom, kad chart veiktų net jei HgfxSettings neprieinamas.
  var HgS = window.HgfxSettings || null;
  var SETTINGS_STORE = HgS ? HgS.load() : null;
  var DEFAULT_S = {
    chartBackground: '#0b0d0e', plotBackground: '#0b0d0e',
    grid: 'both', gridColor: '#1c2024', gridOpacity: 1, gridWidth: 1, gridLineStyle: 'solid',
    showBorder: true, borderColor: '#1c2024', borderWidth: 1,
    showWatermark: false, watermarkText: 'HUGOFXLAB', watermarkOpacity: .6, watermarkPosition: 'center', watermarkFontSize: 48,
    labelFontSize: 'medium', axisLabelColor: '#8b909a',
    chartStyle: 'candle', bullColor: GREEN, bearColor: RED, wickColor: GREEN,
    bullBorderColor: GREEN, bearBorderColor: RED, showWicks: true, showCandleBorders: true,
    candleWidth: 62, showVolume: true, volumePosition: 'bottom',
    bullVolumeColor: GREEN, bearVolumeColor: RED, volumeOpacity: .3,
    priceScalePos: 'right', timeScalePos: 'bottom', showPriceLabels: true, showTimeLabels: true,
    showLastPriceLine: true, lastPriceLineColor: '#e8e9ea', lastPriceLineStyle: 'solid', showLastPriceLabel: true,
    wheelMode: 'zoom', doubleClickAction: 'fit', dragAction: 'pan', spaceDragPan: true,
    zoomToCursor: true, zoomSensitivity: 1, panSensitivity: 1, pinchZoom: true, twoFingerPan: true, doubleTapReset: true,
    keyboardShortcuts: true, arrowPanStep: 15, crosshairMode: 'normal', cursorStyle: 'crosshair',
    showDrawings: true, lockDrawings: false, drawingLineColor: '#e0c46c', drawingLineWidth: 1.4, drawingLineStyle: 'solid', drawingOpacity: 1, magnetMode: false
  };
  main.s = Object.assign({}, DEFAULT_S, SETTINGS_STORE ? HgS.mergeSettings(SETTINGS_STORE, 'p1') : {});
  function activeSettings() { return main.s || DEFAULT_S; }
  function applySettingsToChart() {
    var s = activeSettings();
    main.ctype = s.chartStyle || main.ctype;
    main.log = s.logScale === true;
    main.auto = s.autoScale !== false;
    if (s.indVolume !== undefined) main.inds.vol = s.indVolume;
    if (s.indEMA20 !== undefined) main.inds.ema20 = s.indEMA20;
    if (s.indEMA50 !== undefined) main.inds.ema50 = s.indEMA50;
    if (s.indSMA200 !== undefined) main.inds.sma200 = s.indSMA200;
    if (s.indVWAP !== undefined) main.inds.vwap = s.indVWAP;
    if (s.indBB !== undefined) main.inds.bb = s.indBB;
    if (s.indCVD !== undefined) main.inds.cvd = s.indCVD;
    PREC_OVERRIDE = (s.pricePrecision != null && s.pricePrecision !== 'auto') ? s.pricePrecision : (s.decimalPrecision != null ? s.decimalPrecision : null);
    if (s.magnetMode !== undefined) main.magnet = s.magnetMode;
    if (s.lockDrawings !== undefined) main.lock = s.lockDrawings;
    main.dirty = true;
  }
  // ================================================================ Renderer
  function draw(C) {
    if (!C.bars.length) return;
    var ctx = C.ctx, W = C.W, H = C.H;
    var PL = PADL, PR = W - PADR, PT = PADT, PB = H - PADB;
    var volH = C.inds.vol ? 0.14 : 0;
    var PH = PB - (PB - PT) * volH;
    var data = C.ctype === 'heikin' ? heikin(C.bars) : C.bars;
    var N = data.length;
    // ---- View: slankus \u201e\u017eymos langas\u201c (bar\u0173 indeksais, float) ----
    C.view.width = Math.max(8, Math.min(N || 8, C.view.width || N));
    if (C.view.follow) C.view.left = N - C.view.width;
    var left = C.view.left, width = C.view.width;
    // Laisvas over-scroll: žvakes galima atitraukti ir kairėn, ir dešinėn su tuščia vieta
    var maxLeft = Math.min(0, N - width) + width * 0.9;
    var minLeft = maxLeft - width - width * 0.9;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
    C.view.left = left;
    var i0 = Math.max(0, Math.floor(left)), i1 = Math.min(N, Math.ceil(left + width));
    if (i1 <= i0) i1 = Math.min(N, i0 + 1);
    var vis = data.slice(i0, i1);
    var lo = Infinity, hi = -Infinity, vMax = 0;
    vis.forEach(function (b) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); vMax = Math.max(vMax, b.v); });
    if (!(lo < hi) || !vis.length) { lo = 0; hi = 1; vMax = 1; }
    if (!C.auto) {
      var tail = vis.slice(-120);
      if (tail.length) { lo = Math.min.apply(null, tail.map(function (b) { return b.l; })); hi = Math.max.apply(null, tail.map(function (b) { return b.h; })); }
    }
    var pad = (hi - lo) * .07 || 1;
    lo -= pad; hi += pad;
    // Y scale (0.1\u201310x) aplink centr\u0105 + Y shift (vertikalus pan)
    var cy = (lo + hi) / 2, half = (hi - lo) / 2 / (C.view.yZoom || 1);
    lo = cy - half; hi = cy + half;
    var dy = (C.view.yShift || 0) * half * 1.0;
    lo += dy; hi += dy;
    if (C.log) { lo = Math.log(Math.max(1e-9, lo)); hi = Math.log(Math.max(1e-9, hi)); }
    var step = (PR - PL) / width;
    var yOf = function (p) {
      if (C.log) p = Math.log(Math.max(1e-9, p));
      return PB - (p - lo) / (hi - lo) * (PB - PT);
    };
    var yV = function (v) { return PB - v / (vMax || 1) * (PB - PH); };
    var xOf = function (i) { return PL + (i - left) * step + step / 2; };

    ctx.clearRect(0, 0, W, H);
    var _s = activeSettings();
    ctx.fillStyle = _s.chartBackground || '#0b0d0e';
    ctx.fillRect(0, 0, W, H);

    // tinklelis + kainų ašis
    var ts = niceStep((hi - lo) / 7);
    ctx.font = (main.cd ? (main.cd + 'px ') : '') + '11px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = _s.gridWidth || 1;
    var showH = _s.grid !== 'none' && _s.grid !== 'vertical';
    var showV = _s.grid !== 'none' && _s.grid !== 'horizontal';
    var gridColor = _s.gridColor || '#1c2024';
    ctx.strokeStyle = withAlpha(gridColor, _s.gridOpacity != null ? _s.gridOpacity : 1);
    ctx.setLineDash(_s.gridLineStyle === 'dashed' ? [5, 4] : _s.gridLineStyle === 'dotted' ? [2, 3] : []);
    for (var p = Math.ceil(lo / ts) * ts; p < hi; p += ts) {
      var py = yOf(C.log ? Math.exp(p) : p);
      if (showH) { ctx.beginPath(); ctx.moveTo(PL, py); ctx.lineTo(PR, py); ctx.stroke(); }
      if (_s.showPriceLabels !== false) {
        ctx.fillStyle = _s.axisLabelColor || '#8b909a';
        ctx.fillText(C.log ? fmt(Math.exp(p)) : fmt(p), PR + 6, py);
      }
    }
    ctx.setLineDash([]);
    if (showV) {
      ctx.strokeStyle = withAlpha(gridColor, (_s.gridOpacity != null ? _s.gridOpacity : 1) * 0.6);
      var gEvery = Math.max(1, Math.ceil(width / 10));
      for (var gi = Math.ceil(left / gEvery) * gEvery; gi < i1 && gi < N; gi += gEvery) {
        if (gi < i0 || gi < 0) continue;
        ctx.beginPath(); ctx.moveTo(xOf(gi), PT); ctx.lineTo(xOf(gi), PB); ctx.stroke();
      }
    }
    // volume
    if (C.inds.vol && _s.volumePosition !== 'hidden') {
      for (var i = i0; i < i1; i++) {
        var b = data[i];
        ctx.fillStyle = withAlpha(b.c >= b.o ? _s.bullVolumeColor : _s.bearVolumeColor, _s.volumeOpacity != null ? _s.volumeOpacity : .3);
        var vy = yV(b.v);
        ctx.fillRect(xOf(i) - step * .3, vy, Math.max(step * .6, 1), PB - vy);
      }
    }
    // price series
    if (C.ctype === 'candle' || C.ctype === 'heikin') {
      var bw = Math.max(2, step * _s.candleWidth / 100);
      for (var i = i0; i < i1; i++) {
        var b = data[i], up = b.c >= b.o, x = xOf(i);
        var bodyCol = up ? _s.bullColor : _s.bearColor;
        var wickCol = _s.wickColor || bodyCol;
        var borderCol = up ? (_s.bullBorderColor || _s.bullColor) : (_s.bearBorderColor || _s.bearColor);
        ctx.strokeStyle = wickCol; ctx.fillStyle = bodyCol;
        if (_s.showWicks !== false) {
          ctx.beginPath();
          ctx.moveTo(x, yOf(b.h)); ctx.lineTo(x, yOf(b.l));
          ctx.lineWidth = 1; ctx.stroke();
        }
        var yt = yOf(Math.max(b.o, b.c)), yb = yOf(Math.min(b.o, b.c));
        ctx.fillRect(x - bw / 2, yt, bw, Math.max(yb - yt, 1));
        if (_s.showCandleBorders !== false) {
          ctx.strokeStyle = borderCol; ctx.lineWidth = 1;
          ctx.strokeRect(x - bw / 2, yt, bw, Math.max(yb - yt, 1));
        }
      }
    } else if (C.ctype === 'bar') {
      for (var i = i0; i < i1; i++) {
        var b = data[i], col = b.c >= b.o ? GREEN : RED, x = xOf(i);
        ctx.strokeStyle = col; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, yOf(b.h)); ctx.lineTo(x, yOf(b.l));
        ctx.moveTo(x - step * .3, yOf(b.o)); ctx.lineTo(x, yOf(b.o));
        ctx.moveTo(x, yOf(b.c)); ctx.lineTo(x + step * .3, yOf(b.c));
        ctx.stroke();
      }
    } else if (C.ctype === 'line' || C.ctype === 'area') {
      ctx.strokeStyle = '#4a8dff'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      var started = false;
      for (var i = i0; i < i1; i++) { var x = xOf(i), y = yOf(data[i].c); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
      ctx.stroke();
      if (C.ctype === 'area') {
        ctx.lineTo(xOf(Math.max(left, i1 - 1)), PB); ctx.lineTo(xOf(Math.max(left, i0)), PB);
        ctx.closePath(); ctx.fillStyle = 'rgba(74,141,255,.12)'; ctx.fill();
      }
    }
    // indikatoriai
    var closes = C.bars.map(function (b) { return b.c; });
    function poly(series, color, dash) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.setLineDash(dash ? [5, 4] : []);
      ctx.beginPath();
      var started = false;
      for (var i = i0; i < i1; i++) {
        if (series[i] == null) { started = false; continue; }
        var x = xOf(i), y = yOf(series[i]);
        started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        started = true;
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (C.inds.ema20) poly(ema(closes, 20), '#f0b90b');
    if (C.inds.ema50) poly(ema(closes, 50), '#b06cf0');
    if (C.inds.sma200) poly(sma(closes, 200), '#4a8dff');
    if (C.inds.vwap) poly(vwap(C.bars), '#00c2ff', true);
    if (C.inds.bb) {
      var bb = boll(closes);
      poly(bb.up, '#6f7480', true); poly(bb.lo, '#6f7480', true); poly(bb.mid, '#8b909a');
    }
    if (C.inds.cvd) {
      // CVD live iš aggTrade — normalizuotas į chart aukštį
      var cmin = Math.min.apply(null, C.cvdSeries.concat([0]));
      var cmax = Math.max.apply(null, C.cvdSeries.concat([0]));
      var cy = function (v) { return PT + (1 - (v - cmin) / (cmax - cmin || 1)) * (PB - PT) * .9; };
      ctx.strokeStyle = '#e0a13e'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var i = 0; i < Math.min(C.cvdSeries.length, N); i++) {
        var x = xOf(N - 1 - (C.cvdSeries.length - 1 - i)), y = cy(C.cvdSeries[i]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // last price + laiko ašis
    if (C.lastPrice && _s.showLastPriceLine !== false) {
      var ly = yOf(C.lastPrice);
      var upc = C.lastPrice >= data[0].o;
      ctx.strokeStyle = _s.lastPriceLineColor || (upc ? GREEN : RED);
      ctx.setLineDash(_s.lastPriceLineStyle === 'dashed' ? [6, 5] : _s.lastPriceLineStyle === 'dotted' ? [2, 4] : []);
      ctx.beginPath(); ctx.moveTo(PL, ly); ctx.lineTo(PR, ly); ctx.stroke();
      ctx.setLineDash([]);
      if (_s.showLastPriceLabel !== false) {
        ctx.fillStyle = _s.lastPriceLineColor || (upc ? GREEN : RED);
        ctx.fillRect(PR, ly - 9, PADR, 18);
        ctx.fillStyle = '#0b0d0e';
        ctx.fillText(fmt(C.lastPrice), PR + 6, ly);
      }
    }
    if (_s.showTimeLabels !== false) {
      ctx.fillStyle = _s.axisLabelColor || '#8b909a';
      var every = Math.max(1, Math.ceil(width / 8));
      for (var i = Math.ceil(left / every) * every; i < i1 && i < N; i += every) {
        if (i < i0 || i < 0) continue;
        var d = new Date(data[i].t);
        ctx.fillText(('0' + d.getUTCHours()).slice(-2) + ':00', xOf(i) - 14, H - 8);
      }
    }

    // drawings (show/hide via settings, not hidden)
    if (!C.hide && _s.showDrawings !== false) {
      var _dlw = _s.drawingLineWidth || 1.4;
      var _dlcol = _s.drawingLineColor || '#e0c46c';
      C.drawings.forEach(function (g) {
        ctx.strokeStyle = withAlpha(g.color || _dlcol, _s.drawingOpacity != null ? _s.drawingOpacity : 1);
        ctx.lineWidth = _dlw;
        var x1 = xOf(g.i0), y1 = yOf(g.p0);
        if (g.type === 'hline') {
          ctx.beginPath(); ctx.moveTo(PL, y1); ctx.lineTo(PR, y1); ctx.stroke();
        } else {
          var x2 = xOf(g.i1), y2 = yOf(g.p1);
          if (g.type === 'trend') { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
          else if (g.type === 'ray') {
            var dx = x2 - x1, dy = y2 - y1, k = (PR - x1) / (dx || 1e-9);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + dx * Math.max(1, k), y1 + dy * Math.max(1, k)); ctx.stroke();
          } else if (g.type === 'rect') {
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          } else if (g.type === 'fib') {
            [0, .236, .382, .5, .618, 1].forEach(function (f) {
              var yv = yOf(g.p0 + (g.p1 - g.p0) * f);
              ctx.beginPath(); ctx.moveTo(PL, yv); ctx.lineTo(PR, yv); ctx.stroke();
              ctx.fillStyle = '#8b909a';
              ctx.fillText(f.toFixed(3), PL + 4, yv - 6);
            });
          }
        }
      });
    }
    // crosshair
    if (C.hover && _s.crosshairMode !== 'off') {
      var hx = Math.max(PL, Math.min(PR, C.hover.x)), hy = C.hover.y;
      if (_s.crosshairMode === 'magnet' && data.length) {
        var bbi = Math.max(i0, Math.min(i1 - 1, Math.floor(left + (hx - PL) / step)));
        if (data[bbi]) hy = yOf(data[bbi].c);
      }
      var bi = Math.max(i0, Math.min(i1 - 1, Math.floor(left + (hx - PL) / step)));
      var priceAt = lo + (PB - hy) / (PB - PT) * (hi - lo);
      if (C.log) priceAt = Math.exp(priceAt);
      C._hoverBar = { bar: data[bi] || null, price: priceAt };
    }
    if (C.hover && C.tool === 'cursor' && _s.crosshairMode !== 'off') {
      ctx.strokeStyle = '#565d66'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hx, PT); ctx.lineTo(hx, PB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PL, hy); ctx.lineTo(PR, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#2a2e39'; ctx.fillRect(PR, hy - 9, PADR, 18);
      ctx.fillStyle = '#e8e9ea'; ctx.fillText(fmt(priceAt), PR + 6, hy);
      var hb = data[bi];
      if (hb) {
        ctx.fillStyle = '#2a2e39';
        var lbl = new Date(hb.t).toISOString().slice(0, 16).replace('T', ' ');
        ctx.fillText(lbl, hx + 8, PT - 10);
      }
      C._hoverBar.price = priceAt;
    }
//@@T9-END@@
    // drag preview
    if (C.drag && C.drag.preview) {
      var g = C.drag.preview;
      ctx.strokeStyle = '#e0c46c'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      if (g.type === 'hline') { ctx.beginPath(); ctx.moveTo(PL, yOf(g.p0)); ctx.lineTo(PR, yOf(g.p0)); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(xOf(g.i0), yOf(g.p0)); ctx.lineTo(xOf(g.i1), yOf(g.p1)); ctx.stroke(); }
      ctx.setLineDash([]);
    }
  }

  // ============================================================= rAF render loop
  var charts = [main];
  var rafPending = false;
  function frame() {
    rafPending = false;
    var anyDirty = false;
    charts.forEach(function (C) {
      if (C.dirty) { draw(C); C.dirty = false; anyDirty = true; }
    });
    if (anyDirty) { updateStatus(); if (T && T.sync) T.sync(); }
  }
  function kick() {
    if (!rafPending) { rafPending = true; requestAnimationFrame(frame); }
  }
  setInterval(kick, 300); // fallback tick (indicator chains, status)
  // ============================================================= pointer/veiksmai
  function pxToIndex(C, x) {
    var N = C.bars.length;
    var step = (C.W - PADR - PADL) / (C.view.width || N);
    var f = C.view.left + (x - PADL) / step;
    return Math.max(0, Math.min(N - 1, Math.floor(f)));
  }
  function priceFromY(C, y) {
    // atstatoma iš draw konteksto — supaprastinta: naudoja C._range (po draw)
    return C._priceFromY ? C._priceFromY(y) : 0;
  }
  cv.addEventListener('mousemove', function (e) {
    var r = cv.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    main.hover = { x: x, y: y };
    // ašies žymeklio grįžtamasis ryšys (kai nedragojam)
    if (panState) { /* drago metu žymeklis jau nustatytas */ }
    else if (x >= main.W - PADR) cv.style.cursor = 'ns-resize';
    else if (y >= main.H - PADB) cv.style.cursor = 'ew-resize';
    else cv.style.cursor = '';
    if (main.drag) {
      var i = pxToIndex(main, x);
      var p = main._hoverBar ? main._hoverBar.price : 0;
      if (main.magnet && main._hoverBar && main._hoverBar.bar) {
        var hb = main._hoverBar.bar;
        var cands = [hb.o, hb.h, hb.l, hb.c];
        p = cands.reduce(function (a, c2) { return Math.abs(c2 - p) < Math.abs(a - p) ? c2 : a; });
      }
      main.drag.preview.i1 = i;
      main.drag.preview.p1 = p;
      if (main.drag.preview.type === 'hline') main.drag.preview.p0 = p;
    }
    main.dirty = true;
  });
  cv.addEventListener('mouseleave', function () { main.hover = null; main.dirty = true; });
  cv.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var r = cv.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    var tool = main.tool;
    if (tool === 'cursor' || tool === 'arrow') return;
    var i = pxToIndex(main, x);
    var p = main._hoverBar ? main._hoverBar.price : 0;
    if (tool === 'trash') { main.drawings = []; main.dirty = true; toast('Drawings cleared'); return; }
    main.drag = { preview: { type: tool, i0: i, p0: p, i1: i, p1: p } };
  });
  window.addEventListener('mouseup', function () {
    if (!main.drag) return;
    var g = main.drag.preview;
    if (main.tool === 'hline' || Math.abs(g.i1 - g.i0) > 0 || Math.abs(g.p1 - g.p0) > 0) {
      main.drawings.push(g);
      if (main.lock) toast('Drawings locked — new drawings disabled on next tool use');
    }
    main.drag = null;
    main.dirty = true;
  });
  // ============================================================= CHART TRANSFORM (zoom/pan/scale)
  function isEditable(t){ return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function clampV(v, a, b){ return v < a ? a : (v > b ? b : v); }
  var spaceHeld = false;
  document.addEventListener('keydown', function (e) { if (e.code === 'Space' && !isEditable(e.target)) { spaceHeld = true; e.preventDefault(); } });
  document.addEventListener('keyup', function (e) { if (e.code === 'Space') spaceHeld = false; });

  var T = {
    panMode: (function () { try { return localStorage.getItem('tfm.panMode') || 'free'; } catch (e) { return 'free'; } })(),
    sm: 'zoom', // ctrl-drag funkcija: 'zoom'(pan) | 'scale'
    minW: 8,
    getN: function (c) { return Math.max(c.bars.length, 1); },
    clampL: function (c, left) {
      var N = T.getN(c), w = c.view.width;
      var maxL = Math.min(0, N - w) + w * 0.9;
      var minL = maxL - w - w * 0.9;
      return Math.max(minL, Math.min(maxL, left));
    },
    pctOf: function () {
      var c = main, N = T.getN(c);
      if (N <= 0) return 100;
      return clampV(100 * N / c.view.width, 5, 400);
    },
    setPct: function (pct) {
      var c = main, N = T.getN(c);
      pct = clampV(pct, 5, 400);
      var w = clampV(N * (100 / pct), T.minW, N * 1.5);
      c.view.width = w; c.view.left = T.clampL(c, N - w);
      c.view.follow = (c.view.left + w >= N - 0.5);
      c.dirty = true; T.sync();
    },
    fit: function (c) {
      var N = T.getN(c);
      c.view.width = N; c.view.left = 0; c.view.follow = true;
      c.view.yZoom = 1; c.view.yShift = 0;
      if (c === main) T.sm = 'zoom';
      c.dirty = true; T.sync();
    },
    zoom: function (c, factor, cxPx) {
      var N = T.getN(c);
      var hadFollow = c.view.follow;
      var pw = c.W - PADR - PADL;
      var newW = clampV(c.view.width * factor, T.minW, N * 1.5);
      var f = (typeof cxPx === 'number' && pw > 0) ? clampV((cxPx - PADL) / pw, 0, 1) : 0.5;
      var left = c.view.left + f * (c.view.width - newW);
      c.view.width = newW; c.view.left = T.clampL(c, left);
      c.view.follow = hadFollow ? true : (c.view.left + newW >= N - 0.5);
      c.dirty = true; T.sync();
    },
    panBy: function (c, dx, vy) {
      var pw = Math.max(1, c.W - PADR - PADL);
      if (dx) {
        var dIdx = dx / pw * c.view.width;
        c.view.left = T.clampL(c, c.view.left - dIdx);
        c.view.follow = (c.view.left + c.view.width >= T.getN(c) - 0.5);
      }
      if (vy) c.view.yShift = clampV((c.view.yShift || 0) + vy, -1.8, 1.8);
      c.dirty = true; T.sync();
    },
    setScale: function (sx, sy) {
      if (typeof sx === 'number' && isFinite(sx) && sx > 0) {
        main.view.width = clampV(main.view.width * sx, T.minW, T.getN(main) * 1.5);
        main.view.left = T.clampL(main, main.view.left);
        main.view.follow = (main.view.left + main.view.width >= T.getN(main) - 0.5);
      }
      if (typeof sy === 'number' && isFinite(sy) && sy > 0) main.view.yZoom = clampV(main.view.yZoom * sy, 0.1, 10);
      main.dirty = true; T.sync();
    },
    resetAll: function () {
      T.fit(main);
      T.panMode = 'free'; T.sm = 'zoom';
      try { localStorage.setItem('tfm.panMode', 'free'); } catch (e) {}
      main.dirty = true; T.sync();
      toast('View reset (R)');
    },
    cyclePanMode: function () {
      T.panMode = T.panMode === 'free' ? 'h' : T.panMode === 'h' ? 'v' : 'free';
      try { localStorage.setItem('tfm.panMode', T.panMode); } catch (e) {}
      main.dirty = true; T.sync();
      toast('Pan mode: ' + T.panMode);
    },
    toggleScaleMode: function () {
      T.sm = T.sm === 'zoom' ? 'scale' : 'zoom';
      T.sync();
      toast('Ctrl-drag: ' + (T.sm === 'scale' ? 'SCALE X/Y' : 'PAN'));
    },
    sync: function () { if (T.ui) T.ui.sync(); if (T.drawMinimap) T.drawMinimap(); }
  };

  cv.addEventListener('wheel', function (e) {
    if (T.busy) return;
    var s = activeSettings();
    if (s.wheelMode === 'disabled') return;
    e.preventDefault();
    var r = cv.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var zSens = s.zoomSensitivity != null ? s.zoomSensitivity : 1;
    var base = zSens * (e.ctrlKey ? (e.deltaY > 0 ? 1.06 : 0.943) : (e.deltaY > 0 ? 1.22 : 0.82));
    // ratukas ant ašies keičia tik tą ašį
    if (mx >= main.W - PADR) { // kainos juosta -> vertikalus zoom
      main.view.yZoom = clampV(main.view.yZoom / base, 0.2, 10);
      main.dirty = true; T.sync(); return;
    }
    if (my >= main.H - PADB) { // laiko juosta -> horizontalus zoom aplink žymeklį
      if (s.wheelMode !== 'zoom') return;
      T.zoom(main, base, s.zoomToCursor !== false ? mx : null); return;
    }
    var tool = main.tool;
    if (s.wheelMode !== 'zoom') return;
    if (tool !== 'cursor' && tool !== 'arrow') return;
    T.zoom(main, base, s.zoomToCursor !== false ? mx : null);
  }, { passive: false });
  cv.addEventListener('dblclick', function (e) {
    var s = activeSettings();
    e.preventDefault();
    if (s.doubleClickAction === 'disabled') return;
    if (s.doubleClickAction === 'reset') { T.fit(main); return; }
    T.fit(main); toast('Fit to screen');
  });

  // ---- Pan / Ctrl-drag scale ----
  var panState = null;
  cv.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var tool = main.tool;
    var s = activeSettings();
    var r = cv.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    // Zonos: dešinė kainos (Y) juosta / apatinė laiko (X) juosta
    var zone = null;
    if (s.dragAction !== 'disabled' && mx >= main.W - PADR) zone = 'y';
    else if (s.dragAction !== 'disabled' && my >= main.H - PADB) zone = 'x';
    // pan leidžiamas tik jei dragAction='pan' (ir per space jei spaceDragPan)
    var wantDrag = s.dragAction === 'pan' && (zone || (tool === 'cursor' || tool === 'arrow') || (s.spaceDragPan !== false && spaceHeld));
    if (!wantDrag) return;
    if (zone === null && (tool !== 'cursor' && tool !== 'arrow') && !(s.spaceDragPan !== false && spaceHeld)) return;
    e.preventDefault();
    panState = {
      sx: e.clientX, sy: e.clientY,
      L: main.view.left, w: main.view.width,
      shift: main.view.yShift, yz: main.view.yZoom,
      zone: zone,
      scale: (e.ctrlKey || e.metaKey) && T.sm === 'scale'
    };
    main.cv.style.cursor = zone === 'y' ? 'ns-resize' : (zone === 'x' ? 'ew-resize' : 'grabbing');
    // Atkabinti nuo \u201elive\u201c kra\u0161to, kad traukimas veikt\u0173 laisvai
    main.view.follow = false;
  });
  window.addEventListener('mousemove', function (e) {
    if (!panState) return;
    var dx = e.clientX - panState.sx, dy = e.clientY - panState.sy;
    var pw = Math.max(1, main.W - PADR - PADL);
    var ph = Math.max(1, main.H - PADB - PADT);
    // --- ašies skalavimas: tempdami juostą sutraukiame/išplečiame intervalą ---
    if (panState.zone === 'x') {
      // laiko ašis: tempimas dešinėn = išplėsti (daugiau barų), kairėn = sutraukti
      var newW = clampV(panState.w * (1 + dx / pw), T.minW, T.getN(main) * 1.5);
      main.view.width = newW;
      main.view.left = T.clampL(main, panState.L); // ankstyviausias kraštas fiksuotas
      main.view.follow = false;
      main.dirty = true; T.sync();
      return;
    }
    if (panState.zone === 'y') {
      // kainos ašis: tempimas aukštyn = priartinti (mažesnis diapazonas), žemyn = tolinti
      var newY = clampV(panState.yz * (1 - dy / ph), 0.2, 10);
      main.view.yZoom = newY;
      main.dirty = true; T.sync();
      return;
    }
    if (panState.scale) {
      if (Math.abs(dx) > 1) {
        var ew = clampV(panState.w * (1 + dx / pw), T.minW, T.getN(main) * 1.5);
        var f = dx > 0 ? 1 : 0;
        main.view.width = ew;
        main.view.left = T.clampL(main, panState.L + f * (panState.w - ew));
      }
      if (Math.abs(dy) > 1) main.view.yZoom = clampV(panState.yz * (1 + dy / pw), 0.1, 10);
      main.dirty = true; T.sync();
      return;
    }
    // Laisvas 2D pan: paj\u0117mus \u017evakes traukia \u012f bet kuri\u0105 pus\u0119
    main.view.follow = false;
    if (Math.abs(dx) > 1) {
      var dIdx = dx / pw * panState.w;
      main.view.left = T.clampL(main, panState.L - dIdx);
    }
    if (Math.abs(dy) > 1) main.view.yShift = clampV((panState.shift || 0) + dy / pw * 1.8, -1.8, 1.8);
    main.dirty = true; T.sync();
  });
  window.addEventListener('mouseup', function () {
    if (!panState) return;
    main.cv.style.cursor = '';
    // \u012ejungti gyv\u0105 sekim\u0105 tik jei view de\u0161inys kra\u0161tas sutampa su duomen\u0173 galu
    if (Math.abs((main.view.left + main.view.width) - T.getN(main)) < 1) main.view.follow = true;
    panState = null;
    main.dirty = true; T.sync();
  });

  // ---- touch: pinch zoom, 2-finger pan, double-tap reset ----
  var touch = null;
  cv.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var a = e.touches[0], b = e.touches[1];
      var r = cv.getBoundingClientRect();
      touch = { mode: 'pinch', d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), w: main.view.width, L: main.view.left, cx: (a.clientX + b.clientX) / 2 - r.left, lastTap: 0 };
      return;
    }
    if (e.touches.length === 1) {
      var now = Date.now();
      var prev = touch ? touch.lastTap : 0;
      if (now - prev < 400) { touch = null; T.fit(main); e.preventDefault(); return; }
      touch = { lastTap: now };
    }
  }, { passive: false });
  cv.addEventListener('touchmove', function (e) {
    if (!touch) return;
    e.preventDefault();
    if (touch.mode === 'pinch' && e.touches.length === 2) {
      var a = e.touches[0], b = e.touches[1];
      var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (touch.d) T.zoom(main, d / touch.d, touch.cx);
      touch.d = d;
    }
  }, { passive: false });
  cv.addEventListener('touchend', function (e) {
    if (touch) { touch.lastTap = Date.now(); if (e.touches.length < 2) touch.mode = null; }
  });
  // ---- keyboard shortcuts ----
  document.addEventListener('keydown', function (e) {
    if (isEditable(e.target)) return;
    if (activeSettings().keyboardShortcuts === false) return;
    if (e.ctrlKey || e.metaKey) return; // leisti naršyklės zoominimą / ctrl-drag reapimti
    var apStep = activeSettings().arrowPanStep != null ? activeSettings().arrowPanStep / 100 : 0.15;
    switch (e.key) {
      case '+': case '=': e.preventDefault(); T.zoom(main, 1 / 0.82); break;
      case '-': case '_': e.preventDefault(); T.zoom(main, 1.22); break;
      case '0': e.preventDefault(); T.fit(main); break;
      case '1': e.preventDefault(); T.setPct(100); break;
      case '2': e.preventDefault(); T.setPct(200); break;
      case 'ArrowLeft': e.preventDefault(); if (T.panMode === 'v') break; T.panBy(main, -main.view.width * apStep, 0); break;
      case 'ArrowRight': e.preventDefault(); if (T.panMode === 'v') break; T.panBy(main, main.view.width * apStep, 0); break;
      case 'ArrowUp': e.preventDefault(); if (T.panMode === 'h') break; T.panBy(main, 0, -0.35); break;
      case 'ArrowDown': e.preventDefault(); if (T.panMode === 'h') break; T.panBy(main, 0, 0.35); break;
      case 'r': case 'R': e.preventDefault(); T.resetAll(); break;
      case 'f': case 'F': e.preventDefault(); T.fit(main); break;
      case 'p': case 'P': e.preventDefault(); T.cyclePanMode(); break;
      case 's': case 'S': e.preventDefault(); T.toggleScaleMode(); break;
    }
  });
  // ============================================================= TRANSFORM UI (badge + panel + minimap)
  (function () {
    var style = document.createElement('style');
    style.textContent =
      '.tf-badge{position:absolute;top:6px;left:6px;z-index:20;font:600 11px/1 ui-monospace,monospace;color:#cfe3ff;background:rgba(30,36,45,.85);border:1px solid #3a4450;border-radius:6px;padding:3px 8px;cursor:pointer;user-select:none}.tf-badge:hover{border-color:#4a8dff}' +
      '.tf-panel{position:fixed;right:12px;bottom:12px;z-index:200;width:236px;background:#151a20;border:1px solid #3a4450;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:12px;font:12px/1.5 ui-monospace,monospace;color:#d6d9de}.tf-panel h4{margin:0 0 8px;font-size:12px;color:#e8e9ea}.tf-panel .row{display:flex;align-items:center;gap:6px;margin:7px 0}.tf-panel label{width:26px;color:#8b909a;flex:none}.tf-panel input[type=range]{flex:1;-webkit-appearance:none;background:#2a2e39;height:4px;border-radius:3px;outline:none}.tf-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#4a8dff;cursor:pointer}.tf-panel input[type=number]{width:52px;background:#0b0d0e;border:1px solid #3a4450;border-radius:5px;color:#e8e9ea;padding:2px 4px;font:inherit}.tf-panel button{background:#232a33;border:1px solid #3a4450;color:#d6d9de;border-radius:6px;padding:3px 7px;cursor:pointer;font:inherit}.tf-panel button:hover{border-color:#4a8dff}.tf-panel .btn-acc{background:#1c3a5f}.tf-panel .btns{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.tf-panel .sep{border-top:1px solid #2a2e39;margin:8px 0}.tf-panel .mode{display:inline-block;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tf-mm{width:100%;height:34px;margin-top:4px;position:relative;border:1px solid #2a2e39;border-radius:6px;background:#0b0d0e;cursor:crosshair;touch-action:none}canvas.tf-mmc{width:100%;height:34px;display:block;border-radius:6px}';
    document.head.appendChild(style);

    var wrap = main.cv.parentElement;
    wrap.style.position = wrap.style.position || 'relative';

    var badge = document.createElement('button');
    badge.className = 'tf-badge';
    badge.title = 'Zoom / transform controls';
    badge.textContent = '100%';
    wrap.appendChild(badge);

    var panel = document.createElement('div');
    panel.className = 'tf-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<h4>Chart transform</h4>' +
      '<div class="row"><label>Zoom</label><button data-za>−</button><div style="flex:1;text-align:center" data-zval>100%</div><button data-zb>＋</button></div>' +
      '<div class="row"><label>%</label><input type="range" data-zs min="5" max="400" step="1" value="100" title="Zoom %"><input type="number" data-zn min="5" max="400" value="100"></div>' +
      '<div class="row"><label>ScaleX</label><input type="range" data-sx min="0.1" max="10" step="0.1" value="1"><input type="number" data-sxn min="0.1" max="10" step="0.1" value="1" style="width:44px"></div>' +
      '<div class="row"><label>ScaleY</label><input type="range" data-sy min="0.1" max="10" step="0.1" value="1"><input type="number" data-syn min="0.1" max="10" step="0.1" value="1" style="width:44px"></div>' +
      '<div class="sep"></div>' +
      '<div class="btns">' +
      '<button data-panl title="Pan left">◀</button><button data-panr title="Pan right">▶</button>' +
      '<button data-panu title="Pan up">▲</button><button data-pand title="Pan down">▼</button>' +
      '<button data-mode title="Toggle pan mode">Mode <span class="mode" data-modev>free</span></button></div>' +
      '<div class="btns">' +
      '<button data-sm title="Toggle Ctrl-drag behavior">Ctrl-drag: <span data-smv>PAN</span></button>' +
      '<button data-pres-25>25%</button><button data-pres-50>50%</button><button data-pres-100>100%</button>' +
      '<button data-pres-200>200%</button></div>' +
      '<div class="btns"><button class="btn-acc" data-fit>Fit (F)</button><button class="btn-acc" data-reset>Reset (R)</button></div>' +
      '<div class="sep"></div>' +
      '<div style="font-size:10px;color:#6f7480">Wheel=zoom · dbl-click=fit · drag=pan · Ctrl+wheel=precise · Ctrl+drag=scale · Space+drag=pan · P=pan mode · S=scale mode</div>';
    document.body.appendChild(panel);

    var mmWrap = document.createElement('div');
    mmWrap.className = 'tf-mm';
    var mm = document.createElement('canvas');
    mm.className = 'tf-mmc';
    mmWrap.appendChild(mm);
    wrap.appendChild(mmWrap);
    T.mm = mm;
    T.drawMinimap = function () {
      var mmc = T.mm; if (!mmc) return;
      var dpr = window.devicePixelRatio || 1;
      var rect = mmc.parentElement.getBoundingClientRect();
      var w = Math.max(100, rect.width), h = 34;
      mmc.width = Math.round(w * dpr); mmc.height = Math.round(h * dpr);
      mmc.style.width = w + 'px'; mmc.style.height = h + 'px';
      var mctx = mmc.getContext('2d');
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, w, h);
      var b = main.bars; if (!b.length) return;
      var lo = Infinity, hi = -Infinity, i;
      for (i = 0; i < b.length; i++) { lo = Math.min(lo, b[i].l); hi = Math.max(hi, b[i].h); }
      var span = (hi - lo) || 1;
      mctx.fillStyle = 'rgba(139,144,154,.55)';
      var bw = Math.max(1, w / b.length);
      for (i = 0; i < b.length; i++) {
        var x = i * bw;
        var yA = h - ((b[i].c - lo) / span) * (h - 2) - 1;
        var yB = h - ((Math.max(b[i].o, b[i].c) - lo) / span) * (h - 2) - 1;
        mctx.fillRect(x, Math.min(yA, yB), bw, Math.max(1, Math.abs(yB - yA)));
      }
      var c = main, N = T.getN(c);
      var f0 = clampV(c.view.left / N, 0, 1), f1 = clampV((c.view.left + c.view.width) / N, 0, 1);
      mctx.fillStyle = 'rgba(74,141,255,.15)';
      mctx.fillRect(f0 * w, 0, (f1 - f0) * w, h);
      mctx.strokeStyle = '#4a8dff'; mctx.lineWidth = 1;
      mctx.strokeRect(f0 * w, 0, (f1 - f0) * w, h);
    };

    var mmDrag = false;
    function mmJump(e) {
      var r = mmWrap.getBoundingClientRect();
      var fx = clampV((e.clientX - r.left) / (r.width || 1), 0, 1);
      var N = T.getN(main);
      main.view.left = T.clampL(main, fx * N - main.view.width / 2);
      main.view.follow = false; main.dirty = true; T.sync();
    }
    mmWrap.addEventListener('mousedown', function (e) { mmDrag = true; mmJump(e); });
    window.addEventListener('mousemove', function (e) { if (mmDrag) mmJump(e); });
    window.addEventListener('mouseup', function () { mmDrag = false; });

    // --- panel wiring ---
    badge.onclick = function () { panel.hidden = !panel.hidden; badge.textContent = (panel.hidden ? Math.round(T.pctOf()) + '%' : '✕'); };
    function q(s) { return panel.querySelector(s); }
    q('[data-za]').onclick = function () { T.zoom(main, 1.22); };
    q('[data-zb]').onclick = function () { T.zoom(main, 1 / 0.82); };
    q('[data-zs]').oninput = function () { T.setPct(+this.value); };
    q('[data-zn]').onchange = function () { T.setPct(+this.value); };
    q('[data-sx]').oninput = function () { setXFromSlider(+this.value); };
    q('[data-sxn]').onchange = function () { setXFromSlider(+this.value); };
    q('[data-sy]').oninput = function () { main.view.yZoom = clampV(+this.value, 0.1, 10); main.dirty = true; T.sync(); };
    q('[data-syn]').onchange = function () { main.view.yZoom = clampV(+this.value, 0.1, 10); main.dirty = true; T.sync(); };
    function setXFromSlider(v) {
      var N = T.getN(main);
      main.view.width = clampV(N / v, T.minW, N * 1.25);
      main.view.left = T.clampL(main, main.view.left);
      main.view.follow = false; main.dirty = true; T.sync();
    }
    q('[data-panl]').onclick = function () { T.panBy(main, -main.view.width * 0.2, 0); };
    q('[data-panr]').onclick = function () { T.panBy(main, main.view.width * 0.2, 0); };
    q('[data-panu]').onclick = function () { T.panBy(main, 0, -0.35); };
    q('[data-pand]').onclick = function () { T.panBy(main, 0, 0.35); };
    q('[data-mode]').onclick = function () { T.cyclePanMode(); };
    q('[data-sm]').onclick = function () { T.toggleScaleMode(); };
    q('[data-pres-25]').onclick = function () { T.setPct(25); };
    q('[data-pres-50]').onclick = function () { T.setPct(50); };
    q('[data-pres-100]').onclick = function () { T.setPct(100); };
    q('[data-pres-200]').onclick = function () { T.setPct(200); };
    q('[data-fit]').onclick = function () { T.fit(main); };
    q('[data-reset]').onclick = function () { T.resetAll(); };

    T.ui = {
      sync: function () {
        var pct = Math.round(T.pctOf());
        badge.textContent = (panel.hidden ? pct + '%' : '✕');
        var zs = q('[data-zs]'), zn = q('[data-zn]');
        if (document.activeElement !== zs && document.activeElement !== zn) { zs.value = pct; zn.value = pct; }
        q('[data-zval]').textContent = pct + '%';
        var sX = clampV(T.getN(main) / main.view.width, 0.1, 10);
        var sxr = q('[data-sx]'), sxn = q('[data-sxn]');
        if (document.activeElement !== sxr && document.activeElement !== sxn) { sxr.value = sX.toFixed(1); sxn.value = sX.toFixed(1); }
        var syr = q('[data-sy]'), syn = q('[data-syn]');
        if (document.activeElement !== syr && document.activeElement !== syn) { syr.value = main.view.yZoom.toFixed(1); syn.value = main.view.yZoom.toFixed(1); }
        q('[data-modev]').textContent = T.panMode;
        q('[data-smv]').textContent = T.sm === 'scale' ? 'SCALE' : 'PAN';
      }
    };
  })();
  // ============================================================= status bar
  function updateStatus() {
    var b = main.bars.length ? main.bars[main.bars.length - 1] : null;
    if (!b) return;
    var chg = (b.c - b.o) / b.o * 100;
    $('sb-last').textContent = fmt(main.lastPrice || b.c);
    var chgEl = $('sb-chg');
    chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    chgEl.style.color = chg >= 0 ? GREEN : RED;
    $('sb-vol').textContent = Math.round(b.v).toLocaleString('en-US');
    $('sb-tps').textContent = String(main.tps);
    $('sb-bars').textContent = String(main.bars.length);
    // legend
    var lo = $('legend-ohlc');
    lo.querySelectorAll('b').forEach(function (el, k) {
      el.textContent = fmt([b.o, b.h, b.l, b.c][k]);
      el.style.color = b.c >= b.o ? GREEN : RED;
    });
    var ce = lo.querySelector('[data-k="chg"]');
    if (ce) {
      ce.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
      ce.style.color = chg >= 0 ? GREEN : RED;
    }
    var st = $('feed-status');
    var alive = main.ws && main.ws.readyState === 1;
    st.className = 'status ' + (alive ? 'status--live' : 'status--offline');
    var fl = $('feed-label');
    if (fl) fl.textContent = alive ? 'Live · Binance' : 'Reconnecting';
    var la = $('feed-lat');
    if (la) la.textContent = alive ? Math.round(latency) + 'ms' : '';
  }
  setInterval(updateStatus, 1000);

  // ============================================================= meniu pagalba
  function closeMenus() {
    document.querySelectorAll('.menu').forEach(function (m) { m.hidden = true; });
    document.querySelectorAll('[aria-haspopup]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }
  function toggleMenu(id, btn) {
    var m = $(id);
    var open = !m.hidden;
    closeMenus();
    if (!open) { m.hidden = false; if (btn) btn.setAttribute('aria-expanded', 'true'); }
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.menu') && !e.target.closest('[aria-haspopup]')) closeMenus();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
  // ============================================================= header wiring
  $('btn-ctype').onclick = function (e) { e.stopPropagation(); toggleMenu('menu-ctype', $('btn-ctype')); };
  $('btn-widget').onclick = function (e) { e.stopPropagation(); toggleMenu('menu-widget', $('btn-widget')); };
  $('btn-more').onclick = function (e) { e.stopPropagation(); toggleMenu('menu-more', $('btn-more')); };
  $('btn-symbol').onclick = function (e) { e.stopPropagation(); toggleMenu('menu-symbol', $('btn-symbol')); };

  // intervalai
  document.querySelectorAll('#ivals [data-ival]').forEach(function (b) {
    b.onclick = function () { main.setTf(b.getAttribute('data-ival')); fpReset(); main.dirty = true; };
  });

  // chart type
  document.querySelectorAll('#menu-ctype [data-ctype]').forEach(function (b) {
    b.onclick = function () {
      main.ctype = b.getAttribute('data-ctype');
      document.querySelectorAll('#menu-ctype [data-ctype]').forEach(function (x) {
        x.setAttribute('aria-checked', String(x === b));
      });
      $('ctype-icon').innerHTML = b.querySelector('svg') ? b.querySelector('svg').outerHTML : $('ctype-icon').innerHTML;
      $('btn-ctype').setAttribute('aria-label', 'Chart type: ' + b.textContent.trim());
      closeMenus(); main.dirty = true;
    };
  });
  // ============================================================= toolbar tools
  document.querySelectorAll('#tools [data-tool]').forEach(function (b) {
    b.onclick = function () {
      var t = b.getAttribute('data-tool');
      if (b.hasAttribute('data-toggle')) {
        var on = b.getAttribute('aria-pressed') === 'true';
        b.setAttribute('aria-pressed', String(!on));
        if (t === 'magnet') main.magnet = !on;
        if (t === 'lock') main.lock = !on;
        if (t === 'eye') { main.hide = !on; }
        main.dirty = true;
        return;
      }
      if (t === 'trash') { main.drawings = []; main.dirty = true; toast('Drawings cleared'); return; }
      main.tool = t;
      document.querySelectorAll('#tools [data-tool]').forEach(function (x) {
        if (!x.hasAttribute('data-toggle')) x.setAttribute('aria-pressed', String(x === b));
      });
    };
  });

  // ============================================================= indicators modal
  var indBackdrop = $('ind-backdrop');
  $('btn-ind').onclick = function () { indBackdrop.hidden = false; };
  $('ind-close').onclick = $('ind-done').onclick = function () { indBackdrop.hidden = true; };
  indBackdrop.addEventListener('click', function (e) { if (e.target === indBackdrop) indBackdrop.hidden = true; });
  $('ind-q').addEventListener('input', function () {
    var q = $('ind-q').value.toLowerCase();
    document.querySelectorAll('#ind-list .ind').forEach(function (b) {
      b.style.display = b.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
    });
  });
  function updateIndCount() {
    var n = Object.keys(main.inds).filter(function (k) { return main.inds[k]; }).length;
    $('ind-count').textContent = n + ' active';
    var li = $('legend-inds');
    li.innerHTML = ['ema20', 'ema50', 'sma200', 'vwap', 'bb', 'cvd'].filter(function (k) { return main.inds[k]; })
      .map(function (k) { return '<span class="badge">' + k.toUpperCase() + '</span>'; }).join('');
  }
  document.querySelectorAll('#ind-list [data-ind]').forEach(function (b) {
    b.onclick = function () {
      var k = b.getAttribute('data-ind');
      var on = !(main.inds[k] !== false && !(k === 'vol' && main.inds.vol === undefined));
      if (k === 'vol') on = !main.inds.vol; else on = !main.inds[k];
      if (k === 'vol') main.inds.vol = on; else main.inds[k] = on;
      b.setAttribute('aria-pressed', String(on));
      updateIndCount();
      main.dirty = true;
    };
  });
  // ============================================================= widgets
  function ensureWStyles() {
    var s = document.createElement('style');
    s.textContent =
      '.widget{position:absolute;top:0;right:0;width:270px;bottom:0;background:rgba(20,23,25,.96);border-left:1px solid var(--border);z-index:20;display:flex;flex-direction:column;font-size:11px;overflow:hidden}' +
      '.widget .wh{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--fg2);font-weight:600}' +
      '.widget .wb{flex:1;overflow:auto;font-family:var(--font-mono,monospace)}' +
      '.tw-row{display:grid;grid-template-columns:1fr 1fr 1fr;padding:1px 10px}' +
      '.tw-row.buy{color:#2ebd85}.tw-row.sell{color:#e0483e}' +
      '.ob-row{display:grid;grid-template-columns:1fr 1fr 1fr;padding:1px 10px;color:#b2b5be}' +
      '.ob-row span:first-child{color:#8b909a}' +
      '.fp-state{padding:14px 10px;color:#8b909a}' +
      '.fp-state--err{color:#e0483e}' +
      '.fp-state--gap{color:#f0b90b}' +
      '.fp-head{display:flex;gap:12px;padding:6px 10px;border-bottom:1px solid var(--border);color:#e8e9ea}' +
      '.fp-head .faint{color:#8b909a}' +
      '.fp-bar{border-bottom:1px solid var(--border)}' +
      '.fp-barh{display:flex;justify-content:space-between;padding:3px 10px;color:#b2b5be;font-weight:600}' +
      '.fp-barh .dpos{color:#2ebd85}.fp-barh .dneg{color:#e0483e}.fp-barh .fgap{color:#f0b90b}' +
      '.fp-lv{display:grid;grid-template-columns:1.1fr 1fr 1fr 1.3fr;padding:1px 10px}' +
      '.fp-lv .p{color:#8b909a}.fp-lv .b{color:#2ebd85;text-align:right}.fp-lv .s{color:#e0483e;text-align:right}' +
      '.fp-lv .sig{color:#f0b90b;text-align:right}' +
      '.hgfx-toast{position:fixed;left:50%;bottom:64px;transform:translate(-50%,8px);background:#1e2124;color:#e8e9ea;border:1px solid #2a2e39;padding:10px 16px;border-radius:8px;opacity:0;transition:.25s;z-index:300;font-size:12px}' +
      '.hgfx-toast.show{opacity:1;transform:translate(-50%,0)}' +
      '#toast .toast__item{display:none}';
    document.head.appendChild(s);
  }
  function toastFix() {
    // terminal.css turi .toast — naudojam papildomą toast elementą
    var t = document.createElement('div');
    t.id = 'hgfx-toasts';
    document.body.appendChild(t);
    window.__toast = function (msg) {
      var el = document.createElement('div');
      el.className = 'hgfx-toast';
      el.textContent = msg;
      t.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('show'); });
      setTimeout(function () { el.remove(); }, 4000);
    };
  }
  // ============================================================= widget menu
  function addWidget(name) {
    var host = $('chart');
    var w = document.createElement('div');
    w.className = 'widget'; w.id = 'w-' + name;
    w.innerHTML = '<div class="wh"><span>' + name + '</span><button aria-label="Close widget">✕</button></div><div class="wb" id="w-' + name + '-body"></div>';
    w.querySelector('button').onclick = function () {
      w.remove();
      if (name === 'Time & sales') main.tapeEl = null;
      if (name === 'Order book' && obTimer) { clearInterval(obTimer); obTimer = 0; }
      if (name === 'Footprint') fpTeardown();
    };
    host.appendChild(w);
    return w;
  }
  var obTimer = 0;
  async function pollOB() {
    var body = $('w-Order book-body');
    if (!body) { if (obTimer) { clearInterval(obTimer); obTimer = 0; } return; }
    try {
      var r = await fetch(REST + '/fapi/v1/depth?symbol=' + encodeURIComponent(main.sym) + '&limit=10');
      var d = await r.json();
      body.replaceChildren();
      d.asks.slice().reverse().forEach(function (a) {
        var row = document.createElement('div');
        row.className = 'ob-row';
        var s1 = document.createElement('span'); s1.textContent = fmt(+a[0]);
        var s2 = document.createElement('span'); s2.textContent = (+a[1]).toFixed(3);
        var s3 = document.createElement('span'); s3.textContent = 'ask';
        row.append(s1, s2, s3);
        body.appendChild(row);
      });
      var mid = document.createElement('div');
      mid.className = 'ob-row';
      mid.style.color = '#e8e9ea';
      var ms1 = document.createElement('span'); ms1.textContent = 'MID';
      var ms2 = document.createElement('span'); ms2.textContent = fmt(main.lastPrice);
      var ms3 = document.createElement('span');
      mid.append(ms1, ms2, ms3);
      body.appendChild(mid);
      d.bids.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'ob-row';
        var s1 = document.createElement('span'); s1.textContent = fmt(+b[0]);
        var s2 = document.createElement('span'); s2.textContent = (+b[1]).toFixed(3);
        var s3 = document.createElement('span'); s3.textContent = 'bid';
        row.append(s1, s2, s3);
        body.appendChild(row);
      });
    } catch (e) { /* ignore */ }
  }
  document.querySelectorAll('#menu-widget [data-widget]').forEach(function (b) {
    b.onclick = function () {
      var w = b.getAttribute('data-widget');
      var wMode = (window.__hgfxLayouts && window.__hgfxLayouts.activeWorkspace().mode) || 'preset';
      closeMenus();
      if (b.getAttribute('aria-disabled') === 'true') { toast('Order ticket — naudokite dashboard (risk pipeline)'); return; }
      // Free Layout: naudoti naujus add* API, kurie prideda kaip widget item
      if (wMode === 'free' && window.__hgfxLayouts) {
        if (w === 'chart') { window.__hgfxLayouts.addChart(main.sym, main.tf); return; }
        if (w === 'book')   { window.__hgfxLayouts.addWidget('orderbook', 'Order Book'); return; }
        if (w === 'tape')   { window.__hgfxLayouts.addWidget('time_sales', 'Time & Sales'); return; }
        if (w === 'fp')     { window.__hgfxLayouts.addWidget('footprint', 'Footprint'); return; }
        if (w === 'notes')  { window.__hgfxLayouts.addWidget('notes', 'Notes'); return; }
        if (w === 'cvd')    { window.__hgfxLayouts.addWidget('cvd', 'CVD'); return; }
        if (w === 'alerts') { window.__hgfxLayouts.addWidget('alerts', 'Alerts'); return; }
        if (w === 'vp')     { window.__hgfxLayouts.addWidget('volume_profile', 'Volume Profile'); return; }
        if (w === 'sessions') { window.__hgfxLayouts.addWidget('sessions', 'Sessions'); return; }
        if (w === 'ticket') { window.__hgfxLayouts.addWidget('order_ticket', 'Order Ticket · PAPER'); return; }
        if (w === 'positions') { window.__hgfxLayouts.addWidget('positions', 'Positions'); return; }
        if (w === 'split') { return; } // netinka free
      }
      // Preset mode: legacy widget sistema
      if (w === 'book') {
        if (!$('w-Order book')) { addWidget('Order book'); pollOB(); obTimer = setInterval(pollOB, 1000); }
      } else if (w === 'tape') {
        if (!$('w-Time & sales')) main.tapeEl = addWidget('Time & sales').querySelector('.wb');
      } else if (w === 'fp') {
        var fpExisting = $('w-Footprint');
        if (fpExisting) {
          // Dublikato nekuriame — fokusuojam ir parodom "already added".
          fpExisting.scrollIntoView({ block: 'nearest' });
          fpExisting.style.outline = '1px solid #f0b90b';
          setTimeout(function () { fpExisting.style.outline = ''; }, 700);
          toast('Footprint already added');
        } else {
          openFootprint();
        }
      } else if (w === 'split') {
        toggleSplit();
      } else if (w === 'ticket') {
        window.open('/dashboard#ticket', '_blank');
      }
    };
  });

  // ============================================================= Footprint widget
  // Realūs trade duomenys → OrderflowAggregator (src/core/orderflow, tas pats
  // kodą testuoja vitest) → footprint bar'ai + signalai. Jokių mock reikšmių.
  // Footprint turi SAVO WS: futures aggTrade; jei per 5 s neatėja nė vieno
  // trade'o (kai kurie tinklai/proxy blokuoja fstream data frames) — automatinis
  // fallback į spot aggTrade (tikri trade duomenys).
  var fpState = {
    agg: null, timer: 0, ws: null,
    src: 'futures', venue: 'binance',
    firstMsg: false, sym: '', tf: ''
  };
  var FP_SOURCES = {
    futures: { url: function (s) { return 'wss://fstream.binance.com/ws/' + s.toLowerCase() + '@aggTrade'; }, venue: 'binance', fallback: 'spot' },
    spot:    { url: function (s) { return 'wss://stream.binance.com:9443/ws/' + s.toLowerCase() + '@aggTrade'; }, venue: 'binance-spot', fallback: null }
  };

  function fpCore() { return window.OrderflowCore || null; }

  function fpTickSize() {
    var p = main.lastPrice || 0;
    if (!(p > 0)) return 0;
    var raw = p / 400;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  }

  function fpMakeAgg() {
    var core = fpCore();
    if (!core) return null;
    var tick = fpTickSize() || 1;
    return new core.OrderflowAggregator({
      symbol: main.sym,
      timeframeMs: TFMS[main.tf] || 3600000,
      tickSize: tick,
      retention: 60,
      dedupWindow: 20000
    });
  }

  function fpStateRow(body, cls, msg) {
    body.replaceChildren();
    var el = document.createElement('div');
    el.className = 'fp-state' + (cls ? ' ' + cls : '');
    el.textContent = msg;
    body.appendChild(el);
  }

  function fpCloseWs() {
    if (fpState.ws) {
      fpState.ws.onclose = null;
      fpState.ws.onmessage = null;
      try { fpState.ws.close(); } catch (e) {}
      fpState.ws = null;
    }
  }

  function fpConnect() {
    fpCloseWs();
    var src = FP_SOURCES[fpState.src];
    fpState.venue = src.venue;
    fpState.firstMsg = false;
    var sym = main.sym;
    var w;
    try { w = new WebSocket(src.url(sym)); } catch (e) { return; }
    fpState.ws = w;
    w.onmessage = function (ev) {
      var d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (!d || d.e !== 'aggTrade') return;
      if (!fpState.firstMsg) {
        fpState.firstMsg = true;
        if (fpState.src === 'spot') toast('Footprint: futures stream unavailable — using real spot trades');
      }
      if (!fpState.agg || fpState.sym !== sym) return;
      fpState.agg.ingest({
        venue: fpState.venue,
        tradeId: String(d.a),
        symbol: main.sym,
        price: +d.p,
        qty: +d.q,
        aggressor: d.m ? 'sell' : 'buy',
        ts: d.T
      });
    };
    w.onclose = function () {
      if (fpState.ws !== w) return; // pats uždarėm (reset/teardown/fallback)
      fpState.ws = null;
      if (fpState.agg) fpState.agg.markGap(fpState.venue);
      setTimeout(function () { if (fpState.agg && fpState.ws === null) fpConnect(); }, 2000);
    };
    w.onerror = function () { try { w.close(); } catch (e) {} };
    // Watchdog: futures neatėjo nė vieno trade'o per 5 s → spot fallback.
    setTimeout(function () {
      if (fpState.ws === w && !fpState.firstMsg && src.fallback) {
        fpState.src = src.fallback;
        fpConnect();
      }
    }, 5000);
  }

  function openFootprint() {
    var core = fpCore();
    if (!core || !core.OrderflowAggregator) {
      toast('Footprint: orderflow module not loaded');
      return;
    }
    var el = addWidget('Footprint').querySelector('.wb');
    fpState.agg = fpMakeAgg();
    fpState.sym = main.sym;
    fpState.tf = main.tf;
    fpStateRow(el, '', 'Connecting to live trade stream (' + main.sym + ' @ ' + main.tf + ')…');
    fpConnect();
    fpState.timer = setInterval(function () { fpRender(el); }, 1000);
  }

  function fpReset() {
    // Simbolio / timeframe pasikeitimas: senas bucket state saugiai išvalomas.
    if (!fpState.agg) return;
    fpState.agg = fpMakeAgg();
    fpState.sym = main.sym;
    fpState.tf = main.tf;
    var body = $('w-Footprint-body');
    if (body) fpStateRow(body, '', 'Connecting to live trade stream (' + main.sym + ' @ ' + main.tf + ')…');
    fpConnect();
  }

  function fpTeardown() {
    if (fpState.timer) { clearInterval(fpState.timer); fpState.timer = 0; }
    fpCloseWs();
    fpState.agg = null;
  }

  function fpRender(body) {
    var core = fpCore();
    var agg = fpState.agg;
    if (!core || !agg) {
      fpStateRow(body, 'fp-state--err', 'Orderflow module error — reload the page');
      return;
    }
    var snap = agg.snapshot();
    if (snap.tradesIngested === 0) {
      fpStateRow(body, '', 'Waiting for live aggTrade data (' + main.sym + ' @ ' + main.tf + ')…');
      return;
    }
    body.replaceChildren();

    // Data gap: WS žlunga / reconnect — paskutinis trade'as senas.
    var stale = Date.now() - snap.lastTradeTs > 15000;
    if (stale) {
      var gap = document.createElement('div');
      gap.className = 'fp-state fp-state--gap';
      gap.textContent = 'Data gap — feed stale, waiting for trades (reconnect handled by WS)';
      body.appendChild(gap);
    }

    var head = document.createElement('div');
    head.className = 'fp-head';
    var h1 = document.createElement('span'); h1.innerHTML = 'CVD <b>' + snap.cvd.toFixed(3) + '</b>';
    var h2 = document.createElement('span'); h2.innerHTML = '<span class="faint">trades</span> <b>' + snap.tradesIngested + '</b>';
    var h3 = document.createElement('span'); h3.innerHTML = '<span class="faint">dedup</span> <b>' + snap.tradesDeduped + '</b>';
    var h4 = document.createElement('span'); h4.innerHTML = '<span class="faint">src</span> <b>' + fpState.src + '</b>';
    head.append(h1, h2, h3, h4);
    body.appendChild(head);

    var nBars = Math.min(8, snap.bars.length);
    for (var bi = snap.bars.length - 1; bi >= snap.bars.length - nBars; bi--) {
      var bar = snap.bars[bi];
      var signals = core.detectAll(bar);
      var sigByPrice = {};
      signals.forEach(function (s) {
        if (!sigByPrice[s.price]) sigByPrice[s.price] = [];
        sigByPrice[s.price].push(s);
      });

      var box = document.createElement('div');
      box.className = 'fp-bar';
      var barh = document.createElement('div');
      barh.className = 'fp-barh';
      var bt = document.createElement('span');
      bt.textContent = new Date(bar.openTs).toISOString().slice(11, 16);
      var bd = document.createElement('span');
      bd.className = 'fp-delta ' + (bar.delta >= 0 ? 'dpos' : 'dneg');
      bd.textContent = '\u0394 ' + (bar.delta >= 0 ? '+' : '') + bar.delta.toFixed(3);
      barh.append(bt, bd);
      if (bar.incomplete) {
        var bg = document.createElement('span');
        bg.className = 'fgap';
        bg.textContent = 'GAP';
        barh.appendChild(bg);
      }
      box.appendChild(barh);

      var prices = Array.from(bar.levels.keys()).sort(function (a, b2) { return b2 - a; });
      prices.forEach(function (pk) {
        var lv = bar.levels.get(pk);
        var row = document.createElement('div');
        row.className = 'fp-lv';
        var cP = document.createElement('span'); cP.className = 'p'; cP.textContent = fmt(lv.price);
        var cB = document.createElement('span'); cB.className = 'b'; cB.textContent = lv.buyVol.toFixed(3);
        var cS = document.createElement('span'); cS.className = 's'; cS.textContent = lv.sellVol.toFixed(3);
        var cSig = document.createElement('span'); cSig.className = 'sig';
        var sigs = sigByPrice[pk] || [];
        var labels = sigs.map(function (s) {
          if (s.type === 'imbalance') return (s.side === 'buy' ? '\u25B2' : '\u25BC') + (s.stacked > 1 ? s.stacked : '');
          if (s.type === 'absorption') return 'ABS';
          return 'EXH';
        });
        cSig.textContent = labels.join(' ');
        row.append(cP, cB, cS, cSig);
        box.appendChild(row);
      });
      body.appendChild(box);
    }
  }

  function toggleSplit() {
    if (charts.length > 1) {
      var extra = charts.pop();
      extra.cv.remove(); extra.ws && extra.ws.close && (extra.ws.onclose = null, extra.ws.close());
      main.dirty = true;
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'chart';
    wrap.style.borderLeft = '1px solid var(--border)';
    var c2 = document.createElement('canvas');
    c2.id = 'cv2';
    wrap.appendChild(c2);
    $('chart').parentElement.insertBefore(wrap, $('chart').nextSibling);
    var alt = makeChart({ canvas: c2, sym: 'ETHUSDT', tf: main.tf });
    charts.push(alt);
    alt.load(); alt.connect();
    toast('Split: ETHUSDT @ ' + main.tf);
  }
  // ============================================================= more menu / header btns
  var alerts = [];
  function checkAlerts(p) {
    alerts.forEach(function (a) {
      if (a.fired) return;
      if (a.dir === 'above' ? p >= a.price : p <= a.price) {
        a.fired = true;
        toast('🔔 ALERT ' + main.sym + ' ' + a.dir + ' ' + a.price + ' — now ' + fmt(p));
        try {
          var ac = new (window.AudioContext || window.webkitAudioContext)();
          var o = ac.createOscillator(), g = ac.createGain();
          o.connect(g); g.connect(ac.destination);
          o.frequency.value = 880; g.gain.value = .15;
          o.start(); o.stop(ac.currentTime + .3);
        } catch (e) {}
      }
    });
  }
  function priceAlertModal() {
    // Custom input dialog (prompt() is deprecated, blocks thread, blocked in iframes).
    var existing = $('price-alert-modal');
    if (existing) { existing.remove(); }
    var overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.id = 'price-alert-modal';
    overlay.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pa-title" style="max-width:340px">' +
      '<div class="modal__head"><h2 class="modal__title" id="pa-title">Price alert</h2>' +
      '<button class="btn btn--icon" type="button" aria-label="Close">\u2715</button></div>' +
      '<div class="modal__body" style="display:flex;flex-direction:column;gap:10px">' +
      '<p class="faint" style="margin:0">Enter price. \u2265 = alert when price crosses above, \u2264 = crosses below.</p>' +
      '<input type="number" step="any" min="0" id="pa-input" style="background:var(--dropdown);border:1px solid var(--border2);color:var(--fg);border-radius:6px;padding:8px 10px;font:inherit" />' +
      '<div class="row" style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn--ghost" type="button" id="pa-cancel">Cancel</button>' +
      '<button class="btn btn--primary" type="button" id="pa-ok">Add alert</button>' +
      '</div></div></div>';
    document.body.appendChild(overlay);
    var input = $('pa-input');
    var close = function () { overlay.remove(); };
    var ok = function () {
      var p = parseFloat(input.value);
      if (!Number.isFinite(p) || p <= 0) { toast('Invalid price'); return; }
      var dir = p > (main.lastPrice || 0) ? 'above' : 'below';
      alerts.push({ price: p, dir: dir, fired: false });
      toast('Alert set: ' + (dir === 'above' ? '\u2265' : '\u2264') + ' ' + p);
      close();
    };
    overlay.querySelector('.btn--icon').onclick = close;
    $('pa-cancel').onclick = close;
    $('pa-ok').onclick = ok;
    input.onkeydown = function (e) { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); };
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    input.focus();
  }
  function snapshotPNG() {
    var a = document.createElement('a');
    a.download = main.sym + '_' + main.tf + '_' + Date.now() + '.png';
    a.href = cv.toDataURL('image/png');
    a.click();
    toast('Snapshot saved');
  }
  $('btn-alert').onclick = priceAlertModal;
  $('btn-shot').onclick = snapshotPNG;
  $('btn-layout').onclick = function () { toggleSplit(); };
  document.querySelectorAll('#menu-more [data-more]').forEach(function (b) {
    b.onclick = function () {
      closeMenus();
      var m = b.getAttribute('data-more');
      if (m === 'alert') priceAlertModal();
      if (m === 'shot') snapshotPNG();
      if (m === 'layout') toggleSplit();
    };
  });

  // status bar toggles
  $('btn-log').onclick = function () {
    main.log = !main.log;
    $('btn-log').setAttribute('aria-pressed', String(main.log));
    main.dirty = true;
  };
  $('btn-auto').onclick = function () {
    main.auto = !main.auto;
    $('btn-auto').setAttribute('aria-pressed', String(main.auto));
    main.dirty = true;
  };
  $('btn-tz').onclick = function () {
    tzLocal = !tzLocal;
    toast('Time labels: ' + (tzLocal ? 'local' : 'UTC'));
    main.dirty = true;
  };
  var tzLocal = false;
  // ============================================================= mode / symbol / keys / init
  // Symbol meniu (sukuriamas dinamiškai — terminal.tsx neturi statinio)
  var SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  var menuSym = document.createElement('div');
  menuSym.className = 'menu'; menuSym.id = 'menu-symbol'; menuSym.hidden = true;
  menuSym.setAttribute('role', 'menu');
  menuSym.innerHTML = '<div class="menu__group">Symbol · Binance USD-M</div>' + SYMS.map(function (s) {
    return '<button class="menu__item" role="menuitem" data-sym="' + s + '"><span class="grow">' + s + '</span></button>';
  }).join('');
  document.body.appendChild(menuSym);
  document.querySelectorAll('#menu-symbol [data-sym]').forEach(function (b) {
    b.onclick = function () {
      main.sym = b.getAttribute('data-sym');
      var base = main.sym.replace('USDT', '');
      $('sym-base').textContent = base;
      $('legend').querySelector('.legend__sym b').textContent = main.sym;
      closeMenus();
      main.load(); main.connect(); main.dirty = true;
      fpReset();
    };
  });
  // "mano @binance" venue
  $('sym-venue').textContent = '@ binance';

  // Mode menu (demo perjungiklis → reali reikšmė iš serverio env)
  function setMode(m) {
    var badge = $('mode-badge');
    badge.className = 'mode mode--' + m;
    badge.textContent = m.toUpperCase();
    document.querySelectorAll('#menu-mode [data-mode]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === m));
    });
  }
  $('mode-badge').onclick = function (e) { e.stopPropagation(); toggleMenu('menu-mode', $('mode-badge')); };
  document.querySelectorAll('#menu-mode [data-mode]').forEach(function (b) {
    b.onclick = function () { setMode(b.getAttribute('data-mode')); closeMenus(); };
  });

  // klaviatūra
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.altKey) {
      var map = { '1': 'candle', '2': 'heikin', '3': 'bar', '4': 'line', '5': 'area' };
      if (map[e.key]) { var btn = document.querySelector('#menu-ctype [data-ctype="' + map[e.key] + '"]'); if (btn) btn.click(); e.preventDefault(); }
      if (e.key === 'a' || e.key === 'A') priceAlertModal();
      if (e.key === 's' || e.key === 'S') snapshotPNG();
    }
    if (e.ctrlKey && e.key === '\\') { toggleSplit(); e.preventDefault(); }
  });

  // init
  ensureWStyles();
  toastFix();
  updateIndCount();
  setMode('paper');
  var m = location.search.match(/[?&]sym=([A-Z]+)/);
  if (m) { var b2 = document.querySelector('#menu-symbol [data-sym="' + m[1] + '"]'); if (b2) b2.click(); }
  m = location.search.match(/[?&]tf=([0-9]+[mhd])/);
  if (m) main.setTf(m[1]);
  main.load();
  main.connect();

  // ============================================================ Layouts system
  // Persistinama per localStorage 'hgfx.layouts.v1'.
  // Bridge: window.HgfxLayouts (TS controlleris) + šiame faile aprašytas
  // JSON state + workspace CRUD. Greita, be dependency.
  (function () {
    var STORAGE_KEY = 'hgfx.layouts.v1';
    var PRESETS = ['single', 'topdown', 'grid4', 'orderflow', 'trading', 'scanner', 'planner', 'free'];
    var PRESET_DESCRIPTIONS = {
      single:   { name: 'Single Chart',   hint: '1×1' },
      topdown:  { name: 'Top-Down',       hint: '1H · 15M · 5M' },
      grid4:    { name: '4 Chart Grid',   hint: '2×2' },
      orderflow:{ name: 'Order Flow',     hint: 'chart + FO' },
      trading:  { name: 'Trading Desk',   hint: 'PAPER' },
      scanner:  { name: 'Market Scanner', hint: 'multi-symbol' },
      planner:  { name: 'Session Planner',hint: '+ notes' },
      free:     { name: 'Free Layout',    hint: 'editable' }
    };

    function isNum(n) { return typeof n === 'number' && isFinite(n); }
    function clamp(n, mn, mx) { return Math.max(mn, Math.min(mx, n)); }
    function uid() { return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
    function chart(p, sym, iv) {
      return { id: 'p' + p, type: 'chart', chartPaneId: 'p' + p,
        position: { x: 0, y: 0, w: 1, h: 1, minW: 0.2, minH: 0.2 },
        config: { symbol: sym || 'BTCUSDT', interval: iv || '1h', active: p === 1 } };
    }
    function wid(id, type, x, y, w, h, title) {
      return { id: id, type: type, title: title,
        position: { x: x, y: y, w: w, h: h, minW: 0.15, minH: 0.12 } };
    }
    function buildPresetItems(id) {
      switch (id) {
        case 'single':    return [chart(1, 'BTCUSDT', '1h')];
        case 'topdown':   return [chart(1, 'BTCUSDT', '1h'),
                                 { ...chart(2, 'BTCUSDT', '15m'),
                                   position: { x: 0, y: 0.34, w: 1, h: 0.33, minW: 0.2, minH: 0.2 },
                                   config: { symbol: 'BTCUSDT', interval: '15m' } },
                                 { ...chart(3, 'BTCUSDT', '5m'),
                                   position: { x: 0, y: 0.67, w: 1, h: 0.33, minW: 0.2, minH: 0.2 },
                                   config: { symbol: 'BTCUSDT', interval: '5m' } }];
        case 'grid4':     return [
          { ...chart(1, 'BTCUSDT', '4h'), position: { x: 0, y: 0, w: 0.5, h: 0.5, minW: 0.2, minH: 0.2 }, config: { symbol: 'BTCUSDT', interval: '4h', active: true } },
          { ...chart(2, 'BTCUSDT', '1h'), position: { x: 0.5, y: 0, w: 0.5, h: 0.5, minW: 0.2, minH: 0.2 }, config: { symbol: 'BTCUSDT', interval: '1h' } },
          { ...chart(3, 'ETHUSDT', '15m'),position: { x: 0, y: 0.5, w: 0.5, h: 0.5, minW: 0.2, minH: 0.2 }, config: { symbol: 'ETHUSDT', interval: '15m' } },
          { ...chart(4, 'SOLUSDT', '5m'), position: { x: 0.5, y: 0.5, w: 0.5, h: 0.5, minW: 0.2, minH: 0.2 }, config: { symbol: 'SOLUSDT', interval: '5m' } }
        ];
        case 'orderflow': return [chart(1, 'BTCUSDT', '5m'),
                                 wid('w-fp', 'footprint', 0.7, 0, 0.3, 0.4, 'Footprint'),
                                 wid('w-ob', 'orderbook', 0.7, 0.4, 0.3, 0.3, 'Order Book'),
                                 wid('w-ts', 'time_sales', 0.7, 0.7, 0.3, 0.3, 'Time & Sales')];
        case 'trading':   return [chart(1, 'BTCUSDT', '15m'),
                                 wid('w-ticket', 'order_ticket', 0.65, 0, 0.35, 0.4, 'Order Ticket · PAPER'),
                                 wid('w-pos', 'positions', 0.65, 0.4, 0.35, 0.35, 'Positions / Orders'),
                                 wid('w-alerts', 'alerts', 0.65, 0.75, 0.35, 0.25, 'Alerts')];
        case 'scanner':   return [
          { ...chart(1, 'BTCUSDT', '15m'), position: { x: 0, y: 0, w: 0.6, h: 0.65, minW: 0.2, minH: 0.2 }, config: { symbol: 'BTCUSDT', interval: '15m', active: true } },
          { ...chart(2, 'ETHUSDT', '15m'), position: { x: 0.6, y: 0, w: 0.4, h: 0.325, minW: 0.2, minH: 0.2 }, config: { symbol: 'ETHUSDT', interval: '15m' } },
          { ...chart(3, 'SOLUSDT', '15m'), position: { x: 0.6, y: 0.325, w: 0.4, h: 0.325, minW: 0.2, minH: 0.2 }, config: { symbol: 'SOLUSDT', interval: '15m' } },
          wid('w-watch', 'notes', 0, 0.65, 0.6, 0.35, 'Watchlist'),
          { ...chart(4, 'BNBUSDT', '1h'),  position: { x: 0.6, y: 0.65, w: 0.4, h: 0.35, minW: 0.2, minH: 0.2 }, config: { symbol: 'BNBUSDT', interval: '1h' } }
        ];
        case 'planner':   return [chart(1, 'BTCUSDT', '15m'),
                                 wid('w-sessions', 'sessions', 0.65, 0, 0.35, 0.25, 'London / NY sessions'),
                                 wid('w-vp', 'volume_profile', 0.65, 0.25, 0.35, 0.25, 'Volume Profile'),
                                 wid('w-cvd', 'cvd', 0.65, 0.5, 0.35, 0.2, 'CVD'),
                                 wid('w-alerts', 'alerts', 0.65, 0.7, 0.35, 0.15, 'Alerts'),
                                 wid('w-notes', 'notes', 0, 0.7, 0.65, 0.3, 'Session Notes')];
        case 'free':      return [chart(1, 'BTCUSDT', '1h'),
                                 wid('w-ob', 'orderbook', 0.6, 0, 0.4, 0.5, 'Order Book'),
                                 wid('w-notes', 'notes', 0.6, 0.5, 0.4, 0.5, 'Notes')];
        default:          return [chart(1, 'BTCUSDT', '1h')];
      }
    }

    function sanitizeItem(value) {
      if (!value || typeof value !== 'object') return null;
      if (typeof value.id !== 'string' || !value.id) return null;
      if (typeof value.type !== 'string') return null;
      var p = value.position;
      if (!p || !isNum(p.x) || !isNum(p.y) || !isNum(p.w) || !isNum(p.h)) return null;
      if (p.w <= 0 || p.h <= 0) return null;
      if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return null;
      var item = { id: value.id, type: value.type,
        position: {
          x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1),
          w: clamp(p.w, 0.05, 1), h: clamp(p.h, 0.05, 1)
        } };
      if (typeof value.title === 'string') item.title = value.title;
      if (typeof value.chartPaneId === 'string') item.chartPaneId = value.chartPaneId;
      if (value.state === 'minimized' || value.state === 'maximized' || value.state === 'normal') item.state = value.state;
      if (value.config && typeof value.config === 'object') item.config = value.config;
      return item;
    }

    function sanitizeWorkspace(value) {
      if (!value || typeof value !== 'object') return null;
      if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
      if (value.mode !== 'preset' && value.mode !== 'free') return null;
      if (!Array.isArray(value.items)) return null;
      if (typeof value.snapToGrid !== 'boolean') return null;
      var items = value.items.map(sanitizeItem).filter(Boolean);
      if (!items.some(function (i) { return i.type === 'chart'; })) return null;
      return {
        id: value.id, name: value.name, mode: value.mode,
        presetId: typeof value.presetId === 'string' ? value.presetId : undefined,
        items: items,
        activePaneId: typeof value.activePaneId === 'string' || value.activePaneId === null ? value.activePaneId : undefined,
        snapToGrid: value.snapToGrid,
        createdAt: isNum(value.createdAt) ? value.createdAt : Date.now(),
        updatedAt: isNum(value.updatedAt) ? value.updatedAt : Date.now()
      };
    }

    function makeFallback() {
      var now = Date.now();
      return {
        id: 'fallback-single', name: 'Single Chart', mode: 'preset', presetId: 'single',
        items: buildPresetItems('single'), activePaneId: 'p1',
        snapToGrid: false, createdAt: now, updatedAt: now
      };
    }

    function makePresetWorkspace(id, name) {
      var now = Date.now();
      return {
        id: uid(), name: name || (id.charAt(0).toUpperCase() + id.slice(1)),
        mode: 'preset', presetId: id, items: buildPresetItems(id),
        activePaneId: 'p1', snapToGrid: false, createdAt: now, updatedAt: now
      };
    }

    function loadState() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { workspaces: [makeFallback()], activeWorkspaceId: 'fallback-single' };
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { workspaces: [makeFallback()], activeWorkspaceId: 'fallback-single' };
        var ws = Array.isArray(parsed.workspaces)
          ? parsed.workspaces.map(sanitizeWorkspace).filter(Boolean)
          : [];
        if (!ws.length) return { workspaces: [makeFallback()], activeWorkspaceId: 'fallback-single' };
        var active = typeof parsed.activeWorkspaceId === 'string' && ws.some(function (w) { return w.id === parsed.activeWorkspaceId; })
          ? parsed.activeWorkspaceId : ws[0].id;
        return { workspaces: ws, activeWorkspaceId: active };
      } catch (_) { return { workspaces: [makeFallback()], activeWorkspaceId: 'fallback-single' }; }
    }

    var saveTimer = null;
    var lastSerialized = '';
    function saveStateDebounced(state) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        try {
          var s = JSON.stringify(state);
          if (s === lastSerialized) return;
          lastSerialized = s;
          localStorage.setItem(STORAGE_KEY, s);
        } catch (_) {}
      }, 250);
    }
    function saveStateNow(state) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      try {
        var s = JSON.stringify(state);
        lastSerialized = s;
        localStorage.setItem(STORAGE_KEY, s);
      } catch (_) {}
    }

    var state = loadState();
    function activeWorkspace() {
      return state.workspaces.find(function (w) { return w.id === state.activeWorkspaceId; }) || state.workspaces[0];
    }
    function replaceWorkspace(w) {
      var idx = state.workspaces.findIndex(function (x) { return x.id === w.id; });
      if (idx < 0) state.workspaces.push(w); else state.workspaces[idx] = w;
      saveStateDebounced(state);
    }
    function updateActive(mutator) {
      var w = activeWorkspace();
      var updated = mutator(w);
      replaceWorkspace(updated);
      return updated;
    }
    function setActiveWorkspace(id) {
      if (state.workspaces.some(function (w) { return w.id === id; })) {
        state.activeWorkspaceId = id;
        saveStateDebounced(state);
        return true;
      }
      return false;
    }
    function addWorkspace(w) {
      state.workspaces.push(w);
      state.activeWorkspaceId = w.id;
      saveStateDebounced(state);
    }
    function removeWorkspaceAction(id) {
      var remaining = state.workspaces.filter(function (w) { return w.id !== id; });
      if (!remaining.length) { var fb = makeFallback(); remaining = [fb]; }
      state.workspaces = remaining;
      if (!state.workspaces.some(function (w) { return w.id === state.activeWorkspaceId; })) {
        state.activeWorkspaceId = state.workspaces[0].id;
      }
      saveStateDebounced(state);
    }
    function resetAllAction() {
      state = { workspaces: [makeFallback()], activeWorkspaceId: 'fallback-single' };
      saveStateNow(state);
    }

    // ---- Layouts UI wiring ----
    var freeHost = null;
    var originalBody = null;

    function showFreeHost() {
      if (!freeHost) {
        freeHost = document.createElement('div');
        freeHost.id = 'hgfx-free-host';
        freeHost.style.cssText = 'position:absolute;inset:0;z-index:5;';
        var chart = $('chart');
        chart.appendChild(freeHost);
      }
      freeHost.style.display = '';
    }
    function hideFreeHost() {
      if (freeHost) freeHost.style.display = 'none';
    }

    function renderActivePresetChrome() {
      // Reset all extra chart canvases that the legacy toggleSplit() may have created.
      // For presets, the existing .chart #chart ir tools lieka; tik paslepiam free host.
      hideFreeHost();
      // Tarp kitų chart panes (jei yra charts.length > 1) – nieko nedarom, bet warning
      // vartotojui: Free Layout valdo savo canvas atskirai.
    }

    function applyWorkspace(w) {
      // For 'preset' mode: render traditional layout pagal items.
      // For 'free' mode: render Free Layout per HgfxLayouts controller.
      var isFree = w.mode === 'free';
      // Išjunk seną toggleSplit efektą (jei buvo atidarytas 2-as chartas)
      // Svarbu: charts[0] yra 'main' (visada). Pašalinam visus charts > 0
      // išskyrus pagrindinį – nes kitaip dvigubai renderinsime.
      while (charts.length > 1) {
        var extra = charts.pop();
        if (extra.cv && extra.cv.parentElement) extra.cv.parentElement.remove();
        if (extra.feedUnsubscribe) { try { extra.feedUnsubscribe(); } catch (_) {} }
        if (extra.ws) { try { extra.ws.onclose = null; extra.ws.close(); } catch (_) {} }
      }
      if (isFree) {
        // Free Layout: free host; controller mount.
        showFreeHost();
        // Adjust chart canvas dydžius iki 0 (paslėpsim pagrindinį chartą)
        var mainChart = $('chart');
        mainChart.style.position = 'absolute';
        mainChart.style.inset = '0';
        // Padarom single-chart invisible, kai free – controller valdys.
        mainChart.style.display = 'none';
        if (window.HgfxLayouts) {
          window.HgfxLayouts.mount({
            host: freeHost,
            getState: function () { return activeWorkspace(); },
            setState: function (next) { replaceWorkspace(next); },
            save: function () { saveStateNow(state); },
            setActivePane: function (id) { updateActive(function (x) { return Object.assign({}, x, { activePaneId: id }); }); },
            createChart: function (contentEl, item) {
              return createFreeChart(contentEl, item);
            },
            createWidget: function (contentEl, item) {
              return createFreeWidget(contentEl, item);
            }
          });
        } else {
          // Fallback: render panes minimaliai be drag
          renderFreeFallback(freeHost, w);
        }
      } else {
        // Preset mode: simple stack/grid pagal items.
        if (window.HgfxLayouts) window.HgfxLayouts.unmount();
        var mainChart2 = $('chart');
        mainChart2.style.display = '';
        // Sukuriam papildomus chart canvases pagal items.
        renderPresetLayout(w);
        hideFreeHost();
      }
      updateMenuStates();
      updateWidgetMenuForMode();
    }

    function updateWidgetMenuForMode() {
      // Show "Free Layout only" elementus tik kai mode === 'free'
      var isFree = activeWorkspace().mode === 'free';
      var grpCharts = $('menu-widget-group-charts');
      if (grpCharts) grpCharts.hidden = !isFree;
      var grpWidgets = $('menu-widget-group-widgets');
      if (grpWidgets) grpWidgets.hidden = !isFree;
      // Hidden=false elementai (kuriuos JS rodo free režime)
      document.querySelectorAll('#menu-widget [data-widget]').forEach(function (b) {
        var w = b.getAttribute('data-widget');
        if (['chart', 'notes', 'cvd', 'alerts', 'vp', 'sessions', 'positions'].indexOf(w) >= 0) {
          b.hidden = !isFree;
        }
      });
    }

    // ---- Free Layout chart/widget factories ----
    var freeChartsByPane = Object.create(null);
    var freeWidgetDisposers = Object.create(null);

    function createFreeChart(contentEl, item) {
      var canvas = document.createElement('canvas');
      contentEl.appendChild(canvas);
      var cfg = item.config || {};
      var nc = makeChart({ canvas: canvas, sym: cfg.symbol || 'BTCUSDT', tf: cfg.interval || '1h' });
      // Per-pane id: tegul makeChart žino savo paneId (naudojama draw legend update)
      nc.paneId = item.id;
      charts.push(nc);
      freeChartsByPane[item.id] = nc;
      nc.load(); nc.connect();
      return function () {
        // dispose: unsubscribe + close WS + pašalinti iš charts
        if (nc.feedUnsubscribe) { try { nc.feedUnsubscribe(); } catch (_) {} }
        if (nc.ws) { try { nc.ws.onclose = null; nc.ws.close(); } catch (_) {} }
        if (canvas.parentElement) canvas.parentElement.remove();
        var i = charts.indexOf(nc);
        if (i >= 0) charts.splice(i, 1);
        delete freeChartsByPane[item.id];
      };
    }

    function createFreeWidget(contentEl, item) {
      contentEl.classList.add('pane__content--widget');
      // Suteikiam widget turinį pagal tipą
      switch (item.type) {
        case 'footprint': return renderFootprintWidget(contentEl, item);
        case 'orderbook':  return renderOrderbookWidget(contentEl, item);
        case 'time_sales': return renderTimeSalesWidget(contentEl, item);
        case 'notes':      return renderNotesWidget(contentEl, item);
        case 'cvd':        return renderCvdWidget(contentEl, item);
        case 'order_ticket': return renderOrderTicketWidget(contentEl, item);
        case 'positions':    return renderPositionsWidget(contentEl, item);
        case 'alerts':       return renderAlertsWidget(contentEl, item);
        case 'volume_profile': return renderVolumeProfileWidget(contentEl, item);
        case 'sessions':     return renderSessionsWidget(contentEl, item);
        default:             return renderPlaceholderWidget(contentEl, item);
      }
    }

    function renderPlaceholderWidget(contentEl, item) {
      var note = document.createElement('div');
      note.className = 'pane-widget-placeholder';
      note.textContent = item.title || item.type;
      contentEl.appendChild(note);
      return function () {};
    }

    function renderOrderTicketWidget(contentEl, item) {
      var note = document.createElement('div');
      note.className = 'pane-widget-placeholder';
      note.innerHTML = '<div><b>' + escapeHtml(item.title || 'Order Ticket') + '</b></div>' +
        '<div class="muted" style="margin-top:6px">PAPER only – use the dashboard risk pipeline for orders.</div>' +
        '<a class="btn btn--sm" href="/dashboard#ticket" target="_blank" rel="noopener" style="margin-top:8px;display:inline-block">Open dashboard</a>';
      contentEl.appendChild(note);
      return function () {};
    }

    function renderPositionsWidget(contentEl, item) {
      var note = document.createElement('div');
      note.className = 'pane-widget-placeholder';
      note.innerHTML = '<div><b>' + escapeHtml(item.title || 'Positions') + '</b></div>' +
        '<div class="muted" style="margin-top:6px">No live positions in PAPER mode.</div>';
      contentEl.appendChild(note);
      return function () {};
    }

    function renderAlertsWidget(contentEl, item) {
      var list = document.createElement('div');
      list.className = 'pane-widget-alerts';
      list.innerHTML = '<div class="pane-widget-head">' + escapeHtml(item.title || 'Alerts') + '</div>' +
        '<div class="pane-widget-body" id="alerts-body-' + item.id + '"><div class="muted">No alerts yet. Use the header Alerts button to add price alerts.</div></div>';
      contentEl.appendChild(list);
      // Periodiškai atnaujiname alerts sąrašą
      var intv = setInterval(function () {
        var body = $('alerts-body-' + item.id);
        if (!body) return;
        if (!alerts.length) {
          body.innerHTML = '<div class="muted">No alerts yet. Use the header Alerts button to add price alerts.</div>';
          return;
        }
        body.innerHTML = alerts.map(function (a, i) {
          return '<div class="alert-row"><span class="num">' + (a.dir === 'above' ? '≥' : '≤') + ' ' + a.price + '</span>' +
            '<span class="muted">' + (a.fired ? 'fired' : 'armed') + '</span>' +
            '<button class="pane-ctrl" data-rmalert="' + i + '">✕</button></div>';
        }).join('');
        body.querySelectorAll('[data-rmalert]').forEach(function (b) {
          b.onclick = function () {
            var idx = parseInt(b.getAttribute('data-rmalert'), 10);
            if (!isNaN(idx)) { alerts.splice(idx, 1); }
          };
        });
      }, 1000);
      return function () { clearInterval(intv); };
    }

    function renderVolumeProfileWidget(contentEl, item) {
      var note = document.createElement('div');
      note.className = 'pane-widget-placeholder';
      note.innerHTML = '<div><b>' + escapeHtml(item.title || 'Volume Profile') + '</b></div>' +
        '<div class="muted" style="margin-top:6px">Volume Profile requires historical trades aggregation over a session window. Not yet implemented in Free Layout. Use the Footprint widget for live order flow data.</div>';
      contentEl.appendChild(note);
      return function () {};
    }

    function renderSessionsWidget(contentEl, item) {
      var now = new Date();
      var utcH = now.getUTCHours();
      var sessions = [
        { name: 'Asia', range: '00:00 – 08:00 UTC', active: utcH >= 0 && utcH < 8 },
        { name: 'London', range: '08:00 – 16:00 UTC', active: utcH >= 8 && utcH < 16 },
        { name: 'New York', range: '13:00 – 22:00 UTC', active: utcH >= 13 && utcH < 22 }
      ];
      var html = '<div class="pane-widget-head">' + escapeHtml(item.title || 'Sessions') + '</div>' +
        '<div class="pane-widget-body">' + sessions.map(function (s) {
          return '<div class="session-row' + (s.active ? ' session-row--active' : '') + '">' +
            '<span class="session-name">' + s.name + '</span>' +
            '<span class="muted num">' + s.range + '</span>' +
            (s.active ? '<span class="session-pill">LIVE</span>' : '') +
            '</div>';
        }).join('') + '</div>';
      var wrap = document.createElement('div');
      wrap.className = 'pane-widget-sessions';
      wrap.innerHTML = html;
      contentEl.appendChild(wrap);
      // Atnaujiname kas minutę (kad LIVE indikatorių persijungtų)
      var intv = setInterval(function () { renderSessionsWidget(contentEl, item); clearInterval(intv); }, 60000);
      return function () { clearInterval(intv); };
    }

    function renderOrderbookWidget(contentEl, item) {
      var wrap = document.createElement('div');
      wrap.className = 'pane-widget-ob';
      wrap.innerHTML = '<div class="pane-widget-head">' + escapeHtml(item.title || 'Order Book') + '</div>' +
        '<div class="pane-widget-body" id="ob-' + item.id + '"></div>';
      contentEl.appendChild(wrap);
      var sym = main.sym;
      var timer = setInterval(function () {
        var body = $('ob-' + item.id);
        if (!body) return;
        fetch(REST + '/fapi/v1/depth?symbol=' + encodeURIComponent(sym) + '&limit=10')
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.bids || !d.asks) return;
            var rows = '';
            d.asks.slice().reverse().forEach(function (a) {
              rows += '<div class="ob-row"><span>' + fmt(+a[0]) + '</span><span>' + (+a[1]).toFixed(3) + '</span><span>ask</span></div>';
            });
            rows += '<div class="ob-row" style="color:#e8e9ea"><span>MID</span><span>' + fmt(main.lastPrice) + '</span><span></span></div>';
            d.bids.forEach(function (b) {
              rows += '<div class="ob-row"><span>' + fmt(+b[0]) + '</span><span>' + (+b[1]).toFixed(3) + '</span><span>bid</span></div>';
            });
            body.innerHTML = rows;
          })
          .catch(function () {});
      }, 1000);
      return function () { clearInterval(timer); };
    }

    function renderTimeSalesWidget(contentEl, item) {
      var wrap = document.createElement('div');
      wrap.className = 'pane-widget-tape';
      wrap.innerHTML = '<div class="pane-widget-head">' + escapeHtml(item.title || 'Time & Sales') + '</div>' +
        '<div class="pane-widget-body" id="tape-' + item.id + '"></div>';
      contentEl.appendChild(wrap);
      var body = $('tape-' + item.id);
      // Šis widget'as naudoja FeedManager per main
      var unsub = null;
      if (window.HgfxFeed && window.HgfxFeed.FeedManager) {
        var fm = window.__hgfxFeedManager = window.__hgfxFeedManager || new window.HgfxFeed.FeedManager();
        unsub = fm.subscribe(main.sym, function (t) {
          if (!body) return;
          var row = document.createElement('div');
          row.className = 'tw-row ' + (t.aggressor === 'sell' ? 'sell' : 'buy');
          row.textContent = fmt(t.price) + '  ' + t.qty.toFixed(4) + '  ' + new Date(t.ts).toISOString().slice(11, 19);
          body.prepend(row);
          while (body.children.length > 50) body.lastChild.remove();
        });
      }
      return function () { if (unsub) unsub(); };
    }

    function renderFootprintWidget(contentEl, item) {
      // Per-instance footprint aggregator, NE bendrinamas su globaliu fpState (kad keli footprint widget'ai veiktų).
      var core = (window.OrderflowCore && window.OrderflowCore.OrderflowAggregator) || (window.HgfxFeed && null);
      var agg = null;
      var body = document.createElement('div');
      body.className = 'pane-widget-fp';
      body.innerHTML = '<div class="pane-widget-head">' + escapeHtml(item.title || 'Footprint') + '</div>' +
        '<div class="pane-widget-body" id="fp-' + item.id + '"><div class="muted" style="padding:8px">Connecting to live trade stream (' + main.sym + ' @ ' + main.tf + ')…</div></div>';
      contentEl.appendChild(body);

      function tickSize() {
        var p = main.lastPrice || 0;
        if (!(p > 0)) return 0;
        var raw = p / 400;
        var mag = Math.pow(10, Math.floor(Math.log10(raw)));
        var n = raw / mag;
        return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
      }

      function makeAgg() {
        if (!core) return null;
        return new core({
          symbol: main.sym,
          timeframeMs: TFMS[main.tf] || 3600000,
          tickSize: tickSize() || 1,
          retention: 60,
          dedupWindow: 20000
        });
      }

      agg = makeAgg();

      var unsub = null;
      if (agg && window.HgfxFeed && window.HgfxFeed.FeedManager) {
        var fm = window.__hgfxFeedManager = window.__hgfxFeedManager || new window.HgfxFeed.FeedManager();
        unsub = fm.subscribe(main.sym, function (t) {
          if (!agg) return;
          agg.ingest({ venue: 'binance-futures', tradeId: String(t.tradeId), symbol: main.sym, price: t.price, qty: t.qty, aggressor: t.aggressor, ts: t.ts });
        });
      }

      var intv = setInterval(function () {
        var b = $('fp-' + item.id);
        if (!b || !agg) return;
        var snap = agg.snapshot();
        if (snap.tradesIngested === 0) {
          b.innerHTML = '<div class="muted" style="padding:8px">Waiting for live aggTrade data (' + main.sym + ' @ ' + main.tf + ')…</div>';
          return;
        }
        var html = '<div class="fp-head">' +
          '<span>CVD <b>' + snap.cvd.toFixed(3) + '</b></span>' +
          '<span class="faint">trades <b>' + snap.tradesIngested + '</b></span>' +
          '<span class="faint">dedup <b>' + snap.tradesDeduped + '</b></span>' +
          '</div>';
        var nBars = Math.min(8, snap.bars.length);
        for (var bi = snap.bars.length - 1; bi >= snap.bars.length - nBars; bi--) {
          var bar = snap.bars[bi];
          var sigs = core && core.detectAll ? core.detectAll(bar) : [];
          var sigByPrice = {};
          sigs.forEach(function (s) {
            if (!sigByPrice[s.price]) sigByPrice[s.price] = [];
            sigByPrice[s.price].push(s);
          });
          html += '<div class="fp-bar"><div class="fp-barh"><span>' + new Date(bar.openTs).toISOString().slice(11, 16) + '</span>' +
            '<span class="dpos">' + (bar.delta >= 0 ? '+' : '') + bar.delta.toFixed(3) + '</span></div>';
          var prices = Array.from(bar.levels.keys()).sort(function (a, b2) { return b2 - a; });
          prices.forEach(function (pk) {
            var lv = bar.levels.get(pk);
            var sb = sigByPrice[pk] || [];
            var labels = sb.map(function (s) {
              if (s.type === 'imbalance') return (s.side === 'buy' ? '▲' : '▼') + (s.stacked > 1 ? s.stacked : '');
              if (s.type === 'absorption') return 'ABS';
              return 'EXH';
            });
            html += '<div class="fp-lv"><span class="p">' + fmt(lv.price) + '</span><span class="b">' + lv.buyVol.toFixed(3) + '</span><span class="s">' + lv.sellVol.toFixed(3) + '</span><span class="sig">' + labels.join(' ') + '</span></div>';
          });
          html += '</div>';
        }
        b.innerHTML = html;
      }, 1000);

      return function () {
        clearInterval(intv);
        if (unsub) unsub();
        agg = null;
      };
    }

    function renderNotesWidget(contentEl, item) {
      var wrap = document.createElement('div');
      wrap.className = 'pane-widget-notes';
      var head = document.createElement('div');
      head.className = 'pane-widget-head';
      head.textContent = item.title || 'Notes';
      var ta = document.createElement('textarea');
      ta.className = 'pane-widget-notes-ta';
      ta.placeholder = 'Session notes… (autosaved)';
      var key = 'hgfx.notes.' + item.id;
      try { ta.value = localStorage.getItem(key) || ''; } catch (_) {}
      var saveTimer = null;
      ta.addEventListener('input', function () {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
          try { localStorage.setItem(key, ta.value); } catch (_) {}
        }, 400);
      });
      wrap.appendChild(head);
      wrap.appendChild(ta);
      contentEl.appendChild(wrap);
      return function () {
        if (saveTimer) { clearTimeout(saveTimer); try { localStorage.setItem(key, ta.value); } catch (_) {} }
      };
    }

    function renderCvdWidget(contentEl, item) {
      // Mini sparkline – naudoja tą patį main.cvdSeries
      var wrap = document.createElement('div');
      wrap.className = 'pane-widget-cvd';
      wrap.innerHTML = '<div class="pane-widget-head">' + escapeHtml(item.title || 'CVD') + '</div>' +
        '<canvas class="pane-widget-cvd-canvas" id="cvd-' + item.id + '"></canvas>' +
        '<div class="pane-widget-cvd-val num" id="cvd-val-' + item.id + '">0</div>';
      contentEl.appendChild(wrap);
      var cv = $('cvd-' + item.id);
      var intv = setInterval(function () {
        var val = $('cvd-val-' + item.id);
        if (!cv) return;
        if (val) val.textContent = main.cvd.toFixed(2);
        var series = main.cvdSeries || [];
        if (!series.length) return;
        var dpr = window.devicePixelRatio || 1;
        var rect = cv.getBoundingClientRect();
        var w = Math.max(40, rect.width);
        var h = Math.max(20, rect.height);
        if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
        var ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        var min = Math.min.apply(null, series);
        var max = Math.max.apply(null, series);
        var range = (max - min) || 1;
        ctx.beginPath();
        for (var i = 0; i < series.length; i++) {
          var x = (i / (series.length - 1)) * w;
          var y = h - ((series[i] - min) / range) * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = main.cvd >= 0 ? '#2ebd85' : '#e0483e';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }, 500);
      return function () { clearInterval(intv); };
    }

    function renderFreeFallback(host, w) {
      host.innerHTML = '';
      w.items.forEach(function (it) {
        var el = document.createElement('div');
        el.className = 'pane ' + (it.type === 'chart' ? 'pane--chart' : 'pane--widget');
        el.style.left = (it.position.x * 100) + '%';
        el.style.top = (it.position.y * 100) + '%';
        el.style.width = (it.position.w * 100) + '%';
        el.style.height = (it.position.h * 100) + '%';
        el.dataset.itemId = it.id;
        el.dataset.itemType = it.type;
        var hd = document.createElement('div');
        hd.className = 'pane-handle';
        var t = document.createElement('span');
        t.className = 'pane-handle__title';
        t.textContent = it.title || it.type;
        hd.appendChild(t);
        el.appendChild(hd);
        if (it.type === 'chart') {
          var cv = document.createElement('canvas');
          el.appendChild(cv);
        }
        host.appendChild(el);
      });
    }

    var presetCanvases = []; // papildomi canvas, kuriuos sukūrėm
    function renderPresetLayout(w) {
      // Pagrindinis chart (p1) visada naudoja esamą canvas#cv.
      // Papildomiems chart items sukuriam atskirus canvas.
      // Išvalom senus papildomus canvas.
      presetCanvases.forEach(function (p) {
        if (p.canvas.parentElement) p.canvas.parentElement.remove();
        if (p.chart.ws) { try { p.chart.ws.onclose = null; p.chart.ws.close(); } catch (_) {} }
      });
      presetCanvases = [];
      var items = w.items.slice().sort(function (a, b) {
        if (a.type === 'chart' && b.type !== 'chart') return -1;
        if (a.type !== 'chart' && b.type === 'chart') return 1;
        return 0;
      });
      var chartIdx = 0;
      items.forEach(function (it) {
        if (it.type === 'chart') {
          chartIdx++;
          if (chartIdx === 1) {
            // jau yra
            return;
          }
          var c = document.createElement('canvas');
          c.style.cssText = 'position:absolute;left:' + (it.position.x * 100) + '%;top:' + (it.position.y * 100) + '%;width:' + (it.position.w * 100) + '%;height:' + (it.position.h * 100) + '%;z-index:1';
          var chartHost = $('chart');
          chartHost.appendChild(c);
          var cfg = (it.config) || {};
          var nc = makeChart({ canvas: c, sym: cfg.symbol || 'BTCUSDT', tf: cfg.interval || '1h' });
          charts.push(nc);
          presetCanvases.push({ canvas: c, chart: nc });
          nc.load(); nc.connect();
        } else if (it.type === 'orderbook' && !$('w-Order book')) {
          addWidget('Order book'); pollOB(); obTimer = setInterval(pollOB, 1000);
        } else if (it.type === 'time_sales' && !$('w-Time & sales')) {
          main.tapeEl = addWidget('Time & sales').querySelector('.wb');
        } else if (it.type === 'footprint' && !$('w-Footprint')) {
          openFootprint();
        }
      });
    }

    function applyPreset(id) {
      var w = makePresetWorkspace(id);
      addWorkspace(w);
      applyWorkspace(w);
    }

    // ---- Add Chart / Add Widget to active workspace ----
    function addChartToActiveWorkspace(symbol, interval) {
      var sym = (symbol || main.sym || 'BTCUSDT').toUpperCase();
      var iv = interval || main.tf || '1h';
      var w = activeWorkspace();
      if (w.mode !== 'free') {
        toast('Add Chart works only in Free Layout – switch to Free first');
        return;
      }
      // Rasti laisvą vietą (apatinis dešinys kvadratas, jei tuščias)
      var newItem = {
        id: 'p' + uid().replace('ws_', ''),
        type: 'chart',
        chartPaneId: null,
        position: { x: 0.55, y: 0.55, w: 0.4, h: 0.4, minW: 0.2, minH: 0.2 },
        config: { symbol: sym, interval: iv }
      };
      newItem.chartPaneId = newItem.id;
      var next = Object.assign({}, w, {
        items: w.items.concat([newItem]),
        activePaneId: newItem.id,
        updatedAt: Date.now()
      });
      replaceWorkspace(next);
      if (window.HgfxLayouts && freeHost) {
        window.HgfxLayouts.refresh();
      } else {
        applyWorkspace(next);
      }
      saveStateNow(state);
      toast('Chart added: ' + sym + ' ' + iv);
    }

    function addWidgetToActiveWorkspace(type, title) {
      var w = activeWorkspace();
      if (w.mode !== 'free') {
        toast('Add Widget works only in Free Layout – switch to Free first');
        return;
      }
      var positions = {
        orderbook: { x: 0.7, y: 0, w: 0.3, h: 0.5 },
        time_sales: { x: 0.7, y: 0.5, w: 0.3, h: 0.5 },
        footprint: { x: 0.7, y: 0, w: 0.3, h: 0.5 },
        notes: { x: 0, y: 0.85, w: 0.6, h: 0.15 },
        cvd: { x: 0.6, y: 0, w: 0.4, h: 0.25 },
        alerts: { x: 0.6, y: 0.25, w: 0.4, h: 0.25 },
        volume_profile: { x: 0.6, y: 0.5, w: 0.4, h: 0.25 },
        sessions: { x: 0.6, y: 0.75, w: 0.4, h: 0.25 },
        order_ticket: { x: 0.6, y: 0, w: 0.4, h: 0.4 },
        positions: { x: 0.6, y: 0.4, w: 0.4, h: 0.4 }
      };
      var pos = positions[type] || { x: 0.6, y: 0.5, w: 0.4, h: 0.3 };
      var newItem = {
        id: 'w-' + uid().replace('ws_', ''),
        type: type,
        title: title || null,
        position: { x: pos.x, y: pos.y, w: pos.w, h: pos.h, minW: 0.15, minH: 0.12 }
      };
      var next = Object.assign({}, w, {
        items: w.items.concat([newItem]),
        activePaneId: newItem.id,
        updatedAt: Date.now()
      });
      replaceWorkspace(next);
      if (window.HgfxLayouts && freeHost) {
        window.HgfxLayouts.refresh();
      } else {
        applyWorkspace(next);
      }
      saveStateNow(state);
      toast('Widget added: ' + (title || type));
    }

    // ---- Menu wiring ----
    function closeAllMenus() {
      document.querySelectorAll('.menu').forEach(function (m) { m.hidden = true; });
      document.querySelectorAll('[aria-haspopup]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    }
    function toggleMenu(id, btn) {
      var m = $(id);
      var open = !m.hidden;
      closeAllMenus();
      if (!open) { m.hidden = false; if (btn) btn.setAttribute('aria-expanded', 'true'); }
    }
    function updateMenuStates() {
      var w = activeWorkspace();
      var lbl = $('layout-active-name');
      if (lbl) lbl.innerHTML = '<b>' + escapeHtml(w.name) + '</b> · ' + (w.mode === 'free' ? 'Free' : (w.presetId || 'preset')) + ' · ' + w.items.length + ' items';
      var snapLbl = $('ws-snap-label');
      if (snapLbl) snapLbl.textContent = 'Snap to grid: ' + (w.snapToGrid ? 'On' : 'Off');
      document.querySelectorAll('#menu-layout [data-layout]').forEach(function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-layout') === w.presetId && w.mode === 'preset' ? 'true' : 'false');
      });
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
    }

    function openConfirm(msg, onOk) {
      var menu = $('menu-confirm');
      $('confirm-msg').textContent = msg;
      $('confirm-cancel').onclick = function () { menu.hidden = true; };
      $('confirm-ok').onclick = function () { menu.hidden = true; onOk(); };
      menu.hidden = false;
    }
    function openRename() {
      var w = activeWorkspace();
      var input = $('rename-input');
      input.value = w.name;
      $('rename-backdrop').hidden = false;
      setTimeout(function () { input.focus(); input.select(); }, 0);
      function close() { $('rename-backdrop').hidden = true; }
      $('rename-close').onclick = close;
      $('rename-cancel').onclick = close;
      $('rename-ok').onclick = function () {
        var v = input.value.trim();
        if (!v) return;
        updateActive(function (x) { return Object.assign({}, x, { name: v, presetId: x.presetId ? undefined : x.presetId, updatedAt: Date.now() }); });
        applyWorkspace(activeWorkspace());
        close();
      };
      input.onkeydown = function (e) {
        if (e.key === 'Enter') $('rename-ok').click();
        if (e.key === 'Escape') close();
      };
    }
    function downloadJson(name, text) {
      var a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
      a.download = name;
      a.click();
    }
    function openImport() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = function () {
        var f = input.files && input.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            var parsed = JSON.parse(String(r.result));
            var obj = parsed && parsed.state ? parsed.state : parsed;
            if (!obj || !Array.isArray(obj.workspaces)) throw new Error('Invalid format');
            var ws = obj.workspaces.map(sanitizeWorkspace).filter(Boolean);
            if (!ws.length) throw new Error('No valid workspaces');
            state = { workspaces: ws, activeWorkspaceId: typeof obj.activeWorkspaceId === 'string' && ws.some(function (w) { return w.id === obj.activeWorkspaceId; }) ? obj.activeWorkspaceId : ws[0].id };
            saveStateNow(state);
            applyWorkspace(activeWorkspace());
            toast('Layout imported: ' + state.workspaces.length + ' workspace(s)');
          } catch (e) {
            toast('Import failed: ' + e.message);
          }
        };
        r.readAsText(f);
      };
      input.click();
    }

    $('btn-layout').onclick = function (e) { e.stopPropagation(); toggleMenu('menu-layout', $('btn-layout')); updateMenuStates(); };
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.menu') && !e.target.closest('[aria-haspopup]')) closeAllMenus();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAllMenus(); });

    document.querySelectorAll('#menu-layout [data-layout]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-layout');
        if (!PRESETS.includes(id)) return;
        closeAllMenus();
        applyPreset(id);
        toast('Layout: ' + PRESET_DESCRIPTIONS[id].name);
      };
    });
    document.querySelectorAll('#menu-layout [data-ws]').forEach(function (b) {
      b.onclick = function () {
        var action = b.getAttribute('data-ws');
        closeAllMenus();
        var w = activeWorkspace();
        switch (action) {
          case 'new': {
            var fresh = { id: uid(), name: 'New Workspace', mode: 'free', items: [], snapToGrid: true, createdAt: Date.now(), updatedAt: Date.now() };
            addWorkspace(fresh);
            applyWorkspace(fresh);
            toast('New workspace created');
            break;
          }
          case 'duplicate': {
            var copy = JSON.parse(JSON.stringify(w));
            copy.id = uid();
            copy.name = w.name + ' (copy)';
            copy.presetId = undefined;
            copy.createdAt = Date.now();
            copy.updatedAt = Date.now();
            addWorkspace(copy);
            applyWorkspace(copy);
            toast('Workspace duplicated');
            break;
          }
          case 'rename': openRename(); break;
          case 'snap': {
            updateActive(function (x) { return Object.assign({}, x, { snapToGrid: !x.snapToGrid, updatedAt: Date.now() }); });
            applyWorkspace(activeWorkspace());
            break;
          }
          case 'save': saveStateNow(state); toast('Layout saved'); break;
          case 'save-as': {
            var name = prompt('Template name:', w.name + ' template');
            if (!name) return;
            var t = JSON.parse(JSON.stringify(w));
            t.id = uid(); t.name = name + ' (template)'; t.presetId = undefined;
            t.createdAt = Date.now(); t.updatedAt = Date.now();
            addWorkspace(t);
            toast('Saved as: ' + t.name);
            break;
          }
          case 'export': {
            var json = JSON.stringify({ version: 1, exportedAt: Date.now(), state: state }, null, 2);
            downloadJson('hgfx-layout-' + w.name.replace(/[^\w-]+/g, '_') + '.json', json);
            toast('Exported');
            break;
          }
          case 'import': openImport(); break;
          case 'reset': openConfirm('Reset all layouts? This will remove all your custom workspaces and restore Single Chart.', function () { resetAllAction(); applyWorkspace(activeWorkspace()); toast('Layouts reset'); }); break;
          case 'delete': {
            if (w.presetId && state.workspaces.length <= 1) { toast('Cannot delete the last workspace'); return; }
            openConfirm('Delete workspace "' + w.name + '"? This cannot be undone.', function () {
              removeWorkspaceAction(w.id);
              applyWorkspace(activeWorkspace());
              toast('Workspace deleted');
            });
            break;
          }
        }
      };
    });

    // Ctrl+S – save
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        saveStateNow(state);
        toast('Layout saved');
        e.preventDefault();
      }
    });

    // Init – load active workspace
    applyWorkspace(activeWorkspace());
    window.__hgfxLayouts = {
      state: state,
      applyPreset: applyPreset,
      activeWorkspace: activeWorkspace,
      saveNow: function () { saveStateNow(state); },
      addChart: addChartToActiveWorkspace,
      addWidget: addWidgetToActiveWorkspace,
      refresh: function () { if (window.HgfxLayouts) window.HgfxLayouts.refresh(); }
    };
  })();

  // ================================================================ Chart SETTINGS panel
  (function () {
    if (!HgS) { return; }
    var paneId = 'p1';
    var state = HgS.load();
    var base = HgS.mergeSettings(state, paneId);
    var draft = Object.assign({}, base);
    var dirty = false;

    var style = document.createElement('style');
    style.textContent =
      '.hgfx-set{position:fixed;inset:0;z-index:400;display:none;align-items:flex-start;justify-content:flex-end;font:12px/1.5 ui-monospace,monospace;color:#d6d9de}.hgfx-set.open{display:flex}' +
      '.hgfx-set__scrim{position:absolute;inset:0;background:rgba(0,0,0,.45)}' +
      '.hgfx-set__panel{position:relative;width:min(920px,96vw);height:100%;background:#151a20;border-left:1px solid #3a4450;display:grid;grid-template-columns:190px 1fr;grid-template-rows:auto 1fr auto;box-shadow:-12px 0 40px rgba(0,0,0,.5)}' +
      '.hgfx-set__head{grid-column:1/3;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #2a2e39}.hgfx-set__head h3{margin:0;font-size:14px;color:#e8e9ea}.hgfx-set__head .sp{flex:1}.hgfx-set__head .pill{padding:2px 8px;border-radius:20px;background:#1c3a5f;color:#cfe3ff;font-size:11px}' +
      '.hgfx-set__nav{border-right:1px solid #2a2e39;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:2px}' +
      '.hgfx-set__nav button{text-align:left;padding:8px 10px;border-radius:8px;border:0;background:transparent;color:#aeb4bd;cursor:pointer;font:inherit;display:flex;gap:8px;align-items:center}.hgfx-set__nav button:hover{background:#1c2024}.hgfx-set__nav button.on{background:#1c3a5f;color:#e8e9ea}' +
      '.hgfx-set__body{overflow:auto;padding:16px 20px 40px}.hgfx-set__body h4{margin:0 0 14px;color:#e8e9ea;font-size:13px;border-bottom:1px solid #2a2e39;padding-bottom:8px}' +
      '.st-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #20242a}.st-row:last-child{border:0}' +
      '.st-label{flex:1;min-width:0}.st-label b{display:block;font-weight:600;color:#d6d9de;font-size:12px}.st-label small{display:block;color:#7c828c;font-size:11px}' +
      '.st-row select,.st-row input[type=number],.st-row input[type=text]{background:#0b0d0e;border:1px solid #3a4450;color:#e8e9ea;border-radius:6px;padding:4px 6px;font:inherit;max-width:150px}' +
      '.st-row input[type=color]{width:40px;height:26px;border:1px solid #3a4450;border-radius:6px;background:#0b0d0e;padding:1px;cursor:pointer}.st-row input[type=range]{width:110px}' +
      '.st-toggle{width:42px;height:22px;flex:none;border-radius:20px;border:1px solid #3a4450;background:#2a2e39;cursor:pointer;position:relative;transition:.15s}.st-toggle::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#aeb4bd;transition:.15s}.st-toggle.on{background:#1c5c3a;border-color:#2ebd85}.st-toggle.on::after{left:22px;background:#2ebd85}' +
      '.st-disabled{opacity:.45;pointer-events:none}.st-cell{flex:none;display:flex;align-items:center;gap:8px}' +
      '.hgfx-set__foot{grid-column:1/3;display:flex;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid #2a2e39}.hgfx-set__foot .sp{flex:1}' +
      '.hgfx-set__foot button,.hgfx-set__head button{background:#232a33;border:1px solid #3a4450;color:#d6d9de;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}.hgfx-set__foot .btn-primary{background:#1c3a5f;border-color:#2a5a8f}.hgfx-set__foot .btn-danger{color:#e0483e}.hgfx-set__foot button:hover{border-color:#4a8dff}' +
      '.hgfx-set .coming{padding:10px 4px;color:#7c828c;font-size:11px;font-style:italic}';
    document.head.appendChild(style);

    var gear = document.createElement('button');
    gear.type = 'button'; gear.className = 'btn btn--icon';
    gear.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"/><path d="M13.4 9l1.2-1-1.6-2.8-1.5.3a5.6 5.6 0 0 0-1.2-.7L10.1 3l-4.2 0-.2 1.8c-.5.2-.9.5-1.3.8L3 5.2 1.4 8l1 1.2-1 1.2 1.6 2.8 1.1-.5c.4.3.9.6 1.4.8l.2 1.8 4.2 0 .2-1.6c.5-.2.9-.5 1.3-.8l1.3.4L14.6 10z"/></svg>';
    gear.setAttribute('aria-label', 'Chart settings'); gear.title = 'Chart settings';
    var hdrRight = document.getElementById('hdr-right-full') || document.getElementById('hdr');
    if (hdrRight) hdrRight.appendChild(gear);

    var panel = document.createElement('div');
    panel.className = 'hgfx-set';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Chart settings');
    panel.innerHTML =
      '<div class="hgfx-set__scrim" data-close></div>' +
      '<div class="hgfx-set__panel">' +
        '<div class="hgfx-set__head"><h3>Chart Settings</h3><span class="pill" data-pane>pane ' + paneId + '</span>' +
          '<span data-dirty style="display:none" class="pill">•</span><div class="sp"></div>' +
          '<button data-close aria-label="Close settings">✕</button></div>' +
        '<div class="hgfx-set__nav" data-nav></div>' +
        '<div class="hgfx-set__body" data-body></div>' +
        '<div class="hgfx-set__foot">' +
          '<button class="btn-danger" data-reset-all title="Reset all settings to defaults">Reset All</button>' +
          '<button data-reset-section title="Reset this section to defaults">Reset Section</button>' +
          '<div class="sp"></div>' +
          '<button data-cancel title="Discard changes">Cancel</button>' +
          '<button class="btn-primary" data-apply>Apply</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    var nav = panel.querySelector('[data-nav]');
    var body = panel.querySelector('[data-body]');
    var activeCat = 'general';

    function F(key, type, label, extra) { return Object.assign({ key: key, type: type, label: label }, extra || {}); }
    var cats = [
      { id: 'general', label: 'General', icon: '⚙', fields: [
        F('timezone','select','Timezone',{opts:['local','utc','exchange']}),
        F('showTitle','bool','Show title'), F('showSymbolHeader','bool','Symbol / exchange header'),
        F('crosshairMode','select','Crosshair',{opts:['off','normal','magnet']}),
        F('showLastPriceLine','bool','Last-price line'), F('lastPriceLineColor','color','Last-price color'), F('showLastPriceLabel','bool','Last-price label'),
        F('pricePrecision','select','Price precision',{opts:['auto','0','1','2','4']}),
        F('thousandsSeparator','bool','Thousands separator'),
        F('syncSymbolAcrossPanes','bool','Sync symbol across panes'),
        F('syncTimeframeAcrossPanes','bool','Sync timeframe across panes'),
        F('syncSettingsAcrossPanes','bool','Sync settings across panes')
      ], coming: [] },
      { id: 'appearance', label: 'Appearance', icon: '🎨', fields: [
        F('chartBackground','color','Chart background'), F('plotBackground','color','Plot background'),
        F('grid','select','Grid lines',{opts:['both','horizontal','vertical','none']}),
        F('gridColor','color','Grid color'), F('gridOpacity','number','Grid opacity',{min:0.05,max:1,step:0.05}),
        F('gridLineStyle','select','Grid style',{opts:['solid','dashed','dotted']}),
        F('showBorder','bool','Chart border'), F('borderColor','color','Border color'), F('borderWidth','number','Border width',{min:0,max:8,step:1}),
        F('showWatermark','bool','Watermark'), F('watermarkText','text','Watermark text'),
        F('watermarkOpacity','number','Watermark opacity',{min:0.05,max:1,step:0.05}),
        F('watermarkPosition','select','Watermark position',{opts:['center','tl','tr','bl','br']}),
        F('labelFontSize','select','Label font size',{opts:['small','medium','large']})
      ], coming: ['Light theme nėra — engine palaiko tik Nordic-Atelier dark.'] },
      { id: 'candles', label: 'Candles / Bars', icon: '🕯', fields: [
        F('chartStyle','select','Chart type',{opts:['candle','bar','heikin','line','area']}),
        F('bullColor','color','Bull body'), F('bearColor','color','Bear body'), F('wickColor','color','Wick color'),
        F('bullBorderColor','color','Bull border'), F('bearBorderColor','color','Bear border'),
        F('showWicks','bool','Show wicks'), F('showCandleBorders','bool','Show borders'),
        F('candleWidth','number','Candle width %',{min:10,max:100,step:1}),
        F('showVolume','bool','Volume bars'), F('bullVolumeColor','color','Bull volume'),
        F('bearVolumeColor','color','Bear volume'), F('volumeOpacity','number','Volume opacity',{min:0.05,max:1,step:0.05}),
        F('priceSource','select','Line price source',{opts:['close','open','high','low','hl2','hlc3','ohlc4']})
      ], coming: ['Hollow candles, Footprint Cluster/Profile renderer — nėra chart engine (2 etapas).'] },
      { id: 'axes', label: 'Scales & Axes', icon: '📐', fields: [
        F('priceScalePos','select','Price scale position',{opts:['right','left','both','hidden']}),
        F('showPriceLabels','bool','Price labels'), F('showTimeLabels','bool','Time labels'),
        F('autoScale','bool','Auto scale'), F('logScale','bool','Log scale'), F('invertPriceScale','bool','Invert price scale'),
        F('axisColor','color','Axis line color'), F('axisLabelColor','color','Axis label color'),
        F('showOHLC','bool','OHLC legend')
      ], coming: ['Countdown-to-close, Bid/Ask/spread — nėra duomenų/engine.'] },
            { id: 'interaction', label: 'Interaction', icon: '🖱', fields: [
        F('wheelMode','select','Mouse wheel',{opts:['zoom','disabled']}),
        F('zoomToCursor','bool','Zoom to cursor'), F('zoomSensitivity','number','Zoom sensitivity',{min:0.1,max:5,step:0.1}),
        F('doubleClickAction','select','Double-click',{opts:['fit','reset','disabled']}),
        F('dragAction','select','Drag action',{opts:['pan','disabled']}),
        F('spaceDragPan','bool','Space + drag pan'), F('keyboardShortcuts','bool','Keyboard shortcuts'),
        F('arrowPanStep','number','Arrow pan step %',{min:2,max:50,step:1}),
        F('panSensitivity','number','Pan sensitivity',{min:0.1,max:5,step:0.1}),
        F('pinchZoom','bool','Pinch zoom'), F('twoFingerPan','bool','Two-finger pan'), F('doubleTapReset','bool','Double-tap reset')
      ], coming: ['Zoom direction locked to XY — engine neturi vertical-only.'] },
      { id: 'indicators', label: 'Indicators', icon: '📈', fields: [
        F('indVolume','bool','Volume'), F('indEMA20','bool','EMA 20'), F('indEMA50','bool','EMA 50'),
        F('indSMA200','bool','SMA 200'), F('indVWAP','bool','VWAP'), F('indBB','bool','Bollinger Bands'), F('indCVD','bool','CVD')
      ], coming: ['Periodai/spalvos fiksuoti engine kode — čia enable/disable. Volume Profile, Session levels, D/W High/Low — nėra.'] },
      { id: 'drawings', label: 'Drawings', icon: '✏', fields: [
        F('showDrawings','bool','Show all drawings'), F('lockDrawings','bool','Lock all drawings'),
        F('drawingLineColor','color','Default line color'), F('drawingLineWidth','number','Line width',{min:0.5,max:8,step:0.5}),
        F('drawingLineStyle','select','Line style',{opts:['solid','dashed','dotted']}),
        F('drawingOpacity','number','Opacity',{min:0.05,max:1,step:0.05}),
        F('magnetMode','bool','Snap to price (magnet)')
      ], coming: ['Per-tool defaults, import/export JSON — kitas etapas. Delete-all: trash įrankis.'] },
      { id: 'orderflow', label: 'Order Flow', icon: '🧱', fields: [
        F('footprintEnabled','bool','Footprint widget'),
        F('obEnabled','bool','Order Book widget'),
        F('tapeEnabled','bool','Time & Sales widget')
      ], coming: ['Footprint param (row size, imbalance, heatmap) — orderflow.js; čia widget visibility.'] },
      { id: 'layout', label: 'Layout', icon: '🔲', fields: [
        F('snapToGrid','bool','Snap to grid (Free Layout)')
      ], coming: ['Presetai/workspace tvarkomi per Layout meniu (header).'] },
    ];
    function renderNav() {
      nav.innerHTML = '';
      cats.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = c.icon + ' ' + c.label;
        b.setAttribute('data-cat', c.id); b.setAttribute('role', 'tab');
        if (c.id === activeCat) b.className = 'on';
        nav.appendChild(b);
      });
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];}); }
    function rowHtml(f) {
      var cur = draft[f.key];
      var ctl = '';
      if (f.type === 'bool') {
        ctl = '<div class="st-toggle ' + (cur ? 'on' : '') + '" data-real="' + f.key + '" role="switch" aria-checked="' + (cur?'true':'false') + '" aria-label="' + esc(f.label) + '"></div>';
      } else if (f.type === 'select') {
        ctl = '<select data-real="' + f.key + '" aria-label="' + esc(f.label) + '">' + (f.opts||[]).map(function(o){return '<option ' + (String(cur)===String(o)?'selected':'') + '>' + esc(o) + '</option>';}).join('') + '</select>';
      } else if (f.type === 'color') {
        ctl = '<input type="color" data-real="' + f.key + '" value="' + esc(cur||'#000000') + '" aria-label="' + esc(f.label) + '">';
      } else if (f.type === 'text') {
        ctl = '<input type="text" data-real="' + f.key + '" value="' + esc(cur||'') + '">';
      } else {
        ctl = '<input type="number" data-real="' + f.key + '" value="' + cur + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step||1) + '">' +
              '<input type="range" data-range="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step||1) + '" value="' + cur + '">';
      }
      var d = HgS.defaults, dv = d[f.key];
      var hint = f.hint ? '<small>' + esc(f.hint) + '</small>' : '';
      return '<div class="st-row"><div class="st-label"><b>' + esc(f.label) + ' <small style="display:inline;color:#556070">· def ' + (typeof dv==='boolean'?(dv?'on':'off'):esc(dv)) + '</small></b>' + hint + '</div><div class="st-cell">' + ctl + '</div></div>';
    }
    function renderBody() {
      var c = cats.find(function(x){return x.id===activeCat;}) || cats[0];
      body.innerHTML = '<h4>' + c.icon + ' ' + c.label + '</h4>' + c.fields.map(rowHtml).join('') +
        (c.coming && c.coming.length ? '<div class="coming">' + c.coming.join('<br>') + '</div>' : '');
      body.querySelectorAll('.st-toggle').forEach(function (el) { el.addEventListener('click', function () { el.classList.toggle('on'); dirty = true; syncDirty(); }); });
      body.querySelectorAll('[data-real]').forEach(function (el) {
        var k = el.getAttribute('data-real');
        var isSel = el.tagName === 'SELECT';
        el.addEventListener(isSel ? 'change' : 'input', function () {
          if (el.getAttribute('type') === 'number') { draft[k] = finite(el.valueAsNumber, HgS.defaults[k]); }
          else if (el.getAttribute('type') === 'color') { draft[k] = el.value; }
          else draft[k] = el.value;
          dirty = true; syncDirty();
          if (el.getAttribute('type') === 'color') renderBody();
        });
      });
      body.querySelectorAll('[data-range]').forEach(function (el) {
        el.addEventListener('input', function () { var k = el.getAttribute('data-range'); draft[k] = finite(el.valueAsNumber, HgS.defaults[k]); dirty = true; syncDirty(); renderBody(); });
      });
    }
    function finite(n, fb) { return Number.isFinite(n) ? n : fb; }
    function syncDirty() { var dEl = panel.querySelector('[data-dirty]'); if (dEl) dEl.style.display = dirty ? 'inline-block' : 'none'; }
    function refreshDraft() { base = HgS.mergeSettings(state, paneId); draft = Object.assign({}, base); dirty = false; syncDirty(); }
    function commit() {
      var sync = draft.syncSettingsAcrossPanes === true;
      var keys = Object.keys(draft);
      keys.forEach(function (k) { if (draft[k] !== base[k]) state = HgS.setValue(state, paneId, k, draft[k], sync); });
      HgS.persist(state);
      refreshDraft();
      main.s = HgS.mergeSettings(state, paneId);
      applySettingsToChart(); if (T && T.sync) T.sync();
      toast('Settings applied');
    }
    function closePanel(force) {
      if (dirty && !force && !confirm('Discard unsaved settings changes?')) return;
      panel.classList.remove('open'); gearOpen = false;
      refreshDraft(); gear.focus();
    }
    function resetSection() {
      var c = cats.find(function(x){return x.id===activeCat;}) || cats[0];
      c.fields.forEach(function (f) { draft[f.key] = HgS.defaults[f.key]; });
      dirty = true; syncDirty(); renderBody();
    }
    function resetAll() {
      if (!confirm('Reset ALL chart settings to defaults?')) return;
      state = HgS.resetAll(state); HgS.persist(state);
      refreshDraft(); main.s = HgS.mergeSettings(state, paneId); applySettingsToChart(); if (T&&T.sync) T.sync();
      renderBody(); toast('All settings reset');
    }

    // open/close wiring
    gear.addEventListener('click', function () {
      if (gearOpen) { closePanel(false); return; }
      state = HgS.load();
      refreshDraft();
      panel.classList.add('open'); gearOpen = true; syncDirty();
      renderNav(); renderBody();
      var first = panel.querySelector('[data-nav] button'); if (first) first.focus();
    });
    panel.querySelector('[data-scrim]') && panel.querySelector('[data-scrim]').addEventListener('click', function(){ closePanel(false); });
    nav.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-cat]'); if (!b) return;
      activeCat = b.getAttribute('data-cat'); renderNav(); renderBody();
    });
    panel.querySelector('[data-apply]').addEventListener('click', commit);
    panel.querySelector('[data-cancel]').addEventListener('click', function () { closePanel(false); });
    panel.querySelector('[data-reset-section]').addEventListener('click', resetSection);
    panel.querySelector('[data-reset-all]').addEventListener('click', resetAll);
    panel.querySelector('[data-close]').addEventListener('click', function () { closePanel(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && gearOpen) { e.preventDefault(); closePanel(false); }
      if (e.key === 'Tab' && gearOpen) {
        var f = panel.querySelectorAll('.hgfx-set .st-toggle, .hgfx-set button, .hgfx-set select, .hgfx-set input');
        if (!f.length) return;
        var first = f[0], last = f[f.length-1], active = document.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    });
    // pradinė būsena: jei jau yra išsaugotų settings — pritaikom chartui
    main.s = HgS.mergeSettings(state, paneId);
    applySettingsToChart();
    if (T && T.sync) T.sync();
  })();

})();
