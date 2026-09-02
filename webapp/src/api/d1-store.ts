/**
 * D1 OrderStore — Cloudflare implementacija `OrderStore` interfeiso.
 * Jūsų Next.js/Postgres versija: tas pats interfeisas, kitas SQL dialektas.
 */
import type { AuditEntry, AuditEvent, OrderRecord, OrderStatus, OrderStore } from '../core/orders/types'
import type { RiskLimits, RiskState } from '../core/risk/types'

const VALID_AUDIT_EVENTS: ReadonlySet<AuditEvent> = new Set<AuditEvent>([
  'order.received',
  'order.risk_rejected',
  'order.accepted',
  'order.sent',
  'order.filled',
  'order.exchange_rejected',
  'order.failed',
  'order.duplicate',
  'risk.kill_switch',
  'risk.re_enable',
  'risk.auto_disable',
  'risk.limits_changed',
  'auth.denied'
])

const VALID_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'received',
  'risk_rejected',
  'accepted',
  'sent',
  'filled',
  'exchange_rejected',
  'failed'
])

function isAuditEvent(x: string): x is AuditEvent {
  return VALID_AUDIT_EVENTS.has(x as AuditEvent)
}

function isOrderStatus(x: string): x is OrderStatus {
  return VALID_ORDER_STATUSES.has(x as OrderStatus)
}

export class D1OrderStore implements OrderStore {
  constructor(private db: D1Database) {}

  async getOrder(id: string): Promise<OrderRecord | null> {
    const row = await this.db.prepare('SELECT * FROM orders WHERE client_order_id = ?').bind(id).first<OrderRow>()
    return row ? rowToRecord(row) : null
  }

  async putOrder(r: OrderRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO orders (client_order_id, symbol, side, qty, price, mode, status, exchange_order_id, intent_json, risk_decision_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(client_order_id) DO UPDATE SET status=excluded.status, exchange_order_id=excluded.exchange_order_id, updated_at=excluded.updated_at`
      )
      .bind(...recordToParams(r))
      .run()
  }

  async createIfAbsent(r: OrderRecord): Promise<boolean> {
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO orders (client_order_id, symbol, side, qty, price, mode, status, exchange_order_id, intent_json, risk_decision_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(...recordToParams(r))
      .run()
    return (res.meta.changes ?? 0) > 0
  }

  async appendAudit(e: AuditEntry): Promise<void> {
    await this.db
      .prepare('INSERT INTO audit_log (ts, event, actor, ip, client_order_id, detail_json) VALUES (?,?,?,?,?,?)')
      .bind(e.ts, e.event, e.actor, e.ip, e.clientOrderId, JSON.stringify(e.detail))
      .run()
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    const { results } = await this.db
      .prepare('SELECT ts, event, actor, ip, client_order_id, detail_json FROM audit_log ORDER BY id DESC LIMIT ?')
      .bind(Math.min(Math.max(1, limit), 500))
      .all<{ ts: number; event: string; actor: string; ip: string; client_order_id: string | null; detail_json: string }>()
    const out: AuditEntry[] = []
    for (const r of results) {
      if (!isAuditEvent(r.event)) {
        // eslint-disable-next-line no-console
        console.error('d1-store.listAudit: invalid event in DB, skipping row', { ts: r.ts, event: r.event })
        continue
      }
      out.push({
        ts: r.ts,
        event: r.event,
        actor: r.actor,
        ip: r.ip,
        clientOrderId: r.client_order_id,
        detail: JSON.parse(r.detail_json)
      })
    }
    return out
  }

  async listOrders(limit: number): Promise<OrderRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?')
      .bind(Math.min(Math.max(1, limit), 200))
      .all<OrderRow>()
    const out: OrderRecord[] = []
    for (const r of results) {
      if (!isOrderStatus(r.status)) {
        // eslint-disable-next-line no-console
        console.error('d1-store.listOrders: invalid status in DB, skipping row', { client_order_id: r.client_order_id, status: r.status })
        continue
      }
      out.push(rowToRecord(r))
    }
    return out
  }

  async getRiskState(): Promise<RiskState | null> {
    const row = await this.db.prepare('SELECT state_json FROM risk_state WHERE id = 1').first<{ state_json: string }>()
    return row ? JSON.parse(row.state_json) : null
  }

  async putRiskState(s: RiskState): Promise<void> {
    await this.db
      .prepare('INSERT INTO risk_state (id, state_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at')
      .bind(JSON.stringify(s), Date.now())
      .run()
  }

  async getLimits(): Promise<RiskLimits | null> {
    const row = await this.db.prepare('SELECT limits_json FROM risk_limits WHERE id = 1').first<{ limits_json: string }>()
    return row ? JSON.parse(row.limits_json) : null
  }

  async putLimits(l: RiskLimits): Promise<void> {
    await this.db
      .prepare('INSERT INTO risk_limits (id, limits_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET limits_json=excluded.limits_json, updated_at=excluded.updated_at')
      .bind(JSON.stringify(l), Date.now())
      .run()
  }
}

interface OrderRow {
  client_order_id: string
  status: string
  exchange_order_id: string | null
  intent_json: string
  risk_decision_json: string
  created_at: number
  updated_at: number
}

function rowToRecord(r: OrderRow): OrderRecord {
  if (!isOrderStatus(r.status)) {
    throw new Error(`d1-store.rowToRecord: invalid status "${r.status}" for order ${r.client_order_id}`)
  }
  return {
    clientOrderId: r.client_order_id,
    intent: JSON.parse(r.intent_json),
    status: r.status,
    exchangeOrderId: r.exchange_order_id,
    riskDecision: JSON.parse(r.risk_decision_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function recordToParams(r: OrderRecord) {
  return [
    r.clientOrderId,
    r.intent.symbol,
    r.intent.side,
    r.intent.qty,
    r.intent.price,
    r.intent.mode,
    r.status,
    r.exchangeOrderId,
    JSON.stringify(r.intent),
    JSON.stringify(r.riskDecision),
    r.createdAt,
    r.updatedAt
  ] as const
}
