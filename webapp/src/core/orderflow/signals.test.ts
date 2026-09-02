import { describe, expect, it } from 'vitest'
import { detectAbsorption, detectAll, detectDeltaDivergence, detectExhaustion, detectImbalances } from './signals'
import type { FootprintBar, PriceLevel } from './types'

/** Statom bar'ą iš [price, buy, sell] eilučių. */
function bar(rows: [number, number, number][], over: Partial<FootprintBar> = {}): FootprintBar {
  const levels = new Map<number, PriceLevel>()
  let totalBuy = 0
  let totalSell = 0
  for (const [price, buyVol, sellVol] of rows) {
    levels.set(price, { price, buyVol, sellVol, delta: buyVol - sellVol, trades: 1 })
    totalBuy += buyVol
    totalSell += sellVol
  }
  const prices = rows.map((r) => r[0])
  return {
    openTs: 0, timeframeMs: 60_000, levels, totalBuy, totalSell, delta: totalBuy - totalSell,
    cvdClose: 0, deltaHigh: 0, deltaLow: 0, high: Math.max(...prices), low: Math.min(...prices),
    trades: rows.length, incomplete: false, venueDelta: new Map(), ...over
  }
}

describe('detectImbalances', () => {
  it('buy imbalance: buyVol[i] vs sellVol[i-1] (diagonal)', () => {
    const b = bar([
      [100, 1, 1],
      [110, 9, 1] // 9 vs sell below 1 → ratio 9
    ])
    const out = detectImbalances(b, { ratio: 3 })
    expect(out).toEqual([{ type: 'imbalance', side: 'buy', price: 110, ratio: 9, stacked: 1 }])
  })

  it('sell imbalance: sellVol[i] vs buyVol[i+1]', () => {
    const b = bar([
      [100, 1, 9],
      [110, 1, 1]
    ])
    const out = detectImbalances(b, { ratio: 3 })
    expect(out).toEqual([{ type: 'imbalance', side: 'sell', price: 100, ratio: 9, stacked: 1 }])
  })

  it('stacked imbalances get the full run length', () => {
    const b = bar([
      [100, 1, 1],
      [110, 5, 1],
      [120, 5, 1],
      [130, 5, 1],
      [140, 1, 1],
      [150, 5, 1]
    ])
    const out = detectImbalances(b, { ratio: 3 }).filter((s) => s.side === 'buy')
    expect(out.map((s) => [s.price, s.stacked])).toEqual([[110, 3], [120, 3], [130, 3], [150, 1]])
  })

  it('minVol filters noise; zero opposite volume → Infinity ratio only when above minVol', () => {
    const b = bar([
      [100, 0, 0],
      [110, 1, 0]
    ])
    expect(detectImbalances(b, { ratio: 3 })).toEqual([]) // minVol 0 → x/0 not counted
    expect(detectImbalances(b, { ratio: 3, minVol: 1 })).toEqual([{ type: 'imbalance', side: 'buy', price: 110, ratio: Infinity, stacked: 1 }])
    expect(detectImbalances(bar([[100, 0, 0], [110, 0.5, 0]]), { minVol: 1 })).toEqual([])
  })

  it('empty / single-level bar → no signals', () => {
    expect(detectImbalances(bar([]))).toEqual([])
    expect(detectImbalances(bar([[100, 10, 0]]))).toEqual([])
  })
})

describe('detectAbsorption', () => {
  it('buy absorption at low when sell volume there is >> average', () => {
    const b = bar([
      [100, 1, 20], // low: heavy selling absorbed
      [110, 2, 2],
      [120, 2, 2]
    ])
    // avg = 29/3 ≈ 9.67; 20 >= 2 × 9.67
    expect(detectAbsorption(b, { volMult: 2 })).toEqual([{ type: 'absorption', side: 'buy', price: 100, volume: 20 }])
  })
  it('sell absorption at high', () => {
    const b = bar([[100, 2, 2], [110, 2, 2], [120, 20, 1]])
    expect(detectAbsorption(b, { volMult: 2 })).toEqual([{ type: 'absorption', side: 'sell', price: 120, volume: 20 }])
  })
  it('needs >= 3 levels and non-zero volume', () => {
    expect(detectAbsorption(bar([[100, 1, 50], [110, 1, 1]]))).toEqual([])
    expect(detectAbsorption(bar([[100, 0, 0], [110, 0, 0], [120, 0, 0]]))).toEqual([])
  })
})

describe('detectExhaustion', () => {
  it('buy exhaustion: tiny buy volume at high after up-move (delta > 0)', () => {
    const b = bar([[100, 10, 2], [110, 10, 2], [120, 0.1, 0]]) // delta > 0
    expect(detectExhaustion(b, { frac: 0.2 })).toEqual([{ type: 'exhaustion', side: 'buy', price: 120, volume: 0.1 }])
  })
  it('sell exhaustion: tiny sell volume at low after down-move', () => {
    const b = bar([[100, 0, 0.1], [110, 2, 10], [120, 2, 10]])
    expect(detectExhaustion(b, { frac: 0.2 })).toEqual([{ type: 'exhaustion', side: 'sell', price: 100, volume: 0.1 }])
  })
  it('no exhaustion when delta direction does not match', () => {
    const b = bar([[100, 10, 2], [110, 10, 2], [120, 0.1, 0]], { delta: -5 })
    expect(detectExhaustion(b)).toEqual([])
  })
  it('needs >= 3 levels', () => {
    expect(detectExhaustion(bar([[100, 10, 0], [110, 0.1, 0]]))).toEqual([])
    expect(detectExhaustion(bar([[100, 0, 0], [110, 0, 0], [120, 0, 0]]))).toEqual([])
  })
})

describe('detectAll', () => {
  it('concatenates all detectors', () => {
    // avg = (1+80+9+1+2+2)/3 ≈ 31.7; 80 >= 2.5 × 31.7 = 79.2 → absorption; 9/80 ratio nėra, bet 110 buy 9 vs 100 sell 80 → ne; 120? 2 vs 1 → ne.
    // Imbalance: sell @100: 80 vs buy@110 9 → 8.9x ✓
    const b = bar([[100, 1, 80], [110, 9, 1], [120, 2, 2]])
    const types = detectAll(b).map((s) => s.type)
    expect(types).toContain('imbalance')
    expect(types).toContain('absorption')
  })
})

describe('detectDeltaDivergence', () => {
  const seq = (rows: { high: number; low: number; cvd: number; trades?: number }[]) =>
    rows.map((r, i) => bar([[r.low, 1, 1], [r.high, 1, 1]], { openTs: i * 60_000, cvdClose: r.cvd, trades: r.trades ?? 2 }))

  it('bearish: higher high with lower CVD', () => {
    const bars = seq([
      { high: 100, low: 90, cvd: 10 },
      { high: 95, low: 88, cvd: 8 },
      { high: 105, low: 92, cvd: 5 } // new high, cvd < cvd at prev high (10)
    ])
    expect(detectDeltaDivergence(bars)).toEqual([{ type: 'delta_divergence', side: 'bearish', barIndex: 2 }])
  })
  it('bullish: lower low with higher CVD', () => {
    const bars = seq([
      { high: 100, low: 90, cvd: -10 },
      { high: 98, low: 85, cvd: -5 } // lower low, cvd higher
    ])
    expect(detectDeltaDivergence(bars)).toEqual([{ type: 'delta_divergence', side: 'bullish', barIndex: 1 }])
  })
  it('no divergence when CVD confirms', () => {
    const bars = seq([{ high: 100, low: 90, cvd: 10 }, { high: 105, low: 95, cvd: 15 }])
    expect(detectDeltaDivergence(bars)).toEqual([])
  })
  it('skips empty bars and respects lookback', () => {
    const bars = seq([
      { high: 200, low: 90, cvd: 100 }, // out of lookback
      { high: 100, low: 90, cvd: 10 },
      { high: 0, low: 0, cvd: 10, trades: 0 }, // empty
      { high: 105, low: 92, cvd: 12 }
    ])
    // lookback 2 → langas [1,2]: prev high 100, cvd 10; cur 105 high, cvd 12 > 10 → confirms, no signal
    expect(detectDeltaDivergence(bars, { lookback: 2 })).toEqual([])
    // lookback 3 → langas [0,1,2]: prev high 200 → 105 nėra naujas high → no signal
    expect(detectDeltaDivergence(bars, { lookback: 3 })).toEqual([])
    // Bet su mažesniu CVD nei prev-high bar'e (lookback 2) → bearish
    bars[3].cvdClose = 5
    expect(detectDeltaDivergence(bars, { lookback: 2 })).toEqual([{ type: 'delta_divergence', side: 'bearish', barIndex: 3 }])
  })
})
