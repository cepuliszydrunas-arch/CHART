# Integracija į esamą Next.js platformą (Planas A)

Visi žingsniai — kopijavimas failų + vienas adapteris. Jokių pakeitimų `core/` viduje.

## 1. Kopijuoti `core/`

```bash
cp -r src/core/ <platforma>/packages/core/src/     # arba apps/web/src/core
```

`core/` importuoja tik save. Testai (`*.test.ts`) — colocated, Vitest jau yra platformoje.
Pridėti į `vitest.config.ts` coverage thresholds iš šio repo (90/90/85/90).

## 2. Risk limits + mainnet guard (§11 punktas 4)

**Serveris** — vienas order route'as. Pakeisti esamus order endpointus:

```ts
// apps/web/src/app/api/orders/route.ts
import { submitOrder } from '@/core/orders/pipeline'
import { PgOrderStore } from '@/server/pg-order-store'   // žr. 3.
import { bybitAdapter } from '@/server/exchange/bybit'   // esamas adapteris → ExecutionAdapter

export async function POST(req: Request) {
  const session = await requireOwner(req)                 // esamas/naujas auth
  const result = await submitOrder(await req.json(), {
    store: pgStore,
    adapter: bybitAdapter,
    limits: await pgStore.getLimits() ?? DEFAULT_LIMITS,
    env: { ALLOW_MAINNET: process.env.ALLOW_MAINNET, RISK_LIMITS_CONFIRMED: process.env.RISK_LIMITS_CONFIRMED },
    actor: session.userId,
    ip: req.headers.get('x-forwarded-for') ?? 'unknown'
  })
  return Response.json(result, { status: statusFor(result) })
}
```

**Esamas `ExecutionAdapter`:** apvyniokite esamą biržos klientą:

```ts
export const bybitAdapter: ExecutionAdapter = {
  async place(intent) {
    const r = await bybitClient.submitOrder({ symbol: intent.symbol, side: intent.side, qty: intent.qty, orderLinkId: intent.clientOrderId })
    return r.retCode === 0 ? { ok: true, exchangeOrderId: r.result.orderId } : { ok: false, reason: r.retMsg }
  }
}
```

`orderLinkId = clientOrderId` — birža irgi dedup'ina; dviguba apsauga.

**Env (Railway):** `ALLOW_MAINNET=false` kol nepraeitas staged rollout. Mainnet reikalauja
`ALLOW_MAINNET=true` **ir** `RISK_LIMITS_CONFIRMED=true` **ir** ne-tuščio `allowedSymbols`.

**Kill-switch:** `POST /api/risk/kill` → `killSwitch(state, now, reason)` → persist.
Vienintelis kelias atgal — `reEnable()`, rankinis. Naujos dienos roll **ne** re-enable'ina.

## 3. Postgres `OrderStore`

Interfeisas — `core/orders/types.ts#OrderStore`. `createIfAbsent` privalo būti atominis:

```sql
INSERT INTO orders (...) VALUES (...) ON CONFLICT (client_order_id) DO NOTHING RETURNING 1;
-- rowCount === 1 → true
```

Schema — `migrations/0001_orders_audit_risk.sql` (SQLite dialektas; Postgres: `INTEGER
PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL`, `REAL` → `NUMERIC`). Drizzle/Prisma — jūsų pasirinkimas
(§3 "ORM/migracijų frameworkas"). `audit_log` — append-only, be UPDATE/DELETE teisių app userui.

## 4. Agreguotas orderflow

**Vienas CVD šaltinis** (§2). `OrderflowAggregator` pakeičia esamą FootprintStore + CVD proxy dubliavimą:

```ts
// hooks/useOrderflowFeed.ts
const agg = useRef(new OrderflowAggregator({ symbol, timeframeMs, tickSize, retention: 240, dedupWindow: 20_000 }))

// Variantas A — per esamą relay (server.mjs). Relay siunčia NormalizedTrade[]:
ws.onmessage = (e) => { agg.current.ingestMany(JSON.parse(e.data)); schedule() }
//   → relay pusėje: ADAPTERS[venue].parse(raw, symbol) ir forward.

// Variantas B — browser-direct (kaip šiame repo public/static/app.js).

// rAF gating — N trade'ų = 1 setState
const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; setSnap(agg.current.snapshot()) }) }
```

Reconnect → `agg.markGap(venue)`: dabartinis bar'as `incomplete: true`, dedup ringas venue'ui
išvalomas (replay po reconnect priimamas).

**Venue svoriai:** `venueWeights: { binance: 1, bybit: 0.7, okx: 0.5 }` — CVD'ui, ne footprint volume.

**Signalai:** `detectAll(bar)` ant `snapshot().bars.at(-1)`; `detectDeltaDivergence(bars)` —
pakeičia esamą `deltaDivergence`, jei norite vieno swing algoritmo (§M3).

## 5. Dizaino tokenai

`public/static/tokens.css` → `apps/web/src/app/globals.css`. Naujos dalys, kurių esama neturi (§4.7–4.8):
- `@media (prefers-reduced-motion: reduce)`
- `:focus-visible`
- `--z-*` ladder (tada ESLint rule: `no-restricted-syntax` prieš `z-\[\d+\]`)
- status tonai su **forma** (`.status--*::before`), ne tik spalva

Tailwind: `colors: { base: 'rgb(var(--color-base) / <alpha-value>)', ... }`.

## 6. Order ticket UI (2-step confirm)

Referencija — `public/static/app.js` sekcija "Order ticket". Portuoti į `<OrderTicket/>`:
1. `input` → debounce 250 ms → `POST /api/risk/check` (dry-run) → rodyti rejection/warnings PRIEŠ submit.
2. Submit → confirm panelė su 15 s timeout'u, `mainnet` → raudonas "REAL MONEY".
3. Confirm → `POST /api/orders` su `crypto.randomUUID()` kaip `clientOrderId`.

## Staged rollout (§6 "Mainnet guard")

| Etapas | `ALLOW_MAINNET` | `RISK_LIMITS_CONFIRMED` | `maxOrderNotionalUsd` | Trukmė |
|---|---|---|---|---|
| Paper | false | false | — | iki UI stabilus |
| Testnet | false | false | — | ≥ 1 sav. |
| Mainnet minimalus | true | true | 50 | ≥ 1 sav., 0 incidentų |
| Mainnet limitai | true | true | realūs | — |
