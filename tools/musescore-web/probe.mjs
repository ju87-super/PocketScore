#!/usr/bin/env node
// Static artifact gate only; does not claim browser execution.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || !args.some(arg => !arg.startsWith('--'))) {
  console.log('Usage: node tools/musescore-web/probe.mjs /path/to/app-web/output [--json]')
  if (!args.includes('--help')) process.exitCode = 2
} else {
  const directory = resolve(args.find(arg => !arg.startsWith('--')))
  const checks = []
  const files = [
    'MuseScoreStudio.js', 'MuseScoreStudio.wasm', 'viewer.html',
    'distr/muapi.js', 'distr/muimpl.js', 'distr/qtloader.js', 'distr/config.js',
  ]
  for (const name of files) {
    const path = join(directory, name)
    const present = existsSync(path) && statSync(path).isFile()
    checks.push({ name, passed: present, message: present ? 'present' : 'missing' })
  }
  const wasm = join(directory, 'MuseScoreStudio.wasm')
  if (existsSync(wasm) && statSync(wasm).isFile()) {
    const bytes = readFileSync(wasm)
    const valid = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
    checks.push({ name: 'WebAssembly v1 header', passed: valid, message: valid ? 'valid' : 'invalid' })
  }
  const apiFile = join(directory, 'distr/muapi.js')
  if (existsSync(apiFile) && statSync(apiFile).isFile()) {
    const api = readFileSync(apiFile, 'utf8')
    for (const symbol of ['loadScoreFile', 'loadScoreData', 'startAudioProcessing']) {
      const passed = api.includes(symbol)
      checks.push({ name: 'muapi.js: ' + symbol, passed, message: passed ? 'declared' : 'missing' })
    }
  }
  const passed = checks.every(check => check.passed)
  const report = {
    status: passed ? 'ARTIFACTS_PRESENT_NOT_RUNTIME_VERIFIED' : 'ARTIFACT_GATE_FAILED',
    directory,
    checks,
    limitations: [
      'Static files only: Qt initialization, browser display and execution were NOT tested.',
      'No Galaxy Tab, touch, MusicXML, audio, performance or edit/save round-trip was tested.',
    ],
  }
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(report.status)
    for (const c of checks) console.log((c.passed ? 'PASS ' : 'FAIL ') + c.name + ': ' + c.message)
    console.log('Runtime testing is required; see docs/musescore-web-spike.md.')
  }
  if (!passed) process.exitCode = 1
}
