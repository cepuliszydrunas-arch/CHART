import { describe, expect, it } from 'vitest'
import { binanceFutures, bybitLinear, okxInstId, okxSwap } from './adapters'

// Tikri payload formatai iš biržų dokumentacijos.

describe('binanceFutures', () => {
  const raw = JSON.stringify({
    e: 'aggTrade', E: 1725278400123, s: 'BTCUSDT', a: 5933014,
    p: '50000.10', q: '0.250', f: 100, l: 105, T: 1725278400100, m: true
  })

  it('maps isBuyerMaker=true → aggressor sell (CRITICAL)', () => {
    const [t] = binanceFutures.parse(raw, 'BTCUSDT')
    expect(t).toEqual({
      venue: 'binance', tradeId: '5933014', symbol: 'BTCUSDT',
      price: 50000.1, qty: 0.25, aggressor: 'sell', ts: 1725278400100
    })
  })
  it('maps isBuyerMaker=false → aggressor buy', () => {
    const [t] = binanceFutures.parse(raw.replace('"m":true', '"m":false'), 'BTCUSDT')
    expect(t.aggressor).toBe('buy')
  })
  it('ignores other symbols, non-aggTrade events, garbage', () => {
    expect(binanceFutures.parse(raw, 'ETHUSDT')).toEqual([])
    expect(binanceFutures.parse('{"e":"kline"}', 'BTCUSDT')).toEqual([])
    expect(binanceFutures.parse('not json', 'BTCUSDT')).toEqual([])
    expect(binanceFutures.parse('{"e":"aggTrade","s":"BTCUSDT","p":"x","q":"1","T":1}', 'BTCUSDT')).toEqual([])
  })
  it('wsUrl lowercases symbol; no subscribe message', () => {
    expect(binanceFutures.wsUrl('BTCUSDT')).toBe('wss://fstream.binance.com/ws/btcusdt@aggTrade')
    expect(binanceFutures.subscribeMessage('BTCUSDT')).toBeNull()
  })
})

describe('bybitLinear', () => {
  const raw = JSON.stringify({
    topic: 'publicTrade.BTCUSDT', type: 'snapshot', ts: 1725278400200,
    data: [
      { T: 1725278400150, s: 'BTCUSDT', S: 'Buy', v: '0.100', p: '50001.5', L: 'PlusTick', i: 'abc-1', BT: false },
      { T: 1725278400160, s: 'BTCUSDT', S: 'Sell', v: '0.300', p: '50001.0', L: 'MinusTick', i: 'abc-2', BT: false },
      { T: 1725278400170, s: 'ETHUSDT', S: 'Buy', v: '1', p: '3000', i: 'abc-3' }
    ]
  })

  it('parses batch, maps S Buy/Sell → aggressor, filters symbol', () => {
    const out = bybitLinear.parse(raw, 'BTCUSDT')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ venue: 'bybit', tradeId: 'abc-1', aggressor: 'buy', price: 50001.5, qty: 0.1 })
    expect(out[1]).toMatchObject({ tradeId: 'abc-2', aggressor: 'sell', qty: 0.3 })
  })
  it('ignores ack/pong and other topics', () => {
    expect(bybitLinear.parse('{"op":"subscribe","success":true}', 'BTCUSDT')).toEqual([])
    expect(bybitLinear.parse('{"topic":"orderbook.50.BTCUSDT","data":[]}', 'BTCUSDT')).toEqual([])
    expect(bybitLinear.parse('{"topic":"publicTrade.BTCUSDT","data":"x"}', 'BTCUSDT')).toEqual([])
  })
  it('skips rows with unknown side or bad numbers', () => {
    const bad = JSON.stringify({ topic: 'publicTrade.BTCUSDT', data: [{ s: 'BTCUSDT', S: 'Hold', v: '1', p: '1', T: 1, i: 'x' }, { s: 'BTCUSDT', S: 'Buy', v: 'q', p: '1', T: 1, i: 'y' }] })
    expect(bybitLinear.parse(bad, 'BTCUSDT')).toEqual([])
  })
  it('subscribe message targets publicTrade topic', () => {
    expect(JSON.parse(bybitLinear.subscribeMessage('btcusdt')!)).toEqual({ op: 'subscribe', args: ['publicTrade.BTCUSDT'] })
  })
})

describe('okxSwap', () => {
  it('maps canonical symbol to instId', () => {
    expect(okxInstId('BTCUSDT')).toBe('BTC-USDT-SWAP')
    expect(okxInstId('ETHUSDC')).toBe('ETH-USDC-SWAP')
    expect(okxInstId('BTCUSD')).toBe('BTC-USD-SWAP')
    expect(okxInstId('WEIRD')).toBe('WEIRD')
  })
  const raw = JSON.stringify({
    arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' },
    data: [{ instId: 'BTC-USDT-SWAP', tradeId: '130639474', px: '50002.5', sz: '3', side: 'sell', ts: 1725278400300 }]
  })
  it('parses trades channel', () => {
    const [t] = okxSwap.parse(raw, 'BTCUSDT')
    expect(t).toEqual({ venue: 'okx', tradeId: '130639474', symbol: 'BTCUSDT', price: 50002.5, qty: 3, aggressor: 'sell', ts: 1725278400300 })
  })
  it('ignores other instIds / channels / events', () => {
    expect(okxSwap.parse(raw, 'ETHUSDT')).toEqual([])
    expect(okxSwap.parse('{"event":"subscribe","arg":{"channel":"trades"}}', 'BTCUSDT')).toEqual([])
    expect(okxSwap.parse('{"arg":{"channel":"tickers","instId":"BTC-USDT-SWAP"},"data":[]}', 'BTCUSDT')).toEqual([])
    expect(okxSwap.parse('{"arg":{"channel":"trades","instId":"BTC-USDT-SWAP"},"data":[{"px":"1","sz":"1","side":"long","ts":1}]}', 'BTCUSDT')).toEqual([])
    expect(okxSwap.parse('{"arg":{"channel":"trades","instId":"BTC-USDT-SWAP"},"data":[{"px":"1","sz":"nan","side":"buy","ts":1}]}', 'BTCUSDT')).toEqual([])
  })
  it('subscribe message', () => {
    expect(JSON.parse(okxSwap.subscribeMessage('BTCUSDT')!)).toEqual({ op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT-SWAP' }] })
  })
})
