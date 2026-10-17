import { defineConfig } from '@playwright/test'

const target = process.env.POCKETSCORE_BASE_URL
if (!target) throw new Error('Set POCKETSCORE_BASE_URL to the deployed /PocketScore/ URL.')
const url = new URL(target)
if (url.pathname !== '/PocketScore/' || url.search || url.hash) {
  throw new Error('The deployment URL must end with /PocketScore/ and have no query or hash.')
}

export default defineConfig({
  testDir: '.',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: url.href,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
})
