// Optional XSD/GUI interoperability fixture, generated through the real exporter.
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const destination = process.argv[2] ?? '.cache/alpha-ensemble.musicxml'
const server = await createServer({ server: { middlewareMode: true } })
try {
  const { createProject, allSelections, replaceEvent } = await server.ssrLoadModule('/src/project/model.ts')
  const { addStaff, addVoice } = await server.ssrLoadModule('/src/project/structure.ts')
  const { exportMusicXML } = await server.ssrLoadModule('/src/files/musicxml.ts')
  let project = createProject()
  const selection = allSelections(project)[0]
  project = addStaff(addVoice(project, selection.staffId), selection.partId)
  project = replaceEvent(project, selection, event => ({ ...event, chord: [{ step: 'E', octave: 4, alter: 0 }] }))
  project = { ...project, tempos: [{ measure: 0, bpm: 96 }, { measure: 2, bpm: 120 }] }
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, exportMusicXML(project))
  console.log(`Exported four instruments, five staves, multiple voices, chord, drums and tempo changes to ${destination}`)
} finally {
  await server.close()
}
