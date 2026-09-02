/* Dashboard client. Vanilla ES module — 1:1 portuojama į React hook'us:
 *   feed  → useOrderflowFeed(symbol, venues)   (WS + aggregator + rAF)
 *   risk  → useRiskState()                     (polling / SWR)
 *   ticket→ <OrderTicket/> su 2-step confirm
 */
import { OrderflowAggregator, ADAPTERS, detectAll } from './orderflow.js'

const $ = (id) => document.getElementById(id)
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—')
const toast = (msg, cls = '') => {
  // Dedup: ta pati žinutė nerodoma dukart vienu metu
  if ([...$('toast').children].some((c) => c.textContent === msg)) return
  const el = document.createElement('div')
  el.className = `panel panel__body ${cls}`
  el.textContent = msg
  $('toast').appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

// ---------------------------------------------------------------------------
// Auth token (sessionStorage — ne localStorage: dingsta užvėrus tab'ą)
// ---------------------------------------------------------------------------
const tokenInput = $('token')
tokenInput.value = sessionStorage.getItem('api_token') ?? ''
tokenInput.addEventListener('change', () => sessionStorage.setItem('api_token', tokenInput.value))
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenInput.value}`, ...(opts.headers ?? {}) }
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) { toast('Unauthorized — set API token', 'danger'); tokenInput.focus() }
  if (res.status === 503) toast(body.message ?? 'Server misconfigured', 'danger')
  return { res, body }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const THEME_KEY = 'hgfx-theme'
try {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved
} catch { /* localStorage gali būti nepasiekiamas — lieka default dark */ }
$('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark'
  html.dataset.theme = next
  try { localStorage.setItem(THEME_KEY, next) } catch { /* ignore */ }
})

// ---------------------------------------------------------------------------
// Feed: browser-direct multi-venue WS → aggregator → rAF render
// ---------------------------------------------------------------------------
const feed = {
  symbol: 'BTCUSDT',
  venues: ['binance', 'bybit', 'okx'],
  sockets: new Map(),
  agg: null,
  lastPrice: 0,
  connected: false,
  dirty: false,
  rafId: 0,
  statusTimer: 0
}

function newAggregator() {
  feed.agg = new OrderflowAggregator({
    symbol: feed.symbol,
    timeframeMs: Number($('tf').value),
    tickSize: Number($('tick').value),
    retention: 120,
    dedupWindow: 5000
  })
}
newAggregator()
$('tf').addEventListener('change', () => { newAggregator(); scheduleRender() })
$('tick').addEventListener('change', () => { newAggregator(); scheduleRender() })

function connectVenue(name) {
  const adapter = ADAPTERS[name]
  const ws = new WebSocket(adapter.wsUrl(feed.symbol))
  const sub = adapter.subscribeMessage(feed.symbol)
  ws.onopen = () => { if (sub) ws.send(sub); updateFeedStatus() }
  ws.onmessage = (ev) => {
    const trades = adapter.parse(typeof ev.data === 'string' ? ev.data : '', feed.symbol)
    if (trades.length === 0) {
      // Bybit/OKX ping
      try { const m = JSON.parse(ev.data); if (m.op === 'ping' || m.event === 'ping') ws.send(JSON.stringify({ op: 'pong' })) } catch {}
      return
    }
    const n = feed.agg.ingestMany(trades)
    if (n > 0) { feed.lastPrice = trades[trades.length - 1].price; scheduleRender() }
  }
  ws.onclose = () => {
    feed.sockets.delete(name)
    feed.agg.markGap(name)
    updateFeedStatus()
    if (feed.connected) setTimeout(() => feed.connected && !feed.sockets.has(name) && connectVenue(name), 2000 + Math.random() * 3000)
  }
  ws.onerror = () => ws.close()
  feed.sockets.set(name, ws)
}

function toggleFeed() {
  feed.connected = !feed.connected
  if (feed.connected) {
    feed.venues.forEach(connectVenue)
    feed.statusTimer = setInterval(updateFeedStatus, 5000)
    $('feed-toggle').textContent = 'Disconnect'
  } else {
    for (const ws of feed.sockets.values()) ws.close()
    feed.sockets.clear()
    clearInterval(feed.statusTimer)
    $('feed-toggle').textContent = 'Connect'
  }
  updateFeedStatus()
}
$('feed-toggle').addEventListener('click', toggleFeed)

function updateFeedStatus() {
  const el = $('feed-status')
  const open = [...feed.sockets.values()].filter((w) => w.readyState === 1).length
  const stale = feed.agg.staleVenues(Date.now(), 45_000).filter((v) => feed.sockets.has(v))
  let tone = 'offline', label = 'offline'
  if (feed.connected) {
    if (open === 0) { tone = 'danger'; label = 'connecting…' }
    else if (open < feed.venues.length) { tone = 'delayed'; label = `${open}/${feed.venues.length} venues` }
    else if (stale.length) { tone = 'stale'; label = `stale: ${stale.join(',')}` }
    else { tone = 'live'; label = 'live' }
  }
  el.className = `status status--${tone}`
  el.textContent = label
  $('venue-status').textContent = feed.venues.map((v) => `${v}:${feed.sockets.get(v)?.readyState === 1 ? '●' : '○'}`).join(' ')
}

// rAF gating — N trade'ų per frame'ą = 1 render
function scheduleRender() {
  feed.dirty = true
  if (!feed.rafId) feed.rafId = requestAnimationFrame(render)
}

function render() {
  feed.rafId = 0
  if (!feed.dirty) return
  feed.dirty = false
  const snap = feed.agg.snapshot()
  $('cvd').textContent = fmt(snap.cvd, 3)
  $('cvd').className = `num ${snap.cvd >= 0 ? 'buy' : 'sell'}`
  $('cvd-venues').textContent = Object.entries(snap.venueCvd).map(([v, c]) => `${v[0]}:${fmt(c, 1)}`).join(' ')
  if (feed.lastPrice && document.activeElement !== $('ticket-price')) { $('ticket-price').value = String(feed.lastPrice); updateNotional() }

  const bar = snap.bars[snap.bars.length - 1]
  if (!bar) { $('footprint').innerHTML = '<div class="faint">waiting for trades…</div>'; return }
  const levels = [...bar.levels.values()].sort((a, b) => b.price - a.price)
  const max = Math.max(1, ...levels.map((l) => Math.max(l.buyVol, l.sellVol)))
  const signals = detectAll(bar)
  const imb = new Set(signals.filter((s) => s.type === 'imbalance').map((s) => `${s.side}:${s.price}`))
  const head = `<div class="row muted" style="margin-bottom:6px">bar ${new Date(bar.openTs).toISOString().slice(11, 16)}Z · Δ <b class="${bar.delta >= 0 ? 'buy' : 'sell'} num">${fmt(bar.delta, 3)}</b> · trades ${bar.trades}${bar.incomplete ? ' · <span class="status status--warning">incomplete</span>' : ''}</div>`
  $('footprint').innerHTML = head + levels.map((l) => `
    <div class="fp-row">
      <span class="num muted">${fmt(l.price, 0)}</span>
      <div class="fp-bar fp-bar--sell ${imb.has('sell:' + l.price) ? 'imb' : ''}"><span style="width:${(l.sellVol / max) * 100}%"></span><b class="sell num">${fmt(l.sellVol, 3)}</b></div>
      <div class="fp-bar fp-bar--buy ${imb.has('buy:' + l.price) ? 'imb' : ''}"><span style="width:${(l.buyVol / max) * 100}%"></span><b class="buy num">${fmt(l.buyVol, 3)}</b></div>
    </div>`).join('')

  $('signals').innerHTML = signals.length
    ? signals.map((s) => `<span class="badge ${s.side === 'buy' || s.side === 'bullish' ? 'buy' : 'sell'}">${s.type} ${s.side} @${fmt(s.price, 0)}${s.stacked > 1 ? ` ×${s.stacked}` : ''}</span> `).join('')
    : '<span class="faint">none</span>'
}

// ---------------------------------------------------------------------------
// Risk state
// ---------------------------------------------------------------------------
let riskCache = null
async function loadRisk() {
  const { res, body } = await api('/api/risk')
  if (!res.ok) return
  riskCache = body
  const { state, limits, mainnet } = body
  $('risk-badge').className = `status status--${state.disabled ? 'danger' : 'live'}`
  $('risk-badge').textContent = state.disabled ? 'DISABLED' : 'armed'
  const totalNotional = state.positions.reduce((s, p) => s + Math.abs(p.qty) * p.avgEntryPrice, 0)
  $('risk-kv').innerHTML = [
    ['Day', state.dayKey],
    ['Realized PnL', `<span class="num ${state.realizedPnlUsdToday >= 0 ? 'buy' : 'sell'}">${fmt(state.realizedPnlUsdToday)}</span>`],
    ['Consecutive fails', `<span class="num">${state.consecutiveFailures}/${limits.maxConsecutiveFailures}</span>`],
    ['Positions', state.positions.length ? state.positions.map((p) => `<span class="num">${p.symbol} ${p.qty > 0 ? '+' : ''}${p.qty}@${fmt(p.avgEntryPrice, 0)}</span>`).join('<br>') : '<span class="faint">flat</span>'],
    ['Mainnet', mainnet.allowMainnet && mainnet.limitsConfirmed ? '<span class="danger">ENABLED</span>' : '<span class="buy">blocked</span>'],
    state.disabled ? ['Reason', `<span class="danger">${state.disabledReason}</span>`] : null
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
  const meter = (label, used, max) => {
    const u = max > 0 ? Math.min(1, used / max) : 0
    return `<div style="margin-bottom:6px"><div class="row" style="justify-content:space-between;font-size:var(--fs-meta)"><span class="muted">${label}</span><span class="num">${fmt(used)} / ${fmt(max)}</span></div><div class="meter ${u >= 1 ? 'meter--danger' : u >= 0.8 ? 'meter--warn' : ''}"><span style="width:${u * 100}%"></span></div></div>`
  }
  $('risk-meters').innerHTML =
    meter('Daily loss', Math.max(0, -state.realizedPnlUsdToday), limits.dailyLossLimitUsd) +
    meter('Total notional', totalNotional, limits.maxTotalNotionalUsd) +
    meter('Orders / window', state.recentOrderTs.filter((t) => t > Date.now() - limits.orderWindowMs).length, limits.maxOrdersPerWindow)
  renderLimitsForm(limits)
}

function renderLimitsForm(limits) {
  const fields = [
    ['maxOrderNotionalUsd', 'Max order $'], ['maxPositionSize', 'Max position'], ['maxTotalNotionalUsd', 'Max total $'],
    ['dailyLossLimitUsd', 'Daily loss $'], ['maxConsecutiveFailures', 'Max fails'], ['maxOrdersPerWindow', 'Orders/window'],
    ['orderWindowMs', 'Window ms']
  ]
  $('limits-form').innerHTML = fields.map(([k, l]) => `<label>${l}<input class="num" name="${k}" value="${limits[k]}" inputmode="decimal"></label>`).join('') +
    `<label style="grid-column:1/-1">Allowed symbols (comma)<input name="allowedSymbols" value="${limits.allowedSymbols.join(',')}"></label>`
}
$('limits-save').addEventListener('click', async () => {
  const inputs = [...$('limits-form').querySelectorAll('input')]
  const body = {}
  for (const i of inputs) body[i.name] = i.name === 'allowedSymbols' ? i.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : Number(i.value)
  const { res, body: out } = await api('/api/risk/limits', { method: 'PUT', body: JSON.stringify(body) })
  toast(res.ok ? 'Limits saved' : `Rejected: ${out.field ?? out.error}`, res.ok ? '' : 'danger')
  loadRisk(); loadAudit()
})

$('kill-btn').addEventListener('click', async () => {
  if (!confirm('KILL SWITCH: disable all trading now?')) return
  await api('/api/risk/kill', { method: 'POST', body: JSON.stringify({ reason: 'dashboard' }) })
  toast('Kill switch engaged', 'danger'); loadRisk(); loadAudit()
})
$('enable-btn').addEventListener('click', async () => {
  if (!confirm('Re-enable trading? Make sure you understand why it was disabled.')) return
  await api('/api/risk/enable', { method: 'POST' })
  toast('Trading re-enabled'); loadRisk(); loadAudit()
})
$('refresh-btn').addEventListener('click', () => { loadRisk(); loadOrders(); loadAudit() })

// ---------------------------------------------------------------------------
// Order ticket — 2-step confirm
// ---------------------------------------------------------------------------
const ticket = $('ticket')
const readIntent = () => {
  const f = new FormData(ticket)
  return {
    clientOrderId: crypto.randomUUID(),
    symbol: String(f.get('symbol')).toUpperCase(),
    side: f.get('side'),
    qty: Number(f.get('qty')),
    price: Number(f.get('price')),
    mode: f.get('mode'),
    ts: 0
  }
}
function updateNotional() {
  const i = readIntent()
  $('ticket-notional').textContent = fmt(i.qty * i.price)
}
ticket.addEventListener('input', () => { updateNotional(); precheck() })
let precheckTimer = 0
function precheck() {
  clearTimeout(precheckTimer)
  precheckTimer = setTimeout(async () => {
    const i = readIntent()
    if (!(i.qty > 0 && i.price > 0)) return
    const { res, body } = await api('/api/risk/check', { method: 'POST', body: JSON.stringify(i) })
    if (!res.ok) return
    $('precheck').innerHTML = body.ok
      ? (body.warnings.length ? body.warnings.map((w) => `<span class="status status--warning">${w.message}</span>`).join(' ') : '<span class="status status--live">passes all limits</span>')
      : `<span class="status status--danger">${body.rejection.code}: ${body.rejection.message}</span>`
  }, 250)
}

let pending = null, confirmTimer = 0
ticket.addEventListener('submit', (e) => {
  e.preventDefault()
  pending = readIntent()
  $('confirm-text').innerHTML = `<b class="${pending.side}">${pending.side.toUpperCase()}</b> <span class="num">${pending.qty}</span> ${pending.symbol} @ <span class="num">${fmt(pending.price)}</span> = <span class="num">$${fmt(pending.qty * pending.price)}</span> · <span class="badge">${pending.mode}</span>${pending.mode === 'mainnet' ? ' <span class="danger">REAL MONEY</span>' : ''}`
  $('confirm').hidden = false
  let left = 15
  const tick = () => { $('confirm-timer').textContent = `expires in ${left}s`; if (left-- <= 0) cancel() }
  tick(); confirmTimer = setInterval(tick, 1000)
})
function cancel() { pending = null; clearInterval(confirmTimer); $('confirm').hidden = true }
$('cancel-btn').addEventListener('click', cancel)
$('confirm-btn').addEventListener('click', async () => {
  if (!pending) return
  const intent = pending
  cancel()
  const { res, body } = await api('/api/orders', { method: 'POST', body: JSON.stringify(intent) })
  if (body.status === 'filled' || body.status === 'sent') toast(`Order ${body.status}: ${intent.side} ${intent.qty} ${intent.symbol}`)
  else if (body.status === 'risk_rejected') toast(`Risk rejected: ${body.record.riskDecision.rejection.message}`, 'danger')
  else toast(`${body.status}: ${body.error ?? body.record?.status ?? res.status}`, 'danger')
  loadRisk(); loadOrders(); loadAudit()
})

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
async function loadOrders() {
  const { res, body } = await api('/api/orders?limit=50')
  if (!res.ok) return
  $('orders').querySelector('tbody').innerHTML = body.orders.map((o) => `<tr>
    <td class="faint" title="${o.clientOrderId}">${o.clientOrderId.slice(0, 8)}</td><td>${o.intent.symbol}</td>
    <td class="${o.intent.side}">${o.intent.side}</td><td class="num">${o.intent.qty}</td><td class="num">${fmt(o.intent.price)}</td>
    <td><span class="status status--${{ filled: 'live', sent: 'delayed', risk_rejected: 'danger', exchange_rejected: 'danger', failed: 'danger' }[o.status] ?? 'stale'}">${o.status}</span></td></tr>`).join('')
}
async function loadAudit() {
  const { res, body } = await api('/api/audit?limit=100')
  if (!res.ok) return
  $('audit').querySelector('tbody').innerHTML = body.audit.map((a) => `<tr>
    <td class="num faint">${new Date(a.ts).toISOString().slice(11, 19)}</td><td>${a.event}</td>
    <td class="faint" style="max-width:180px;overflow:hidden;text-overflow:ellipsis" title='${JSON.stringify(a.detail).replace(/'/g, '&#39;')}'>${a.detail.rejection?.code ?? a.detail.reason ?? a.detail.error ?? a.detail.existingStatus ?? ''}</td></tr>`).join('')
}

// Klaviatūra: K = kill, R = refresh, Esc = cancel confirm
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
  if (e.key === 'k' && e.shiftKey) $('kill-btn').click()
  if (e.key === 'r') $('refresh-btn').click()
  if (e.key === 'Escape') cancel()
})

updateNotional()
loadRisk(); loadOrders(); loadAudit()
setInterval(loadRisk, 10_000)
