import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { bearerAuth, clientIp, constantTimeEqual, rateLimit } from './auth'

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
  })
  it('returns true for two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true)
  })
  it('returns false for strings of same length with different content', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'xyz')).toBe(false)
  })
  it('returns false for strings of different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', 'a')).toBe(false)
    expect(constantTimeEqual('a', '')).toBe(false)
  })
  it('handles long strings', () => {
    const a = 'a'.repeat(32)
    const b = 'a'.repeat(31) + 'b'
    expect(constantTimeEqual(a, a)).toBe(true)
    expect(constantTimeEqual(a, b)).toBe(false)
  })
})

describe('bearerAuth', () => {
  const TOKEN = 'a'.repeat(32)

  function makeApp(getToken: (c: { env: { TOKEN?: string } }) => string | undefined) {
    const app = new Hono<{ Bindings: { TOKEN?: string } }>()
    app.use('/api/*', bearerAuth((c) => getToken(c)))
    app.get('/api/test', (c) => c.json({ ok: true }))
    return app
  }

  it('returns 503 when API_TOKEN is missing', async () => {
    const app = makeApp((c) => c.env.TOKEN)
    const res = await app.request('/api/test', { headers: { authorization: `Bearer ${TOKEN}` } }, {})
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error?: string; message?: string }
    expect(body.error).toBe('server_misconfigured')
  })

  it('returns 503 when API_TOKEN is too short (< 32 chars)', async () => {
    const app = makeApp(() => 'short')
    const res = await app.request('/api/test', { headers: { authorization: 'Bearer short' } })
    expect(res.status).toBe(503)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const app = makeApp(() => TOKEN)
    const res = await app.request('/api/test')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('unauthorized')
  })

  it('returns 401 when header is not Bearer scheme', async () => {
    const app = makeApp(() => TOKEN)
    const res = await app.request('/api/test', { headers: { authorization: `Basic ${TOKEN}` } })
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong token of same length', async () => {
    const app = makeApp(() => TOKEN)
    const wrong = 'b'.repeat(32)
    const res = await app.request('/api/test', { headers: { authorization: `Bearer ${wrong}` } })
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong token of different length', async () => {
    const app = makeApp(() => TOKEN)
    const res = await app.request('/api/test', { headers: { authorization: 'Bearer short' } })
    expect(res.status).toBe(401)
  })

  it('passes through with correct token', async () => {
    const app = makeApp(() => TOKEN)
    const res = await app.request('/api/test', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('clientIp', () => {
  it('prefers cf-connecting-ip', () => {
    const c = {
      req: {
        header: (n: string) => {
          if (n === 'cf-connecting-ip') return '1.2.3.4'
          if (n === 'x-forwarded-for') return '5.6.7.8'
          return undefined
        }
      }
    } as unknown as Parameters<typeof clientIp>[0]
    expect(clientIp(c)).toBe('1.2.3.4')
  })

  it('falls back to first x-forwarded-for entry', () => {
    const c = {
      req: {
        header: (n: string) => (n === 'x-forwarded-for' ? '1.1.1.1, 2.2.2.2' : undefined)
      }
    } as unknown as Parameters<typeof clientIp>[0]
    expect(clientIp(c)).toBe('1.1.1.1')
  })

  it('returns "unknown" when no header is present', () => {
    const c = { req: { header: () => undefined } } as unknown as Parameters<typeof clientIp>[0]
    expect(clientIp(c)).toBe('unknown')
  })
})

describe('rateLimit', () => {
  function makeApp(capacity: number, refillPerSec: number) {
    const app = new Hono<{ Bindings: Record<string, never> }>()
    app.use('/api/*', rateLimit({ capacity, refillPerSec }))
    app.get('/api/test', (c) => c.json({ ok: true }))
    return app
  }

  it('allows up to capacity requests then blocks', async () => {
    const app = makeApp(2, 0.0001)
    const r1 = await app.request('/api/test')
    const r2 = await app.request('/api/test')
    const r3 = await app.request('/api/test')
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 429])
    const body = (await r3.json()) as { error?: string }
    expect(body.error).toBe('rate_limited')
  })

  it('returns 429 with rate_limited error body', async () => {
    const app = makeApp(1, 0.0001)
    await app.request('/api/test')
    const res = await app.request('/api/test')
    expect(res.status).toBe(429)
  })
})
