import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [phase, rawCode, directory = 'reports/wasm', log] = process.argv.slice(2)
const order = ['preflight', 'toolchain', 'configure', 'compile', 'artifacts']
const code = Number(rawCode)
const success = phase === 'complete' && code === 0
const current = order.indexOf(phase)
let excerpt = ''
if (!success && log) {
  try { excerpt = (await readFile(log, 'utf8')).split('\n').slice(-60).join('\n').slice(-6000) } catch { /* Failure may precede creation of a compiler log. */ }
}
const report = {
  status: success ? 'passed' : 'failed', exitCode: success ? 0 : (code || 1),
  phases: Object.fromEntries(order.map((name, i) => [name, success || i < current ? 'passed' : i === current ? 'failed' : 'not_run'])),
  failedPhase: success ? null : phase, failureExcerpt: excerpt,
  runtime: 'not_run', completedAt: new Date().toISOString(),
}
await mkdir(directory, { recursive: true })
await writeFile(join(directory, 'build-status.json'), JSON.stringify(report, null, 2) + '\n')
const summary = `## MuseScore WASM build: ${report.status}\n\n| Phase | Result |\n|---|---|\n${Object.entries(report.phases).map(([name, state]) => `| ${name} | ${state} |`).join('\n')}\n\nBrowser initialization, editing and persistence: **not_run by this build script**. Require the separate runtime job.\n`
await writeFile(join(directory, 'build-summary.md'), summary)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
if (!success) {
  const message = `Build stopped in ${phase} (exit ${report.exitCode}). Later phases were not run.\n${excerpt}`
  console.error(process.env.GITHUB_ACTIONS === 'true'
    ? `::error title=MuseScore WASM ${phase}::${message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`
    : message)
  process.exitCode = report.exitCode
}
