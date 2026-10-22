import { build, preview } from 'vite'
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const configFile = 'tests/performance/vite.config.ts'
await build({ configFile, logLevel: 'error' })
const server = await preview({ configFile, preview: { host: '127.0.0.1', port: 4177, strictPort: true } })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:4177/tests/performance/index.html')
  await page.waitForFunction(() => window.fixture)
  await page.evaluate(async () => { await document.fonts.ready; window.fixture.mount(64) })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const records = []
  for (let batch = 0; batch <= 8; batch++) {
    if (batch) await page.evaluate(() => {
      for (let index = 0; index < 200; index++) window.fixture.act({ type: 'pitch', amount: index % 2 ? -1 : 1 })
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
    const state = await page.evaluate(() => ({ history: window.fixture.state().past.length, nodes: document.querySelectorAll('.notation svg *').length }))
    records.push({ edits: batch * 200, heapBytes: metrics.JSHeapUsedSize, ...state })
  }
  if (errors.length) throw new Error(errors.join('\n'))
  await mkdir('.cache/performance-results', { recursive: true })
  await writeFile('.cache/performance-results/memory-stress.json', JSON.stringify({ browser: browser.version(), measures: 64, records }, null, 2))
  console.log(JSON.stringify(records))
} finally { await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve)) }
