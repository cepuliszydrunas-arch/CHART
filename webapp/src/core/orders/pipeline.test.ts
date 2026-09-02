import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, killSwitch, initialRiskState } from '../risk/engine'
import type { RiskLimits } from '../risk/types'
import { MemoryOrderStore, PaperAdapter } from './memory-store'
import { submitOrder, validateIntentShape, type SubmitContext } from './pipeline'
import type { ExecutionAdapter } from './types'

const T0 = Date.UTC(2026, 8, 2, 12, 0, 0)
const limits: RiskLimits = {
  ...DEFAULT_LIMITS,
  maxOrderNotionalUsd: 1000,
  maxPositionSize: 0.1,
  maxTotalNotionalUsd: 5000,
  maxConsecutiveFailures: 2,
  allowedSymbols: ['BTCUSDT']
}

function ctx(over: Partial<SubmitContext> = {}): SubmitContext & { store: MemoryOrderStore } {
  let t = T0
  return {
    store: new MemoryOrderStore(),
    adapter: new PaperAdapter(),
    limits,
    env: {},
    actor: 'owner',
    ip: '127.0.0.1',
    now: () => (t += 1),
    ...over
  } as SubmitContext & { store: MemoryOrderStore }
}

const intent = (id = 'order-0001', over: Record<string, unknown> = {}) => ({
  clientOrderId: id,
  symbol: 'BTCUSDT',
  side: 'buy',
  qty: 0.01,
  price: 50_000,
  mode: 'paper',
  ts: 0,
  ...over
})

const failingAdapter: ExecutionAdapter = { place: async () => ({ ok: false, reason: 'insufficient margin' }) }
const throwingAdapter: ExecutionAdapter = {
  place: async () => {
    throw new Error('network down')
  }
}
const restingAdapter: ExecutionAdapter = { place: async () => ({ ok: true, exchangeOrderId: 'ex-1' }) }

describe('validateIntentShape', () => {
  it('accepts a valid intent', () => expect(validateIntentShape(intent())).toBe(true))
  it('rejects short / weird clientOrderId', () => {
    expect(validateIntentShape(intent('abc'))).toBe(false)
    expect(validateIntentShape(intent('has space here'))).toBe(false)
  })
  it('rejects wrong side / mode / non-number qty / null', () => {
    expect(validateIntentShape(intent('order-0001', { side: 'long' }))).toBe(false)
    expect(validateIntentShape(intent('order-0001', { mode: 'live' }))).toBe(false)
    expect(validateIntentShape(intent('order-0001', { qty: '0.01' }))).toBe(false)
    expect(validateIntentShape(null)).toBe(false)
    expect(validateIntentShape('x')).toBe(false)
  })
})

describe('submitOrder', () => {
  it('paper order fills, updates risk state, writes full audit trail', async () => {
    const c = ctx()
    const r = await submitOrder(intent(), c)
    expect(r.status).toBe('filled')
    const rs = await c.store.getRiskState()
    expect(rs?.positions).toEqual([{ symbol: 'BTCUSDT', qty: 0.01, avgEntryPrice: 50_000 }])
    expect(rs?.recentOrderTs).toHaveLength(1)
    expect(c.store.allAudit().map((a) => a.event)).toEqual(['order.received', 'order.accepted', 'order.filled'])
    expect(c.store.allAudit()[0].ip).toBe('127.0.0.1')
  })

  it('server overwrites client ts', async () => {
    const c = ctx()
    const r = await submitOrder(intent('order-0001', { ts: 1 }), c)
    if (r.status !== 'filled') throw new Error('expected filled')
    expect(r.record.intent.ts).toBeGreaterThan(T0)
  })

  it('invalid shape → invalid + audit', async () => {
    const c = ctx()
    const r = await submitOrder({ foo: 'bar' }, c)
    expect(r.status).toBe('invalid')
    expect(c.store.allAudit()[0].event).toBe('order.failed')
  })

  it('risk rejection persists record with status risk_rejected and does NOT call adapter', async () => {
    let called = 0
    const c = ctx({ adapter: { place: async () => (called++, { ok: true, exchangeOrderId: 'x' }) } })
    const r = await submitOrder(intent('order-0001', { qty: 1 }), c) // notional 50k > 1000
    expect(r.status).toBe('risk_rejected')
    expect(called).toBe(0)
    expect((await c.store.getOrder('order-0001'))?.status).toBe('risk_rejected')
    expect(c.store.allAudit().at(-1)?.event).toBe('order.risk_rejected')
  })

  it('duplicate clientOrderId returns first result, no second send', async () => {
    let called = 0
    const c = ctx({
      adapter: { place: async (i) => (called++, { ok: true, exchangeOrderId: 'x', fill: { qty: i.qty, price: i.price } }) }
    })
    const a = await submitOrder(intent(), c)
    const b = await submitOrder(intent(), c)
    expect(a.status).toBe('filled')
    expect(b.status).toBe('duplicate')
    if (b.status === 'duplicate') expect(b.record.status).toBe('filled')
    expect(called).toBe(1)
    expect(c.store.allAudit().at(-1)?.event).toBe('order.duplicate')
  })

  it('duplicate also for risk_rejected orders (no re-evaluation)', async () => {
    const c = ctx()
    await submitOrder(intent('order-0001', { qty: 1 }), c)
    const b = await submitOrder(intent('order-0001', { qty: 0.001 }), c) // now would pass — but ID reused
    expect(b.status).toBe('duplicate')
  })

  it('exchange reject → exchange_rejected, failure counter, auto-disable after N', async () => {
    const c = ctx({ adapter: failingAdapter })
    const r1 = await submitOrder(intent('order-0001'), c)
    expect(r1.status).toBe('exchange_rejected')
    expect((await c.store.getRiskState())?.consecutiveFailures).toBe(1)
    const r2 = await submitOrder(intent('order-0002'), c)
    expect(r2.status).toBe('exchange_rejected')
    const rs = await c.store.getRiskState()
    expect(rs?.disabled).toBe(true)
    expect(c.store.allAudit().at(-1)?.event).toBe('risk.auto_disable')
    // Trečias — jau atmestas risk lygyje
    const r3 = await submitOrder(intent('order-0003'), c)
    expect(r3.status).toBe('risk_rejected')
    if (r3.status === 'risk_rejected' && !r3.record.riskDecision.ok) {
      expect(r3.record.riskDecision.rejection.code).toBe('DISABLED')
    }
  })

  it('adapter throwing is treated as exchange_rejected, never propagates', async () => {
    const c = ctx({ adapter: throwingAdapter })
    const r = await submitOrder(intent(), c)
    expect(r.status).toBe('exchange_rejected')
    expect(c.store.allAudit().at(-1)?.detail.reason).toBe('network down')
  })

  it('resting order (no fill) → sent with exchangeOrderId, position unchanged', async () => {
    const c = ctx({ adapter: restingAdapter })
    const r = await submitOrder(intent(), c)
    expect(r.status).toBe('sent')
    if (r.status === 'sent') expect(r.record.exchangeOrderId).toBe('ex-1')
    expect((await c.store.getRiskState())?.positions).toEqual([])
  })

  it('kill-switched state rejects immediately', async () => {
    const c = ctx()
    await c.store.putRiskState(killSwitch(initialRiskState(T0), T0, 'test'))
    const r = await submitOrder(intent(), c)
    expect(r.status).toBe('risk_rejected')
  })

  it('race on createIfAbsent yields duplicate', async () => {
    const c = ctx()
    // Simuliuojam: getOrder grąžina null, bet createIfAbsent → false
    const store = c.store
    const orig = store.getOrder.bind(store)
    let first = true
    store.getOrder = async (id) => {
      if (first) {
        first = false
        return null
      }
      return orig(id)
    }
    await store.createIfAbsent({
      clientOrderId: 'order-0001',
      intent: intent() as never,
      status: 'sent',
      exchangeOrderId: 'ex-9',
      riskDecision: { ok: true, warnings: [] },
      createdAt: T0,
      updatedAt: T0
    })
    const r = await submitOrder(intent(), c)
    expect(r.status).toBe('duplicate')
    if (r.status === 'duplicate') expect(r.record.exchangeOrderId).toBe('ex-9')
  })
})
