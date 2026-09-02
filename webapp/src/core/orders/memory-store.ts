/**
 * In-memory OrderStore — testams ir lokaliam dev be DB.
 * NE produkcijai: Workers izoliatai neturi bendros atminties tarp request'ų.
 */
import type { RiskState } from '../risk/types'
import type { AuditEntry, OrderRecord, OrderStore } from './types'

export class MemoryOrderStore implements OrderStore {
  private orders = new Map<string, OrderRecord>()
  private audit: AuditEntry[] = []
  private riskState: RiskState | null = null

  async getOrder(id: string): Promise<OrderRecord | null> {
    return this.orders.get(id) ?? null
  }
  async putOrder(r: OrderRecord): Promise<void> {
    this.orders.set(r.clientOrderId, r)
  }
  async createIfAbsent(r: OrderRecord): Promise<boolean> {
    if (this.orders.has(r.clientOrderId)) return false
    this.orders.set(r.clientOrderId, r)
    return true
  }
  async appendAudit(e: AuditEntry): Promise<void> {
    this.audit.push(e)
  }
  async listAudit(limit: number): Promise<AuditEntry[]> {
    return this.audit.slice(-limit).reverse()
  }
  async getRiskState(): Promise<RiskState | null> {
    return this.riskState
  }
  async putRiskState(s: RiskState): Promise<void> {
    this.riskState = s
  }

  /** Testams. */
  allAudit(): readonly AuditEntry[] {
    return this.audit
  }
}

/** Paper adapteris — fill'ina iš karto intent kaina (+ pasirinktinis slippage bps). */
export class PaperAdapter {
  constructor(private slippageBps = 0) {}
  async place(intent: { clientOrderId: string; side: 'buy' | 'sell'; qty: number; price: number }) {
    const slip = intent.price * (this.slippageBps / 10_000) * (intent.side === 'buy' ? 1 : -1)
    return {
      ok: true as const,
      exchangeOrderId: `paper-${intent.clientOrderId}`,
      fill: { qty: intent.qty, price: intent.price + slip }
    }
  }
}
