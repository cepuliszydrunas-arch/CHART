/// <reference lib="dom" />
/**
 * FeedManager — vienas WebSocket per simbolis, broadcast'ina aggTrade visiems
 * subscriberiams. Sumažina connection overhead (viena BTCUSDT diagrama Free
 * Layout'e = 1 WS, ne 4).
 *
 * Browser-only: naudoja WebSocket + fetch. Testuojamas per fake WebSocket
 * (žr. feed-manager.test.ts).
 */

export type TradeEvent = {
  /** aggTrade id iš Binance */
  tradeId: string | number;
  /** Simbolis, pvz. BTCUSDT */
  symbol: string;
  /** Kaina */
  price: number;
  /** Kiekis */
  qty: number;
  /** Aggressor: 'buy' (m=false) arba 'sell' (m=true) */
  aggressor: 'buy' | 'sell';
  /** Trade timestamp ms */
  ts: number;
  /** Venue identifikatorius */
  venue: string;
};

export type Subscriber = (t: TradeEvent) => void;

export interface FeedManagerOptions {
  /** REST base klines/futures. Default: https://fapi.binance.com */
  restBase?: string;
  /** WS base, pvz. wss://fstream.binance.com */
  wsBase?: string;
  /** Reconnect delay ms. Default 2000 */
  reconnectMs?: number;
  /**
   * Factory WebSocket objektui (testams / custom transportams).
   * Default: globalThis.WebSocket
   */
  createSocket?: (url: string) => WebSocketLike;
  /**
   * Factory fetch'ui (testams). Default: globalThis.fetch
   */
  fetcher?: typeof fetch;
}

export interface WebSocketLike {
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

interface SymbolStream {
  symbol: string;
  ws: WebSocketLike | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Trade id, kurio jau matėme (dedupe) */
  lastTradeId: string | number | null;
  /** Trade timestamp, kurio paskutinį matėme (gap detection) */
  lastTradeTs: number;
  /** Subscribers Map<id, Subscriber> */
  subscribers: Map<string, Subscriber>;
  /** Uždarytas (sąmoningai) — nereconnect'ins */
  closed: boolean;
  /** Pirmas pranešimas gautas (gap watchdog logika) */
  firstMsg: boolean;
}

const DEFAULT_REST = 'https://fapi.binance.com';
const DEFAULT_WS = 'wss://fstream.binance.com/stream?streams=';

export class FeedManager {
  private streams = new Map<string, SymbolStream>();
  private opts: Required<Omit<FeedManagerOptions, 'createSocket' | 'fetcher'>> & {
    createSocket: NonNullable<FeedManagerOptions['createSocket']>;
    fetcher: NonNullable<FeedManagerOptions['fetcher']>;
  };
  private nextSubId = 0;

  constructor(opts: FeedManagerOptions = {}) {
    this.opts = {
      restBase: opts.restBase ?? DEFAULT_REST,
      wsBase: opts.wsBase ?? DEFAULT_WS,
      reconnectMs: opts.reconnectMs ?? 2000,
      createSocket: opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
      fetcher: opts.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    };
  }

  /**
   * Užsako trade stream simboliui. Grąžina unsubscribe funkciją.
   * Jei stream'as jau aktyvus — tik prideda subscriber; kitaip atidaro WS.
   */
  subscribe(symbol: string, sub: Subscriber): () => void {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) throw new Error('FeedManager.subscribe: empty symbol');
    let stream = this.streams.get(sym);
    if (!stream) {
      stream = {
        symbol: sym,
        ws: null,
        reconnectTimer: null,
        lastTradeId: null,
        lastTradeTs: 0,
        subscribers: new Map(),
        closed: false,
        firstMsg: false
      };
      this.streams.set(sym, stream);
      this.open(stream);
    }
    const id = 'sub_' + (++this.nextSubId);
    stream.subscribers.set(id, sub);
    return () => this.unsubscribe(sym, id);
  }

  private unsubscribe(symbol: string, subId: string): void {
    const stream = this.streams.get(symbol);
    if (!stream) return;
    stream.subscribers.delete(subId);
    if (stream.subscribers.size === 0) {
      this.closeStream(stream);
      this.streams.delete(symbol);
    }
  }

  /** Uždaro visus stream'us (pvz. puslapiui užsidarant). */
  shutdown(): void {
    for (const s of this.streams.values()) this.closeStream(s);
    this.streams.clear();
  }

  /** Testams: ar stream'as aktyvus. */
  hasStream(symbol: string): boolean {
    return this.streams.has(String(symbol || '').toUpperCase());
  }

  /** Testams: subscriberių skaičius. */
  subscriberCount(symbol: string): number {
    return this.streams.get(String(symbol || '').toUpperCase())?.subscribers.size ?? 0;
  }

  private open(stream: SymbolStream): void {
    if (stream.closed) return;
    if (stream.ws) {
      try { stream.ws.onclose = null; stream.ws.close(); } catch { /* ignore */ }
    }
    const url = this.opts.wsBase + stream.symbol.toLowerCase() + '@aggTrade';
    let ws: WebSocketLike;
    try {
      ws = this.opts.createSocket(url);
    } catch {
      this.scheduleReconnect(stream);
      return;
    }
    stream.ws = ws;
    stream.firstMsg = false;
    ws.onmessage = (ev) => this.onMessage(stream, ev);
    ws.onclose = () => {
      if (stream.closed) return;
      stream.ws = null;
      this.scheduleReconnect(stream);
    };
    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }

  private onMessage(stream: SymbolStream, ev: { data: string | ArrayBuffer }): void {
    let d: any;
    try {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      d = JSON.parse(raw);
    } catch { return; }
    const payload = d && typeof d === 'object' && 'data' in d ? (d as { data: unknown }).data : d;
    if (!payload || (payload as { e?: string }).e !== 'aggTrade') return;
    if (!stream.firstMsg) stream.firstMsg = true;
    const t = payload as {
      a: number; s: string; p: string; q: string; T: number; m: boolean; E: number;
    };
    // Dedupe pagal tradeId (kad reconnect nepraleistų trade'ų, bet ir nedubliuotų)
    if (stream.lastTradeId !== null && t.a === stream.lastTradeId) return;
    const evt: TradeEvent = {
      tradeId: t.a,
      symbol: t.s,
      price: +t.p,
      qty: +t.q,
      aggressor: t.m ? 'sell' : 'buy',
      ts: t.T,
      venue: 'binance-futures'
    };
    stream.lastTradeId = t.a;
    stream.lastTradeTs = t.T;
    for (const sub of stream.subscribers.values()) {
      try { sub(evt); } catch { /* vieno subscriberio klaida neturi žudyti kitų */ }
    }
  }

  private scheduleReconnect(stream: SymbolStream): void {
    if (stream.closed) return;
    if (stream.reconnectTimer) return;
    stream.reconnectTimer = setTimeout(() => {
      stream.reconnectTimer = null;
      this.open(stream);
    }, this.opts.reconnectMs);
  }

  private closeStream(stream: SymbolStream): void {
    stream.closed = true;
    if (stream.reconnectTimer) {
      clearTimeout(stream.reconnectTimer);
      stream.reconnectTimer = null;
    }
    if (stream.ws) {
      try {
        stream.ws.onclose = null;
        stream.ws.onmessage = null;
        stream.ws.onerror = null;
        stream.ws.close();
      } catch { /* ignore */ }
      stream.ws = null;
    }
  }
}
