import type { OrderIntent, RiskDecision, RiskState } from '../risk/types'

/**
 * Orderio gyvavimo ciklas. Būsenos perėjimai TIK per `submitOrder` pipeline —
 * niekas kitas negali rašyti į orders lentelę.
 *
 *   received → risk_rejected
 *   received → accepted → sent → filled | exchange_rejected | failed
 */
export type OrderStatus =
  | 'received'
  | 'risk_rejected'
  | 'accepted'
  | 'sent'
  | 'filled'
  | 'exchange_rejected'
  | 'failed'

export interface OrderRecord {
  clientOrderId: string
  intent: OrderIntent
  status: OrderStatus
  /** Biržos priskirtas ID (po `sent`). */
  exchangeOrderId: string | null
  /** Risk sprendimas serializuotas — audito atsekamumui. */
  riskDecision: RiskDecision
  createdAt: number
  updatedAt: number
}

export type AuditEvent =
  | 'order.received'
  | 'order.risk_rejected'
  | 'order.accepted'
  | 'order.sent'
  | 'order.filled'
  | 'order.exchange_rejected'
  | 'order.failed'
  | 'order.duplicate'
  | 'risk.kill_switch'
  | 'risk.re_enable'
  | 'risk.auto_disable'
  | 'risk.limits_changed'
  | 'auth.denied'

export interface AuditEntry {
  ts: number
  event: AuditEvent
  /** Kas — userio id / 'system'. Single-user: 'owner'. */
  actor: string
  /** IP arba 'internal'. */
  ip: string
  clientOrderId: string | null
  /** Laisva struktūra — serializuojama į JSON. NE slaptažodžiai, NE raktai. */
  detail: Record<string, unknown>
}

/**
 * Persistencijos interfeisas. Dvi implementacijos:
 *   - MemoryOrderStore — testams ir dev
 *   - D1OrderStore — Cloudflare D1 (šiame repo)
 *   - (jūsų Next.js) — Postgres/Drizzle implementacija pagal tą patį interfeisą
 */
export interface OrderStore {
  getOrder(clientOrderId: string): Promise<OrderRecord | null>
  putOrder(record: OrderRecord): Promise<void>
  /** Atominis: sukuria jei nėra, grąžina `false` jei jau egzistavo. */
  createIfAbsent(record: OrderRecord): Promise<boolean>
  appendAudit(entry: AuditEntry): Promise<void>
  listAudit(limit: number): Promise<AuditEntry[]>
  getRiskState(): Promise<RiskState | null>
  putRiskState(state: RiskState): Promise<void>
}

/** Adapteris į biržą / paper engine. Vienintelė vieta, kur liečiamas išorinis pasaulis. */
export interface ExecutionAdapter {
  place(intent: OrderIntent): Promise<
    | { ok: true; exchangeOrderId: string; fill?: { qty: number; price: number } }
    | { ok: false; reason: string }
  >
}
