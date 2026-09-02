/**
 * Risk & Orderflow dashboard — referencinis UI ant tokenų.
 * Server-rendered shell; visa logika — /static/app.js (vanilla, be framework'o,
 * kad būtų aišku, ką portuoti į React komponentus).
 */
export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Risk & Orderflow — reference</title>
<link rel="stylesheet" href="/static/tokens.css">
<style>
  .app { display: grid; grid-template-columns: 320px 1fr 360px; grid-template-rows: auto 1fr; gap: var(--space-2); padding: var(--space-2); height: 100vh; }
  .topbar { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); }
  .topbar h1 { font-size: var(--fs-label); margin: 0; font-weight: 600; }
  .col { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; }
  .scroll { overflow: auto; min-height: 0; }
  .kv { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--space-3); font-size: var(--fs-meta); }
  .kv dt { color: rgb(var(--color-fg-muted)); }
  .kv dd { margin: 0; text-align: right; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
  .row { display: flex; gap: var(--space-2); align-items: center; }
  .fp { font-family: var(--font-mono); font-size: var(--fs-meta); }
  .fp-row { display: grid; grid-template-columns: 70px 1fr 1fr; gap: var(--space-2); align-items: center; height: 15px; }
  .fp-bar { position: relative; height: 10px; }
  .fp-bar > span { position: absolute; top: 0; bottom: 0; }
  .fp-bar--sell > span { right: 0; background: rgb(var(--color-sell) / 0.55); }
  .fp-bar--buy > span { left: 0; background: rgb(var(--color-buy) / 0.55); }
  .fp-bar > b { position: absolute; top: -2px; font-weight: 500; }
  .fp-bar--sell > b { right: 3px; }
  .fp-bar--buy > b { left: 3px; }
  .imb { outline: 1px solid rgb(var(--color-accent)); outline-offset: -1px; }
  .badge { font-size: var(--fs-micro); padding: 0 5px; border-radius: var(--radius-sm); background: rgb(var(--color-surface-2)); border: 1px solid rgb(var(--color-border)); }
  @media (max-width: 1100px) { .app { grid-template-columns: 1fr; height: auto; } }
</style>
</head>
<body>
<main class="app" id="app">
  <header class="topbar panel">
    <h1>Risk &amp; Orderflow <span class="faint">reference</span></h1>
    <span id="feed-status" class="status status--offline" aria-live="polite">offline</span>
    <span id="venue-status" class="muted"></span>
    <span style="flex:1"></span>
    <label class="row" style="flex-direction:row;align-items:center;gap:6px">Token <input id="token" type="password" placeholder="API_TOKEN" style="width:180px" autocomplete="off"></label>
    <button class="btn btn--ghost btn--sm" id="theme-toggle" aria-label="Toggle theme">◐</button>
  </header>

  <section class="col">
    <article class="panel" id="risk-panel">
      <div class="panel__head"><span>Risk state</span><span id="risk-badge" class="status status--stale">unknown</span></div>
      <div class="panel__body">
        <dl class="kv" id="risk-kv"></dl>
        <div style="margin-top:8px" id="risk-meters"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn--danger" id="kill-btn">KILL SWITCH</button>
          <button class="btn btn--outline" id="enable-btn">Re-enable</button>
          <button class="btn btn--ghost btn--sm" id="refresh-btn">↻</button>
        </div>
      </div>
    </article>

    <article class="panel" id="ticket-panel">
      <div class="panel__head"><span>Order ticket (paper)</span></div>
      <div class="panel__body">
        <form id="ticket" class="form-grid" autocomplete="off">
          <label>Symbol <input name="symbol" value="BTCUSDT"></label>
          <label>Side <select name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
          <label>Qty <input class="num" name="qty" value="0.001" inputmode="decimal"></label>
          <label>Price <input class="num" name="price" id="ticket-price" value="0" inputmode="decimal"></label>
          <label>Mode <select name="mode"><option value="paper">paper</option><option value="testnet">testnet</option><option value="mainnet">mainnet</option></select></label>
          <label>Notional <output class="num" id="ticket-notional">—</output></label>
          <div id="precheck" class="muted" style="grid-column:1/-1;min-height:28px"></div>
          <button class="btn btn--primary" type="submit" id="submit-btn" style="grid-column:1/-1">Review order</button>
        </form>
        <div id="confirm" hidden style="margin-top:8px">
          <div class="panel__body panel" style="border-color:rgb(var(--color-warning))">
            <div id="confirm-text" style="margin-bottom:8px"></div>
            <div class="row">
              <button class="btn btn--danger" id="confirm-btn">Confirm &amp; send</button>
              <button class="btn btn--ghost" id="cancel-btn">Cancel</button>
              <span class="faint" id="confirm-timer"></span>
            </div>
          </div>
        </div>
      </div>
    </article>

    <article class="panel" id="limits-panel">
      <div class="panel__head"><span>Limits</span><button class="btn btn--ghost btn--sm" id="limits-save">Save</button></div>
      <div class="panel__body form-grid" id="limits-form"></div>
    </article>
  </section>

  <section class="col">
    <article class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="panel__head">
        <span>Aggregated footprint <span id="fp-symbol" class="badge">BTCUSDT</span></span>
        <span class="row">
          <span class="muted">CVD</span> <b class="num" id="cvd">0</b>
          <span class="faint" id="cvd-venues"></span>
          <select id="tf"><option value="60000">1m</option><option value="300000">5m</option></select>
          <select id="tick"><option value="5">5</option><option value="10" selected>10</option><option value="25">25</option><option value="50">50</option></select>
          <button class="btn btn--sm" id="feed-toggle">Connect</button>
        </span>
      </div>
      <div class="panel__body scroll fp" id="footprint"></div>
    </article>
    <article class="panel">
      <div class="panel__head"><span>Signals (current bar)</span></div>
      <div class="panel__body" id="signals" style="min-height:40px"></div>
    </article>
  </section>

  <section class="col">
    <article class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="panel__head"><span>Orders</span></div>
      <div class="scroll"><table id="orders"><thead><tr><th>id</th><th>sym</th><th>side</th><th class="num">qty</th><th class="num">px</th><th>status</th></tr></thead><tbody></tbody></table></div>
    </article>
    <article class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="panel__head"><span>Audit log</span></div>
      <div class="scroll"><table id="audit"><thead><tr><th>ts</th><th>event</th><th>detail</th></tr></thead><tbody></tbody></table></div>
    </article>
  </section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script type="module" src="/static/app.js"></script>
</body>
</html>`
}
