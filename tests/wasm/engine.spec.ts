import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    muapi: { loadScoreData(data: Uint8Array): void }
    wasmEvidence: { initialized: boolean; saved: number[][]; errors: string[] }
  }
}
test('compiles real WASM, initializes Qt, loads MSCZ, edits pitch and reopens serialized music', async ({ page }, testInfo) => {
  const phases: Record<string, string> = { wasm: 'not_run', initialization: 'not_run', load: 'not_run', editSave: 'not_run', reopen: 'not_run' }
  const logs: string[] = []
  page.on('console', message => logs.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => logs.push(`pageerror: ${error.message}`))
  try {
    await page.goto('/runtime.html')
    phases.wasm = 'running'
    const exports = await page.evaluate(async () => {
      const response = await fetch('/MuseScoreStudio.wasm')
      if (!response.ok || !response.headers.get('content-type')?.includes('application/wasm')) throw new Error('Real WASM/MIME missing')
      return WebAssembly.Module.exports(await WebAssembly.compile(await response.arrayBuffer())).map(item => item.name)
    })
    expect(exports.length).toBeGreaterThan(0)
    phases.wasm = 'passed'; phases.initialization = 'running'
    await expect.poll(() => page.evaluate(() => window.wasmEvidence?.initialized), { timeout: 150000 }).toBe(true)
    await expect(page.locator('#screen canvas').first()).toBeVisible()
    expect(await page.evaluate(() => window.wasmEvidence.errors)).toEqual([])
    phases.initialization = 'passed'; phases.load = 'running'
    const source = [...await readFile('tests/fixtures/musescore/ci-score.mscz')]
    await page.evaluate(bytes => window.muapi.loadScoreData(new Uint8Array(bytes)), source)
    // Qt has no supported semantic editing JS API. Exercise the actual canvas
    // keyboard path and require serialized note evidence, never a mocked bridge.
    await page.locator('#screen canvas').first().click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowUp')
    phases.editSave = 'running'
    await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(() => window.wasmEvidence.saved.length), { timeout: 30000 }).toBeGreaterThan(0)
    const saved = await page.evaluate(() => window.wasmEvidence.saved.at(-1)!)
    const file = testInfo.outputPath('edited.mscz')
    await writeFile(file, new Uint8Array(saved))
    const inspect = (path: string) => JSON.parse(execFileSync('python3', ['tools/musescore-web/inspect-score.py', path], { encoding: 'utf8' }))
    const original = inspect('tests/fixtures/musescore/ci-score.mscz')
    const edited = inspect(file)
    expect(original[0][0]).toEqual({ start: '0', duration: '1/4', pitches: [60] })
    expect(edited[0][0]).toEqual({ start: '0', duration: '1/4', pitches: [62] })
    expect(edited[0].map((event: { start: string; duration: string }) => [event.start, event.duration])).toEqual(original[0].map((event: { start: string; duration: string }) => [event.start, event.duration]))
    phases.load = 'passed'; phases.editSave = 'passed'; phases.reopen = 'running'
    await page.evaluate(bytes => { window.wasmEvidence.saved = []; window.muapi.loadScoreData(new Uint8Array(bytes)) }, saved)
    await page.locator('#screen canvas').first().click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(() => window.wasmEvidence.saved.length), { timeout: 30000 }).toBeGreaterThan(0)
    await writeFile(file, new Uint8Array(await page.evaluate(() => window.wasmEvidence.saved.at(-1)!)))
    expect(inspect(file)).toEqual(original)
    phases.reopen = 'passed'
    await page.screenshot({ path: testInfo.outputPath('real-engine.png') })
  } finally {
    for (const phase of Object.keys(phases)) if (phases[phase] === 'running') phases[phase] = 'failed'
    await mkdir('reports/wasm', { recursive: true })
    await writeFile('reports/wasm/phases.json', JSON.stringify({ phases, note: 'Not-run phases are not successes. This is a Qt keyboard integration experiment, not a proven SDK or physical-tablet test.' }, null, 2))
    await writeFile('reports/wasm/browser.log', logs.join('\n'))
  }
})
