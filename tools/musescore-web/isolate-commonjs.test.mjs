import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isolateCommonJS } from './isolate-commonjs.mjs'

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pocketscore-node-boundary-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
test('upstream CommonJS executes under an ESM project only after a local boundary is added', async t => {
  const parent = await temporary(t), child = join(parent, 'upstream')
  await mkdir(child)
  const parentManifest = '{"type":"module"}\n'
  await writeFile(join(parent, 'package.json'), parentManifest)
  const script = join(child, 'install.js')
  await writeFile(script, 'const fs = require("node:fs"); console.log(fs.existsSync(__filename))\n')
  const before = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.notEqual(before.status, 0)
  assert.match(before.stderr, /require is not defined in ES module scope/)
  await isolateCommonJS(child)
  const after = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(after.status, 0, after.stderr)
  assert.equal(after.stdout.trim(), 'true')
  assert.equal(await readFile(join(parent, 'package.json'), 'utf8'), parentManifest)
})
test('an existing compatible package manifest is preserved exactly', async t => {
  const directory = await temporary(t), file = join(directory, 'package.json')
  const original = '{"name":"existing-build-tools","type":"commonjs"}\n'
  await writeFile(file, original)
  await isolateCommonJS(directory)
  assert.equal(await readFile(file, 'utf8'), original)
})
test('an existing ESM manifest is rejected and never overwritten', async t => {
  const directory = await temporary(t), file = join(directory, 'package.json')
  const original = '{"type":"module"}\n'
  await writeFile(file, original)
  await assert.rejects(isolateCommonJS(directory), /Refusing to overwrite/)
  assert.equal(await readFile(file, 'utf8'), original)
})
