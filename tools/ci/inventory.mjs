import { glob, mkdir, writeFile } from 'node:fs/promises'

const groups = { music: [], input: [], playback: [], musicxml: [] }
for await (const file of glob('src/**/*.test.{ts,tsx}')) {
  const group = file.startsWith('src/music/') || file.startsWith('src/project/') || file.startsWith('src/notation/') ? 'music'
    : file.startsWith('src/editor/') || file === 'src/App.test.tsx' ? 'input'
    : file.startsWith('src/playback/') ? 'playback' : file.startsWith('src/files/') ? 'musicxml' : null
  if (!group) throw new Error(`Unassigned test file: ${file}. Add it to a required CI suite.`)
  groups[group].push(file)
}
for (const [name, files] of Object.entries(groups)) if (!files.length) throw new Error(`CI suite ${name} has no tests`)
const report = { groups, unsupported: ['tuplet editing/playback', 'percussion tied-fragment input', 'MuseScore WASM runtime (separate manual workflow)', 'physical Galaxy Tab/S Pen'] }
await mkdir('reports/quality', { recursive: true })
await writeFile('reports/quality/test-inventory.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
