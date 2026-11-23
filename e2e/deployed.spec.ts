import { expect, test } from '@playwright/test'

// Checks that need the real Cloudflare deployment (Pages Functions + headers). Skipped on a local `vite preview`.
// Run:  BASE_URL=https://your-site.pages.dev npx playwright test --grep @deployed
test.skip(!process.env.BASE_URL, 'needs BASE_URL pointing at a deployment')

const API_POST = ['reveal', 'lease-request', 'lease-respond', 'pay-create', 'deposit-action', 'refund-record', 'sign-upload', 'admin-delete-user', 'sweep']

test.describe('@deployed API access control', () => {
  for (const name of API_POST) {
    test(`POST /api/${name} refuses anonymous callers`, async ({ request }) => {
      const res = await request.post(`/api/${name}`, { data: { unitId: 'x', leaseId: 'x', paymentId: 'x', uid: 'x' } })
      expect(res.status()).toBe(401)
    })
    test(`POST /api/${name} refuses a forged token`, async ({ request }) => {
      const res = await request.post(`/api/${name}`, { data: {}, headers: { Authorization: 'Bearer forged.token.value' } })
      expect([401, 403]).toContain(res.status())
    })
  }

  test('the payment webhook rejects an unsigned callback', async ({ request }) => {
    const res = await request.post('/api/pay-webhook', { data: { type: 'TRANSACTION', obj: { id: 1, success: true, amount_cents: 100, order: { id: 1 } } } })
    expect(res.status()).toBe(401)
  })

  test('the payment webhook rejects a callback signed with a guessed secret', async ({ request }) => {
    const res = await request.post('/api/pay-webhook?hmac=' + '0'.repeat(128), { data: { type: 'TRANSACTION', obj: { id: 1, success: true, amount_cents: 100, order: { id: 1 } } } })
    expect(res.status()).toBe(401)
  })

  test('/api/health does not leak any secret value', async ({ request }) => {
    const res = await request.get('/api/health')
    const text = await res.text()
    expect(res.status()).toBeLessThan(500)
    expect(text).not.toMatch(/sk_(live|test)|BEGIN PRIVATE KEY|re_[A-Za-z0-9]{10,}|"private_key"/)
  })
})

test.describe('@deployed security headers', () => {
  for (const path of ['/', '/search', '/api/health', '/sitemap.xml']) {
    test(`${path} sends the baseline security headers`, async ({ request }) => {
      const h = (await request.get(path)).headers()
      expect(h['x-content-type-options']).toBe('nosniff')
      expect(h['x-frame-options']).toBe('DENY')
      expect(h['referrer-policy']).toBeTruthy()
      expect(h['strict-transport-security']).toContain('max-age=')
    })
  }
  test('the home page is served over HTTPS and never sets a COOP header that would break Google sign-in', async ({ request }) => {
    const res = await request.get('/')
    expect(res.url().startsWith('https://')).toBe(true)
    expect(res.headers()['cross-origin-opener-policy']).not.toBe('same-origin')
  })
})

test.describe('@deployed injection probes (nothing may be reflected unescaped)', () => {
  const probes = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "';alert(1);//"]
  for (const probe of probes) {
    test(`reserved paths do not reflect ${probe}`, async ({ request }) => {
      for (const path of [`/unit/${encodeURIComponent(probe)}`, `/rent/${encodeURIComponent(probe)}`, `/search?gov=${encodeURIComponent(probe)}`]) {
        const body = await (await request.get(path)).text()
        expect(body, path).not.toContain(probe)
      }
    })
  }
})

test.describe('@deployed crawling files', () => {
  test('robots.txt points to the sitemap and blocks private areas', async ({ request }) => {
    const t = await (await request.get('/robots.txt')).text()
    expect(t).toMatch(/Sitemap:\s*https:\/\//i)
    expect(t).toMatch(/Disallow:\s*\/(admin|dashboard|api)/)
  })
  test('sitemap.xml is valid XML with unique URLs', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.headers()['content-type']).toContain('xml')
    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBeGreaterThan(5)
    expect(new Set(locs).size).toBe(locs.length)
  })
  test('the home page has one canonical link and structured data', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel=canonical]')).toHaveCount(1)
    expect(await page.locator('script[type="application/ld+json"]').count()).toBeGreaterThan(0)
  })
})
