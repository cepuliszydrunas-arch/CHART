/**
 * Risk limits engine — tipai.
 *
 * KODĖL atskiras failas: tipai importuojami ir iš serverio (Hono/Next API route),
 * ir iš kliento (order ticket UI rodo, kuris limitas suveiks PRIEŠ siunčiant).
 * Jokių runtime priklausomybių — portuojama bet kur.
 */

export type Side = 'buy' | 'sell'

export type ExecutionMode = 'paper' | 'testnet' | 'mainnet'

export interface OrderIntent {
  /** Kliento generuotas idempotency raktas (UUID). Privalomas. */
  clientOrderId: string
  symbol: string
  side: Side
  /** Kiekis bazine valiuta (pvz. BTC). Visada > 0. */
  qty: number
  /** Kaina USD. Market orderiui — paskutinė žinoma kaina (mark/last). */
  price: number
  mode: ExecutionMode
  /** Unix ms. Injektuojamas iš išorės — testuojamumui. */
  ts: number
}

export interface RiskLimits {
  /** Maks. vieno orderio notional USD (qty * price). */
  maxOrderNotionalUsd: number
  /** Maks. absoliuti pozicija bazine valiuta per simbolį. */
  maxPositionSize: number
  /** Maks. bendra atvira notional per visus simbolius, USD. */
  maxTotalNotionalUsd: number
  /** Dienos nuostolio riba USD (teigiamas skaičius; -500 realizuota => viršyta jei limit 500). */
  dailyLossLimitUsd: number
  /** Po N iš eilės nesėkmingų orderių — auto-disable. */
  maxConsecutiveFailures: number
  /** Maks. orderių per slankų langą (rate limit). */
  maxOrdersPerWindow: number
  /** Lango ilgis ms. */
  orderWindowMs: number
  /** Leidžiami simboliai. Tuščias masyvas = draudžiama viskas (fail-closed). */
  allowedSymbols: string[]
}

export interface PositionSnapshot {
  symbol: string
  /** Signed: + long, - short. */
  qty: number
  avgEntryPrice: number
}

export interface RiskState {
  /** UTC dienos raktas 'YYYY-MM-DD' — realizuoto PnL resetui. */
  dayKey: string
  realizedPnlUsdToday: number
  consecutiveFailures: number
  /** Ar sistema išjungta (auto-disable ARBA kill-switch). */
  disabled: boolean
  disabledReason: string | null
  disabledAt: number | null
  /** Sėkmingai priimtų orderių timestamp'ai slankiam langui. */
  recentOrderTs: number[]
  positions: PositionSnapshot[]
}

export type RiskRejectCode =
  | 'DISABLED'
  | 'MAINNET_NOT_ALLOWED'
  | 'SYMBOL_NOT_ALLOWED'
  | 'INVALID_QTY'
  | 'INVALID_PRICE'
  | 'ORDER_NOTIONAL'
  | 'POSITION_SIZE'
  | 'TOTAL_NOTIONAL'
  | 'DAILY_LOSS'
  | 'RATE_LIMIT'

export interface RiskRejection {
  code: RiskRejectCode
  /** Žmogui skaitomas paaiškinimas — rodomas UI, rašomas į auditą. */
  message: string
  /** Kuri riba ir kokia reikšmė — UI gali rodyti progress bar. */
  limit?: number
  actual?: number
}

export type RiskDecision =
  | { ok: true; warnings: RiskWarning[] }
  | { ok: false; rejection: RiskRejection; warnings: RiskWarning[] }

export interface RiskWarning {
  code: 'NEAR_DAILY_LOSS' | 'NEAR_TOTAL_NOTIONAL' | 'NEAR_POSITION_SIZE'
  message: string
  /** 0..1 — kiek limito išnaudota. */
  utilization: number
}

export interface MainnetGuardEnv {
  /** Turi būti tiksliai 'true' (string) — env var'ai visada string. */
  ALLOW_MAINNET?: string
  /** Papildomas sargas: aiškus patvirtinimas, kad limitai sukonfigūruoti. */
  RISK_LIMITS_CONFIRMED?: string
}
