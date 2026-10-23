// Requires CMake: run in the isolated WASM job, not ordinary TypeScript PR CI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

for (const version of ['6.10.2', '6.10.1']) test(`Qt metadata check reads the generated version (${version}), not wrapper text`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pocketscore-qt-metadata-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const metadata = join(directory, 'lib/cmake/Qt6Core')
  await mkdir(metadata, { recursive: true })
  // Package metadata fixture only: this is not an installed Qt engine/toolchain.
  await writeFile(join(metadata, 'Qt6CoreConfigVersion.cmake'), 'include("${CMAKE_CURRENT_LIST_DIR}/Qt6CoreConfigVersionImpl.cmake")\n')
  await writeFile(join(metadata, 'Qt6CoreConfigVersionImpl.cmake'), `set(PACKAGE_VERSION "${version}")\n`)
  const result = spawnSync('cmake', ['-P', resolve('tools/musescore-web/verify-qt.cmake')], { encoding: 'utf8', env: { ...process.env, QT_ROOT_DIR: directory } })
  assert.equal(result.error, undefined)
  assert.equal(result.status, version === '6.10.2' ? 0 : 1)
  assert.match(result.stdout + result.stderr, version === '6.10.2' ? /Verified Qt 6.10.2/ : /Expected Qt 6.10.2/)
})
