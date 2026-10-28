import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportMusicXML, importMusicXML } from './musicxml'
import { parseProject, serializeProject } from './project'
import { eventPitches } from '../music/score'
import { midi } from '../music/pitch'
import { validateProject } from '../project/model'
import type { Project } from '../project/model'

const fixture = (name: string) => readFileSync(resolve('tests/fixtures/musicxml', `${name}.musicxml`), 'utf8')
function musicalData(project: Project) {
  return { title: project.title, tempos: project.tempos, parts: project.parts.map(part => ({ name: part.name, instrument: part.instrument, mixer: part.mixer,
    staves: part.staves.map(staff => ({ clef: staff.clef, key: staff.score.keySignature, meter: staff.score.timeSignature,
      measures: staff.score.measures.map(measure => measure.voices.map(voice => voice.events.map(event => ({ start: event.start, duration: event.duration, pitches: eventPitches(event).map(midi) })))),
    })),
  })) }
}
describe('fixed MusicXML compatibility corpus', () => {
  it('imports the fixed ensemble with independent golden pitch/timing/structure expectations', () => {
    const project = importMusicXML(fixture('ensemble'))
    expect(validateProject(project)).toEqual([])
    expect(project.parts.map(part => part.instrument)).toEqual(['piano', 'guitar', 'bass', 'drums'])
    expect(project.parts.map(part => part.staves.length)).toEqual([2, 1, 1, 1])
    expect(project.parts[0].staves[0].score.measures[0].voices).toHaveLength(2)
    expect(project.parts[0].staves[0].score.measures[0].voices[0].events.map(event => ({ start: event.start, duration: event.duration, pitches: eventPitches(event).map(midi) }))).toEqual([
      { start: { n: 0, d: 1 }, duration: { n: 1, d: 4 }, pitches: [60, 64] },
      { start: { n: 1, d: 4 }, duration: { n: 1, d: 4 }, pitches: [] },
      { start: { n: 1, d: 2 }, duration: { n: 1, d: 4 }, pitches: [64] },
      { start: { n: 3, d: 4 }, duration: { n: 1, d: 4 }, pitches: [] },
    ])
    expect(project.tempos).toEqual([{ measure: 0, bpm: 96 }, { measure: 2, bpm: 120 }])
    expect(project.parts[2].staves[0].clef).toBe('bass')
    expect(project.parts[3].staves[0].clef).toBe('percussion')
    expect(project.parts.every(part => part.staves.every(staff => staff.score.keySignature === 0 && staff.score.timeSignature === '4/4'))).toBe(true)
  })
  it('preserves musical data through export/import and every field through JSON reload', () => {
    const imported = importMusicXML(fixture('ensemble'))
    expect(musicalData(importMusicXML(exportMusicXML(imported)))).toEqual(musicalData(imported))
    expect(parseProject(serializeProject(imported))).toEqual(imported)
  })
  it('retains a nonzero key, compound meter and altered/natural pitches from a fixed fixture', () => {
    const project = importMusicXML(fixture('key-meter'))
    const score = project.parts[0].staves[0].score
    expect(score.keySignature).toBe(1)
    expect(score.timeSignature).toBe('6/8')
    expect(score.measures[0].voices[0].events.flatMap(event => eventPitches(event).map(midi))).toEqual([66, 65, 70])
    expect(musicalData(importMusicXML(exportMusicXML(project)))).toEqual(musicalData(project))
  })
  it.each(['invalid', 'tied', 'tuplet'])('diagnoses %s without changing an existing project', name => {
    const before = importMusicXML(fixture('ensemble'))
    const snapshot = serializeProject(before)
    expect(() => importMusicXML(fixture(name))).toThrow(name === 'invalid' ? /올바른/ : name === 'tied' ? /붙임줄.*누락/ : /지원하지 않는 MusicXML/)
    expect(serializeProject(before)).toBe(snapshot)
  })
})
