import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function preparePages(directory, sha, requireAudio = true) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source SHA')
  const root = resolve(directory)
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const entries = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(path => path.endsWith('.js') || path.endsWith('.css'))
  if (entries.length < 2 || entries.some(path => !/^\/PocketScore\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path))) throw new Error('Build must use /PocketScore/ production asset URLs')
  const assets = []
  for (const path of entries) {
    const bytes = await readFile(resolve(root, path.slice('/PocketScore/'.length)))
    if (!bytes.length) throw new Error('Empty production entry asset')
    assets.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  if (requireAudio) {
    const bytes = await readFile(resolve(root, 'audio/MSBasic.sf3'))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (bytes.length !== 51278610 || sha256 !== '5ea2375e8bd7d8e71def1036978c1621e85b66934169b6a2744b27b9b3c2d99c') throw new Error('Production deployment requires the verified MS Basic asset')
    assets.push({ path: '/PocketScore/audio/MSBasic.sf3', bytes: bytes.length, sha256 })
  }
  await mkdir(resolve(root, 'legacy'), { recursive: true })
  await copyFile(resolve(root, 'index.html'), resolve(root, 'legacy/index.html'))
  await copyFile(resolve(root, 'index.html'), resolve(root, '404.html'))
  await writeFile(resolve(root, '.nojekyll'), '')
  const metadata = { sourceSha: sha, base: '/PocketScore/', audioIncluded: requireAudio, assets }
  await writeFile(resolve(root, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n')
  return metadata
}
if (process.argv[1]?.endsWith('/pages-build.mjs')) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (process.env.EXPECTED_SHA && sha !== process.env.EXPECTED_SHA) throw new Error('Checkout differs from the validated CI commit')
  await preparePages(process.argv[2] ?? 'dist', sha)
  console.log(`Prepared verified /PocketScore/ build for ${sha}`)
}
