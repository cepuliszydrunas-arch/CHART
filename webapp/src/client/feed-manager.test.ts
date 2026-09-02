/**
 * FeedManager testai — naudojama fake WebSocket (node aplinka, be jsdom).
 *
 * Tikrinama:
 * • subscribe atidaro WS lygiai vieną kartą per simbolį
 * • du subscriberiai gauna tą patį trade'ą (shared feed)
 * • unsubscribe paskutinio subscriberio uždaro WS
 * • reconnect po onclose
 * • dedupe pagal tradeId
 * • shutdown uždaro viską
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { FeedManager, type TradeEvent, type WebSocketLike } from './feed-manager'

interface FakeWS extends WebSocketLike {
  url: string
  sentClose: boolean
  /** rankiniu būdu simuliuoti pranešimą */
  emit(data: unknown): void
  emitClose(): void
}

function makeFakeSocket(): FakeWS {
  const ws: FakeWS = {
    url: '',
    sentClose: false,
    onmessage: null,
    onclose: null,
    onerror: null,
    close() { this.sentClose = true; if (this.onclose) this.onclose({}); },
    emit(data) { if (this.onmessage) this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) }); },
    emitClose() { if (this.onclose) this.onclose({}); }
  }
  return ws
}

function aggTrade(over: Partial<{ a: number; s: string; p: string; q: string; T: number; m: boolean }> = {}) {
  return {
    e: 'aggTrade',
    a: over.a ?? 1,
    s: over.s ?? 'BTCUSDT',
    p: over.p ?? '50000',
    q: over.q ?? '0.01',
    T: over.T ?? Date.now(),
    m: over.m ?? false,
    E: Date.now()
  }
}

describe('FeedManager', () => {
  let sockets: FakeWS[] = []
  let mgr: FeedManager

  beforeEach(() => {
    sockets = []
    mgr = new FeedManager({
      reconnectMs: 50,
      createSocket: (url) => {
        const ws = makeFakeSocket()
        ws.url = url
        sockets.push(ws)
        return ws
      },
      fetcher: (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
    })
  })

  afterEach(() => {
    mgr.shutdown()
  })

  it('opens exactly one WebSocket per symbol', () => {
    const u1 = mgr.subscribe('BTCUSDT', () => {})
    const u2 = mgr.subscribe('BTCUSDT', () => {})
    expect(sockets.length).toBe(1)
    expect(sockets[0]!.url).toContain('btcusdt@aggTrade')
    u1(); u2()
  })

  it('opens separate sockets for different symbols', () => {
    const u1 = mgr.subscribe('BTCUSDT', () => {})
    const u2 = mgr.subscribe('ETHUSDT', () => {})
    expect(sockets.length).toBe(2)
    u1(); u2()
  })

  it('broadcasts the same trade to multiple subscribers', () => {
    const received1: TradeEvent[] = []
    const received2: TradeEvent[] = []
    const u1 = mgr.subscribe('BTCUSDT', (t) => received1.push(t))
    const u2 = mgr.subscribe('BTCUSDT', (t) => received2.push(t))
    sockets[0]!.emit({ data: aggTrade({ a: 100, p: '50000' }) })
    expect(received1.length).toBe(1)
    expect(received2.length).toBe(1)
    expect(received1[0]!.price).toBe(50000)
    expect(received1[0]!.aggressor).toBe('buy')
    u1(); u2()
  })

  it('parses sell aggressor (m=true) correctly', () => {
    const received: TradeEvent[] = []
    mgr.subscribe('BTCUSDT', (t) => received.push(t))
    sockets[0]!.emit({ data: aggTrade({ a: 200, m: true, p: '49000' }) })
    expect(received[0]!.aggressor).toBe('sell')
    expect(received[0]!.price).toBe(49000)
  })

  it('closes the socket when last subscriber unsubscribes', () => {
    const u1 = mgr.subscribe('BTCUSDT', () => {})
    const u2 = mgr.subscribe('BTCUSDT', () => {})
    expect(mgr.hasStream('BTCUSDT')).toBe(true)
    u1()
    expect(mgr.hasStream('BTCUSDT')).toBe(true)
    u2()
    expect(mgr.hasStream('BTCUSDT')).toBe(false)
  })

  it('dedupes by tradeId (does not redeliver the same id)', () => {
    const received: TradeEvent[] = []
    mgr.subscribe('BTCUSDT', (t) => received.push(t))
    sockets[0]!.emit({ data: aggTrade({ a: 999 }) })
    sockets[0]!.emit({ data: aggTrade({ a: 999 }) })
    expect(received.length).toBe(1)
  })

  it('reconnects after socket closes', async () => {
    mgr.subscribe('BTCUSDT', () => {})
    expect(sockets.length).toBe(1)
    sockets[0]!.emitClose()
    await new Promise((r) => setTimeout(r, 80))
    expect(sockets.length).toBe(2)
  })

  it('shutdown closes all streams', () => {
    mgr.subscribe('BTCUSDT', () => {})
    mgr.subscribe('ETHUSDT', () => {})
    expect(mgr.hasStream('BTCUSDT')).toBe(true)
    expect(mgr.hasStream('ETHUSDT')).toBe(true)
    mgr.shutdown()
    expect(mgr.hasStream('BTCUSDT')).toBe(false)
    expect(mgr.hasStream('ETHUSDT')).toBe(false)
  })

  it('isolates subscriber errors (one bad sub does not break others)', () => {
    const received: TradeEvent[] = []
    mgr.subscribe('BTCUSDT', () => { throw new Error('bad') })
    const u2 = mgr.subscribe('BTCUSDT', (t) => received.push(t))
    expect(() => sockets[0]!.emit({ data: aggTrade({ a: 5 }) })).not.toThrow()
    expect(received.length).toBe(1)
    u2()
  })

  it('ignores non-aggTrade messages', () => {
    const received: TradeEvent[] = []
    mgr.subscribe('BTCUSDT', (t) => received.push(t))
    sockets[0]!.emit({ data: { e: 'kline', s: 'BTCUSDT' } })
    sockets[0]!.emit({ data: 'not-json' })
    expect(received.length).toBe(0)
  })

  it('throws on empty symbol', () => {
    expect(() => mgr.subscribe('', () => {})).toThrow(/empty symbol/)
  })

  it('exposes subscriber count', () => {
    const u1 = mgr.subscribe('BTCUSDT', () => {})
    const u2 = mgr.subscribe('BTCUSDT', () => {})
    expect(mgr.subscriberCount('BTCUSDT')).toBe(2)
    u1(); u2()
  })
})
