import { describe, expect, it } from 'vitest'
import { DedupRing, OrderflowAggregator } from './aggregator'
import type { NormalizedTrade } from './types'

const T0 = Date.UTC(2026, 8, 2, 12, 0, 0) // aligned to minute
const TF = 60_000

const cfg = { symbol: 'BTCUSDT', timeframeMs: TF, tickSize: 10, retention: 5, dedupWindow: 100 }

let seq = 0
function trade(over: Partial<NormalizedTrade> = {}): NormalizedTrade {
  seq++
  return { venue: 'binance', tradeId: `t${seq}`, symbol: 'BTCUSDT', price: 50_000, qty: 1, aggressor: 'buy', ts: T0, ...over }
}

describe('DedupRing', () => {
  it('detects duplicates and evicts LIFO by capacity', () => {
    const r = new DedupRing(3)
    expect(r.add('a')).toBe(true)
    expect(r.add('a')).toBe(false)
    r.add('b')
    r.add('c')
    expect(r.size).toBe(3)
    r.add('d') // evicts 'a'
    expect(r.has('a')).toBe(false)
    expect(r.add('a')).toBe(true)
    expect(r.size).toBe(3)
  })
  it('clear resets', () => {
    const r = new DedupRing(2)
    r.add('x')
    r.clear()
    expect(r.add('x')).toBe(true)
  })
  it('rejects capacity <= 0', () => {
    expect(() => new DedupRing(0)).toThrow()
  })
})

describe('OrderflowAggregator — ingest & CVD', () => {
  it('validates config', () => {
    expect(() => new OrderflowAggregator({ ...cfg, timeframeMs: 0 })).toThrow()
    expect(() => new OrderflowAggregator({ ...cfg, tickSize: 0 })).toThrow()
    expect(() => new OrderflowAggregator({ ...cfg, retention: 0 })).toThrow()
  })

  it('accumulates CVD across venues, tracks per-venue CVD', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ venue: 'binance', qty: 2, aggressor: 'buy' }))
    a.ingest(trade({ venue: 'bybit', qty: 0.5, aggressor: 'sell' }))
    a.ingest(trade({ venue: 'okx', qty: 1, aggressor: 'buy' }))
    const s = a.snapshot()
    expect(s.cvd).toBeCloseTo(2.5)
    expect(s.venueCvd).toEqual({ binance: 2, bybit: -0.5, okx: 1 })
    expect(s.tradesIngested).toBe(3)
  })

  it('applies venue weights to CVD but not to raw footprint volume', () => {
    const a = new OrderflowAggregator({ ...cfg, venueWeights: { bybit: 0.5 } })
    a.ingest(trade({ venue: 'bybit', qty: 4, aggressor: 'buy' }))
    const s = a.snapshot()
    expect(s.cvd).toBe(2)
    expect(s.bars[0].totalBuy).toBe(4) // footprint = tikras volume
    expect(s.bars[0].venueDelta.get('bybit')).toBe(2)
  })

  it('dedups by (venue, tradeId) — same id on different venues is distinct', () => {
    const a = new OrderflowAggregator(cfg)
    expect(a.ingest(trade({ venue: 'binance', tradeId: '1' }))).toBe(true)
    expect(a.ingest(trade({ venue: 'binance', tradeId: '1' }))).toBe(false)
    expect(a.ingest(trade({ venue: 'bybit', tradeId: '1' }))).toBe(true)
    expect(a.snapshot().tradesDeduped).toBe(1)
  })

  it('rejects wrong symbol and invalid numbers', () => {
    const a = new OrderflowAggregator(cfg)
    expect(a.ingest(trade({ symbol: 'ETHUSDT' }))).toBe(false)
    expect(a.ingest(trade({ qty: 0 }))).toBe(false)
    expect(a.ingest(trade({ price: NaN }))).toBe(false)
    expect(a.ingest(trade({ qty: -1 }))).toBe(false)
    expect(a.snapshot().tradesIngested).toBe(0)
  })

  it('ingestMany returns accepted count', () => {
    const a = new OrderflowAggregator(cfg)
    const n = a.ingestMany([trade(), trade({ tradeId: 'dup' }), trade({ tradeId: 'dup' })])
    expect(n).toBe(2)
  })
})

describe('OrderflowAggregator — footprint bars', () => {
  it('buckets price into tickSize levels and computes level/bar delta', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ price: 50_003, qty: 1, aggressor: 'buy' }))
    a.ingest(trade({ price: 49_997, qty: 3, aggressor: 'sell' })) // → 50_000
    a.ingest(trade({ price: 50_014, qty: 2, aggressor: 'buy' })) // → 50_010
    const bar = a.snapshot().bars[0]
    expect([...bar.levels.keys()].sort()).toEqual([50_000, 50_010])
    const l0 = bar.levels.get(50_000)!
    expect(l0).toEqual({ price: 50_000, buyVol: 1, sellVol: 3, delta: -2, trades: 2 })
    expect(bar.delta).toBe(0)
    expect(bar.deltaHigh).toBe(1) // po 1-o trade
    expect(bar.deltaLow).toBe(-2) // po 2-o
    expect(bar.high).toBe(50_014)
    expect(bar.low).toBe(49_997)
    expect(bar.trades).toBe(3)
  })

  it('rolls bars by timeframe and fills gaps with empty bars', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ ts: T0, qty: 1 }))
    a.ingest(trade({ ts: T0 + 3 * TF, qty: 1 }))
    const bars = a.snapshot().bars
    expect(bars.map((b) => b.openTs)).toEqual([T0, T0 + TF, T0 + 2 * TF, T0 + 3 * TF])
    expect(bars[1].trades).toBe(0)
    expect(bars[1].cvdClose).toBe(1) // carry-forward
    expect(bars[3].cvdClose).toBe(2)
  })

  it('enforces retention', () => {
    const a = new OrderflowAggregator(cfg) // retention 5
    for (let i = 0; i < 10; i++) a.ingest(trade({ ts: T0 + i * TF }))
    const bars = a.snapshot().bars
    expect(bars).toHaveLength(5)
    expect(bars[0].openTs).toBe(T0 + 5 * TF)
  })

  it('long outage does not create unbounded empty bars', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ ts: T0 }))
    a.ingest(trade({ ts: T0 + 1000 * TF }))
    expect(a.snapshot().bars.length).toBeLessThanOrEqual(cfg.retention)
  })

  it('late trade into an earlier bar updates that bar and recomputes cvdClose chain', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ ts: T0, qty: 1, aggressor: 'buy' }))
    a.ingest(trade({ ts: T0 + TF, qty: 1, aggressor: 'buy' }))
    // Bybit vėluoja 2s ir siunčia trade į pirmą bar'ą
    a.ingest(trade({ venue: 'bybit', ts: T0 + 30_000, qty: 5, aggressor: 'sell' }))
    const s = a.snapshot()
    expect(s.cvd).toBe(-3)
    expect(s.bars[0].cvdClose).toBe(-4) // 1 - 5
    expect(s.bars[1].cvdClose).toBe(-3) // -4 + 1
    expect(s.bars[0].totalSell).toBe(5)
  })

  it('drops trades older than retention window', () => {
    const a = new OrderflowAggregator(cfg)
    for (let i = 0; i < 6; i++) a.ingest(trade({ ts: T0 + i * TF }))
    const before = a.snapshot().tradesIngested
    a.ingest(trade({ ts: T0 })) // bar T0 jau išmestas
    const s = a.snapshot()
    expect(s.tradesIngested).toBe(before + 1) // CVD'ui skaitomas
    expect(s.bars.find((b) => b.openTs === T0)).toBeUndefined()
  })

  it('markGap flags current bar incomplete and propagates to fill bars', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ ts: T0 }))
    a.markGap('binance')
    a.ingest(trade({ ts: T0 + 2 * TF }))
    const bars = a.snapshot().bars
    expect(bars[0].incomplete).toBe(true)
    expect(bars[1].incomplete).toBe(true) // fill bar paveldi
    expect(bars[2].incomplete).toBe(false)
  })

  it('markGap on venue clears its dedup ring so replayed ids are accepted', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ venue: 'binance', tradeId: 'r1' }))
    a.markGap('binance')
    expect(a.ingest(trade({ venue: 'binance', tradeId: 'r1' }))).toBe(true)
  })
})

describe('OrderflowAggregator — lazy snapshot', () => {
  it('returns cached snapshot when nothing changed; new object after ingest', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade())
    const s1 = a.snapshot()
    const s2 = a.snapshot()
    expect(s2).toBe(s1)
    a.ingest(trade())
    const s3 = a.snapshot()
    expect(s3).not.toBe(s1)
  })

  it('snapshot is a deep copy — mutating it does not affect internal state', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ price: 50_000 }))
    const s = a.snapshot()
    s.bars[0].levels.get(50_000)!.buyVol = 999
    s.bars[0].totalBuy = 999
    a.ingest(trade({ price: 50_000 }))
    expect(a.snapshot().bars[0].totalBuy).toBe(2)
    expect(a.snapshot().bars[0].levels.get(50_000)!.buyVol).toBe(2)
  })

  it('500-trade burst → one derivation', () => {
    const a = new OrderflowAggregator({ ...cfg, dedupWindow: 1000 })
    for (let i = 0; i < 500; i++) a.ingest(trade({ price: 50_000 + (i % 20) * 10 }))
    const s = a.snapshot()
    expect(s.tradesIngested).toBe(500)
    expect(s.bars[0].levels.size).toBe(20)
  })
})

describe('OrderflowAggregator — stale venues', () => {
  it('reports venues without trades for > staleMs', () => {
    const a = new OrderflowAggregator(cfg)
    a.ingest(trade({ venue: 'binance', ts: T0 }))
    a.ingest(trade({ venue: 'bybit', ts: T0 + 40_000 }))
    expect(a.staleVenues(T0 + 50_000, 45_000)).toEqual(['binance'])
    expect(a.snapshot().venueLastTs).toEqual({ binance: T0, bybit: T0 + 40_000 })
  })
})
