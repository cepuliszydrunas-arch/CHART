# webapp — Risk & Orderflow core (Planas A moduliai)

## Project Overview
- **Name**: webapp
- **Goal**: Portuojami, runtime-nepriklausomi moduliai esamai Next.js prekybos platformai (Planas A). Uždaro dokumento §11 punktą 4: **mainnet OFF guard + risk limits — Kritinis**, ir §2 "vienas CVD šaltinis" per agreguotą orderflow.
- **Sprendimai (2026-09-02)**: Planas A · agreguotas orderflow · vienas useris. Žr. `docs/adr/0001-plan-a-portable-core.md`.
- **Tai NĖRA terminalas.** Charting, temos, esamas signalų sluoksnis lieka esamoje platformoje. Šis repo — referencinė implementacija + testai, kuriuos kopijuojate (`docs/INTEGRATION.md`).

## URLs
- **Sandbox dashboard**: https://3000-igi797fu78wxtysqykvnj-5634da27.sandbox.novita.ai (token — `.dev.vars` `API_TOKEN`)
- **Production**: neišdeployinta (nusprendžiama: ar deployinti referenciją, ar tik portuoti)

## Kas padaryta ✅

| Modulis | Failai | Testai |
|---|---|---|
| **Risk limits engine** | `src/core/risk/engine.ts` | 32 |
| — 9 tikrinimai fiksuota tvarka: DISABLED → MAINNET → SYMBOL → QTY/PRICE → ORDER_NOTIONAL → POSITION → TOTAL_NOTIONAL → DAILY_LOSS → RATE_LIMIT | | |
| — fail-closed (tuščias allowlist = viskas draudžiama), warnings ≥ 80 %, pozicijos mažinimas visada leidžiamas | | |
| — `mainnetGuard`: **du** env flag'ai + saugūs limitai; `killSwitch` idempotentiškas; `reEnable` — vienintelis kelias atgal; auto-disable po N failure'ų | | |
| — `recordFill`: svertinis avg entry, partial close PnL, flip | | |
| **Order pipeline** | `src/core/orders/pipeline.ts` | 14 |
| — vienas kanoninis kelias: validate → idempotency → risk → persist → adapter → persist → audit | | |
| — `clientOrderId` = PK; duplikatas grąžina pirmą rezultatą, **nesiunčia** antrą kartą; race per `createIfAbsent` | | |
| — serveris perrašo kliento `ts`; adapter throw → `exchange_rejected`, ne crash | | |
| **Orderflow agregatorius** | `src/core/orderflow/aggregator.ts` | 21 |
| — multi-venue → vienas footprint + CVD; per-venue CVD ir svoriai; `DedupRing` O(1) LIFO | | |
| — lazy dirty-flag snapshot (500 trade = 1 derivation); deep copy; retention; gap fill; `incomplete` po reconnect; vėluojantys trade'ai į senus bar'us su CVD chain recompute | | |
| **Venue adapteriai** | `src/core/orderflow/adapters.ts` | 14 |
| — Binance USD-M `aggTrade`, Bybit v5 `publicTrade`, OKX v5 `trades`; testai su tikrais payload'ais; **aggressor mapinimas** (Binance `m=true` → sell) padengtas | | |
| **Signalai** | `src/core/orderflow/signals.ts` | 17 |
| — diagonal imbalance (stacked), absorption, exhaustion, delta divergence — pure funkcijos | | |
| **Hono API + D1** | `src/index.tsx`, `src/api/*`, `migrations/` | smoke curl |
| **Dizaino tokenai** | `public/static/tokens.css` | — |
| — RGB triplets, 11px bazė, tabular-nums, 6 status tonai su forma, z-index ladder, `prefers-reduced-motion`, focus-visible, vienas `.btn` | | |
| **Dashboard** | `src/ui/dashboard.tsx`, `public/static/app.js` | Playwright flow |
| — risk state + meter'iai, kill-switch, limits editor, order ticket su precheck + 2-step confirm (15 s), browser-direct 3-venue feed su rAF gating, footprint + signalai, orders/audit | | |

**96 testai · 99.5 % statements · 96.4 % branches** (`npm run test:coverage`). CI vartai: 90/90/85/90.

## API (visi `/api/*` — `Authorization: Bearer <API_TOKEN>`)

| Method | Path | Aprašymas |
|---|---|---|
| GET | `/health` | be auth; D1 ping |
| GET | `/api/risk` | state + limits + mainnet flag'ai |
| PUT | `/api/risk/limits` | keisti limitus (audit `risk.limits_changed`) |
| POST | `/api/risk/check` | dry-run `evaluate()` — UI precheck |
| POST | `/api/risk/kill` | `{reason}` → kill-switch |
| POST | `/api/risk/enable` | rankinis re-enable |
| POST | `/api/orders` | **vienintelis** order kelias → 201 filled/sent · 200 duplicate · 422 risk_rejected · 400 invalid |
| GET | `/api/orders?limit=` | paskutiniai orderiai |
| GET | `/api/audit?limit=` | audit log (append-only) |

## Data Architecture
- **Storage**: Cloudflare D1 (referencija). Lentelės: `orders` (PK = client_order_id), `audit_log` (append-only), `risk_state` (1 eilutė), `risk_limits` (1 eilutė).
- **Interfeisas**: `OrderStore` — D1 čia, Postgres esamoje platformoje (`docs/INTEGRATION.md` §3).
- **Orderflow**: browser-direct WS → `ADAPTERS[venue].parse` → `OrderflowAggregator.ingest` → rAF → render. Nėra serverio relay (Workers negali); esamoje platformoje relay lieka, agregatorius tas pats.

## Dar nepadaryta ❌
- Testnet/mainnet `ExecutionAdapter` (Bybit/Binance su raktais iš vault) — atskiras PR; čia tik `PaperAdapter`.
- Postgres `OrderStore` — rašoma esamoje platformoje pagal interfeisą.
- Tikras rate limiting (in-memory nėra bendras tarp Workers izoliatų).
- Playwright E2E kaip CI žingsnis (dabar — rankinis `/tmp/ui-test.mjs` flow).
- Deploy į Cloudflare (nusprendžiama, žr. "Next steps").

## Next steps
1. **Portuoti `core/` į esamą platformą** pagal `docs/INTEGRATION.md` (1–2 d). Pirma — risk + pipeline (uždaro Kritinį punktą), tada orderflow.
2. `ALLOW_MAINNET=false` Railway env **šiandien** — dar prieš portavimą.
3. Postgres `OrderStore` + `ExecutionAdapter` aplink esamą Bybit klientą (`orderLinkId = clientOrderId`).
4. Pakeisti esamą dvigubą CVD kelią `OrderflowAggregator` (§2).
5. Tokenai: `prefers-reduced-motion`, z-ladder + lint rule, status formos → `globals.css`.

## Lokalus paleidimas
```bash
cp .dev.vars.example .dev.vars && sed -i "s/^API_TOKEN=.*/API_TOKEN=$(openssl rand -hex 32)/" .dev.vars
npm run db:migrate:local && npm run build
pm2 start ecosystem.config.cjs      # http://localhost:3000
npm test                            # 96 testų
```
Dashboard'e įveskite `API_TOKEN` į "Token" lauką (sessionStorage — dingsta užvėrus tab'ą). "Connect" — jungiasi tiesiai į Binance/Bybit/OKX viešuosius stream'us.

## Deployment
- **Platform**: Cloudflare Pages + D1 (referencija) · **Status**: sandbox only
- **Tech**: Hono 4 · TypeScript 5 strict · Vitest 3 · D1 · vanilla ES module client (portuojama į React hook'us)
- **Last updated**: 2026-09-02
