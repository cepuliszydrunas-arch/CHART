/**
 * OrderflowAggregator — multi-venue trade → footprint + CVD.
 *
 * Perimta iš esamos platformos FootprintStore modelio (§5):
 *   - plain class, NE React state
 *   - lazy dirty-flag: `ingest()` tik mutuoja; `snapshot()` derivuoja tik jei dirty
 *   - 500 trade burst = 1 derivation, jei klientas skambina snapshot() per rAF
 *   - retention ribotas; `incomplete` flag'as po gap
 *
 * NAUJA (agregacija): trade'ai iš N biržų sujungiami į vieną bar'ų seką.
 * CVD = Σ venueWeight × (buyVol − sellVol). Dedup per venue (biržos tradeId
 * unikalus tik savo venue viduje).
 *
 * KODĖL ne React state: 200–2000 trade/s peak'e; kiekvienas setState = render.
 * Čia ingest yra O(1) amortizuotai, o snapshot O(bars) tik kai kas nors klausia.
 */

import type { AggregatorConfig, AggregatorSnapshot, FootprintBar, NormalizedTrade, PriceLevel, Venue } from './types'

export class OrderflowAggregator {
  private bars: FootprintBar[] = []
  private cvd = 0
  private venueCvd = new Map<Venue, number>()
  private venueLastTs = new Map<Venue, number>()
  private dedup = new Map<Venue, DedupRing>()
  private lastTradeTs = 0
  private ingested = 0
  private deduped = 0
  private dirty = true
  private cachedSnapshot: AggregatorSnapshot | null = null

  constructor(private readonly cfg: AggregatorConfig) {
    if (!(cfg.timeframeMs > 0)) throw new Error('timeframeMs must be > 0')
    if (!(cfg.tickSize > 0)) throw new Error('tickSize must be > 0')
    if (!(cfg.retention > 0)) throw new Error('retention must be > 0')
  }

  get config(): Readonly<AggregatorConfig> {
    return this.cfg
  }

  /** Grąžina `true` jei trade priimtas, `false` jei dedup'intas / atmestas. */
  ingest(t: NormalizedTrade): boolean {
    if (t.symbol !== this.cfg.symbol) return false
    if (!Number.isFinite(t.price) || !Number.isFinite(t.qty) || t.qty <= 0 || t.price <= 0) return false

    let ring = this.dedup.get(t.venue)
    if (!ring) {
      ring = new DedupRing(this.cfg.dedupWindow)
      this.dedup.set(t.venue, ring)
    }
    if (!ring.add(t.tradeId)) {
      this.deduped++
      return false
    }

    const weight = this.cfg.venueWeights?.[t.venue] ?? 1
    const signed = (t.aggressor === 'buy' ? t.qty : -t.qty) * weight

    // Bar'ą surandam PRIEŠ CVD atnaujinimą: nauji/fill bar'ai paveldi CVD
    // *iki* šio trade'o, kitaip tušti bar'ai "pamatytų" ateitį.
    const bar = this.barFor(t.ts)

    this.cvd += signed
    this.venueCvd.set(t.venue, (this.venueCvd.get(t.venue) ?? 0) + signed)
    this.venueLastTs.set(t.venue, Math.max(this.venueLastTs.get(t.venue) ?? 0, t.ts))
    this.lastTradeTs = Math.max(this.lastTradeTs, t.ts)
    this.ingested++

    if (bar) this.applyToBar(bar, t, signed)

    this.dirty = true
    return true
  }

  /** Batch — vienas dirty flag visam burst'ui. */
  ingestMany(trades: Iterable<NormalizedTrade>): number {
    let n = 0
    for (const t of trades) if (this.ingest(t)) n++
    return n
  }

  /**
   * Pažymi, kad buvo gap (reconnect). Dabartinis bar'as — `incomplete`.
   * Klientas kviečia, kai WS atsijungė ilgiau nei X ms.
   */
  markGap(venue?: Venue): void {
    const last = this.bars[this.bars.length - 1]
    if (last) last.incomplete = true
    if (venue) this.dedup.get(venue)?.clear()
    this.dirty = true
  }

  /** Lazy: derivuoja tik jei buvo ingest po paskutinio snapshot. */
  snapshot(): AggregatorSnapshot {
    if (!this.dirty && this.cachedSnapshot) return this.cachedSnapshot
    this.cachedSnapshot = {
      symbol: this.cfg.symbol,
      cvd: this.cvd,
      venueCvd: Object.fromEntries(this.venueCvd),
      bars: this.bars.map(cloneBar),
      lastTradeTs: this.lastTradeTs,
      tradesIngested: this.ingested,
      tradesDeduped: this.deduped,
      venueLastTs: Object.fromEntries(this.venueLastTs)
    }
    this.dirty = false
    return this.cachedSnapshot
  }

  /** Venue'ai, iš kurių nebuvo trade'ų ilgiau nei `staleMs` (santykinai su `now`). */
  staleVenues(now: number, staleMs: number): Venue[] {
    const out: Venue[] = []
    for (const [v, ts] of this.venueLastTs) if (now - ts > staleMs) out.push(v)
    return out
  }

  // ------------------------------------------------------------------------

  private barFor(ts: number): FootprintBar | null {
    const openTs = ts - (ts % this.cfg.timeframeMs)
    const last = this.bars[this.bars.length - 1]

    if (last && last.openTs === openTs) return last

    if (!last || openTs > last.openTs) {
      // Gap tarp bar'ų (nebuvo trade'ų) — užpildom tuščiais, kad seka būtų tolygi
      if (last) {
        let fill = last.openTs + this.cfg.timeframeMs
        // Riba: ne daugiau nei retention tuščių bar'ų (ilgas outage → ne 10k tuščių)
        let guard = this.cfg.retention
        while (fill < openTs && guard-- > 0) {
          this.bars.push(newBar(fill, this.cfg.timeframeMs, this.cvd, last.incomplete))
          fill += this.cfg.timeframeMs
        }
      }
      const bar = newBar(openTs, this.cfg.timeframeMs, this.cvd, false)
      this.bars.push(bar)
      this.trimRetention()
      return bar
    }

    // Vėluojantis trade į senesnį bar'ą (venue'ai nesinchronizuoti ±kelios s) — O(log n)
    const idx = binarySearchBar(this.bars, openTs)
    return idx >= 0 ? this.bars[idx] : null // per senas — dropinam
  }

  private applyToBar(bar: FootprintBar, t: NormalizedTrade, signedWeighted: number): void {
    const key = Math.round(t.price / this.cfg.tickSize) * this.cfg.tickSize
    let lvl = bar.levels.get(key)
    if (!lvl) {
      lvl = { price: key, buyVol: 0, sellVol: 0, delta: 0, trades: 0 }
      bar.levels.set(key, lvl)
    }
    if (t.aggressor === 'buy') {
      lvl.buyVol += t.qty
      bar.totalBuy += t.qty
    } else {
      lvl.sellVol += t.qty
      bar.totalSell += t.qty
    }
    lvl.delta = lvl.buyVol - lvl.sellVol
    lvl.trades++

    bar.delta = bar.totalBuy - bar.totalSell
    bar.deltaHigh = Math.max(bar.deltaHigh, bar.delta)
    bar.deltaLow = Math.min(bar.deltaLow, bar.delta)
    bar.high = Math.max(bar.high, t.price)
    bar.low = Math.min(bar.low, t.price)
    bar.trades++
    bar.venueDelta.set(t.venue, (bar.venueDelta.get(t.venue) ?? 0) + signedWeighted)

    // cvdClose atnaujinamas tik jei tai paskutinis bar'as; vėluojantiems trade'ams
    // į senus bar'us — perskaičiuojam nuo to bar'o iki galo (retas kelias).
    const lastBar = this.bars[this.bars.length - 1]
    if (bar === lastBar) {
      bar.cvdClose = this.cvd
    } else {
      this.recomputeCvdCloseFrom(bar)
    }
  }

  private recomputeCvdCloseFrom(from: FootprintBar): void {
    const idx = this.bars.indexOf(from)
    // cvdClose(i) = cvdClose(i-1) + Σ venueDelta(i)
    let running = idx > 0 ? this.bars[idx - 1].cvdClose : 0
    for (let i = idx; i < this.bars.length; i++) {
      let d = 0
      for (const v of this.bars[i].venueDelta.values()) d += v
      running += d
      this.bars[i].cvdClose = running
    }
  }

  private trimRetention(): void {
    const excess = this.bars.length - this.cfg.retention
    if (excess > 0) this.bars.splice(0, excess)
  }
}

// ---------------------------------------------------------------------------

function newBar(openTs: number, timeframeMs: number, cvdStart: number, incomplete: boolean): FootprintBar {
  return {
    openTs,
    timeframeMs,
    levels: new Map(),
    totalBuy: 0,
    totalSell: 0,
    delta: 0,
    cvdClose: cvdStart,
    deltaHigh: 0,
    deltaLow: 0,
    high: -Infinity,
    low: Infinity,
    trades: 0,
    incomplete,
    venueDelta: new Map()
  }
}

function cloneBar(b: FootprintBar): FootprintBar {
  const levels = new Map<number, PriceLevel>()
  for (const [k, v] of b.levels) levels.set(k, { ...v })
  return { ...b, levels, venueDelta: new Map(b.venueDelta) }
}

function binarySearchBar(bars: FootprintBar[], openTs: number): number {
  let lo = 0
  let hi = bars.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = bars[mid].openTs
    if (v === openTs) return mid
    if (v < openTs) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/**
 * LIFO dedup ringas: O(1) add/has, fiksuota atmintis.
 * Perimta iš esamos "20k dedup LIFO" (§5).
 */
export class DedupRing {
  private set = new Set<string>()
  private ring: (string | undefined)[]
  private head = 0

  constructor(private readonly capacity: number) {
    if (!(capacity > 0)) throw new Error('capacity must be > 0')
    this.ring = new Array(capacity)
  }

  /** `true` jei naujas, `false` jei jau matytas. */
  add(id: string): boolean {
    if (this.set.has(id)) return false
    const evicted = this.ring[this.head]
    if (evicted !== undefined) this.set.delete(evicted)
    this.ring[this.head] = id
    this.head = (this.head + 1) % this.capacity
    this.set.add(id)
    return true
  }

  has(id: string): boolean {
    return this.set.has(id)
  }

  clear(): void {
    this.set.clear()
    this.ring.fill(undefined)
    this.head = 0
  }

  get size(): number {
    return this.set.size
  }
}
