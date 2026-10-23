import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { preparePages } from './pages-build.mjs'

const repo = resolve('.')
const workflow = async name => parse(await readFile(`.github/workflows/${name}.yml`, 'utf8'))
async function temporary(t) {
  const folder = await mkdtemp(join(tmpdir(), 'pocketscore-ci-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  return folder
}
async function execute(t, body, environment) {
  const folder = await temporary(t)
  const summary = join(folder, 'summary.md')
  const result = spawnSync('bash', ['-c', body], { encoding: 'utf8', env: { ...process.env, ...environment, GITHUB_STEP_SUMMARY: summary } })
  assert.equal(result.error, undefined)
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, summary: await readFile(summary, 'utf8'), folder }
}

test('required CI preserves check, all four deterministic groups, reports and fail-fast=false', async () => {
  const ci = await workflow('ci')
  assert.equal(ci.name, 'Validate')
  assert.ok(ci.on.pull_request !== undefined)
  assert.deepEqual(ci.on.push.branches, ['main'], 'PR validation must not be duplicated by feature-branch push runs')
  assert.equal(ci.jobs.check.name, 'check')
  assert.equal(ci.jobs.check.if, 'always()')
  assert.deepEqual(ci.jobs.check.needs, ['quality', 'unit', 'browser', 'audio'])
  assert.equal(ci.jobs.unit.strategy['fail-fast'], false)
  assert.deepEqual(ci.jobs.unit.strategy.matrix.include.map(item => item.suite), ['music', 'input', 'playback', 'musicxml'])
  function inspect(value) {
    if (!value || typeof value !== 'object') return
    assert.ok(!value['continue-on-error'], 'Failures must not be hidden')
    Object.values(value).forEach(inspect)
  }
  inspect(ci)
  for (const name of ['quality', 'unit', 'browser', 'audio']) {
    const job = ci.jobs[name]
    assert.ok(job['timeout-minutes'] > 0)
    assert.ok(job.steps.some(step => step.uses === './.github/actions/setup-node'))
    assert.ok(job.steps.some(step => step.uses?.startsWith('actions/upload-artifact@') && step.if === 'always()'))
  }
  assert.match(ci.jobs.browser.steps[0].with['sparse-checkout'], /!\/public\/audio\/\*\.sf3/)
  assert.equal(ci.jobs.audio.steps[0].with['sparse-checkout'], undefined)
})

for (const status of ['success', 'failure', 'cancelled', 'skipped', 'missing']) {
  test(`actual check job script handles ${status} without false success`, async t => {
    const ci = await workflow('ci')
    const jobs = Object.fromEntries(['quality', 'unit', 'browser', 'audio'].map(name => [name, { result: 'success' }]))
    if (status === 'missing') delete jobs.audio
    else jobs.audio.result = status
    const result = await execute(t, ci.jobs.check.steps[0].run, { RESULTS: JSON.stringify(jobs) })
    assert.equal(result.code, status === 'success' ? 0 : 1)
    assert.match(result.summary, /Required CI/)
  })
}

test('runner preserves a real failing exit code, logs, fresh report and non-success summary', async t => {
  const folder = await temporary(t)
  await mkdir(join(folder, 'reports/failure-probe'), { recursive: true })
  await writeFile(join(folder, 'reports/failure-probe/result.json'), '{"status":"passed"}')
  const result = spawnSync(process.execPath, [resolve(repo, 'tools/ci/run.mjs'), 'failure-probe'], { cwd: folder, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: join(folder, 'failure-summary.md') } })
  assert.equal(result.status, 17)
  const report = JSON.parse(await readFile(join(folder, 'reports/failure-probe/result.json'), 'utf8'))
  assert.equal(report.status, 'failed')
  assert.equal(report.commands[0].exitCode, 17)
  assert.match(await readFile(join(folder, 'reports/failure-probe/1.log'), 'utf8'), /Intentional CI failure/)
  assert.match(await readFile(join(folder, 'reports/failure-probe/summary.md'), 'utf8'), /failure-probe: failed/)
})

const sha = 'a'.repeat(40)
const validRun = { name: 'Validate', event: 'push', conclusion: 'success', head_branch: 'main', head_repository: { full_name: 'ju87-super/PocketScore' }, head_sha: sha }
for (const [name, update, enabled, allowed] of [
  ['validated main', {}, 'true', true], ['disabled CD', {}, 'false', false],
  ['failed CI', { conclusion: 'failure' }, 'true', false], ['PR CI', { event: 'pull_request' }, 'true', false],
  ['feature branch', { head_branch: 'ci/pipeline' }, 'true', false], ['fork', { head_repository: { full_name: 'fork/PocketScore' } }, 'true', false],
  ['invalid SHA', { head_sha: 'main; echo invalid' }, 'true', false],
]) test(`actual CD eligibility script: ${name}`, async t => {
  const cd = await workflow('deploy-pages')
  const folder = await temporary(t)
  const event = join(folder, 'event.json'), output = join(folder, 'outputs.txt')
  await writeFile(event, JSON.stringify({ workflow_run: { ...validRun, ...update } }))
  const result = await execute(t, cd.jobs.eligibility.steps[0].run, { GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'ju87-super/PocketScore', ENABLE_PAGES_CD: enabled })
  assert.equal(result.code, 0)
  assert.match(await readFile(output, 'utf8'), new RegExp(`allowed=${allowed}`))
  assert.match(result.summary, allowed ? /Eligible validated main/ : /NOT DEPLOYED/)
})

test('CD consumes only successful main CI, exact source SHA, environment and least-privilege deployment', async () => {
  const cd = await workflow('deploy-pages')
  assert.deepEqual(cd.on.workflow_run.branches, ['main'])
  assert.deepEqual(cd.on.workflow_run.workflows, ['Validate'])
  assert.equal(cd.on.pull_request, undefined)
  assert.equal(cd.jobs.build.if, "needs.eligibility.outputs.allowed == 'true'")
  assert.equal(cd.jobs.build.steps[0].with.ref, '${{ needs.eligibility.outputs.sha }}')
  assert.equal(cd.jobs.deploy.environment.name, 'github-pages')
  assert.equal(cd.jobs.deploy.permissions.pages, 'write')
  assert.equal(cd.jobs.deploy.permissions['id-token'], 'write')
  assert.equal(cd.jobs.build.permissions.pages, 'read')
  assert.match(cd.jobs.deploy.steps[0].run, /git\/ref\/heads\/main/)
  assert.equal(cd.jobs.smoke.steps.find(step => step.env?.POCKETSCORE_BASE_URL).env.POCKETSCORE_BASE_URL, '${{ needs.deploy.outputs.page_url }}')
})

test('Pages preparation rejects incorrect base, missing audio and empty assets before deployment', async t => {
  const directory = await temporary(t)
  await mkdir(join(directory, 'assets'))
  await writeFile(join(directory, 'index.html'), '<script src="/assets/app.js"></script><link href="/assets/app.css">')
  await assert.rejects(preparePages(directory, sha, false), /PocketScore/)
  await writeFile(join(directory, 'index.html'), '<script src="/PocketScore/assets/app.js"></script><link href="/PocketScore/assets/app.css">')
  await writeFile(join(directory, 'assets/app.js'), 'console.log("build")')
  await writeFile(join(directory, 'assets/app.css'), '')
  await assert.rejects(preparePages(directory, sha, false), /Empty/)
  await writeFile(join(directory, 'assets/app.css'), 'body{}')
  await assert.rejects(preparePages(directory, sha), /ENOENT/)
  const metadata = await preparePages(directory, sha, false)
  assert.equal(metadata.audioIncluded, false)
  assert.equal(metadata.sourceSha, sha)
  assert.equal(await readFile(join(directory, '404.html'), 'utf8'), await readFile(join(directory, 'index.html'), 'utf8'))
  assert.equal(await readFile(join(directory, 'legacy/index.html'), 'utf8'), await readFile(join(directory, 'index.html'), 'utf8'))
})

test('WASM is manual and must pass browser editing, saving and reopen after real build', async () => {
  const wasm = await workflow('musescore-wasm')
  assert.deepEqual(Object.keys(wasm.on), ['workflow_dispatch'])
  assert.equal(wasm.jobs.runtime.needs, 'build')
  assert.equal(wasm.jobs.build.steps.find(step => step.with?.repository === 'musescore/MuseScore').with.ref, '3654226c2e99289916916953a98e585a3d3b315a')
  assert.ok(!wasm.jobs.runtime['continue-on-error'])
  assert.ok(wasm.jobs.runtime.steps.some(step => step.run === 'npx playwright test --config tests/wasm/playwright.config.ts'))
})
test('MSCZ fixture inspector verifies its notes, not an engine execution claim', () => {
  const result = spawnSync('python3', ['tools/musescore-web/inspect-score.py', 'tests/fixtures/musescore/ci-score.mscz'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [[{ start: '0', duration: '1/4', pitches: [60] }, { start: '1/4', duration: '3/4', pitches: [] }]])
})
