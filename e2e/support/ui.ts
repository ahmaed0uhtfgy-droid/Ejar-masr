import { expect, type Page } from '@playwright/test'
import { ar } from '../../src/i18n/ar'

export const PASSWORD = 'Passw0rd!test'

export async function signUp(page: Page, o: { email: string; name?: string; type?: 'owner' | 'broker'; password?: string }): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: ar.auth.signupTitle, exact: true }).last().click()
  await page.getByLabel(ar.auth.name).fill(o.name ?? 'مستخدم اختبار')
  if (o.type) await page.getByLabel(ar.auth.accountType).selectOption(o.type)
  await page.getByLabel(ar.auth.email).fill(o.email)
  await page.getByLabel(ar.auth.password).fill(o.password ?? PASSWORD)
  await page.getByRole('button', { name: ar.auth.signup, exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

export async function logIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(ar.auth.email).fill(email)
  await page.getByLabel(ar.auth.password).fill(password)
  await page.getByRole('button', { name: ar.auth.login, exact: true }).click()
}

/** On narrow screens the nav links sit behind the menu button. */
export async function openMenuIfCollapsed(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: ar.nav.menu })
  if (await menu.isVisible()) await menu.click()
}

export async function logOut(page: Page): Promise<void> {
  await openMenuIfCollapsed(page)
  await page.getByRole('button', { name: ar.nav.logout }).first().click()
}
