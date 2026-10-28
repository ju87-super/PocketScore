import { describe, expect, it } from 'vitest'
import { beginEntry, createNoteEntry, writeEntry, addEntryChord } from '../project/noteEntry'
import { importMusicXML, exportMusicXML } from './musicxml'
import { parseProject, serializeProject } from './project'
import { rhythmProject, rhythmTarget as target, longHeldProject } from '../../tests/fixtures/rhythm'
import { fraction } from '../music/rational'
import { eventPitches } from '../music/score'
import { midi } from '../music/pitch'
import { compileTimeline } from '../playback/timeline'
import { validateProject } from '../project/model'
import type { Project } from '../project/model'

const music = (project: Project) => project.parts.map(part => part.staves.map(staff => staff.score.measures.map(bar => bar.voices.map(voice => voice.events.map(event => ({ start: event.start, duration: event.duration, pitches: eventPitches(event).map(midi), ties: event.kind === 'note' ? event.tieTo ?? [] : [] }))))))
describe('automatic split file compatibility', () => {
  it('exports both chord components across a newly appended bar and restores actual music from MusicXML and JSON', () => {
    const project = rhythmProject(), entry = beginEntry(project, createNoteEntry(), target(3, 3))
    const note = writeEntry(project, { ...entry, duration: fraction(1, 2) }, { step: 'F', octave: 4, alter: 1 })
    const chord = addEntryChord(note.project, note.entry, note.selection, { step: 'A', octave: 4, alter: 0 }).project
    const xml = exportMusicXML(chord), document = new DOMParser().parseFromString(xml, 'application/xml')
    expect(document.querySelectorAll('tie[type=start]')).toHaveLength(2)
    expect(document.querySelectorAll('tie[type=stop]')).toHaveLength(2)
    expect(document.querySelectorAll('tied[type=start]')).toHaveLength(2)
    expect(music(importMusicXML(xml))).toEqual(music(chord))
    expect(parseProject(serializeProject(chord))).toEqual(chord)
    expect(validateProject(chord)).toEqual([])
  })
  it('round-trips complex preserved tails with the same independent note-on/off timing', () => {
    const project = longHeldProject(), entry = beginEntry(project, createNoteEntry(), target(1))
    const result = writeEntry(project, { ...entry, duration: fraction(1, 16) }, { step: 'D', octave: 4, alter: 0 }, { ...entry.cursor!, start: fraction(5, 16) }).project
    const imported = importMusicXML(exportMusicXML(result))
    const timing = (p: Project) => compileTimeline(p).notes.map(note => [note.midi, note.startTick, note.endTick])
    expect(timing(imported)).toEqual([[60, 0, 2520], [62, 2520, 2640], [60, 2640, 7680]])
    expect(music(imported)).toEqual(music(result))
  })
})
