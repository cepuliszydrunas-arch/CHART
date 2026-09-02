/**
 * Risk limits engine — pure funkcijos.
 *
 * Kontraktas: `evaluate()` NIEKADA nemeta išimčių ir NIEKADA nemutuoja įvesties.
 * Grąžina sprendimą; state atnaujinimai — atskiros funkcijos (`recordAccepted`,
 * `recordFailure`, `recordFill`, ...), kad serveris galėtų juos taikyti
 * transakcijoje kartu su audito įrašu.
 *
 * KODĖL fail-closed: kiekviena neaiški situacija (NaN, tuščias allowlist,
 * nežinoma diena) => REJECT. Prekyboje klaidingas "leidžiu" kainuoja pinigus,
 * klaidingas "draudžiu" — tik vieną praleistą orderį.
 *
 * Tikrinimo tvarka fiksuota (svarbu auditui ir testams):
 *   1 DISABLED  2 MAINNET  3 SYMBOL  4 QTY/PRICE  5 ORDER_NOTIONAL
 *   6 POSITION  7 TOTAL_NOTIONAL  8 DAILY_LOSS  9 RATE_LIMIT
 */

import type {
  MainnetGuardEnv,
  OrderIntent,
  PositionSnapshot,
  RiskDecision,
  RiskLimits,
  RiskRejection,
  RiskState,
  RiskWarning
} from './types'

/** Įspėjimo slenkstis — 80 % limito. */
const WARN_AT = 0.8

export const DEFAULT_LIMITS: RiskLimits = {
  maxOrderNotionalUsd: 500,
  maxPositionSize: 0.05,
  maxTotalNotionalUsd: 2000,
  dailyLossLimitUsd: 200,
  maxConsecutiveFailures: 3,
  maxOrdersPerWindow: 10,
  orderWindowMs: 60_000,
  allowedSymbols: []
}

export function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function initialRiskState(ts: number): RiskState {
  return {
    dayKey: utcDayKey(ts),
    realizedPnlUsdToday: 0,
    consecutiveFailures: 0,
    disabled: false,
    disabledReason: null,
    disabledAt: null,
    recentOrderTs: [],
    positions: []
  }
}

/**
 * Mainnet sargas. Grąžina `null` jei leidžiama, kitaip — priežastį.
 * Reikalauja DVIEJŲ nepriklausomų env var'ų — apsauga nuo atsitiktinio
 * `ALLOW_MAINNET=true` copy-paste iš .env.example.
 */
export function mainnetGuard(env: MainnetGuardEnv, limits: RiskLimits): string | null {
  if (env.ALLOW_MAINNET !== 'true') return 'ALLOW_MAINNET is not "true"'
  if (env.RISK_LIMITS_CONFIRMED !== 'true') return 'RISK_LIMITS_CONFIRMED is not "true"'
  if (limits.allowedSymbols.length === 0) return 'allowedSymbols is empty'
  if (!(limits.maxOrderNotionalUsd > 0)) return 'maxOrderNotionalUsd must be > 0'
  if (!(limits.dailyLossLimitUsd > 0)) return 'dailyLossLimitUsd must be > 0'
  return null
}

function isFinitePositive(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function findPosition(positions: PositionSnapshot[], symbol: string): PositionSnapshot | undefined {
  return positions.find((p) => p.symbol === symbol)
}

function totalNotional(positions: PositionSnapshot[], markPrices: Record<string, number>): number {
  let sum = 0
  for (const p of positions) {
    const mark = markPrices[p.symbol] ?? p.avgEntryPrice
    sum += Math.abs(p.qty) * mark
  }
  return sum
}

/** Roll state į naują UTC dieną: PnL resetinamas, disable — NE (reikia rankinio re-enable). */
export function rollDay(state: RiskState, ts: number): RiskState {
  const key = utcDayKey(ts)
  if (key === state.dayKey) return state
  return { ...state, dayKey: key, realizedPnlUsdToday: 0 }
}

export interface EvaluateInput {
  intent: OrderIntent
  limits: RiskLimits
  state: RiskState
  env: MainnetGuardEnv
  /** Dabartinės mark kainos kitiems simboliams — total notional skaičiavimui. */
  markPrices?: Record<string, number>
}

export function evaluate(input: EvaluateInput): RiskDecision {
  const { intent, limits, env } = input
  const state = rollDay(input.state, intent.ts)
  const markPrices = { ...(input.markPrices ?? {}), [intent.symbol]: intent.price }
  const warnings: RiskWarning[] = []

  const reject = (rejection: RiskRejection): RiskDecision => ({ ok: false, rejection, warnings })

  // 1. Kill-switch / auto-disable
  if (state.disabled) {
    return reject({
      code: 'DISABLED',
      message: `Trading disabled: ${state.disabledReason ?? 'unknown reason'}`
    })
  }

  // 2. Mainnet guard — tik realiems orderiams
  if (intent.mode === 'mainnet') {
    const reason = mainnetGuard(env, limits)
    if (reason) return reject({ code: 'MAINNET_NOT_ALLOWED', message: `Mainnet blocked: ${reason}` })
  }

  // 3. Symbol allowlist (fail-closed)
  if (!limits.allowedSymbols.includes(intent.symbol)) {
    return reject({
      code: 'SYMBOL_NOT_ALLOWED',
      message: `Symbol ${intent.symbol} is not in allowlist`
    })
  }

  // 4. Įvesties validacija
  if (!isFinitePositive(intent.qty)) {
    return reject({ code: 'INVALID_QTY', message: 'qty must be a finite number > 0', actual: intent.qty })
  }
  if (!isFinitePositive(intent.price)) {
    return reject({ code: 'INVALID_PRICE', message: 'price must be a finite number > 0', actual: intent.price })
  }

  // 5. Order notional
  const notional = intent.qty * intent.price
  if (notional > limits.maxOrderNotionalUsd) {
    return reject({
      code: 'ORDER_NOTIONAL',
      message: `Order notional $${notional.toFixed(2)} exceeds max $${limits.maxOrderNotionalUsd}`,
      limit: limits.maxOrderNotionalUsd,
      actual: notional
    })
  }

  // 6. Position size (po orderio)
  const existing = findPosition(state.positions, intent.symbol)
  const signedQty = intent.side === 'buy' ? intent.qty : -intent.qty
  const projectedQty = (existing?.qty ?? 0) + signedQty
  const projectedAbs = Math.abs(projectedQty)
  // Leidžiam MAŽINTI poziciją net jei ji jau viršija limitą (pvz. limitas sumažintas gyvai).
  const isReducing = existing !== undefined && Math.abs(existing.qty) > projectedAbs
  if (!isReducing && projectedAbs > limits.maxPositionSize) {
    return reject({
      code: 'POSITION_SIZE',
      message: `Projected position ${projectedAbs} exceeds max ${limits.maxPositionSize}`,
      limit: limits.maxPositionSize,
      actual: projectedAbs
    })
  }
  pushWarning(warnings, 'NEAR_POSITION_SIZE', projectedAbs / limits.maxPositionSize, 'position size')

  // 7. Total notional (po orderio)
  const projectedPositions = state.positions
    .filter((p) => p.symbol !== intent.symbol)
    .concat(projectedQty !== 0 ? [{ symbol: intent.symbol, qty: projectedQty, avgEntryPrice: intent.price }] : [])
  const projectedTotal = totalNotional(projectedPositions, markPrices)
  const currentTotal = totalNotional(state.positions, markPrices)
  if (!isReducing && projectedTotal > limits.maxTotalNotionalUsd && projectedTotal > currentTotal) {
    return reject({
      code: 'TOTAL_NOTIONAL',
      message: `Projected total notional $${projectedTotal.toFixed(2)} exceeds max $${limits.maxTotalNotionalUsd}`,
      limit: limits.maxTotalNotionalUsd,
      actual: projectedTotal
    })
  }
  pushWarning(warnings, 'NEAR_TOTAL_NOTIONAL', projectedTotal / limits.maxTotalNotionalUsd, 'total notional')

  // 8. Daily loss — blokuoja tik pozicijos DIDINIMĄ; mažinti (uždaryti) visada galima.
  const loss = -state.realizedPnlUsdToday
  if (!isReducing && loss >= limits.dailyLossLimitUsd) {
    return reject({
      code: 'DAILY_LOSS',
      message: `Daily loss $${loss.toFixed(2)} reached limit $${limits.dailyLossLimitUsd}`,
      limit: limits.dailyLossLimitUsd,
      actual: loss
    })
  }
  if (loss > 0) pushWarning(warnings, 'NEAR_DAILY_LOSS', loss / limits.dailyLossLimitUsd, 'daily loss')

  // 9. Rate limit (slankus langas)
  const windowStart = intent.ts - limits.orderWindowMs
  const inWindow = state.recentOrderTs.filter((t) => t > windowStart).length
  if (inWindow >= limits.maxOrdersPerWindow) {
    return reject({
      code: 'RATE_LIMIT',
      message: `${inWindow} orders in last ${limits.orderWindowMs / 1000}s (max ${limits.maxOrdersPerWindow})`,
      limit: limits.maxOrdersPerWindow,
      actual: inWindow
    })
  }

  return { ok: true, warnings }
}

function pushWarning(list: RiskWarning[], code: RiskWarning['code'], utilization: number, label: string): void {
  if (Number.isFinite(utilization) && utilization >= WARN_AT && utilization <= 1) {
    list.push({ code, utilization, message: `${Math.round(utilization * 100)}% of ${label} limit used` })
  }
}

// ---------------------------------------------------------------------------
// State perėjimai (pure — grąžina naują objektą)
// ---------------------------------------------------------------------------

/** Orderis priimtas ir išsiųstas biržai. */
export function recordAccepted(state: RiskState, ts: number, limits: RiskLimits): RiskState {
  const s = rollDay(state, ts)
  const windowStart = ts - limits.orderWindowMs
  return {
    ...s,
    recentOrderTs: [...s.recentOrderTs.filter((t) => t > windowStart), ts]
  }
}

/** Orderis atmestas biržos arba nepavyko išsiųsti. */
export function recordFailure(state: RiskState, ts: number, limits: RiskLimits): RiskState {
  const s = rollDay(state, ts)
  const failures = s.consecutiveFailures + 1
  const shouldDisable = failures >= limits.maxConsecutiveFailures
  return {
    ...s,
    consecutiveFailures: failures,
    disabled: s.disabled || shouldDisable,
    disabledReason: shouldDisable && !s.disabled ? `auto-disable after ${failures} consecutive failures` : s.disabledReason,
    disabledAt: shouldDisable && !s.disabled ? ts : s.disabledAt
  }
}

/** Sėkmingas fill — atnaujina poziciją ir realizuotą PnL, resetina failure counter. */
export function recordFill(
  state: RiskState,
  fill: { symbol: string; side: 'buy' | 'sell'; qty: number; price: number; ts: number }
): RiskState {
  const s = rollDay(state, fill.ts)
  const existing = findPosition(s.positions, fill.symbol)
  const signed = fill.side === 'buy' ? fill.qty : -fill.qty
  let realized = 0
  let next: PositionSnapshot

  if (!existing || existing.qty === 0) {
    next = { symbol: fill.symbol, qty: signed, avgEntryPrice: fill.price }
  } else if (Math.sign(existing.qty) === Math.sign(signed)) {
    // Didinam poziciją — svertinis vidurkis
    const totalQty = existing.qty + signed
    const avg = (existing.avgEntryPrice * Math.abs(existing.qty) + fill.price * fill.qty) / Math.abs(totalQty)
    next = { symbol: fill.symbol, qty: totalQty, avgEntryPrice: avg }
  } else {
    // Mažinam / apverčiam
    const closedQty = Math.min(Math.abs(existing.qty), fill.qty)
    const direction = existing.qty > 0 ? 1 : -1
    realized = (fill.price - existing.avgEntryPrice) * closedQty * direction
    const remaining = existing.qty + signed
    next =
      remaining === 0
        ? { symbol: fill.symbol, qty: 0, avgEntryPrice: 0 }
        : Math.sign(remaining) === Math.sign(existing.qty)
          ? { symbol: fill.symbol, qty: remaining, avgEntryPrice: existing.avgEntryPrice }
          : { symbol: fill.symbol, qty: remaining, avgEntryPrice: fill.price } // apversta
  }

  const positions = s.positions.filter((p) => p.symbol !== fill.symbol)
  if (next.qty !== 0) positions.push(next)

  return {
    ...s,
    positions,
    realizedPnlUsdToday: s.realizedPnlUsdToday + realized,
    consecutiveFailures: 0
  }
}

/** Kill-switch: išjungia viską. Idempotentiškas. */
export function killSwitch(state: RiskState, ts: number, reason: string): RiskState {
  if (state.disabled) return state
  return { ...state, disabled: true, disabledReason: `kill-switch: ${reason}`, disabledAt: ts }
}

/** Rankinis re-enable — VIENINTELIS kelias iš disabled. Resetina failure counter. */
export function reEnable(state: RiskState): RiskState {
  return { ...state, disabled: false, disabledReason: null, disabledAt: null, consecutiveFailures: 0 }
}
