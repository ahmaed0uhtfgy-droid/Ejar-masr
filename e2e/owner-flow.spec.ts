import { expect, test, type Page } from '@playwright/test'
import { ar } from '../src/i18n/ar'
import { allowAdsWithoutImages, clearEmulators, uniqueEmail } from './support/emulator'
import { logOut, signUp } from './support/ui'

// The main journey of the product: an owner publishes a unit, a stranger finds it, signs up and asks for the contact details.
// Needs the Firebase emulators + `npm run build:e2e`. The payment step is covered by the API integration tests, not here.
test.skip(!!process.env.BASE_URL, 'creates data: only runs against the local emulators')
test.beforeEach(async () => { await clearEmulators(); await allowAdsWithoutImages() })

const TITLE = 'شقة مفروشة بالمعادي قريبة من المترو'

async function publish(page: Page, title = TITLE): Promise<string> {
  await page.goto('/dashboard/new')
  await page.getByLabel(ar.form.title).fill(title)
  await page.getByLabel(ar.form.type).selectOption({ index: 1 })
  await page.getByLabel(ar.form.price, { exact: false }).first().fill('4500')
  await page.getByLabel(ar.search.gov).selectOption({ index: 1 })
  await page.getByLabel(ar.search.area).selectOption({ index: 1 })
  await page.getByLabel(ar.form.phone, { exact: true }).fill('01012345678')
  await page.getByRole('button', { name: ar.form.publish }).click()
  await expect(page).toHaveURL(/\/unit\/[A-Za-z0-9]+$/)
  return new URL(page.url()).pathname
}

test.describe('@emulator owner publishes, visitor finds', () => {
  test('publishing validates required fields first', async ({ page }) => {
    await signUp(page, { email: uniqueEmail('owner-invalid') })
    await page.goto('/dashboard/new')
    await page.getByRole('button', { name: ar.form.publish }).click()
    await expect(page.getByText(ar.form.errTitle)).toBeVisible()
    await expect(page.getByText(ar.form.errType)).toBeVisible()
    await expect(page.getByText(ar.form.errPrice)).toBeVisible()
    await expect(page.getByText(ar.form.errGov)).toBeVisible()
    await expect(page.getByText(ar.form.errPhone).first()).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard\/new/)
  })

  test('an owner publishes a unit and it opens on its own page', async ({ page }) => {
    await signUp(page, { email: uniqueEmail('owner') })
    await publish(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(TITLE)
    await page.goto('/dashboard')
    await expect(page.getByText(TITLE)).toBeVisible()
  })

  test('a stranger can find the unit in search, but the phone number is NOT in the page', async ({ page, browser }) => {
    await signUp(page, { email: uniqueEmail('owner-find') })
    const path = await publish(page)
    await logOut(page)

    const visitor = await (await browser.newContext()).newPage()
    await visitor.goto('/search')
    await expect(visitor.getByText(TITLE)).toBeVisible()
    await visitor.goto(path)
    await expect(visitor.getByRole('heading', { level: 1 })).toContainText(TITLE)
    expect(await visitor.content()).not.toContain('01012345678') // contact details are only released by /api/reveal
    await expect(visitor.getByText(ar.unit.loginToReveal)).toBeVisible()
  })

  test('a signed-in visitor reveals the contact details (API mocked with the real response shape)', async ({ page, browser }) => {
    await signUp(page, { email: uniqueEmail('owner-reveal') })
    const path = await publish(page)
    await logOut(page)

    const visitor = await (await browser.newContext()).newPage()
    await visitor.route('**/api/reveal', (route) => route.fulfill({ json: { phone: '01012345678', whatsapp: '01012345678', remaining: 19 } }))
    await signUp(visitor, { email: uniqueEmail('visitor') })
    await visitor.goto(path)
    await visitor.getByRole('button', { name: ar.unit.reveal }).click()
    await expect(visitor.getByRole('link', { name: new RegExp(ar.unit.call) })).toHaveAttribute('href', 'tel:01012345678')
    await expect(visitor.getByText(ar.unit.remaining)).toBeVisible()
  })

  test('the daily-limit error from the server is shown to the user', async ({ page, browser }) => {
    await signUp(page, { email: uniqueEmail('owner-limit') })
    const path = await publish(page)
    await logOut(page)
    const visitor = await (await browser.newContext()).newPage()
    await visitor.route('**/api/reveal', (route) => route.fulfill({ status: 429, json: { error: 'limit', message: ar.unit.limitReached } }))
    await signUp(visitor, { email: uniqueEmail('visitor-limit') })
    await visitor.goto(path)
    await visitor.getByRole('button', { name: ar.unit.reveal }).click()
    await expect(visitor.getByText(ar.unit.limitReached)).toBeVisible()
  })

  test('comparison: the same button adds AND removes, the header shows a count, and "clear all" empties it', async ({ page, browser }) => {
    await signUp(page, { email: uniqueEmail('owner-compare') })
    await publish(page, 'شقة للمقارنة الأولى'); await publish(page, 'شقة للمقارنة الثانية')
    await logOut(page)
    const visitor = await (await browser.newContext()).newPage()
    await visitor.goto('/search')
    const add = visitor.getByRole('button', { name: ar.unit.compare, exact: true })
    await add.first().click(); await add.first().click() // the first card turned into a "remove" button, so .first() is now the second card
    await visitor.goto('/compare')
    await expect(visitor.getByText(ar.compare.count(2))).toBeVisible()
    await visitor.getByRole('button', { name: new RegExp(ar.compare.remove) }).first().click()
    await expect(visitor.getByText(ar.compare.count(1))).toBeVisible()
    await visitor.getByRole('button', { name: new RegExp(ar.compare.clear) }).click()
    await expect(visitor.getByText(ar.compare.empty)).toBeVisible()
  })

  test("another user cannot edit someone else's unit", async ({ page, browser }) => {
    await signUp(page, { email: uniqueEmail('owner-edit') })
    const path = await publish(page)
    const id = path.split('/').pop() as string
    const other = await (await browser.newContext()).newPage()
    await signUp(other, { email: uniqueEmail('intruder') })
    await other.goto(`/dashboard/units/${id}/edit`)
    await expect(other.getByText(ar.errors.permission)).toBeVisible()
  })
})
