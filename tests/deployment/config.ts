import type { PlaywrightTestConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { githubReporter } from '../reporters'
export function deploymentSettings(target: string | undefined, suite = 'deployment'): PlaywrightTestConfig {
  if (!target) throw new Error('Set POCKETSCORE_BASE_URL to an allowed /PocketScore/ URL.')
  const url = new URL(target)
  if (!['/PocketScore/', '/PocketScore/beta/'].includes(url.pathname) || url.search || url.hash || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Deployment URL must end with /PocketScore/ or /PocketScore/beta/ and have no credentials/query/hash.')
  if (!/^[a-f0-9]{40}$/.test(process.env.POCKETSCORE_EXPECTED_SHA ?? '')) throw new Error('Set POCKETSCORE_EXPECTED_SHA to the validated commit.')
  return { testDir: '.', workers: 1, retries: 0, forbidOnly: !!process.env.CI,
    outputDir: `../../test-results/${suite}`,
    reporter: [['list'], ...githubReporter(), ['html', { outputFolder: resolve(`reports/${suite}/html`), open: 'never' }], ['junit', { outputFile: resolve(`reports/${suite}/junit.xml`) }]],
    use: { baseURL: url.href, browserName: 'chromium', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure',
      launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  }
}
