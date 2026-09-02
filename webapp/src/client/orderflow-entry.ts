/**
 * Kliento bundle entry — tas pats core kodas, kurį naudoja testai.
 * Vite build'ina į public/static/orderflow.js (ES module).
 */
import { OrderflowAggregator, DedupRing } from '../core/orderflow/aggregator'
import { binanceFutures } from '../core/orderflow/adapters'
import { detectImbalances, detectAbsorption, detectExhaustion, detectAll } from '../core/orderflow/signals'

export { OrderflowAggregator, DedupRing } from '../core/orderflow/aggregator'
export { ADAPTERS, binanceFutures, bybitLinear, okxSwap } from '../core/orderflow/adapters'
export { detectImbalances, detectAbsorption, detectExhaustion, detectAll, detectDeltaDivergence } from '../core/orderflow/signals'
export { evaluate, DEFAULT_LIMITS, initialRiskState } from '../core/risk/engine'

/**
 * Terminal'ui (vanilla JS): core API eksponuojamas kaip window.OrderflowCore,
 * kad /static/terminal.js galėtų naudoti tą patį agregatorių ir signalus,
 * kuriuos testuoja vitest. Node/test aplinkoje window neegzistuoja — guard'as.
 */
export interface OrderflowCoreApi {
  OrderflowAggregator: typeof OrderflowAggregator
  DedupRing: typeof DedupRing
  detectImbalances: typeof detectImbalances
  detectAbsorption: typeof detectAbsorption
  detectExhaustion: typeof detectExhaustion
  detectAll: typeof detectAll
  binanceFutures: typeof binanceFutures
}

declare global {
  interface Window {
    OrderflowCore?: OrderflowCoreApi
  }
}

if (typeof window !== 'undefined') {
  const api: OrderflowCoreApi = {
    OrderflowAggregator,
    DedupRing,
    detectImbalances,
    detectAbsorption,
    detectExhaustion,
    detectAll,
    binanceFutures
  }
  window.OrderflowCore = api
}
