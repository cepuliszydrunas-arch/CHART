/**
 * Chart-terminal shell — referencinis P0/P1 įgyvendinimas ant Nordic-Atelier tokenų.
 *
 * Kas čia įgyvendinta (žr. action plan):
 *  P0  mode badge visada matomas (PAPER/TESTNET/REAL), feed status su latency tonais,
 *      overflow-safe header (⋯ meniu <1200px) ir status bar.
 *  P1  toolbar 5 grupės su separatoriais (28/44px hit, aria-label, tooltip),
 *      vienas Button primitive header'yje, chart-type mygtukas rodo DABARTINĖ ikoną,
 *      OS-aware kbd (⌘/Ctrl), kontrastas (tamsus tekstas ant bear last-price),
 *      Indicators modal tipografijos hierarchija (13/600 → 12/400 → 11 faint).
 *  Chart  Binance klines REST + live aggTrade WS; rightOffset 12 %, min bar 6px,
 *      price axis be perteklinio `.0`.
 *
 * Server-rendered shell, jokių framework'ų — kad būtų vienareikšmiška, ką portuoti į React.
 */

const I = {
  candle: '<svg viewBox="0 0 16 16"><path d="M4 2v3M4 11v3M12 1v2M12 13v2"/><rect x="2.5" y="5" width="3" height="6"/><rect x="10.5" y="3" width="3" height="10"/></svg>',
  bar: '<svg viewBox="0 0 16 16"><path d="M4 2v12M2 5h2M4 11h2M12 1v14M10 12h2M12 4h2"/></svg>',
  line: '<svg viewBox="0 0 16 16"><path d="M1.5 11.5l3.5-4 3 2.5 3-5 3.5 3"/></svg>',
  area: '<svg viewBox="0 0 16 16"><path d="M1.5 11.5l3.5-4 3 2.5 3-5 3.5 3V14h-13z" fill="currentColor" fill-opacity=".18"/><path d="M1.5 11.5l3.5-4 3 2.5 3-5 3.5 3"/></svg>',
  heikin: '<svg viewBox="0 0 16 16"><rect x="2.5" y="4" width="3" height="8"/><rect x="6.5" y="6" width="3" height="6"/><rect x="10.5" y="2" width="3" height="10"/></svg>',
  cursor: '<svg viewBox="0 0 16 16"><path d="M8 1v14M1 8h14"/><circle cx="8" cy="8" r="2.2"/></svg>',
  arrow: '<svg viewBox="0 0 16 16"><path d="M2 14L14 2M14 2H8M14 2v6"/></svg>',
  trend: '<svg viewBox="0 0 16 16"><path d="M2 13L14 3"/><circle cx="2" cy="13" r="1.4"/><circle cx="14" cy="3" r="1.4"/></svg>',
  hline: '<svg viewBox="0 0 16 16"><path d="M1 8h14"/><circle cx="8" cy="8" r="1.4"/></svg>',
  ray: '<svg viewBox="0 0 16 16"><path d="M3 12L14 3"/><circle cx="3" cy="12" r="1.4"/><path d="M14 3l-4 0M14 3v4"/></svg>',
  rect: '<svg viewBox="0 0 16 16"><rect x="2" y="4" width="12" height="8"/></svg>',
  fib: '<svg viewBox="0 0 16 16"><path d="M1 3h14M1 6.5h14M1 9.5h14M1 13h14"/></svg>',
  text: '<svg viewBox="0 0 16 16"><path d="M3 3h10M8 3v10M6 13h4"/></svg>',
  measure: '<svg viewBox="0 0 16 16"><path d="M2 12L12 2M4 10l1.5 1.5M6.5 7.5L8 9M9 5l1.5 1.5"/><rect x="1" y="9" width="6" height="6" rx="1" transform="rotate(-45 4 12)"/></svg>',
  magnet: '<svg viewBox="0 0 16 16"><path d="M4 2v6a4 4 0 0 0 8 0V2"/><path d="M4 5h3M9 5h3"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>',
  eye: '<svg viewBox="0 0 16 16"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M6.5 7v4M9.5 7v4"/></svg>',
  camera: '<svg viewBox="0 0 16 16"><path d="M2 5h3l1.5-2h3L11 5h3v8H2z"/><circle cx="8" cy="9" r="2.3"/></svg>',
  fx: '<svg viewBox="0 0 16 16"><path d="M9 2c-2 0-2.5 1.5-2.7 3L5.5 12c-.2 1.3-.7 2-2 2"/><path d="M4 7h5M9 9l3 4M12 9l-3 4"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12"/></svg>',
  more: '<svg viewBox="0 0 16 16"><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="13" cy="8" r="1.2" fill="currentColor"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13"/></svg>',
  book: '<svg viewBox="0 0 16 16"><path d="M2 3h5v10H2zM9 3h5v10H9z"/><path d="M4 6h1M4 8h1M11 6h1M11 8h1"/></svg>',
  tape: '<svg viewBox="0 0 16 16"><path d="M2 4h12M2 7h9M2 10h12M2 13h6"/></svg>',
  fp: '<svg viewBox="0 0 16 16"><path d="M2 3h8M2 6h12M2 9h5M2 12h10"/></svg>',
  grid: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg>',
  alert: '<svg viewBox="0 0 16 16"><path d="M8 2a4 4 0 0 1 4 4v3l1.5 2H2.5L4 9V6a4 4 0 0 1 4-4zM6.5 13a1.5 1.5 0 0 0 3 0"/></svg>',
}

function tool(id: string, icon: string, tip: string, pressed = false, extra = '') {
  return `<button class="btn btn--icon tool" type="button" data-tool="${id}" aria-label="${tip}" aria-pressed="${pressed}" data-tip="${tip}" ${extra}>${icon}</button>`
}

export function terminalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HUGOFXLAB — chart terminal (reference)</title>
<link rel="stylesheet" href="/static/tokens.css">
<link rel="stylesheet" href="/static/terminal.css">
</head>
<body>
<div class="term" id="terminal">

  <!-- ===== HEADER — vienas Button primitive; overflow → ⋯ meniu ===== -->
  <header class="hdr" id="hdr">
    <div class="hdr__group hdr__group--symbol">
      <button class="btn btn--symbol" type="button" id="btn-symbol" aria-haspopup="menu" aria-expanded="false" data-tip="Symbol search" data-tip-pos="bottom">
        <span class="sym"><b id="sym-base">BTC</b><span class="faint">/USDT</span></span>
        <span class="venue" id="sym-venue">@ binance</span>
      </button>
      <span class="sep"></span>
      <div class="ivals" role="radiogroup" aria-label="Interval" id="ivals">
        <button class="btn" type="button" role="radio" aria-checked="false" data-ival="1m">1m</button>
        <button class="btn" type="button" role="radio" aria-checked="false" data-ival="5m">5m</button>
        <button class="btn" type="button" role="radio" aria-checked="false" data-ival="15m">15m</button>
        <button class="btn" type="button" role="radio" aria-checked="true" data-ival="1h">1H</button>
        <button class="btn" type="button" role="radio" aria-checked="false" data-ival="4h">4H</button>
        <button class="btn" type="button" role="radio" aria-checked="false" data-ival="1d">1D</button>
      </div>
      <span class="sep"></span>
      <!-- Chart type — rodo DABARTINĘ ikoną -->
      <button class="btn" type="button" id="btn-ctype" aria-haspopup="menu" aria-expanded="false" aria-label="Chart type: Candles" data-tip="Chart type" data-tip-pos="bottom">
        <span id="ctype-icon">${I.candle}</span>${I.caret}
      </button>
      <button class="btn" type="button" id="btn-ind" aria-haspopup="dialog" data-tip="Indicators" data-tip-pos="bottom">${I.fx}<span class="hdr__label">Indicators</span></button>
      <button class="btn" type="button" id="btn-widget" aria-haspopup="menu" aria-expanded="false" data-tip="Add widget" data-tip-pos="bottom">${I.plus}<span class="hdr__label">Add Widget</span>${I.caret}</button>
    </div>

    <div class="hdr__spacer"></div>

    <div class="hdr__group hdr__group--right">
      <div class="hdr__collapsible" id="hdr-right-full">
        <button class="btn" type="button" id="btn-alert" data-tip="Alerts" data-tip-pos="bottom">${I.alert}<span class="hdr__label">Alerts</span></button>
        <button class="btn" type="button" id="btn-shot" data-tip="Snapshot" data-tip-pos="bottom">${I.camera}</button>
        <button class="btn" type="button" id="btn-layout" aria-haspopup="menu" aria-expanded="false" data-tip="Layouts" data-tip-pos="bottom">${I.grid}<span class="hdr__label">Layouts</span>${I.caret}</button>
      </div>
      <button class="btn btn--icon" type="button" id="btn-more" aria-haspopup="menu" aria-expanded="false" aria-label="More" data-tip="More" data-tip-pos="bottom" hidden>${I.more}</button>
      <span class="sep"></span>
      <!-- P0: mode badge VISADA matomas -->
      <span class="mode mode--paper" id="mode-badge" role="status" aria-live="polite" title="Execution mode">PAPER</span>
    </div>
  </header>

  <!-- ===== BODY: toolbar + chart ===== -->
  <div class="body">
    <!-- P1: 5 grupės, separatoriai, aria-label, tooltip -->
    <nav class="tools" id="tools" aria-label="Drawing tools">
      <div class="tools__group" role="group" aria-label="Cursor">
        ${tool('cursor', I.cursor, 'Crosshair', true)}
        ${tool('arrow', I.arrow, 'Arrow')}
      </div>
      <span class="tools__sep"></span>
      <div class="tools__group" role="group" aria-label="Lines">
        ${tool('trend', I.trend, 'Trend line')}
        ${tool('hline', I.hline, 'Horizontal line')}
        ${tool('ray', I.ray, 'Ray')}
      </div>
      <span class="tools__sep"></span>
      <div class="tools__group" role="group" aria-label="Shapes">
        ${tool('rect', I.rect, 'Rectangle')}
        ${tool('fib', I.fib, 'Fib retracement')}
        ${tool('text', I.text, 'Text')}
      </div>
      <span class="tools__sep"></span>
      <div class="tools__group" role="group" aria-label="Measure">
        ${tool('measure', I.measure, 'Measure')}
        ${tool('magnet', I.magnet, 'Magnet', false, 'data-toggle')}
      </div>
      <span class="tools__sep"></span>
      <div class="tools__group tools__group--bottom" role="group" aria-label="Manage">
        ${tool('lock', I.lock, 'Lock drawings', false, 'data-toggle')}
        ${tool('eye', I.eye, 'Hide drawings', false, 'data-toggle')}
        ${tool('trash', I.trash, 'Remove all drawings')}
      </div>
    </nav>

    <section class="chart" id="chart" aria-label="Price chart">
      <div class="chart__legend" id="legend">
        <span class="legend__sym"><b>BTCUSDT</b> <span class="muted">· 1H · Binance</span></span>
        <span class="legend__ohlc num" id="legend-ohlc">
          <span>O <b data-k="o">—</b></span><span>H <b data-k="h">—</b></span><span>L <b data-k="l">—</b></span><span>C <b data-k="c">—</b></span>
          <span data-k="chg" class="chg">—</span>
        </span>
        <div class="legend__inds" id="legend-inds"></div>
      </div>
      <canvas id="cv" role="img" aria-label="Candlestick chart"></canvas>
      <div class="chart__loading" id="chart-loading" hidden><span class="status status--delayed">Loading klines…</span></div>
    </section>
  </div>

  <!-- ===== STATUS BAR — P0: feed status latency tonais, overflow-safe ===== -->
  <footer class="sbar" id="sbar">
    <div class="sbar__left">
      <span class="status status--offline" id="feed-status" role="status" aria-live="polite"><span id="feed-label">Connecting</span><span class="num sbar__lat" id="feed-lat"></span></span>
      <span class="sep"></span>
      <span class="sbar__kv"><span class="faint">Last</span> <b class="num" id="sb-last">—</b></span>
      <span class="sbar__kv sbar__kv--opt"><span class="faint">24h</span> <b class="num" id="sb-chg">—</b></span>
      <span class="sbar__kv sbar__kv--opt"><span class="faint">Vol</span> <b class="num" id="sb-vol">—</b></span>
      <span class="sbar__kv sbar__kv--opt"><span class="faint">Trades/s</span> <b class="num" id="sb-tps">0</b></span>
    </div>
    <div class="sbar__right">
      <span class="sbar__kv sbar__kv--opt"><span class="faint">Bars</span> <b class="num" id="sb-bars">0</b></span>
      <span class="sep sbar__kv--opt"></span>
      <button class="btn btn--sm" type="button" id="btn-tz" data-tip="Timezone" data-tip-pos="bottom"><span class="num" id="sb-clock">--:--:--</span> <span class="faint">UTC</span></button>
      <button class="btn btn--sm" type="button" id="btn-log" aria-pressed="false" data-tip="Log scale" data-tip-pos="bottom">log</button>
      <button class="btn btn--sm" type="button" id="btn-auto" aria-pressed="true" data-tip="Auto-scale" data-tip-pos="bottom">auto</button>
    </div>
  </footer>

  <!-- ===== MENUS ===== -->
  <div class="menu" id="menu-ctype" role="menu" hidden>
    <div class="menu__group">Chart type</div>
    <button class="menu__item" role="menuitemradio" aria-checked="true" data-ctype="candle">${I.candle}<span class="grow">Candles</span><span class="kbds"><kbd data-mod>Alt</kbd><kbd>1</kbd></span></button>
    <button class="menu__item" role="menuitemradio" aria-checked="false" data-ctype="heikin">${I.heikin}<span class="grow">Heikin Ashi</span><span class="kbds"><kbd data-mod>Alt</kbd><kbd>2</kbd></span></button>
    <button class="menu__item" role="menuitemradio" aria-checked="false" data-ctype="bar">${I.bar}<span class="grow">Bars</span><span class="kbds"><kbd data-mod>Alt</kbd><kbd>3</kbd></span></button>
    <button class="menu__item" role="menuitemradio" aria-checked="false" data-ctype="line">${I.line}<span class="grow">Line</span><span class="kbds"><kbd data-mod>Alt</kbd><kbd>4</kbd></span></button>
    <button class="menu__item" role="menuitemradio" aria-checked="false" data-ctype="area">${I.area}<span class="grow">Area</span><span class="kbds"><kbd data-mod>Alt</kbd><kbd>5</kbd></span></button>
  </div>

  <div class="menu" id="menu-widget" role="menu" hidden>
    <div class="menu__group">Market data</div>
    <button class="menu__item" role="menuitem" data-widget="book">${I.book}<span class="grow">Order book</span><span class="kbds"><kbd data-mod="primary">Ctrl</kbd><kbd>B</kbd></span></button>
    <button class="menu__item" role="menuitem" data-widget="tape">${I.tape}<span class="grow">Time & sales</span><span class="kbds"><kbd data-mod="primary">Ctrl</kbd><kbd>T</kbd></span></button>
    <button class="menu__item" role="menuitem" data-widget="fp">${I.fp}<span class="grow">Footprint</span><span class="badge">beta</span></button>
    <div class="menu__group">Trading</div>
    <button class="menu__item" role="menuitem" data-widget="ticket">${I.alert}<span class="grow">Order ticket</span><span class="badge">PAPER only</span></button>
    <div class="menu__group">Layout</div>
    <button class="menu__item" role="menuitem" data-widget="split">${I.grid}<span class="grow">Split chart</span><span class="kbds"><kbd data-mod="primary">Ctrl</kbd><kbd>\\</kbd></span></button>
    <div class="menu__group" id="menu-widget-group-charts" hidden>Charts (Free Layout)</div>
    <button class="menu__item" role="menuitem" data-widget="chart" hidden="${'true'}">${I.candle}<span class="grow">Add chart (active symbol)</span><span class="menu__hint">Free only</span></button>
    <div class="menu__group" id="menu-widget-group-widgets" hidden>Widgets (Free Layout)</div>
    <button class="menu__item" role="menuitem" data-widget="notes" hidden="${'true'}">${I.tape}<span class="grow">Notes</span><span class="menu__hint">Free only</span></button>
    <button class="menu__item" role="menuitem" data-widget="cvd" hidden="${'true'}">${I.fp}<span class="grow">CVD</span><span class="menu__hint">Free only</span></button>
    <button class="menu__item" role="menuitem" data-widget="alerts" hidden="${'true'}">${I.alert}<span class="grow">Alerts panel</span><span class="menu__hint">Free only</span></button>
    <button class="menu__item" role="menuitem" data-widget="vp" hidden="${'true'}">${I.book}<span class="grow">Volume Profile</span><span class="menu__hint">Free only</span></button>
    <button class="menu__item" role="menuitem" data-widget="sessions" hidden="${'true'}">${I.grid}<span class="grow">Sessions</span><span class="menu__hint">Free only</span></button>
    <button class="menu__item" role="menuitem" data-widget="positions" hidden="${'true'}">${I.tape}<span class="grow">Positions</span><span class="menu__hint">Free only</span></button>
  </div>

  <div class="menu" id="menu-layout" role="menu" hidden>
    <div class="menu__group">Layouts</div>
    <button class="menu__item" role="menuitem" data-layout="single">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="23" height="15"/></svg>
      <span class="grow">Single Chart</span>
      <span class="menu__hint">1×1</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="topdown">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="23" height="4.5"/><rect x="0.5" y="5.5" width="23" height="4.5"/><rect x="0.5" y="10.5" width="23" height="4.5"/></svg>
      <span class="grow">Top-Down</span>
      <span class="menu__hint">1H · 15M · 5M</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="grid4">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="11" height="7"/><rect x="12.5" y="0.5" width="11" height="7"/><rect x="0.5" y="8.5" width="11" height="7"/><rect x="12.5" y="8.5" width="11" height="7"/></svg>
      <span class="grow">4 Chart Grid</span>
      <span class="menu__hint">2×2</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="orderflow">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="15" height="15"/><rect x="16.5" y="0.5" width="7" height="5"/><rect x="16.5" y="6" width="7" height="4.5"/><rect x="16.5" y="11" width="7" height="4.5"/></svg>
      <span class="grow">Order Flow</span>
      <span class="menu__hint">chart + FO</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="trading">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="15" height="15"/><rect x="16.5" y="0.5" width="7" height="6"/><rect x="16.5" y="7" width="7" height="5"/><rect x="16.5" y="12.5" width="7" height="3"/></svg>
      <span class="grow">Trading Desk</span>
      <span class="menu__hint">PAPER</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="scanner">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="13" height="10"/><rect x="14.5" y="0.5" width="9" height="5"/><rect x="14.5" y="6" width="9" height="4.5"/><rect x="0.5" y="11" width="13" height="4.5"/><rect x="14.5" y="11" width="9" height="4.5"/></svg>
      <span class="grow">Market Scanner</span>
      <span class="menu__hint">multi-symbol</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="planner">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="15" height="11"/><rect x="16.5" y="0.5" width="7" height="4"/><rect x="16.5" y="5" width="7" height="3"/><rect x="16.5" y="8.5" width="7" height="3"/><rect x="0.5" y="12" width="15" height="3.5"/><rect x="16.5" y="12" width="7" height="3.5"/></svg>
      <span class="grow">Session Planner</span>
      <span class="menu__hint">+ notes</span>
    </button>
    <button class="menu__item" role="menuitem" data-layout="free">
      <svg class="layout-ico" viewBox="0 0 24 16"><rect x="0.5" y="0.5" width="11" height="9" fill="none" stroke-dasharray="2 1.5"/><rect x="12.5" y="0.5" width="11" height="6" fill="none" stroke-dasharray="2 1.5"/><rect x="0.5" y="10.5" width="11" height="5" fill="none" stroke-dasharray="2 1.5"/><rect x="12.5" y="7.5" width="11" height="8" fill="none" stroke-dasharray="2 1.5"/></svg>
      <span class="grow">Free Layout</span>
      <span class="menu__hint">editable</span>
    </button>
    <div class="menu__sep"></div>
    <div class="menu__group">Active workspace</div>
    <div class="menu__readonly" id="layout-active-name">—</div>
    <div class="menu__sep"></div>
    <div class="menu__group">Workspaces</div>
    <button class="menu__item" role="menuitem" data-ws="new"><span class="grow">New workspace</span><span class="menu__hint">empty Free</span></button>
    <button class="menu__item" role="menuitem" data-ws="duplicate"><span class="grow">Duplicate workspace</span></button>
    <button class="menu__item" role="menuitem" data-ws="rename"><span class="grow">Rename workspace…</span></button>
    <button class="menu__item" role="menuitem" data-ws="snap"><span class="grow" id="ws-snap-label">Snap to grid: On</span></button>
    <div class="menu__sep"></div>
    <div class="menu__group">Persistent</div>
    <button class="menu__item" role="menuitem" data-ws="save"><span class="grow">Save layout</span><span class="kbds"><kbd data-mod="primary">Ctrl</kbd><kbd>S</kbd></span></button>
    <button class="menu__item" role="menuitem" data-ws="save-as"><span class="grow">Save as template</span></button>
    <button class="menu__item" role="menuitem" data-ws="export"><span class="grow">Export layout JSON</span></button>
    <button class="menu__item" role="menuitem" data-ws="import"><span class="grow">Import layout JSON</span></button>
    <div class="menu__sep"></div>
    <button class="menu__item menu__item--danger" role="menuitem" data-ws="reset"><span class="grow">Reset layout</span></button>
    <button class="menu__item menu__item--danger" role="menuitem" data-ws="delete"><span class="grow">Delete workspace</span></button>
  </div>

  <div class="menu" id="menu-confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" hidden>
    <div class="menu__group" id="confirm-title">Confirm</div>
    <div class="menu__readonly" id="confirm-msg" style="padding:8px 10px">Are you sure?</div>
    <div class="row" style="display:flex;gap:8px;padding:8px 10px;justify-content:flex-end">
      <button class="btn btn--ghost" type="button" id="confirm-cancel">Cancel</button>
      <button class="btn btn--danger" type="button" id="confirm-ok">Confirm</button>
    </div>
  </div>

  <!-- Demo tik: režimo perjungimas, kad būtų galima pamatyti visus tris badge'us -->
  <div class="menu" id="menu-mode" role="menu" hidden>
    <div class="menu__group">Execution mode (demo)</div>
    <button class="menu__item" role="menuitemradio" aria-checked="true" data-mode="paper"><span class="grow">Paper</span></button>
    <button class="menu__item" role="menuitemradio" aria-checked="false" data-mode="testnet"><span class="grow">Testnet</span></button>
    <button class="menu__item" role="menuitemradio" aria-checked="false" data-mode="real"><span class="grow">Real</span><span class="badge">guarded</span></button>
  </div>

  <!-- ===== INDICATORS MODAL — hierarchija 13/600 · 12/400 · 11 faint ===== -->
  <div class="modal-backdrop" id="rename-backdrop" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rename-title" style="max-width:380px">
      <div class="modal__head">
        <h2 class="modal__title" id="rename-title">Rename workspace</h2>
        <button class="btn btn--icon" type="button" id="rename-close" aria-label="Close">${I.close}</button>
      </div>
      <div class="modal__body" style="display:flex;flex-direction:column;gap:10px;padding:var(--space-3)">
        <label class="faint" for="rename-input">Workspace name</label>
        <input type="text" id="rename-input" maxlength="48" style="background:var(--dropdown);border:1px solid var(--border2);color:var(--fg);border-radius:6px;padding:8px 10px;font:inherit" />
        <div class="row" style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn--ghost" type="button" id="rename-cancel">Cancel</button>
          <button class="btn btn--primary" type="button" id="rename-ok">Rename</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="ind-backdrop" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ind-title" id="ind-modal">
      <div class="modal__head">
        <h2 class="modal__title" id="ind-title">Indicators</h2>
        <button class="btn btn--icon" type="button" id="ind-close" aria-label="Close">${I.close}</button>
      </div>
      <div class="modal__search">
        ${I.search}<input type="search" id="ind-q" placeholder="Search indicators…" aria-label="Search indicators" autocomplete="off">
        <span class="kbds"><kbd>Esc</kbd></span>
      </div>
      <div class="modal__body" id="ind-list">
        <div class="ind__group">Trend</div>
        <button class="ind" type="button" data-ind="ema20" aria-pressed="false"><span class="ind__name">EMA <span class="ind__param">20</span></span><span class="ind__meta">Exponential moving average</span></button>
        <button class="ind" type="button" data-ind="ema50" aria-pressed="false"><span class="ind__name">EMA <span class="ind__param">50</span></span><span class="ind__meta">Exponential moving average</span></button>
        <button class="ind" type="button" data-ind="sma200" aria-pressed="false"><span class="ind__name">SMA <span class="ind__param">200</span></span><span class="ind__meta">Simple moving average</span></button>
        <button class="ind" type="button" data-ind="vwap" aria-pressed="false"><span class="ind__name">VWAP</span><span class="ind__meta">Session volume-weighted price · resets 00:00 UTC</span></button>
        <div class="ind__group">Volatility</div>
        <button class="ind" type="button" data-ind="bb" aria-pressed="false"><span class="ind__name">Bollinger Bands <span class="ind__param">20 · 2σ</span></span><span class="ind__meta">SMA ± 2 standard deviations</span></button>
        <div class="ind__group">Volume · Orderflow</div>
        <button class="ind" type="button" data-ind="vol" aria-pressed="true"><span class="ind__name">Volume</span><span class="ind__meta">Bar volume, buy/sell colored</span></button>
        <button class="ind" type="button" data-ind="cvd" aria-pressed="false"><span class="ind__name">CVD</span><span class="ind__meta">Cumulative volume delta · from live aggTrade</span></button>
      </div>
      <div class="modal__foot"><span class="faint" id="ind-count">1 active</span><button class="btn btn--primary" type="button" id="ind-done">Done</button></div>
    </div>
  </div>

  <div class="toast" id="toast" aria-live="polite"></div>
</div>
<script type="module" src="/static/orderflow.js"></script>
<script type="module" src="/static/feed.js"></script>
<script type="module" src="/static/layouts.js"></script>
<script type="module" src="/static/settings.js"></script>
<script src="/static/terminal.js"></script>
</body>
</html>`
}
