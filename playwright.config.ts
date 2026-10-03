import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests: the real app in Chromium, with the Google APIs replaced by an in-memory fake Sheet
 * (see tests/e2e/fakeSheet.ts), so they need no network, no account and never touch a real Sheet.
 *
 *   npm run test:e2e
 *
 * Browser: `npx playwright install chromium` once, or point CHROMIUM_PATH at an existing Chromium.
 */
const PORT = 5199

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1100, height: 850 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
