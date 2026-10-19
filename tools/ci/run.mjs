import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { suites } from './suites.mjs'

export async function runSuite(name, options = {}) {
  const commands = suites[name]
  if (!commands) throw new Error(`Unknown CI suite: ${name}`)
  const root = options.cwd ?? process.cwd()
  const directory = resolve(root, 'reports', name)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const started = Date.now()
  const results = []
  for (const [index, command] of commands.entries()) {
    const commandStarted = Date.now()
    const log = createWriteStream(resolve(directory, `${index + 1}.log`))
    console.log(`\n[${name}] ${command.join(' ')}`)
    const exitCode = await new Promise(resolveExit => {
      const child = spawn(command[0], command.slice(1), { cwd: root, env: { ...process.env, CI_SUITE: name }, stdio: ['ignore', 'pipe', 'pipe'] })
      const forward = signal => child.kill(signal)
      const terminate = () => forward('SIGTERM')
      process.once('SIGTERM', terminate)
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); process.stdout.write(data) })
      child.on('error', error => { log.write(String(error)); console.error(error) })
      child.on('close', (code, signal) => {
        process.removeListener('SIGTERM', terminate)
        log.end(() => resolveExit(code ?? (signal ? 128 : 1)))
      })
    })
    results.push({ command: command.join(' '), exitCode, status: exitCode === 0 ? 'passed' : 'failed', seconds: (Date.now() - commandStarted) / 1000, log: `${index + 1}.log` })
  }
  let tests = null
  try {
    const vitest = JSON.parse(await readFile(resolve(directory, 'vitest.json'), 'utf8'))
    tests = { total: vitest.numTotalTests, passed: vitest.numPassedTests, failed: vitest.numFailedTests, skipped: vitest.numPendingTests, todo: vitest.numTodoTests }
  } catch { /* Command-only suites have no Vitest report. */ }
  if (name === 'browser' || name === 'audio') {
    try {
      const { stats } = JSON.parse(await readFile(resolve(directory, 'playwright.json'), 'utf8'))
      tests = { total: stats.expected + stats.unexpected + stats.skipped, passed: stats.expected, failed: stats.unexpected, skipped: stats.skipped, flaky: stats.flaky }
    } catch { /* A startup failure still has a nonzero command status/log. */ }
  }
  const exitCode = results.find(result => result.exitCode !== 0)?.exitCode ?? 0
  const report = { suite: name, status: exitCode ? 'failed' : 'passed', exitCode, seconds: (Date.now() - started) / 1000, tests, commands: results }
  await writeFile(resolve(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  const summary = `## ${name}: ${report.status}\n\nElapsed: ${report.seconds.toFixed(2)}s\n\n| Command | Result | Seconds |\n|---|---|---|\n${results.map(result => `| \`${result.command}\` | ${result.status} (exit ${result.exitCode}) | ${result.seconds.toFixed(2)} |`).join('\n')}\n\n${tests ? `Tests: ${JSON.stringify(tests)}\n` : 'Counts: see the browser/Node test reports; no synthetic test count is reported.\n'}\nNot implemented: tuplets/tie playback. Their rejection tests do not establish feature support. Real Galaxy Tab and MuseScore GUI checks are not included.\n`
  await writeFile(resolve(directory, 'summary.md'), summary)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
  return report
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await runSuite(process.argv[2])).exitCode }
  catch (error) { console.error(error); process.exitCode = 1 }
}
