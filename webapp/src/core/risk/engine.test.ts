import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMITS,
  evaluate,
  initialRiskState,
  killSwitch,
  mainnetGuard,
  reEnable,
  recordAccepted,
  recordFailure,
  recordFill,
  rollDay,
  utcDayKey
} from './engine'
import type { OrderIntent, RiskLimits, RiskState } from './types'

const T0 = Date.UTC(2026, 8, 2, 12, 0, 0) // 2026-09-02 12:00Z

const limits: RiskLimits = {
  ...DEFAULT_LIMITS,
  maxOrderNotionalUsd: 1000,
  maxPositionSize: 0.1,
  maxTotalNotionalUsd: 5000,
  dailyLossLimitUsd: 100,
  maxConsecutiveFailures: 3,
  maxOrdersPerWindow: 3,
  orderWindowMs: 60_000,
  allowedSymbols: ['BTCUSDT', 'ETHUSDT']
}

const okEnv = { ALLOW_MAINNET: 'true', RISK_LIMITS_CONFIRMED: 'true' }

function intent(over: Partial<OrderIntent> = {}): OrderIntent {
  return {
    clientOrderId: 'c1',
    symbol: 'BTCUSDT',
    side: 'buy',
    qty: 0.01,
    price: 50_000,
    mode: 'paper',
    ts: T0,
    ...over
  }
}

function run(i: Partial<OrderIntent>, state: RiskState = initialRiskState(T0), env = {}) {
  return evaluate({ intent: intent(i), limits, state, env })
}

function rejectCode(d: ReturnType<typeof evaluate>) {
  return d.ok ? null : d.rejection.code
}

describe('evaluate — happy path', () => {
  it('accepts a small paper order', () => {
    const d = run({})
    expect(d.ok).toBe(true)
    expect(d.warnings).toEqual([])
  })

  it('does not mutate input state', () => {
    const state = initialRiskState(T0)
    const frozen = JSON.stringify(state)
    run({}, state)
    expect(JSON.stringify(state)).toBe(frozen)
  })
})

describe('evaluate — reject order of precedence', () => {
  it('1. DISABLED beats everything', () => {
    const state = killSwitch(initialRiskState(T0), T0, 'test')
    expect(rejectCode(run({ symbol: 'XXX', qty: -1, mode: 'mainnet' }, state))).toBe('DISABLED')
  })

  it('2. MAINNET_NOT_ALLOWED without env', () => {
    expect(rejectCode(run({ mode: 'mainnet' }))).toBe('MAINNET_NOT_ALLOWED')
  })

  it('2b. mainnet allowed with both env flags', () => {
    expect(run({ mode: 'mainnet' }, initialRiskState(T0), okEnv).ok).toBe(true)
  })

  it('2c. mainnet requires BOTH flags (only ALLOW_MAINNET is not enough)', () => {
    expect(rejectCode(run({ mode: 'mainnet' }, initialRiskState(T0), { ALLOW_MAINNET: 'true' }))).toBe(
      'MAINNET_NOT_ALLOWED'
    )
  })

  it('3. SYMBOL_NOT_ALLOWED', () => {
    expect(rejectCode(run({ symbol: 'DOGEUSDT' }))).toBe('SYMBOL_NOT_ALLOWED')
  })

  it('3b. empty allowlist is fail-closed', () => {
    const d = evaluate({ intent: intent(), limits: { ...limits, allowedSymbols: [] }, state: initialRiskState(T0), env: {} })
    expect(rejectCode(d)).toBe('SYMBOL_NOT_ALLOWED')
  })

  it('4. INVALID_QTY for 0, negative, NaN, Infinity', () => {
    for (const qty of [0, -1, NaN, Infinity]) {
      expect(rejectCode(run({ qty }))).toBe('INVALID_QTY')
    }
  })

  it('4b. INVALID_PRICE', () => {
    expect(rejectCode(run({ price: 0 }))).toBe('INVALID_PRICE')
    expect(rejectCode(run({ price: NaN }))).toBe('INVALID_PRICE')
  })

  it('5. ORDER_NOTIONAL with limit/actual', () => {
    const d = run({ qty: 0.03, price: 50_000 }) // 1500 > 1000
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.rejection.code).toBe('ORDER_NOTIONAL')
      expect(d.rejection.limit).toBe(1000)
      expect(d.rejection.actual).toBe(1500)
    }
  })

  it('6. POSITION_SIZE on projected position', () => {
    const state: RiskState = {
      ...initialRiskState(T0),
      positions: [{ symbol: 'BTCUSDT', qty: 0.095, avgEntryPrice: 50_000 }]
    }
    expect(rejectCode(run({ qty: 0.01 }, state))).toBe('POSITION_SIZE')
  })

  it('6b. reducing an oversized position is always allowed', () => {
    const state: RiskState = {
      ...initialRiskState(T0),
      positions: [{ symbol: 'BTCUSDT', qty: 0.5, avgEntryPrice: 50_000 }] // already > 0.1
    }
    expect(run({ side: 'sell', qty: 0.01 }, state).ok).toBe(true)
  })

  it('7. TOTAL_NOTIONAL across symbols uses mark prices', () => {
    const state: RiskState = {
      ...initialRiskState(T0),
      positions: [{ symbol: 'ETHUSDT', qty: 1, avgEntryPrice: 3000 }]
    }
    // ETH mark 4900 => 4900 + BTC 0.01*50000=500 => 5400 > 5000
    const d = evaluate({
      intent: intent({ qty: 0.01 }),
      limits,
      state,
      env: {},
      markPrices: { ETHUSDT: 4900 }
    })
    expect(rejectCode(d)).toBe('TOTAL_NOTIONAL')
  })

  it('8. DAILY_LOSS blocks increasing but allows reducing', () => {
    const state: RiskState = {
      ...initialRiskState(T0),
      realizedPnlUsdToday: -150,
      positions: [{ symbol: 'BTCUSDT', qty: 0.02, avgEntryPrice: 50_000 }]
    }
    expect(rejectCode(run({ side: 'buy', qty: 0.01 }, state))).toBe('DAILY_LOSS')
    expect(run({ side: 'sell', qty: 0.01 }, state).ok).toBe(true)
  })

  it('8b. daily loss resets on new UTC day', () => {
    const state: RiskState = { ...initialRiskState(T0), realizedPnlUsdToday: -150 }
    const nextDay = T0 + 24 * 3600 * 1000
    expect(run({ ts: nextDay }, state).ok).toBe(true)
  })

  it('9. RATE_LIMIT with sliding window', () => {
    let state = initialRiskState(T0)
    state = recordAccepted(state, T0 - 50_000, limits)
    state = recordAccepted(state, T0 - 30_000, limits)
    state = recordAccepted(state, T0 - 10_000, limits)
    expect(rejectCode(run({}, state))).toBe('RATE_LIMIT')
    // 11 s vėliau — pirmasis iškrenta iš 60 s lango
    expect(run({ ts: T0 + 11_000 }, state).ok).toBe(true)
  })
})

describe('evaluate — warnings', () => {
  it('emits NEAR_* warnings at >= 80% utilization', () => {
    const state: RiskState = {
      ...initialRiskState(T0),
      realizedPnlUsdToday: -85,
      positions: [{ symbol: 'BTCUSDT', qty: 0.075, avgEntryPrice: 50_000 }]
    }
    const d = run({ qty: 0.01 }, state) // position 0.085/0.1 = 85%, notional 4250/5000 = 85%, loss 85/100
    expect(d.ok).toBe(true)
    const codes = d.warnings.map((w) => w.code)
    expect(codes).toEqual(['NEAR_POSITION_SIZE', 'NEAR_TOTAL_NOTIONAL', 'NEAR_DAILY_LOSS'])
    for (const w of d.warnings) expect(w.utilization).toBeCloseTo(0.85)
  })

  it('emits no warnings below 80%', () => {
    const d = run({ qty: 0.001 })
    expect(d.warnings).toEqual([])
  })
})

describe('mainnetGuard', () => {
  it('rejects when limits are unsafe even with env flags', () => {
    expect(mainnetGuard(okEnv, { ...limits, allowedSymbols: [] })).toMatch(/allowedSymbols/)
    expect(mainnetGuard(okEnv, { ...limits, maxOrderNotionalUsd: 0 })).toMatch(/maxOrderNotionalUsd/)
    expect(mainnetGuard(okEnv, { ...limits, dailyLossLimitUsd: -1 })).toMatch(/dailyLossLimitUsd/)
  })
  it('rejects string variants other than exactly "true"', () => {
    expect(mainnetGuard({ ALLOW_MAINNET: 'TRUE', RISK_LIMITS_CONFIRMED: 'true' }, limits)).not.toBeNull()
    expect(mainnetGuard({ ALLOW_MAINNET: '1', RISK_LIMITS_CONFIRMED: 'true' }, limits)).not.toBeNull()
  })
  it('passes with valid config', () => {
    expect(mainnetGuard(okEnv, limits)).toBeNull()
  })
})

describe('state transitions', () => {
  it('recordFailure auto-disables after N consecutive failures', () => {
    let s = initialRiskState(T0)
    s = recordFailure(s, T0, limits)
    s = recordFailure(s, T0, limits)
    expect(s.disabled).toBe(false)
    s = recordFailure(s, T0, limits)
    expect(s.disabled).toBe(true)
    expect(s.disabledReason).toMatch(/auto-disable/)
    expect(s.disabledAt).toBe(T0)
  })

  it('a fill resets consecutive failures', () => {
    let s = recordFailure(initialRiskState(T0), T0, limits)
    s = recordFailure(s, T0, limits)
    s = recordFill(s, { symbol: 'BTCUSDT', side: 'buy', qty: 0.01, price: 50_000, ts: T0 })
    expect(s.consecutiveFailures).toBe(0)
  })

  it('killSwitch is idempotent and reEnable is the only way back', () => {
    const s1 = killSwitch(initialRiskState(T0), T0, 'manual')
    const s2 = killSwitch(s1, T0 + 1, 'again')
    expect(s2).toBe(s1)
    expect(s1.disabledReason).toBe('kill-switch: manual')
    // Naujos dienos roll NE re-enable'ina
    const rolled = rollDay(s1, T0 + 86_400_000)
    expect(rolled.disabled).toBe(true)
    const re = reEnable(rolled)
    expect(re.disabled).toBe(false)
    expect(re.disabledReason).toBeNull()
  })

  it('recordAccepted prunes timestamps outside window', () => {
    let s = recordAccepted(initialRiskState(T0), T0 - 120_000, limits)
    s = recordAccepted(s, T0, limits)
    expect(s.recentOrderTs).toEqual([T0])
  })
})

describe('recordFill — position math', () => {
  const fill = (side: 'buy' | 'sell', qty: number, price: number) => ({
    symbol: 'BTCUSDT',
    side,
    qty,
    price,
    ts: T0
  })

  it('opens a position', () => {
    const s = recordFill(initialRiskState(T0), fill('buy', 0.02, 50_000))
    expect(s.positions).toEqual([{ symbol: 'BTCUSDT', qty: 0.02, avgEntryPrice: 50_000 }])
    expect(s.realizedPnlUsdToday).toBe(0)
  })

  it('adds with weighted average entry', () => {
    let s = recordFill(initialRiskState(T0), fill('buy', 0.01, 50_000))
    s = recordFill(s, fill('buy', 0.01, 60_000))
    expect(s.positions[0].qty).toBeCloseTo(0.02)
    expect(s.positions[0].avgEntryPrice).toBe(55_000)
  })

  it('partial close realizes PnL, keeps avg entry', () => {
    let s = recordFill(initialRiskState(T0), fill('buy', 0.02, 50_000))
    s = recordFill(s, fill('sell', 0.01, 52_000))
    expect(s.realizedPnlUsdToday).toBeCloseTo(20) // 2000 * 0.01
    expect(s.positions[0].qty).toBeCloseTo(0.01)
    expect(s.positions[0].avgEntryPrice).toBe(50_000)
  })

  it('full close removes position and realizes loss for short', () => {
    let s = recordFill(initialRiskState(T0), fill('sell', 0.01, 50_000))
    s = recordFill(s, fill('buy', 0.01, 51_000))
    expect(s.positions).toEqual([])
    expect(s.realizedPnlUsdToday).toBeCloseTo(-10)
  })

  it('flip: closes old, opens new at fill price', () => {
    let s = recordFill(initialRiskState(T0), fill('buy', 0.01, 50_000))
    s = recordFill(s, fill('sell', 0.03, 55_000))
    expect(s.realizedPnlUsdToday).toBeCloseTo(50)
    expect(s.positions[0].qty).toBeCloseTo(-0.02)
    expect(s.positions[0].avgEntryPrice).toBe(55_000)
  })
})

describe('utcDayKey', () => {
  it('formats UTC date', () => {
    expect(utcDayKey(T0)).toBe('2026-09-02')
    expect(utcDayKey(Date.UTC(2026, 8, 2, 23, 59, 59))).toBe('2026-09-02')
    expect(utcDayKey(Date.UTC(2026, 8, 3, 0, 0, 0))).toBe('2026-09-03')
  })
})
