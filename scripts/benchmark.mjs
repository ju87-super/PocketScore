import { build, preview } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFile, mkdir, readdir, readFile, cp, rm, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const label = process.argv[2] || 'current'
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Use a simple alphanumeric run label')
const sourceRef = process.argv[3]
let sourceRoot = process.cwd()
const outDir = resolve(`.cache/performance-site-${label}`)
let assetDir = resolve('dist/assets')
if (sourceRef) {
  sourceRoot = resolve(`.cache/performance-source-${label}`)
  await rm(sourceRoot, { recursive: true, force: true })
  await mkdir(sourceRoot, { recursive: true })
  const archive = execFileSync('git', ['archive', sourceRef], { maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', sourceRoot], { input: archive })
  for (const folder of ['tests/performance', 'tests/fixtures']) await cp(folder, resolve(sourceRoot, folder), { recursive: true })
  await symlink(resolve('node_modules'), resolve(sourceRoot, 'node_modules'), 'dir')
  const production = resolve(`.cache/performance-production-${label}`)
  await build({ root: sourceRoot, configFile: resolve(sourceRoot, 'vite.config.ts'), logLevel: 'error', build: { outDir: production, emptyOutDir: true } })
  assetDir = resolve(production, 'assets')
}
await build({ root: sourceRoot, configFile: false, plugins: [react()], base: '/', logLevel: 'error',
  build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve(sourceRoot, 'tests/performance/index.html') } } })
const server = await preview({ root: sourceRoot, configFile: false, base: '/', build: { outDir }, preview: { host: '127.0.0.1', port: 4175, strictPort: true } })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' })
const output = { label, commit: execFileSync('git', ['rev-parse', sourceRef || 'HEAD'], { encoding: 'utf8' }).trim(), browser: browser.version(), viewport: { width: 1280, height: 900 }, rounds: [] }
try {
  for (let round = 0; round < 3; round++) {
    for (const count of [4, 16, 32, 64]) {
      const page = await browser.newPage({ viewport: output.viewport })
      page.on('pageerror', error => { throw error })
      await page.goto('http://127.0.0.1:4175/tests/performance/index.html')
      await page.waitForFunction(() => window.benchmark)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      await cdp.send('HeapProfiler.collectGarbage')
      const heap = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value])).JSHeapUsedSize
      const heapBefore = await heap()
      const result = await page.evaluate(count => window.benchmark.run(count), count)
      await cdp.send('HeapProfiler.collectGarbage')
      const heapAfter = await heap()
      // Repeat the same mounted workload twice to distinguish retained growth
      // from one-time font/renderer initialization. A browser context is isolated.
      const steadyHeaps = []
      for (let repeat = 0; repeat < 2; repeat++) {
        await page.evaluate(count => window.benchmark.run(count, 4), count)
        await cdp.send('HeapProfiler.collectGarbage')
        steadyHeaps.push(await heap())
      }
      await page.evaluate(() => window.benchmark.unmount())
      await cdp.send('HeapProfiler.collectGarbage')
      output.rounds.push({ round, ...result, heapBefore, heapAfter, steadyHeaps, heapUnmounted: await heap() })
      console.log(`${label}: round ${round + 1}, ${count} measures, pitch ${result.updates.pitch.median.toFixed(2)}ms, cursor ${result.updates.cursor.median.toFixed(2)}ms`)
      await page.close()
    }
  }
  output.productionAssets = []
  for (const name of await readdir(assetDir)) {
    const data = await readFile(resolve(assetDir, name))
    output.productionAssets.push({ name, bytes: data.length, gzipBytes: gzipSync(data).length })
  }
  await mkdir('.cache/performance-results', { recursive: true })
  await writeFile(`.cache/performance-results/${label}.json`, JSON.stringify(output, null, 2))
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)) }
