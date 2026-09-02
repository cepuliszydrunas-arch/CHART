import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { DEFAULT_LIMITS, evaluate, initialRiskState, killSwitch, reEnable } from './core/risk/engine'
import type { RiskLimits } from './core/risk/types'
import { submitOrder, validateIntentShape } from './core/orders/pipeline'
import { PaperAdapter } from './core/orders/memory-store'
import { D1OrderStore } from './api/d1-store'
import { bearerAuth, clientIp, rateLimit } from './api/auth'
import { dashboardHtml } from './ui/dashboard'
import { terminalHtml } from './ui/terminal'


type Bindings = {
  DB: D1Database
  API_TOKEN?: string
  ALLOW_MAINNET?: string
  RISK_LIMITS_CONFIRMED?: string
  /** Comma-separated list of allowed origins for CORS. Defaults to localhost in dev. */
  ALLOWED_ORIGINS?: string
}

function parseOrigins(csv: string | undefined): string[] {
  if (!csv) return ['http://localhost:3000']
  return csv.split(',').map((s) => s.trim()).filter(Boolean)
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/static/*', serveStatic({ root: './public' }))
app.use('/api/*', cors({
  origin: (origin, c) => {
    const allowed = parseOrigins(c.env.ALLOWED_ORIGINS)
    if (!origin) return allowed[0]
    return allowed.includes(origin) ? origin : allowed[0]
  },
  credentials: true
}))
app.use('/api/*', rateLimit({ capacity: 30, refillPerSec: 5 }))
app.use('/api/*', bearerAuth((c) => c.env.API_TOKEN))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const store = (c: { env: Bindings }) => new D1OrderStore(c.env.DB)
const loadLimits = async (s: D1OrderStore): Promise<RiskLimits> => (await s.getLimits()) ?? DEFAULT_LIMITS
const ACTOR = 'owner'

// ---------------------------------------------------------------------------
// Health (be auth — monitoringui)
// ---------------------------------------------------------------------------
app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ ok: true, ts: Date.now() })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 503)
  }
})

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------
app.get('/api/risk', async (c) => {
  const s = store(c)
  const [state, limits] = await Promise.all([s.getRiskState(), loadLimits(s)])
  return c.json({
    state: state ?? initialRiskState(Date.now()),
    limits,
    mainnet: {
      allowMainnet: c.env.ALLOW_MAINNET === 'true',
      limitsConfirmed: c.env.RISK_LIMITS_CONFIRMED === 'true'
    }
  })
})

app.put('/api/risk/limits', async (c) => {
  const s = store(c)
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_body' }, 400)
  const prev = await loadLimits(s)
  const next: RiskLimits = { ...prev, ...pickLimits(body) }
  // Sanity: skaičiai teigiami, allowlist — string masyvas
  for (const k of ['maxOrderNotionalUsd', 'maxPositionSize', 'maxTotalNotionalUsd', 'dailyLossLimitUsd', 'maxConsecutiveFailures', 'maxOrdersPerWindow', 'orderWindowMs'] as const) {
    if (!(typeof next[k] === 'number' && Number.isFinite(next[k]) && next[k] > 0)) return c.json({ error: 'invalid_limit', field: k }, 400)
  }
  if (!Array.isArray(next.allowedSymbols) || !next.allowedSymbols.every((x) => typeof x === 'string')) return c.json({ error: 'invalid_limit', field: 'allowedSymbols' }, 400)
  await s.putLimits(next)
  await s.appendAudit({ ts: Date.now(), event: 'risk.limits_changed', actor: ACTOR, ip: clientIp(c), clientOrderId: null, detail: { prev, next } })
  return c.json({ limits: next })
})

/** Kill-switch: < 1 min sustabdo viską. Idempotentiškas. */
app.post('/api/risk/kill', async (c) => {
  const s = store(c)
  const { reason = 'manual' } = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const now = Date.now()
  const state = killSwitch((await s.getRiskState()) ?? initialRiskState(now), now, String(reason).slice(0, 200))
  await s.putRiskState(state)
  await s.appendAudit({ ts: now, event: 'risk.kill_switch', actor: ACTOR, ip: clientIp(c), clientOrderId: null, detail: { reason } })
  return c.json({ state })
})

app.post('/api/risk/enable', async (c) => {
  const s = store(c)
  const now = Date.now()
  const state = reEnable((await s.getRiskState()) ?? initialRiskState(now))
  await s.putRiskState(state)
  await s.appendAudit({ ts: now, event: 'risk.re_enable', actor: ACTOR, ip: clientIp(c), clientOrderId: null, detail: {} })
  return c.json({ state })
})

/** Dry-run: UI rodo, kuris limitas suveiks, PRIEŠ 2-žingsnio confirm. */
app.post('/api/risk/check', async (c) => {
  const s = store(c)
  const intent = await c.req.json().catch(() => null)
  if (!validateIntentShape(intent)) return c.json({ error: 'invalid_intent_shape' }, 400)
  const [state, limits] = await Promise.all([s.getRiskState(), loadLimits(s)])
  const decision = evaluate({
    intent,
    limits,
    state: state ?? initialRiskState(Date.now()),
    env: c.env
  })
  return c.json(decision)
})

// ---------------------------------------------------------------------------
// Orders — VIENAS route'as, VIENAS pipeline
// ---------------------------------------------------------------------------
app.post('/api/orders', async (c) => {
  const s = store(c)
  const body = await c.req.json().catch(() => null)
  const limits = await loadLimits(s)
  const result = await submitOrder(body, {
    store: s,
    adapter: new PaperAdapter(2), // 2 bps slippage. Testnet/mainnet adapteriai — atskiras PR su vault.
    limits,
    env: c.env,
    actor: ACTOR,
    ip: clientIp(c)
  })
  const status = result.status === 'invalid' ? 400 : result.status === 'risk_rejected' ? 422 : result.status === 'duplicate' ? 200 : 201
  return c.json(result, status)
})

app.get('/api/orders', async (c) => {
  const limit = Number(c.req.query('limit') ?? 50)
  return c.json({ orders: await store(c).listOrders(limit) })
})

app.get('/api/audit', async (c) => {
  const limit = Number(c.req.query('limit') ?? 100)
  return c.json({ audit: await store(c).listAudit(limit) })
})

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
// Chart-terminal shell (P0/P1 referencinis) — pagrindinis puslapis
app.get('/', (c) => c.html(terminalHtml()))
app.get('/terminal', (c) => c.html(terminalHtml()))

// Risk & Orderflow dashboard (taip pat pasiekiamas kaip widget'as iš meniu)
app.get('/dashboard', (c) => c.html(dashboardHtml()))


export default app

function pickLimits(b: Record<string, unknown>): Partial<RiskLimits> {
  const out: Partial<RiskLimits> = {}
  const keys: (keyof RiskLimits)[] = ['maxOrderNotionalUsd', 'maxPositionSize', 'maxTotalNotionalUsd', 'dailyLossLimitUsd', 'maxConsecutiveFailures', 'maxOrdersPerWindow', 'orderWindowMs', 'allowedSymbols']
  for (const k of keys) if (k in b) (out as Record<string, unknown>)[k] = b[k]
  return out
}
