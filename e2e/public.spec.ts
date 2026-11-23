import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { ar } from '../src/i18n/ar'

// Read-only checks: safe to run against the live site (BASE_URL=https://...). Tagged @public.

test.describe('@public home and navigation', () => {
  test('home page renders in Arabic, right-to-left, with the hero and a search form', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', /ar/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.home.heroTitle)
    await expect(page.getByRole('button', { name: ar.home.searchBtn })).toBeVisible()
    await expect(page).toHaveTitle(/إيجار/)
  })

  test('the search page opens from the home page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: ar.home.searchBtn }).click()
    await expect(page).toHaveURL(/\/search/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.search.title)
  })

  test('static pages exist and have a heading', async ({ page }) => {
    for (const p of ['about', 'terms', 'privacy', 'safety', 'contact', 'payments-policy']) {
      const res = await page.goto(`/${p}`)
      expect(res?.status(), p).toBeLessThan(400)
      await expect(page.getByRole('heading', { level: 1 }), p).toBeVisible()
    }
  })

  test('an unknown address shows the 404 page, not a blank screen', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-xyz')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.notFound.title)
  })

  test('private pages send a visitor to the login page', async ({ page }) => {
    for (const p of ['dashboard', 'dashboard/new', 'rentals', 'account', 'admin']) {
      await page.goto(`/${p}`)
      await expect(page, p).toHaveURL(/\/login/)
    }
  })

  test('the login form validates before sending anything', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(ar.auth.email).fill('not-an-email')
    await page.getByLabel(ar.auth.password).fill('123')
    await page.getByRole('button', { name: ar.auth.login, exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('@public quality', () => {
  test('no horizontal scrolling on the home page (important on phones)', async ({ page }) => {
    await page.goto('/')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('the page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await page.goto('/search')
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })

  test('accessibility: no serious or critical axe violations on the main pages', async ({ page }) => {
    for (const p of ['/', '/search', '/login']) {
      await page.goto(p)
      await page.waitForLoadState('networkidle')
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${p}: ${v.id} (${v.nodes.length})`)).toEqual([])
    }
  })
})
