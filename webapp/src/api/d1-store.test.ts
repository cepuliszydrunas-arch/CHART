/**
 * In-memory D1Database shim for unit tests.
 *
 * Real D1 has prepared-statement caching, batch semantics, and SQLite-specific
 * SQL dialect. This shim only supports the surface used by D1OrderStore:
 *   - prepare(sql).bind(...).first<T>() -> T | null
 *   - prepare(sql).bind(...).all<T>() -> { results: T[] }
 *   - prepare(sql).bind(...).run() -> { meta: { changes?: number } }
 *
 * It implements just enough of SELECT/INSERT/INSERT OR IGNORE/INSERT ON CONFLICT
 * to exercise D1OrderStore. For integration tests against real D1, use
 * @cloudflare/vitest-pool-workers in a follow-up sprint.
 */
import { describe, expect, it } from 'vitest'
import { D1OrderStore } from './d1-store'
import type { AuditEntry, OrderRecord } from '../core/orders/types'
import { initialRiskState, DEFAULT_LIMITS } from '../core/risk/engine'
import type { RiskLimits, RiskState } from '../core/risk/types'

type Row = Record<string, unknown>

type MockD1 = D1Database & { dump: () => Record<string, Row[]> }

function makeMockD1(): MockD1 {
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
    if (!tables[table]) throw new Error(`Mock D1: unknown table ${table}`)
    const onConflict = /INSERT\s+OR\s+IGNORE/i.test(sql) ? 'ignore' : /ON\s+CONFLICT/i.test(sql) ? 'update' : undefined
    return { table, onConflict }
  }

  function findOrderById(rows: Row[], whereExpr: string | undefined, params: unknown[]): number {
    if (!whereExpr) return -1
    // support `WHERE col = ?` (bound) or `WHERE col = 1` (literal)
    const m = whereExpr.match(/(\w+)\s*=\s*(?:\?|'([^']*)'|(\d+(?:\.\d+)?))/)
    if (!m) return -1
    const col = m[1]
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? Number(m[3]) : params[0])
    return rows.findIndex((r) => r[col] === value)
  }

  function orderColumns(sql: string): { cols: string[]; literals: (string | number | null)[] } {
    // extract (col1, col2, ...) after the first `(` following VALUES or after table name in INSERT
    const m = sql.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i)
    if (!m) return { cols: [], literals: [] }
    const cols = m[1].split(',').map((c) => c.trim())
    const valuesStr = m[2]
    const literals: (string | number | null)[] = []
    let i = 0
    for (const part of valuesStr.split(',')) {
      const p = part.trim()
      if (p === '?') {
        literals.push(null) // placeholder; resolved at run time
        i++
      } else if (/^-?\d+(\.\d+)?$/.test(p)) {
        literals.push(Number(p))
      } else if (/^['"].*['"]$/.test(p)) {
        literals.push(p.slice(1, -1))
      } else {
        literals.push(p)
      }
    }
    return { cols, literals }
  }

  // D1Meta is `D1Meta & Record<string, unknown>` per @cloudflare/workers-types.
  // We provide all known fields; tests assert only on `changes`.
  const emptyMeta: D1Meta & Record<string, unknown> = {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0
  }

  const db = {
    prepare: (sql: string) => {
      let boundParams: unknown[] = []
      const stmt = {
        bind: (...params: unknown[]) => {
          boundParams = params
          return stmt
        },
        first: async <T,>(): Promise<T | null> => {
          const trimmed = sql.trim()
          if (/^SELECT/i.test(trimmed)) {
            const { table } = bindParams(trimmed)
            const whereMatch = trimmed.match(/WHERE\s+([^;]+?)(?:\s+ORDER\s+BY|\s+LIMIT|;|$)/i)
            const whereExpr = whereMatch ? whereMatch[1].trim() : undefined
            const rows = tables[table]
            const idx = findOrderById(rows, whereExpr, boundParams)
            return idx >= 0 ? (rows[idx] as T) : null
          }
          return null
        },
        all: async <T,>(): Promise<D1Result<T>> => {
          const trimmed = sql.trim()
          if (/^SELECT/i.test(trimmed)) {
            const { table } = bindParams(trimmed)
            const limitMatch = trimmed.match(/LIMIT\s+\?/i)
            const limit = limitMatch ? Number(boundParams[boundParams.length - 1]) : undefined
            let rows = tables[table]
            if (/ORDER\s+BY\s+id\s+DESC/i.test(trimmed)) {
              rows = [...rows].sort((a, b) => Number(b.id) - Number(a.id))
            }
            if (limit !== undefined) rows = rows.slice(0, limit)
            return { results: rows as T[], success: true, meta: emptyMeta }
          }
          return { results: [], success: true, meta: emptyMeta }
        },
        run: async <T = Record<string, unknown>,>(): Promise<D1Result<T>> => {
          const trimmed = sql.trim()
          if (/^INSERT/i.test(trimmed)) {
            const { table, onConflict } = bindParams(trimmed)
            const { cols, literals } = orderColumns(trimmed)
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
            if (table === 'audit_log') {
              row.id = ++auditId
            }
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
  }
  return db as unknown as D1Database & { dump: () => Record<string, Row[]> }
}

function makeOrder(over: Partial<OrderRecord> = {}): OrderRecord {
  const intent = {
    clientOrderId: 'order-0001',
    symbol: 'BTCUSDT',
    side: 'buy' as const,
    qty: 0.01,
    price: 50_000,
    mode: 'paper' as const,
    ts: 1_700_000_000_000
  }
  return {
    clientOrderId: 'order-0001',
    intent,
    status: 'received',
    exchangeOrderId: null,
    riskDecision: { ok: true, warnings: [] },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over
  }
}

function makeAudit(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: 1_700_000_000_000,
    event: 'order.received',
    actor: 'owner',
    ip: '127.0.0.1',
    clientOrderId: 'order-0001',
    detail: { foo: 'bar' },
    ...over
  }
}

describe('D1OrderStore — orders', () => {
  it('getOrder returns null for missing id', async () => {
    const store = new D1OrderStore(makeMockD1())
    expect(await store.getOrder('nope')).toBeNull()
  })

  it('putOrder inserts; getOrder round-trips', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    const o = makeOrder()
    await store.putOrder(o)
    const got = await store.getOrder(o.clientOrderId)
    expect(got).toEqual(o)
  })

  it('putOrder upserts via ON CONFLICT', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    const o = makeOrder({ status: 'received' })
    await store.putOrder(o)
    const updated = makeOrder({ status: 'filled', exchangeOrderId: 'ex-1' })
    await store.putOrder(updated)
    const got = await store.getOrder(o.clientOrderId)
    expect(got?.status).toBe('filled')
    expect(got?.exchangeOrderId).toBe('ex-1')
  })

  it('createIfAbsent returns true first time, false second time', async () => {
    const store = new D1OrderStore(makeMockD1())
    const o = makeOrder()
    expect(await store.createIfAbsent(o)).toBe(true)
    expect(await store.createIfAbsent(o)).toBe(false)
  })

  it('listOrders returns most recent first, respects limit clamp', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    for (let i = 0; i < 5; i++) {
      await store.putOrder(makeOrder({ clientOrderId: `order-${i.toString().padStart(4, '0')}`, createdAt: i }))
    }
    const all = await store.listOrders(10)
    expect(all).toHaveLength(5)
    // limit > 200 is clamped to 200; only 5 in store
    const big = await store.listOrders(10_000)
    expect(big.length).toBe(5)
    // limit=0 is clamped up to 1
    const min = await store.listOrders(0)
    expect(min.length).toBe(1)
  })
})

describe('D1OrderStore — audit', () => {
  it('appendAudit + listAudit round-trips, newest first', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    await store.appendAudit(makeAudit({ ts: 1000, event: 'order.received' }))
    await store.appendAudit(makeAudit({ ts: 2000, event: 'order.filled' }))
    const all = await store.listAudit(10)
    expect(all.map((a) => a.ts)).toEqual([2000, 1000])
  })

  it('listAudit filters out rows with invalid event types', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    // inject a malformed row directly
    const tables = (db as unknown as { dump: () => Record<string, Row[]> }).dump()
    tables.audit_log.push({ ts: 3000, event: 'hacker.evil', actor: 'evil', ip: '0.0.0.0', client_order_id: null, detail_json: '{}' })
    await store.appendAudit(makeAudit({ ts: 1000, event: 'order.received' }))
    const all = await store.listAudit(10)
    expect(all).toHaveLength(1)
    expect(all[0].event).toBe('order.received')
  })

  it('listAudit limit clamp: max 500, min 1', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    for (let i = 0; i < 3; i++) await store.appendAudit(makeAudit({ ts: i }))
    // limit=0 is clamped up to 1 inside the store
    expect((await store.listAudit(0)).length).toBe(1)
    // within the cap
    expect((await store.listAudit(10_000)).length).toBe(3)
  })
})

describe('D1OrderStore — risk state', () => {
  it('getRiskState returns null when not set', async () => {
    const store = new D1OrderStore(makeMockD1())
    expect(await store.getRiskState()).toBeNull()
  })

  it('putRiskState + getRiskState round-trips', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    const s: RiskState = initialRiskState(1_700_000_000_000)
    await store.putRiskState(s)
    const got = await store.getRiskState()
    expect(got).toEqual(s)
  })

  it('putRiskState upserts single row (id=1)', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    const s1 = initialRiskState(1_700_000_000_000)
    await store.putRiskState(s1)
    const s2: RiskState = { ...s1, disabled: true, disabledReason: 'test' }
    await store.putRiskState(s2)
    const got = await store.getRiskState()
    expect(got?.disabled).toBe(true)
    expect((db as unknown as { dump: () => Record<string, Row[]> }).dump().risk_state).toHaveLength(1)
  })
})

describe('D1OrderStore — risk limits', () => {
  it('getLimits returns null when not set', async () => {
    const store = new D1OrderStore(makeMockD1())
    expect(await store.getLimits()).toBeNull()
  })

  it('putLimits + getLimits round-trips', async () => {
    const db = makeMockD1()
    const store = new D1OrderStore(db)
    const l: RiskLimits = { ...DEFAULT_LIMITS, allowedSymbols: ['BTCUSDT'] }
    await store.putLimits(l)
    const got = await store.getLimits()
    expect(got).toEqual(l)
  })
})
