import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://127.0.0.1:4173/PocketScore/',
    viewport: { width: 1280, height: 900 },
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: [{
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/PocketScore/',
    reuseExistingServer: false,
  }, {
    command: 'node scripts/serve-fixture.mjs',
    url: 'http://127.0.0.1:4176/tests/performance/index.html',
    reuseExistingServer: false,
  }],
})
