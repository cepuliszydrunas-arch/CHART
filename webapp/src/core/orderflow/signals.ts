/**
 * Footprint signalai — pure funkcijos ant FootprintBar.
 * Portuojamos 1:1 į esamos platformos signalų sluoksnį (§10: "jie yra pure functions").
 *
 * Kiekvienas signalas grąžina masyvą (gali būti keli lygiai viename bar'e).
 * Threshold'ai — parametrai, ne konstantos: tuning'ui per UI.
 */

import type { FootprintBar } from './types'

export interface ImbalanceSignal {
  type: 'imbalance'
  /** 'buy' = agresyvūs pirkėjai dominavo (diagonal buy > ratio × sell žemiau). */
  side: 'buy' | 'sell'
  price: number
  ratio: number
  /** Kiek iš eilės lygių — "stacked imbalance" ≥ 3 yra stiprus. */
  stacked: number
}

export interface AbsorptionSignal {
  type: 'absorption'
  /** 'buy' = didelis SELL volume ties low, bet kaina nekrito → pirkėjai absorbavo. */
  side: 'buy' | 'sell'
  price: number
  volume: number
}

export interface ExhaustionSignal {
  type: 'exhaustion'
  /** 'buy' = pirkėjai išseko ties high (mažas volume ekstremume po judesio aukštyn). */
  side: 'buy' | 'sell'
  price: number
  volume: number
}

export type FootprintSignal = ImbalanceSignal | AbsorptionSignal | ExhaustionSignal

function sortedLevels(bar: FootprintBar) {
  return [...bar.levels.values()].sort((a, b) => a.price - b.price)
}

/**
 * Diagonal imbalance (standartinis footprint metodas):
 *   buy imbalance ties lygiu i:  buyVol[i] >= ratio × sellVol[i-1]  (lyginam su lygiu ŽEMIAU)
 *   sell imbalance ties lygiu i: sellVol[i] >= ratio × buyVol[i+1]  (lyginam su lygiu AUKŠČIAU)
 * `minVol` filtruoja triukšmą (1 vs 0 yra ∞ ratio, bet nieko nereiškia).
 */
export function detectImbalances(bar: FootprintBar, opts: { ratio?: number; minVol?: number } = {}): ImbalanceSignal[] {
  const ratio = opts.ratio ?? 3
  const minVol = opts.minVol ?? 0
  const lv = sortedLevels(bar)
  const out: ImbalanceSignal[] = []

  const buyFlags: boolean[] = lv.map((l, i) => {
    if (i === 0 || l.buyVol < minVol) return false
    const below = lv[i - 1].sellVol
    return below > 0 ? l.buyVol / below >= ratio : l.buyVol >= minVol && minVol > 0
  })
  const sellFlags: boolean[] = lv.map((l, i) => {
    if (i === lv.length - 1 || l.sellVol < minVol) return false
    const above = lv[i + 1].buyVol
    return above > 0 ? l.sellVol / above >= ratio : l.sellVol >= minVol && minVol > 0
  })

  const emit = (flags: boolean[], side: 'buy' | 'sell') => {
    // Run ilgiai: kiekvienas flag'intas lygis gauna VISO savo gretimų run'o ilgį
    const runLen: number[] = new Array(lv.length).fill(0)
    for (let i = 0; i < lv.length; ) {
      if (!flags[i]) {
        i++
        continue
      }
      let j = i
      while (j < lv.length && flags[j]) j++
      for (let k = i; k < j; k++) runLen[k] = j - i
      i = j
    }
    for (let i = 0; i < lv.length; i++) {
      if (!flags[i]) continue
      const l = lv[i]
      const opp = side === 'buy' ? lv[i - 1].sellVol : lv[i + 1].buyVol
      const vol = side === 'buy' ? l.buyVol : l.sellVol
      out.push({ type: 'imbalance', side, price: l.price, ratio: opp > 0 ? vol / opp : Infinity, stacked: runLen[i] })
    }
  }
  emit(buyFlags, 'buy')
  emit(sellFlags, 'sell')
  return out
}

/**
 * Absorption: ekstremume (low/high) DIDELIS priešingas volume, bet kaina nepratęsė judesio.
 *   buy absorption ties low:  sellVol[low] >= volMult × avgLevelVol  (pardavėjai spaudė, absorbavo)
 *   sell absorption ties high: buyVol[high] >= volMult × avgLevelVol
 * Patvirtinimas — kad bar'as užsidarė toliau nuo ekstremumo — daromas aukštesniame
 * sluoksnyje su close kaina (čia footprint neturi close; klientas turi žvakę).
 */
export function detectAbsorption(bar: FootprintBar, opts: { volMult?: number } = {}): AbsorptionSignal[] {
  const volMult = opts.volMult ?? 2.5
  const lv = sortedLevels(bar)
  if (lv.length < 3) return []
  const total = bar.totalBuy + bar.totalSell
  const avg = total / lv.length
  if (avg <= 0) return []
  const out: AbsorptionSignal[] = []
  const low = lv[0]
  const high = lv[lv.length - 1]
  if (low.sellVol >= volMult * avg) out.push({ type: 'absorption', side: 'buy', price: low.price, volume: low.sellVol })
  if (high.buyVol >= volMult * avg) out.push({ type: 'absorption', side: 'sell', price: high.price, volume: high.buyVol })
  return out
}

/**
 * Exhaustion: ekstremume LABAI MAŽAS volume ta kryptimi, kuria judėjo kaina.
 *   buy exhaustion ties high:  buyVol[high] <= frac × avgLevelVol  ir bar delta > 0 (kilo)
 *   sell exhaustion ties low:  sellVol[low] <= frac × avgLevelVol ir bar delta < 0
 */
export function detectExhaustion(bar: FootprintBar, opts: { frac?: number } = {}): ExhaustionSignal[] {
  const frac = opts.frac ?? 0.2
  const lv = sortedLevels(bar)
  if (lv.length < 3) return []
  const avg = (bar.totalBuy + bar.totalSell) / lv.length
  if (avg <= 0) return []
  const out: ExhaustionSignal[] = []
  const low = lv[0]
  const high = lv[lv.length - 1]
  if (bar.delta > 0 && high.buyVol <= frac * avg) out.push({ type: 'exhaustion', side: 'buy', price: high.price, volume: high.buyVol })
  if (bar.delta < 0 && low.sellVol <= frac * avg) out.push({ type: 'exhaustion', side: 'sell', price: low.price, volume: low.sellVol })
  return out
}

export function detectAll(bar: FootprintBar): FootprintSignal[] {
  return [...detectImbalances(bar), ...detectAbsorption(bar), ...detectExhaustion(bar)]
}

/**
 * Delta divergence tarp bar'ų: kaina padarė naują high, o CVD — ne (bearish), ir atvirkščiai.
 * `lookback` — kiek bar'ų atgal ieškoti ankstesnio ekstremumo.
 */
export function detectDeltaDivergence(
  bars: FootprintBar[],
  opts: { lookback?: number } = {}
): { type: 'delta_divergence'; side: 'bearish' | 'bullish'; barIndex: number }[] {
  const lookback = opts.lookback ?? 20
  const out: { type: 'delta_divergence'; side: 'bearish' | 'bullish'; barIndex: number }[] = []
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]
    if (cur.trades === 0) continue
    const from = Math.max(0, i - lookback)
    let prevHigh = -Infinity
    let prevLow = Infinity
    let cvdAtHigh = -Infinity
    let cvdAtLow = Infinity
    for (let j = from; j < i; j++) {
      const b = bars[j]
      if (b.trades === 0) continue
      if (b.high > prevHigh) {
        prevHigh = b.high
        cvdAtHigh = b.cvdClose
      }
      if (b.low < prevLow) {
        prevLow = b.low
        cvdAtLow = b.cvdClose
      }
    }
    if (prevHigh !== -Infinity && cur.high > prevHigh && cur.cvdClose < cvdAtHigh) {
      out.push({ type: 'delta_divergence', side: 'bearish', barIndex: i })
    }
    if (prevLow !== Infinity && cur.low < prevLow && cur.cvdClose > cvdAtLow) {
      out.push({ type: 'delta_divergence', side: 'bullish', barIndex: i })
    }
  }
  return out
}
