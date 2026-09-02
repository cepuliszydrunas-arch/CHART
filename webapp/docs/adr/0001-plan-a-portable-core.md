# ADR-0001: Planas A — portuojamas `core/` sluoksnis, ne naujas terminalas

**Data:** 2026-09-02 · **Statusas:** Priimta

## Kontekstas

Dokumentas "Naujo prekybos terminalo kūrimas nuo nulio" (v1.0) lygino Planą A (atnaujinti
esamą Next.js platformą) su Planu B (nuo nulio). Rekomendacija — **A**. Vartotojo sprendimai:
(1) Planas A, (2) agreguotas orderflow kaip duomenų šaltinis, (3) vienas useris.

Šis repo kuriamas Cloudflare Pages/Workers aplinkoje, kuri **negali** paleisti esamos
platformos stack'o (Node `ws` relay, FastAPI, Postgres/TimescaleDB). Todėl čia NE kuriamas
terminalas — čia kuriami **moduliai esamai platformai**.

## Sprendimas

1. Visas verslo kodas gyvena `src/core/**` ir turi **nulį** runtime priklausomybių
   (nei Hono, nei Cloudflare, nei React, nei Node). Tik TypeScript + Web standard API.
2. Persistencija — per interfeisą `OrderStore`. Čia — D1 implementacija; esamoje
   platformoje — Postgres. Pipeline (`submitOrder`) nežino, kuris.
3. Auth — single-user bearer token, constant-time compare, fail-closed (be tokeno → 503).
   Ne Auth.js/Lucia: vienas useris, multi-user reikalavimo nėra (§F0 sprendimas).
4. Orderflow — **browser-direct** WS į biržas (Binance/Bybit/OKX viešieji stream'ai leidžia
   CORS). Relay sluoksnis (esamos platformos `server.mjs`) lieka esamoje platformoje —
   agregatorius veikia vienodai ir su relay, ir be jo, nes priima `NormalizedTrade`.
5. Vienas kanoninis kelias orderiui: `POST /api/orders` → `submitOrder()`. Jokių kitų
   route'ų, kurie rašo į `orders`.

## Pasekmės

- ✅ Uždaromas §11 punktas 4 ("mainnet OFF guard + risk limits — Kritinis") portuojamu kodu.
- ✅ `core/orderflow` gali pakeisti esamos platformos dvigubą CVD kelią (§2 "vienas CVD šaltinis").
- ⚠️ D1 store yra referencinis. Produkcinė persistencija — esamos platformos Postgres.
- ⚠️ In-memory rate limit Workers'uose nėra bendras tarp izoliatų — tikras rate limiting
  esamoje platformoje darosi relay/Node lygyje arba Cloudflare WAF.
- ❌ Šis repo NĖRA terminalas ir netaps juo. Charting, temos (31), signalų sluoksnis
  (deltaDivergence, swingLevels, FVG, RSI div) — lieka esamoje platformoje.

## Alternatyvos, kurios atmestos

- **Planas B pilnu stack'u čia** — neįmanoma (edge runtime).
- **Planas B adaptuotas Cloudflare'ui** — M3 CVD engine ir M5 agentai vis tiek išeitų už
  platformos ribų; dvigubas darbas.
- **Auth.js nuo 1 dienos** — overkill vienam useriui; attack surface didesnis nei bearer.
