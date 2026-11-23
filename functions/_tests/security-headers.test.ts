// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CSP, SECURITY_HEADERS, THEME_SCRIPT_HASH, withSecurityHeaders } from '../_lib/securityHeaders'
import { onRequest } from '../_middleware'

describe('security headers', () => {
  it('are added to JSON and HTML responses', async () => {
    for (const ct of ['application/json', 'text/html; charset=utf-8']) {
      const r = withSecurityHeaders(new Response('x', { headers: { 'Content-Type': ct } }))
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k)).toBe(v)
    }
  })
  it('the CSP is only attached to HTML', () => {
    expect(withSecurityHeaders(new Response('x', { headers: { 'Content-Type': 'text/html' } })).headers.get('Content-Security-Policy-Report-Only')).toBe(CSP)
    expect(withSecurityHeaders(new Response('{}', { headers: { 'Content-Type': 'application/json' } })).headers.has('Content-Security-Policy-Report-Only')).toBe(false)
  })
  it('never overwrites a header a handler set deliberately, and keeps status and body', async () => {
    const r = withSecurityHeaders(new Response('hello', { status: 404, headers: { 'X-Frame-Options': 'SAMEORIGIN' } }))
    expect([r.status, r.headers.get('X-Frame-Options'), await r.text()]).toEqual([404, 'SAMEORIGIN', 'hello'])
  })
  it('the middleware wraps whatever the route returns', async () => {
    const r = await onRequest({ next: async () => new Response('{}', { status: 201 }) } as unknown as Parameters<typeof onRequest>[0])
    expect([r.status, r.headers.get('X-Content-Type-Options')]).toEqual([201, 'nosniff'])
  })
  it('does not set COOP same-origin (it would break the Google sign-in popup)', () => {
    expect(Object.keys(SECURITY_HEADERS)).not.toContain('Cross-Origin-Opener-Policy')
  })
  it('the CSP forbids plugins, framing and base-tag injection, and allows no wildcard scripts', () => {
    expect(CSP).toContain("object-src 'none'"); expect(CSP).toContain("frame-ancestors 'none'"); expect(CSP).toContain("base-uri 'self'")
    const script = CSP.split('; ').find((d) => d.startsWith('script-src')) as string
    expect(script).not.toContain('unsafe-inline'); expect(script).not.toContain('unsafe-eval'); expect(script).not.toMatch(/\s\*(\s|$)/)
  })
})

describe('consistency with the rest of the project', () => {
  it('public/_headers (static files) carries exactly the same values as the Functions middleware', () => {
    const file = readFileSync('public/_headers', 'utf8')
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(file).toContain(`${k}: ${v}`)
    expect(file).toContain(`Content-Security-Policy-Report-Only: ${CSP}`)
  })
  it("the CSP hash matches the inline theme script in index.html (otherwise the script would be blocked once the CSP is enforced)", () => {
    const html = readFileSync('index.html', 'utf8')
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(inline).toHaveLength(1)
    expect(`'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`).toBe(THEME_SCRIPT_HASH)
  })
})
