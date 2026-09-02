/**
 * Venue adapteriai — RAW WS message → NormalizedTrade[].
 *
 * Pure funkcijos. WS jungimą / reconnect daro klientas (`useOrderflowFeed` hook'as
 * Next.js pusėje arba paprastas `new WebSocket()` čia). Taip adapteriai
 * testuojami su fixture'ais, be tinklo.
 *
 * KRITINIS DETALUS: `aggressor` semantika skiriasi tarp biržų:
 *   Binance: `m` (isBuyerMaker) === true  → pirkėjas buvo MAKER → agresorius SELL
 *   Bybit:   `S` === 'Buy'                → taker pirko          → agresorius BUY
 * Klaida čia apverčia visą CVD. Todėl testai su tikrais payload'ais privalomi.
 */

import type { NormalizedTrade } from './types'

export interface VenueAdapter {
  venue: string
  /** WS URL viešam trade stream'ui (be auth). */
  wsUrl(symbol: string): string
  /** Subscribe žinutė (kai kurios biržos jos nereikalauja — grąžina null). */
  subscribeMessage(symbol: string): string | null
  /** Parse'ina RAW žinutę. Ne-trade žinutės (ping, ack) → []. Niekada nemeta. */
  parse(raw: string, symbol: string): NormalizedTrade[]
}

function num(x: unknown): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
  return Number.isFinite(n) ? n : NaN
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Binance USD-M Futures — aggTrade stream
// https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Aggregate-Trade-Streams
// ---------------------------------------------------------------------------
export const binanceFutures: VenueAdapter = {
  venue: 'binance',
  wsUrl: (symbol) => `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`,
  subscribeMessage: () => null,
  parse(raw, symbol) {
    const m = safeJson(raw) as Record<string, unknown> | null
    if (!m || m.e !== 'aggTrade') return []
    if (typeof m.s !== 'string' || m.s.toUpperCase() !== symbol.toUpperCase()) return []
    const price = num(m.p)
    const qty = num(m.q)
    const ts = num(m.T)
    if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) return []
    return [
      {
        venue: 'binance',
        tradeId: String(m.a),
        symbol: symbol.toUpperCase(),
        price,
        qty,
        aggressor: m.m === true ? 'sell' : 'buy',
        ts
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Bybit v5 — publicTrade (linear)
// https://bybit-exchange.github.io/docs/v5/websocket/public/trade
// ---------------------------------------------------------------------------
export const bybitLinear: VenueAdapter = {
  venue: 'bybit',
  wsUrl: () => 'wss://stream.bybit.com/v5/public/linear',
  subscribeMessage: (symbol) => JSON.stringify({ op: 'subscribe', args: [`publicTrade.${symbol.toUpperCase()}`] }),
  parse(raw, symbol) {
    const m = safeJson(raw) as Record<string, unknown> | null
    if (!m || typeof m.topic !== 'string' || !m.topic.startsWith('publicTrade.')) return []
    if (!Array.isArray(m.data)) return []
    const out: NormalizedTrade[] = []
    for (const d of m.data as Record<string, unknown>[]) {
      if (typeof d.s !== 'string' || d.s.toUpperCase() !== symbol.toUpperCase()) continue
      const price = num(d.p)
      const qty = num(d.v)
      const ts = num(d.T)
      if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) continue
      if (d.S !== 'Buy' && d.S !== 'Sell') continue
      out.push({
        venue: 'bybit',
        tradeId: String(d.i),
        symbol: symbol.toUpperCase(),
        price,
        qty,
        aggressor: d.S === 'Buy' ? 'buy' : 'sell',
        ts
      })
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// OKX v5 — trades (SWAP). Simbolis mapinamas 'BTCUSDT' → 'BTC-USDT-SWAP'.
// https://www.okx.com/docs-v5/en/#public-data-websocket-trades-channel
// ---------------------------------------------------------------------------
export function okxInstId(symbol: string): string {
  const s = symbol.toUpperCase()
  const quote = ['USDT', 'USDC', 'USD'].find((q) => s.endsWith(q))
  if (!quote) return s
  return `${s.slice(0, -quote.length)}-${quote}-SWAP`
}

export const okxSwap: VenueAdapter = {
  venue: 'okx',
  wsUrl: () => 'wss://ws.okx.com:8443/ws/v5/public',
  subscribeMessage: (symbol) => JSON.stringify({ op: 'subscribe', args: [{ channel: 'trades', instId: okxInstId(symbol) }] }),
  parse(raw, symbol) {
    const m = safeJson(raw) as Record<string, unknown> | null
    if (!m || typeof m.arg !== 'object' || m.arg === null) return []
    const arg = m.arg as Record<string, unknown>
    if (arg.channel !== 'trades' || arg.instId !== okxInstId(symbol)) return []
    if (!Array.isArray(m.data)) return []
    const out: NormalizedTrade[] = []
    for (const d of m.data as Record<string, unknown>[]) {
      const price = num(d.px)
      const qty = num(d.sz)
      const ts = num(d.ts)
      if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) continue
      if (d.side !== 'buy' && d.side !== 'sell') continue
      out.push({ venue: 'okx', tradeId: String(d.tradeId), symbol: symbol.toUpperCase(), price, qty, aggressor: d.side, ts })
    }
    return out
  }
}

export const ADAPTERS: Record<string, VenueAdapter> = {
  binance: binanceFutures,
  bybit: bybitLinear,
  okx: okxSwap
}
