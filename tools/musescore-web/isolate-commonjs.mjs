import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function isolateCommonJS(directory) {
  const file = join(directory, 'package.json')
  try {
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    if (manifest.type && manifest.type !== 'commonjs') throw new Error(`Refusing to overwrite the existing ${manifest.type} package boundary: ${file}`)
    return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(directory, { recursive: true })
  await writeFile(file, '{"private":true,"type":"commonjs"}\n', { flag: 'wx' })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const directory of process.argv.slice(2)) await isolateCommonJS(directory)
}
