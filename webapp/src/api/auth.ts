/**
 * Auth — single-user bearer token.
 *
 * KODĖL ne pilnas Auth.js/Lucia: vienas useris (jūsų sprendimas). Vienas ilgas
 * random token secret'e (`API_TOKEN`) + constant-time palyginimas yra
 * pakankama ir 10× mažiau attack surface nei session sistema.
 * Kai atsiras multi-user — šis middleware keičiamas, route'ai — ne.
 *
 * Fail-closed: jei API_TOKEN nesukonfigūruotas → VISKAS 503, ne "leidžiam".
 */
import type { Context, MiddlewareHandler } from 'hono'

export interface AuthEnv {
  API_TOKEN?: string
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  // Lyginam fiksuoto ilgio — ilgio skirtumas irgi neturi nutekėti per timing
  const len = Math.max(ab.length, bb.length)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export function bearerAuth(getToken: (c: Context) => string | undefined): MiddlewareHandler {
  return async (c, next) => {
    const expected = getToken(c)
    if (!expected || expected.length < 32) {
      return c.json({ error: 'server_misconfigured', message: 'API_TOKEN not set or too short (min 32 chars)' }, 503)
    }
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token || !constantTimeEqual(token, expected)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  }
}

/**
 * Paprastas in-memory token bucket per IP. Workers izoliatuose atmintis
 * nėra bendra — tai tik "pirma linija" prieš accidental loops; tikras rate
 * limiting — Cloudflare WAF rules arba D1-backed counter.
 */
export function rateLimit(opts: { capacity: number; refillPerSec: number }): MiddlewareHandler {
  const buckets = new Map<string, { tokens: number; ts: number }>()
  return async (c, next) => {
    const ip = clientIp(c)
    const now = Date.now()
    const b = buckets.get(ip) ?? { tokens: opts.capacity, ts: now }
    b.tokens = Math.min(opts.capacity, b.tokens + ((now - b.ts) / 1000) * opts.refillPerSec)
    b.ts = now
    if (b.tokens < 1) {
      buckets.set(ip, b)
      return c.json({ error: 'rate_limited' }, 429)
    }
    b.tokens -= 1
    buckets.set(ip, b)
    if (buckets.size > 10_000) buckets.clear() // memory guard
    await next()
  }
}

export { constantTimeEqual }
