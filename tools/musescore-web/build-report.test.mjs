import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pocketscore-wasm-report-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
test('actual build script rejects wrong upstream revision and records later phases as not_run', async t => {
  const directory = await temporary(t)
  const result = spawnSync('bash', [resolve('tools/musescore-web/build.sh')], { cwd: directory, encoding: 'utf8', env: {
    ...process.env, MUSESCORE_SOURCE: resolve('.'), MUSESCORE_BUILD: join(directory, 'build'),
    MUSESCORE_WEB_OUTPUT: join(directory, 'output'), QT_ROOT_DIR: join(directory, 'qt'),
    MUSESCORE_REPORT_DIR: directory, GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
  } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Expected MuseScore/)
  const report = JSON.parse(await readFile(join(directory, 'build-status.json'), 'utf8'))
  assert.equal(report.status, 'failed')
  assert.deepEqual(report.phases, { preflight: 'failed', toolchain: 'not_run', configure: 'not_run', compile: 'not_run', artifacts: 'not_run' })
  assert.equal(report.runtime, 'not_run')
  assert.match(await readFile(join(directory, 'summary.md'), 'utf8'), /preflight \| failed/)
})
test('compiler failure remains failed and emits a bounded diagnostic through GitHub annotations', async t => {
  const directory = await temporary(t), log = join(directory, 'compiler.log')
  await writeFile(log, 'first line\nerror: compile failed at 50%\n')
  const result = spawnSync(process.execPath, [resolve('tools/musescore-web/build-report.mjs'), 'compile', '23', directory, log], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: join(directory, 'summary.md') } })
  assert.equal(result.status, 23)
  assert.match(result.stderr, /::error title=MuseScore WASM compile::/)
  assert.match(result.stderr, /50%25%0A/)
  const report = JSON.parse(await readFile(join(directory, 'build-status.json'), 'utf8'))
  assert.equal(report.phases.compile, 'failed')
  assert.equal(report.phases.artifacts, 'not_run')
  assert.equal(report.runtime, 'not_run')
})
test('an early zero exit cannot be reported as a completed engine build', async t => {
  const directory = await temporary(t)
  const result = spawnSync(process.execPath, [resolve('tools/musescore-web/build-report.mjs'), 'configure', '0', directory], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: join(directory, 'summary.md') } })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(await readFile(join(directory, 'build-status.json'), 'utf8')).status, 'failed')
})
