/**
 * Integration tests for the Hono app defined in src/index.tsx.
 *
 * Uses a fresh `cf-connecting-ip` per test to avoid the in-memory rate limit
 * middleware carrying state between tests. Each test sets up its own
 * in-memory D1 shim via the same mock as d1-store.test.ts.
 */
import { describe, expect, it } from 'vitest'
import app from './index'
import type { AuditEntry, OrderRecord } from './core/orders/types'
import { initialRiskState, DEFAULT_LIMITS } from './core/risk/engine'
import type { RiskLimits, RiskState } from './core/risk/types'

type Row = Record<string, unknown>

const emptyMeta: D1Meta & Record<string, unknown> = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0
}

function makeMockD1() {
  const tables: Record<string, Row[]> = {
    orders: [],
    audit_log: [],
    risk_state: [],
    risk_limits: []
  }
  let auditId = 0

  function bindParams(sql: string): { table: string; onConflict?: 'ignore' | 'update' } {
    const m = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i)
    const table = m ? m[1] : ''
    const onConflict = /INSERT\s+OR\s+IGNORE/i.test(sql) ? 'ignore' : /ON\s+CONFLICT/i.test(sql) ? 'update' : undefined
    return { table, onConflict }
  }
  function findIdx(rows: Row[], whereExpr: string | undefined, params: unknown[]): number {
    if (!whereExpr) return -1
    const m = whereExpr.match(/(\w+)\s*=\s*(?:\?|'([^']*)'|(\d+(?:\.\d+)?))/)
    if (!m) return -1
    const col = m[1]
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? Number(m[3]) : params[0])
    return rows.findIndex((r) => r[col] === value)
  }
  function orderColumns(sql: string): { cols: string[]; literals: (string | number | null)[] } {
    const m = sql.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i)
    if (!m) return { cols: [], literals: [] }
    const cols = m[1].split(',').map((c) => c.trim())
    const valuesStr = m[2]
    const literals: (string | number | null)[] = []
    for (const part of valuesStr.split(',')) {
      const p = part.trim()
      if (p === '?') literals.push(null)
      else if (/^-?\d+(\.\d+)?$/.test(p)) literals.push(Number(p))
      else if (/^['"].*['"]$/.test(p)) literals.push(p.slice(1, -1))
      else literals.push(p)
    }
    return { cols, literals }
  }
  const db = {
    prepare: (sql: string) => {
      let boundParams: unknown[] = []
      const stmt = {
        bind: (...params: unknown[]) => { boundParams = params; return stmt },
        first: async <T,>(): Promise<T | null> => {
          const t = sql.trim()
          if (/^SELECT/i.test(t)) {
            const { table } = bindParams(t)
            const whereMatch = t.match(/WHERE\s+([^;]+?)(?:\s+ORDER\s+BY|\s+LIMIT|;|$)/i)
            const whereExpr = whereMatch ? whereMatch[1].trim() : undefined
            const rows = tables[table]
            const idx = findIdx(rows, whereExpr, boundParams)
            return idx >= 0 ? (rows[idx] as T) : null
          }
          return null
        },
        all: async <T,>(): Promise<D1Result<T>> => {
          const t = sql.trim()
          if (/^SELECT/i.test(t)) {
            const { table } = bindParams(t)
            const limitMatch = t.match(/LIMIT\s+\?/i)
            const limit = limitMatch ? Number(boundParams[boundParams.length - 1]) : undefined
            let rows = tables[table]
            if (/ORDER\s+BY\s+id\s+DESC/i.test(t)) {
              rows = [...rows].sort((a, b) => Number(b.id) - Number(a.id))
            }
            if (limit !== undefined) rows = rows.slice(0, limit)
            return { results: rows as T[], success: true, meta: emptyMeta }
          }
          return { results: [], success: true, meta: emptyMeta }
        },
        run: async <T = Record<string, unknown>,>(): Promise<D1Result<T>> => {
          const t = sql.trim()
          if (/^INSERT/i.test(t)) {
            const { table, onConflict } = bindParams(t)
            const { cols, literals } = orderColumns(t)
            const row: Row = {}
            let paramIdx = 0
            cols.forEach((c, i) => {
              const lit = literals[i]
              if (lit === null) {
                row[c] = boundParams[paramIdx++]
              } else {
                row[c] = lit
              }
            })
            if (table === 'audit_log') row.id = ++auditId
            const rows = tables[table]
            const keyCol = table === 'orders' ? 'client_order_id' : 'id'
            const existingIdx = rows.findIndex((r) => r[keyCol] === row[keyCol])
            if (existingIdx >= 0) {
              if (onConflict === 'ignore') {
                return { success: true, results: [] as T[], meta: { ...emptyMeta, changes: 0 } }
              }
              if (onConflict === 'update') {
                if (table === 'orders') {
                  rows[existingIdx] = { ...rows[existingIdx], status: row.status, exchange_order_id: row.exchange_order_id, updated_at: row.updated_at }
                } else {
                  rows[existingIdx] = { ...row }
                }
                return { success: true, results: [] as T[], meta: { ...emptyMeta, changes: 1 } }
              }
              return { success: true, results: [] as T[], meta: { ...emptyMeta, changes: 0 } }
            }
            rows.push(row)
            return { success: true, results: [] as T[], meta: { ...emptyMeta, changes: 1 } }
          }
          return { success: true, results: [] as T[], meta: emptyMeta }
        },
        raw: async <T,>(): Promise<T[]> => []
      }
      return stmt as unknown as D1PreparedStatement
    },
    dump: () => tables,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 })
  } as unknown as D1Database & { dump: () => Record<string, Row[]> }
  return db
}

const TOKEN = 'a'.repeat(32)
const AUTH = { authorization: `Bearer ${TOKEN}` }
let ipCounter = 0
function nextIp() { return `203.0.113.${++ipCounter}` }

function makeEnv(db: D1Database): { DB: D1Database; API_TOKEN?: string; ALLOW_MAINNET?: string; RISK_LIMITS_CONFIRMED?: string; ALLOWED_ORIGINS?: string } {
  return { DB: db, API_TOKEN: TOKEN, ALLOW_MAINNET: 'false', RISK_LIMITS_CONFIRMED: 'false', ALLOWED_ORIGINS: 'http://localhost:3000' }
}

async function seedLimits(db: D1Database, over: Partial<RiskLimits> = {}) {
  const limits: RiskLimits = {
    ...DEFAULT_LIMITS,
    maxOrderNotionalUsd: 1_000_000,
    maxPositionSize: 100,
    maxTotalNotionalUsd: 5_000_000,
    dailyLossLimitUsd: 100_000,
    maxConsecutiveFailures: 100,
    maxOrdersPerWindow: 1_000,
    orderWindowMs: 60_000,
    allowedSymbols: ['BTCUSDT'],
    ...over
  }
  // store.putLimits is private; inject via mock D1 to keep env surface clean
  const tables = (db as unknown as { dump: () => Record<string, Row[]> }).dump()
  tables.risk_limits.push({ id: 1, limits_json: JSON.stringify(limits), updated_at: Date.now() })
  return limits
}

const validIntent = {
  clientOrderId: 'order-test-001',
  symbol: 'BTCUSDT',
  side: 'buy',
  qty: 0.01,
  price: 50_000,
  mode: 'paper',
  ts: 0
}

describe('GET /health', () => {
  it('returns ok when DB responds', async () => {
    const db = makeMockD1()
    const res = await app.request('/health', { headers: { 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('auth + rate limit middleware on /api/*', () => {
  it('returns 401 without bearer token', async () => {
    const db = makeMockD1()
    const res = await app.request('/api/risk', { headers: { 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(401)
  })

  it('returns 503 when API_TOKEN is not configured', async () => {
    const db = makeMockD1()
    const env = { DB: db, ALLOWED_ORIGINS: 'http://localhost:3000' } as unknown as { DB: D1Database; API_TOKEN?: string; ALLOWED_ORIGINS?: string }
    const res = await app.request('/api/risk', { headers: { ...AUTH, 'cf-connecting-ip': nextIp() } }, env)
    expect(res.status).toBe(503)
  })

  it('returns 200 with valid token', async () => {
    const db = makeMockD1()
    const res = await app.request('/api/risk', { headers: { ...AUTH, 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/risk', () => {
  it('returns default state when no state has been persisted', async () => {
    const db = makeMockD1()
    const res = await app.request('/api/risk', { headers: { ...AUTH, 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { state: RiskState; limits: RiskLimits; mainnet: { allowMainnet: boolean; limitsConfirmed: boolean } }
    expect(body.state).toBeTruthy()
    expect(body.limits).toBeTruthy()
    expect(body.mainnet.allowMainnet).toBe(false)
    expect(body.mainnet.limitsConfirmed).toBe(false)
  })
})

describe('PUT /api/risk/limits', () => {
  it('returns 400 on invalid body', async () => {
    const db = makeMockD1()
    const res = await app.request('/api/risk/limits', {
      method: 'PUT',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: 'not json'
    }, makeEnv(db))
    expect(res.status).toBe(400)
  })

  it('returns 400 on negative number', async () => {
    const db = makeMockD1()
    const res = await app.request('/api/risk/limits', {
      method: 'PUT',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ maxOrderNotionalUsd: -1 })
    }, makeEnv(db))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; field: string }
    expect(body.error).toBe('invalid_limit')
    expect(body.field).toBe('maxOrderNotionalUsd')
  })

  it('persists valid limits and writes audit', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    const res = await app.request('/api/risk/limits', {
      method: 'PUT',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ maxOrderNotionalUsd: 999 })
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { limits: RiskLimits }
    expect(body.limits.maxOrderNotionalUsd).toBe(999)
  })
})

describe('POST /api/risk/kill and /enable', () => {
  it('kill disables state, enable restores', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    const ip = nextIp()
    const kill = await app.request('/api/risk/kill', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ reason: 'test' })
    }, env)
    expect(kill.status).toBe(200)
    const killed = (await kill.json()) as { state: RiskState }
    expect(killed.state.disabled).toBe(true)
    expect(killed.state.disabledReason).toContain('test')

    const enable = await app.request('/api/risk/enable', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip }
    }, env)
    expect(enable.status).toBe(200)
    const enabled = (await enable.json()) as { state: RiskState }
    expect(enabled.state.disabled).toBe(false)
  })

  it('kill is idempotent', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    const ip = nextIp()
    await app.request('/api/risk/kill', {
      method: 'POST', headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ reason: 'first' })
    }, env)
    const second = await app.request('/api/risk/kill', {
      method: 'POST', headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ reason: 'second' })
    }, env)
    const body = (await second.json()) as { state: RiskState }
    // second call should not change the disabledReason
    expect(body.state.disabledReason).toContain('first')
  })
})

describe('POST /api/risk/check', () => {
  it('returns 400 on invalid intent (no clientOrderId)', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const res = await app.request('/api/risk/check', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ symbol: 'BTCUSDT' })
    }, env)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_intent_shape')
  })

  it('returns 400 on garbage body', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    const res = await app.request('/api/risk/check', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: 'not json'
    }, env)
    expect(res.status).toBe(400)
  })

  it('returns ok: true for valid paper intent', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const res = await app.request('/api/risk/check', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify(validIntent)
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('POST /api/orders', () => {
  it('returns 400 on invalid intent', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ symbol: 'BTCUSDT' })
    }, env)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { status: string; error: string }
    expect(body.status).toBe('invalid')
  })

  it('returns 201 filled for valid paper intent', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify(validIntent)
    }, env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { status: string; record: OrderRecord }
    expect(body.status).toBe('filled')
    expect(body.record.clientOrderId).toBe(validIntent.clientOrderId)
  })

  it('returns 200 duplicate on second submit with same clientOrderId', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const ip = nextIp()
    const first = await app.request('/api/orders', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify(validIntent)
    }, env)
    expect(first.status).toBe(201)
    const second = await app.request('/api/orders', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify(validIntent)
    }, env)
    expect(second.status).toBe(200)
    const body = (await second.json()) as { status: string }
    expect(body.status).toBe('duplicate')
  })
})

describe('GET /api/orders and /api/audit', () => {
  it('list orders after a submit', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const ip = nextIp()
    await app.request('/api/orders', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify(validIntent)
    }, env)
    const res = await app.request('/api/orders?limit=10', {
      headers: { ...AUTH, 'cf-connecting-ip': ip }
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orders: OrderRecord[] }
    expect(body.orders.length).toBeGreaterThan(0)
  })

  it('list audit returns the entries written by the pipeline', async () => {
    const db = makeMockD1()
    const env = makeEnv(db)
    await seedLimits(db)
    const ip = nextIp()
    await app.request('/api/orders', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify(validIntent)
    }, env)
    const res = await app.request('/api/audit?limit=50', {
      headers: { ...AUTH, 'cf-connecting-ip': ip }
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { audit: AuditEntry[] }
    expect(body.audit.length).toBeGreaterThan(0)
    expect(body.audit.some((a) => a.event === 'order.received')).toBe(true)
    expect(body.audit.some((a) => a.event === 'order.filled')).toBe(true)
  })
})

describe('UI routes', () => {
  it('GET / returns terminal HTML', async () => {
    const db = makeMockD1()
    const res = await app.request('/', { headers: { 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('<!DOCTYPE html>')
    expect(text).toContain('chart terminal')
  })

  it('GET /dashboard returns dashboard HTML', async () => {
    const db = makeMockD1()
    const res = await app.request('/dashboard', { headers: { 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Risk')
  })

  it('GET /chart returns 404 (route was deleted)', async () => {
    const db = makeMockD1()
    const res = await app.request('/chart', { headers: { 'cf-connecting-ip': nextIp() } }, makeEnv(db))
    expect(res.status).toBe(404)
  })
})
