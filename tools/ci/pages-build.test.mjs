import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparePages } from './pages-build.mjs'

const sha = '0123456789abcdef0123456789abcdef01234567'
const demoAssets = ['main-hello.js', 'style-ok.css']

async function fixture(base) {
  const dir = await mkdtemp(join(tmpdir(), 'pocketscore-pages-'))
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'index.html'), `<html><head><link rel="stylesheet" href="${base}assets/style-ok.css"></head><body><script src="${base}assets/main-hello.js"></script></body></html>`)
  await writeFile(join(dir, 'assets', demoAssets[0]), 'console.log("hello")')
  await writeFile(join(dir, 'assets', demoAssets[1]), 'body { color: black }')
  return dir
}

test('stable build path retains the existing manifest shape', async () => {
  const dir = await fixture('/PocketScore/')
  try {
    const manifest = await preparePages(dir, sha, false)
    assert.equal(manifest.base, '/PocketScore/')
    assert.equal(manifest.sourceSha, sha)
    assert.equal(manifest.audioIncluded, false)
    assert.ok(manifest.assets.every(asset => asset.path.startsWith('/PocketScore/assets/')))
    assert.equal((await readFile(join(dir, '404.html'), 'utf8')), (await readFile(join(dir, 'index.html'), 'utf8')))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('beta preview manifests and assets are sandboxed under /PocketScore/beta/', async () => {
  const dir = await fixture('/PocketScore/beta/')
  try {
    const manifest = await preparePages(dir, sha, false, '/PocketScore/beta/')
    assert.equal(manifest.base, '/PocketScore/beta/')
    assert.ok(manifest.assets.every(asset => asset.path.startsWith('/PocketScore/beta/assets/')))
    assert.equal(JSON.parse(await readFile(join(dir, 'build-info.json'), 'utf8')).sourceSha, sha)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('beta manifest cannot claim stable URLs, and arbitrary base is rejected', async () => {
  const dir = await fixture('/PocketScore/')
  try {
    await assert.rejects(preparePages(dir, sha, false, '/PocketScore/beta/'), /Build must use/)
    await assert.rejects(preparePages(dir, sha, false, '/other/'), /Unsupported Pages build base/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
