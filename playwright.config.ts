import { defineConfig } from '@playwright/test'
const suite = process.env.CI_SUITE ?? 'e2e'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: `test-results/${suite}`,
  reporter: [['list'], ['html', { outputFolder: `reports/${suite}/html`, open: 'never' }],
    ['junit', { outputFile: `reports/${suite}/playwright.xml` }], ['json', { outputFile: `reports/${suite}/playwright.json` }]],
  projects: [
    { name: 'chromium', grepInvert: /@audio/ },
    { name: 'audio', grep: /@audio/ },
  ],
  workers: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://127.0.0.1:4173/PocketScore/legacy/',
    viewport: { width: 1280, height: 900 },
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
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
