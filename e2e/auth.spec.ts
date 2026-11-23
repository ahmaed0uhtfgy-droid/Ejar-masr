import { expect, test } from '@playwright/test'
import { ar } from '../src/i18n/ar'
import { clearEmulators, uniqueEmail } from './support/emulator'
import { PASSWORD, logIn, logOut, openMenuIfCollapsed, signUp } from './support/ui'

// Needs the Firebase emulators + a build made with `npm run build:e2e`. Run with: npm run test:e2e:emulators
test.skip(!!process.env.BASE_URL, 'account tests create users: they only run against the local emulators, never a real site')
test.beforeEach(clearEmulators)

test.describe('@emulator accounts', () => {
  test('sign up, see the account menu, log out, log back in', async ({ page }) => {
    const email = uniqueEmail('signup')
    await signUp(page, { email, name: 'سارة أحمد' })
    await openMenuIfCollapsed(page)
    await expect(page.getByRole('button', { name: ar.nav.logout }).first()).toBeVisible()
    await expect(page.getByText('سارة أحمد').first()).toBeVisible()

    await logOut(page)
    await openMenuIfCollapsed(page)
    await expect(page.getByRole('link', { name: ar.nav.login }).first()).toBeVisible()

    await logIn(page, email)
    await expect(page).not.toHaveURL(/\/login/)
    await openMenuIfCollapsed(page)
    await expect(page.getByRole('button', { name: ar.nav.logout }).first()).toBeVisible()
  })

  test('the session survives a page reload', async ({ page }) => {
    await signUp(page, { email: uniqueEmail('reload') })
    await page.reload()
    await openMenuIfCollapsed(page)
    await expect(page.getByRole('button', { name: ar.nav.logout }).first()).toBeVisible()
  })

  test('a wrong password shows a clear error and does not log in', async ({ page }) => {
    const email = uniqueEmail('wrongpw')
    await signUp(page, { email }); await logOut(page)
    await logIn(page, email, 'definitely-wrong')
    await expect(page.getByText(ar.auth.errInvalid)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('an unknown email gets the same error as a wrong password (no account enumeration)', async ({ page }) => {
    await logIn(page, uniqueEmail('nobody'), PASSWORD)
    await expect(page.getByText(ar.auth.errInvalid)).toBeVisible()
  })

  test('signing up twice with the same email is refused', async ({ page, context }) => {
    const email = uniqueEmail('dup')
    await signUp(page, { email }); await logOut(page)
    await context.clearCookies()
    await page.goto('/login')
    await page.getByRole('button', { name: ar.auth.signupTitle, exact: true }).last().click()
    await page.getByLabel(ar.auth.name).fill('تكرار')
    await page.getByLabel(ar.auth.email).fill(email)
    await page.getByLabel(ar.auth.password).fill(PASSWORD)
    await page.getByRole('button', { name: ar.auth.signup, exact: true }).click()
    await expect(page.getByText(ar.auth.errExists)).toBeVisible()
  })

  test('after logging out, private pages are closed again', async ({ page }) => {
    await signUp(page, { email: uniqueEmail('closed') })
    await page.goto('/dashboard'); await expect(page).toHaveURL(/\/dashboard/)
    await logOut(page)
    await page.goto('/dashboard'); await expect(page).toHaveURL(/\/login/)
  })

  test('a visitor who was sent to login lands back on the page they wanted', async ({ page }) => {
    const email = uniqueEmail('redirect')
    await signUp(page, { email }); await logOut(page)
    await page.goto('/dashboard/new'); await expect(page).toHaveURL(/\/login/)
    await logIn(page, email)
    await expect(page).toHaveURL(/\/dashboard\/new/)
  })
})
