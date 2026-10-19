import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const probe = fileURLToPath(new URL('./probe.mjs', import.meta.url))
const required = [
  'MuseScoreStudio.js', 'MuseScoreStudio.wasm', 'viewer.html',
  'distr/muapi.js', 'distr/muimpl.js', 'distr/qtloader.js', 'distr/config.js',
]
function withFixture(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'musescore-web-spike-'))
  try {
    for (const path of required) {
      const destination = join(dir, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, path.endsWith('.wasm')
        ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
        : path === 'distr/muapi.js'
          ? 'loadScoreFile loadScoreData startAudioProcessing'
          : 'fixture')
    }
    callback(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
function run(dir) {
  const result = spawnSync(process.execPath, [probe, dir, '--json'], { encoding: 'utf8' })
  assert.equal(result.error, undefined)
  return { code: result.status, report: JSON.parse(result.stdout) }
}

test('passes only the static gate with complete fixture', () => withFixture(dir => {
  const { code, report } = run(dir)
  assert.equal(code, 0)
  assert.equal(report.status, 'ARTIFACTS_PRESENT_NOT_RUNTIME_VERIFIED')
  assert.ok(report.limitations.length > 0)
}))
test('fails on a missing output script', () => withFixture(dir => {
  rmSync(join(dir, 'MuseScoreStudio.js'))
  const { code, report } = run(dir)
  assert.equal(code, 1)
  assert.ok(report.checks.some(check => check.name === 'MuseScoreStudio.js' && !check.passed))
}))
test('fails on an invalid WebAssembly magic header', () => withFixture(dir => {
  writeFileSync(join(dir, 'MuseScoreStudio.wasm'), 'not a wasm module')
  const { code, report } = run(dir)
  assert.equal(code, 1)
  assert.ok(report.checks.some(check => check.name === 'WebAssembly v1 header' && !check.passed))
}))
test('fails if the expected upstream JavaScript API is absent', () => withFixture(dir => {
  writeFileSync(join(dir, 'distr/muapi.js'), 'loadScoreFile')
  const { code, report } = run(dir)
  assert.equal(code, 1)
  assert.ok(report.checks.some(check => check.name === 'muapi.js: loadScoreData' && !check.passed))
}))
