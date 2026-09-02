/**
 * Agreguotas orderflow — tipai.
 *
 * Kanoninis trade formatas. Kiekvienas biržos adapteris konvertuoja į šį —
 * agregatorius NIEKADA nemato biržos-specifinių laukų.
 */

export type Venue = 'binance' | 'bybit' | 'okx' | 'coinbase' | (string & {})

export interface NormalizedTrade {
  venue: Venue
  /** Biržos trade ID — dedup'ui per venue. */
  tradeId: string
  /** Kanoninis simbolis, pvz. 'BTCUSDT' (adapteris mapina 'BTC-USDT' → 'BTCUSDT'). */
  symbol: string
  price: number
  qty: number
  /**
   * Agresorius. 'buy' = market buy (taker pirko). Biržose tai `isBuyerMaker === false`
   * (Binance) arba `side === 'Buy'` (Bybit). Adapteris atsakingas už teisingą mapinimą.
   */
  aggressor: 'buy' | 'sell'
  /** Biržos timestamp ms. */
  ts: number
}

export interface PriceLevel {
  price: number
  buyVol: number
  sellVol: number
  /** buyVol - sellVol */
  delta: number
  trades: number
}

export interface FootprintBar {
  /** Bar pradžia ms (aligned į timeframe). */
  openTs: number
  timeframeMs: number
  /** Map<priceLevelKey, PriceLevel>. Raktas — tickSize-aligned kaina. */
  levels: Map<number, PriceLevel>
  totalBuy: number
  totalSell: number
  delta: number
  /** Running CVD bar'o pabaigoje (kumuliatyvus nuo agregatoriaus starto). */
  cvdClose: number
  /** Min/max delta bar'o viduje — divergencijoms. */
  deltaHigh: number
  deltaLow: number
  high: number
  low: number
  trades: number
  /** Po reconnect / gap — bar'as gali būti nepilnas. UI turi tai rodyti. */
  incomplete: boolean
  /** Per-venue delta — matyti, kuri birža stumia. */
  venueDelta: Map<Venue, number>
}

export interface AggregatorConfig {
  symbol: string
  timeframeMs: number
  /** Kainos žingsnis footprint lygiams (pvz. 10 USD BTC'ui). */
  tickSize: number
  /** Kiek bar'ų laikyti atmintyje. */
  retention: number
  /** Dedup lango dydis per venue (LIFO). */
  dedupWindow: number
  /**
   * Pasirinktinis venue svoris CVD'ui (default 1). Naudinga, kai viena birža
   * turi 10x volume ir "užgožia" kitas; svoris < 1 ją nuslopina.
   */
  venueWeights?: Partial<Record<Venue, number>>
}

export interface AggregatorSnapshot {
  symbol: string
  cvd: number
  venueCvd: Record<string, number>
  bars: FootprintBar[]
  lastTradeTs: number
  tradesIngested: number
  tradesDeduped: number
  /** Laikas nuo paskutinio trade'o per venue — stale detektavimui. */
  venueLastTs: Record<string, number>
}
