/**
 * Order pipeline — vienintelis kanoninis kelias orderiui.
 *
 *   validate → idempotency → risk.evaluate → persist(accepted) → adapter.place
 *   → persist(sent/filled/failed) → risk state update → audit
 *
 * KODĖL viskas viename: dvigubi keliai (esamos platformos problema) atsiranda,
 * kai order logika išsibarsto po route handler'ius. Čia route handler'is yra
 * 5 eilučių wrapper'is aplink `submitOrder`.
 *
 * Idempotency: `clientOrderId` yra pirminis raktas. Pakartotinis submit su tuo
 * pačiu ID grąžina PIRMĄJĮ rezultatą ir NEsiunčia į biržą — net jei pirmas
 * bandymas dar 'sent' (in-flight). Tai apsauga nuo dvigubo click / retry storm.
 */

import { evaluate, recordAccepted, recordFailure, recordFill, initialRiskState } from '../risk/engine'
import type { MainnetGuardEnv, OrderIntent, RiskLimits, RiskState } from '../risk/types'
import type { AuditEntry, ExecutionAdapter, OrderRecord, OrderStore } from './types'

export interface SubmitContext {
  store: OrderStore
  adapter: ExecutionAdapter
  limits: RiskLimits
  env: MainnetGuardEnv
  actor: string
  ip: string
  markPrices?: Record<string, number>
  /** Injektuojamas laikrodis — testams. */
  now?: () => number
}

export type SubmitResult =
  | { status: 'risk_rejected'; record: OrderRecord }
  | { status: 'duplicate'; record: OrderRecord }
  | { status: 'filled' | 'sent' | 'exchange_rejected' | 'failed'; record: OrderRecord }
  | { status: 'invalid'; error: string }

const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export function validateIntentShape(x: unknown): x is OrderIntent {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.clientOrderId === 'string' &&
    CLIENT_ORDER_ID_RE.test(o.clientOrderId) &&
    typeof o.symbol === 'string' &&
    o.symbol.length > 0 &&
    o.symbol.length <= 32 &&
    (o.side === 'buy' || o.side === 'sell') &&
    typeof o.qty === 'number' &&
    typeof o.price === 'number' &&
    (o.mode === 'paper' || o.mode === 'testnet' || o.mode === 'mainnet') &&
    typeof o.ts === 'number'
  )
}

export async function submitOrder(rawIntent: unknown, ctx: SubmitContext): Promise<SubmitResult> {
  const now = ctx.now ?? Date.now
  const audit = (event: AuditEntry['event'], clientOrderId: string | null, detail: Record<string, unknown>) =>
    ctx.store.appendAudit({ ts: now(), event, actor: ctx.actor, ip: ctx.ip, clientOrderId, detail })

  if (!validateIntentShape(rawIntent)) {
    await audit('order.failed', null, { error: 'invalid_intent_shape' })
    return { status: 'invalid', error: 'Invalid order intent shape' }
  }
  // Serveris NIEKADA nepasitiki kliento ts — perrašo savo.
  const intent: OrderIntent = { ...rawIntent, ts: now() }

  await audit('order.received', intent.clientOrderId, { intent })

  // --- Idempotency: ar jau matėm šį ID? ---
  const existing = await ctx.store.getOrder(intent.clientOrderId)
  if (existing) {
    await audit('order.duplicate', intent.clientOrderId, { existingStatus: existing.status })
    return { status: 'duplicate', record: existing }
  }

  // --- Risk ---
  let riskState: RiskState = (await ctx.store.getRiskState()) ?? initialRiskState(intent.ts)
  const decision = evaluate({ intent, limits: ctx.limits, state: riskState, env: ctx.env, markPrices: ctx.markPrices })

  const base: OrderRecord = {
    clientOrderId: intent.clientOrderId,
    intent,
    status: 'received',
    exchangeOrderId: null,
    riskDecision: decision,
    createdAt: intent.ts,
    updatedAt: intent.ts
  }

  if (!decision.ok) {
    const record = { ...base, status: 'risk_rejected' as const }
    await ctx.store.createIfAbsent(record)
    await audit('order.risk_rejected', intent.clientOrderId, { rejection: decision.rejection })
    return { status: 'risk_rejected', record }
  }

  // --- Persist BEFORE send (crash tarp šių dviejų = orderis 'accepted' be exchangeId — matomas audite) ---
  const accepted = { ...base, status: 'accepted' as const }
  const created = await ctx.store.createIfAbsent(accepted)
  if (!created) {
    // Race: kitas request'as su tuo pačiu ID laimėjo tarp getOrder ir createIfAbsent.
    const winner = (await ctx.store.getOrder(intent.clientOrderId)) ?? accepted
    await audit('order.duplicate', intent.clientOrderId, { race: true, existingStatus: winner.status })
    return { status: 'duplicate', record: winner }
  }
  riskState = recordAccepted(riskState, intent.ts, ctx.limits)
  await ctx.store.putRiskState(riskState)
  await audit('order.accepted', intent.clientOrderId, { warnings: decision.warnings })

  // --- Send ---
  let result: Awaited<ReturnType<ExecutionAdapter['place']>>
  try {
    result = await ctx.adapter.place(intent)
  } catch (e) {
    result = { ok: false, reason: e instanceof Error ? e.message : 'adapter threw' }
  }

  const ts = now()
  if (!result.ok) {
    const before = riskState
    riskState = recordFailure(riskState, ts, ctx.limits)
    await ctx.store.putRiskState(riskState)
    const record: OrderRecord = { ...accepted, status: 'exchange_rejected', updatedAt: ts }
    await ctx.store.putOrder(record)
    await audit('order.exchange_rejected', intent.clientOrderId, { reason: result.reason })
    if (riskState.disabled && !before.disabled) {
      await audit('risk.auto_disable', intent.clientOrderId, { reason: riskState.disabledReason })
    }
    return { status: 'exchange_rejected', record }
  }

  if (result.fill) {
    riskState = recordFill(riskState, { symbol: intent.symbol, side: intent.side, qty: result.fill.qty, price: result.fill.price, ts })
    await ctx.store.putRiskState(riskState)
    const record: OrderRecord = { ...accepted, status: 'filled', exchangeOrderId: result.exchangeOrderId, updatedAt: ts }
    await ctx.store.putOrder(record)
    await audit('order.filled', intent.clientOrderId, { exchangeOrderId: result.exchangeOrderId, fill: result.fill })
    return { status: 'filled', record }
  }

  const record: OrderRecord = { ...accepted, status: 'sent', exchangeOrderId: result.exchangeOrderId, updatedAt: ts }
  await ctx.store.putOrder(record)
  await audit('order.sent', intent.clientOrderId, { exchangeOrderId: result.exchangeOrderId })
  return { status: 'sent', record }
}
