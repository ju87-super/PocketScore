import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const started = Date.now()
const report = {
  status: 'failed', nodeVersion: process.version,
  expectedPlaywright: manifest.devDependencies['@playwright/test'],
  playwrightVersion: require('@playwright/test/package.json').version,
  browserStore: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
}
let browser
try {
  if (report.playwrightVersion !== report.expectedPlaywright) throw new Error('Installed Playwright does not match package.json.')
  browser = await chromium.launch({ timeout: 30000,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: report.executablePath } : {}),
  })
  const page = await browser.newPage()
  await page.setContent('<title>PocketScore browser ready</title><main>runtime ready</main>', { timeout: 10000 })
  if (await page.title() !== 'PocketScore browser ready') throw new Error('Chromium did not execute the page.')
  report.chromiumVersion = browser.version()
  report.status = 'passed'
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  try { await browser?.close() }
  catch (error) { report.status = 'failed'; report.error = String(error) }
  report.seconds = (Date.now() - started) / 1000
  await mkdir('reports/setup', { recursive: true })
  await writeFile('reports/setup/browser-runtime.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Chromium startup: ${report.status}\n\nNode ${report.nodeVersion}, Playwright ${report.playwrightVersion}, Chromium ${report.chromiumVersion ?? 'not started'}. Elapsed ${report.seconds}s.\n\nThis is a browser startup check; feature and audio tests run separately. See setup artifacts for diagnostics.\n`)
}
process.exitCode = report.status === 'passed' ? 0 : 1
