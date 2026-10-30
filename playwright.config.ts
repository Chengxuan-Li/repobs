import { defineConfig } from '@playwright/test'

// E2E runs against the *built* app (npm run build first) served by tests/e2e/serve.ts on
// synthetic demo data. Locally on Windows the installed Microsoft Edge is used, so no browser
// download is required; CI installs Playwright's Chromium (REPOBS_E2E_CHANNEL=chromium).
const port = Number(process.env.REPOBS_E2E_PORT ?? 47399)
const channel = process.env.REPOBS_E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium')

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: channel === 'chromium' ? undefined : channel,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: `node tests/e2e/serve.ts ${port}`,
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
})
