import { defineConfig, devices } from '@playwright/test'

/**
 * Two ways to run:
 *  1) Against a deployed URL (read-only checks only):        BASE_URL=https://your-site.pages.dev npx playwright test --grep @public
 *  2) Against a local build + Firebase emulators (full flow): npm run build:e2e && npm run test:e2e:emulators
 *     (never touches real data: the app is built with VITE_USE_EMULATORS=true)
 */
const external = process.env.BASE_URL
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // the emulators are shared state
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: external ?? 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'ar-EG' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: external ? undefined : {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 60_000,
  },
})
