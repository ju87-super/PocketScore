// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createProject, allSelections, primaryScore, replaceEvent, staffAt, validateProject } from './model'
import type { Project } from './model'
import { createProjectState, projectReducer } from './state'
import type { ProjectAction } from './state'
import { activeAlter, beginEntry, createNoteEntry, dottedDuration, entryPosition, letterPitch, writeEntry } from './noteEntry'
import { eventPitches, locate, setKeySignature } from '../music/score'
import { fraction, ZERO } from '../music/rational'
import { midi } from '../music/pitch'

function session(project = createProject(false)) {
  let state = createProjectState(project)
  return { get state() { return state }, send(action: ProjectAction) { state = projectReducer(state, action); return state } }
}
const notes = (project: Project) => primaryScore(project).measures[0].voices[0].events
const tones = (project: Project) => eventPitches(notes(project)[0]).map(midi)

describe('MuseScore-style step-time entry', () => {
  it('enters consecutive letters at exact onsets and preserves every voice total', () => {
    const s = session(); s.send({ type: 'entryMode', enabled: true })
    s.send({ type: 'entryWrite', letter: 'C' }); s.send({ type: 'entryWrite', letter: 'D' }); s.send({ type: 'entryWrite', rest: true })
    expect(notes(s.state.present.project).slice(0, 3).map(note => [note.start, note.duration, note.kind])).toEqual([
      [ZERO, fraction(1, 4), 'note'], [fraction(1, 4), fraction(1, 4), 'note'], [fraction(1, 2), fraction(1, 4), 'rest'],
    ])
    expect(s.state.present.entry.cursor?.start).toEqual(fraction(3, 4))
    expect(validateProject(s.state.present.project)).toEqual([])
  })
  it('adds Shift-letter chord tones above the last entered note without advancing the cursor or changing duration', () => {
    const s = session(); s.send({ type: 'entryMode', enabled: true })
    s.send({ type: 'entryWrite', letter: 'C' })
    s.send({ type: 'entrySettings', settings: { duration: fraction(1, 2) } })
    s.send({ type: 'entryWrite', letter: 'E', chord: true }); s.send({ type: 'entryWrite', letter: 'G', chord: true })
    expect(tones(s.state.present.project)).toEqual([60, 64, 67])
    expect(notes(s.state.present.project)[0].duration).toEqual(fraction(1, 4))
    expect(s.state.present.entry.cursor?.start).toEqual(fraction(1, 4))
    expect(s.state.past).toHaveLength(3)
    s.send({ type: 'entryWrite', letter: 'D' })
    expect(notes(s.state.present.project)[1].start).toEqual(fraction(1, 4))
    expect(notes(s.state.present.project)[1].duration).toEqual(fraction(1, 2))
  })
  it('uses a selected note for Shift-letter chords outside input mode and rejects duplicate mouse pitches atomically', () => {
    const project = createProject(), first = allSelections(project)[0], s = session(project)
    s.send({ type: 'pick', selection: first }); s.send({ type: 'entryWrite', letter: 'E', chord: true })
    expect(tones(s.state.present.project)).toEqual([60, 64])
    const before = s.state.present.project
    s.send({ type: 'entryWrite', chordTarget: first, pitch: { step: 'C', octave: 4, alter: 0 } })
    expect(s.state.present.project).toBe(before)
    expect(s.state.notice).toContain('이미')
    s.send({ type: 'undo' }); expect(tones(s.state.present.project)).toEqual([60])
  })
  it('uses the nearest octave for sequential letters and the next higher occurrence for chord letters', () => {
    const project = createProject(false), entry = beginEntry(project, createNoteEntry(), null)
    expect(letterPitch(project, entry, 'B')).toEqual({ step: 'B', octave: 3, alter: 0 })
    expect(letterPitch(project, entry, 'C', { step: 'G', octave: 4, alter: 0 })).toEqual({ step: 'C', octave: 5, alter: 0 })
    expect(() => letterPitch(project, entry, 'C', { step: 'C', octave: 7, alter: 0 })).toThrow('음역')
  })
  it('follows key signatures, explicit accidentals and shared bar-local state, resetting at the next bar', () => {
    let project = createProject(false)
    project = { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: setKeySignature(staff.score, 1) })) })) }
    const s = session(project); s.send({ type: 'entryMode', enabled: true })
    s.send({ type: 'entryWrite', letter: 'F' })
    expect(tones(s.state.present.project)).toEqual([66])
    s.send({ type: 'entrySettings', settings: { accidental: 0 } }); s.send({ type: 'entryWrite', letter: 'F' }); s.send({ type: 'entryWrite', letter: 'F' })
    expect(notes(s.state.present.project).slice(1, 3).map(note => eventPitches(note)[0].alter)).toEqual([0, 0])
    const cursor = s.state.present.entry.cursor!
    expect(activeAlter(s.state.present.project, { ...cursor, start: fraction(1) }, 'F', 4)).toBe(1)
    s.send({ type: 'entryWrite', rest: true }); s.send({ type: 'entryWrite', letter: 'F' })
    expect(eventPitches(primaryScore(s.state.present.project).measures[1].voices[0].events[0])[0].alter).toBe(1)
  })
  it('replaces only the entered time span and keeps other instruments unchanged', () => {
    const project = createProject(), s = session(project)
    const other = project.parts[1].staves[0].score
    s.send({ type: 'entryMode', enabled: true }); s.send({ type: 'entrySettings', settings: { duration: fraction(1, 2) } })
    s.send({ type: 'entryWrite', letter: 'D' })
    expect(notes(s.state.present.project)[0]).toMatchObject({ start: ZERO, duration: fraction(1, 2), pitch: { step: 'D' } })
    expect(s.state.present.project.parts[1].staves[0].score).toBe(other)
    expect(validateProject(s.state.present.project)).toEqual([])
  })
  it('rejects barline crossing without changing data, selection, cursor or history', () => {
    const project = createProject(false), s = session(project)
    s.send({ type: 'entryMode', enabled: true }); s.send({ type: 'entrySettings', settings: { duration: fraction(1, 2) } })
    const before = s.state.present
    s.send({ type: 'entryWrite', position: { ...s.state.present.entry.cursor!, start: fraction(3, 4) }, letter: 'C' })
    expect(s.state.present).toBe(before)
    expect(s.state.past).toHaveLength(0)
    expect(s.state.notice).toContain('마디선')
    s.send({ type: 'entryWrite', position: { ...s.state.present.entry.cursor!, measureId: 'deleted-bar', start: fraction(1) }, pitch: { step: 'C', octave: 4, alter: 0 } })
    expect(s.state.present).toBe(before)
    expect(s.state.notice).toContain('마디를 찾을 수 없습니다')
  })
  it('appends all staves atomically when input continues past the last bar and undoes the new bar with the note', () => {
    const project = createProject(), first = allSelections(project)[0], staff = staffAt(project, first).staff, s = session(project)
    s.send({ type: 'entryMode', enabled: true })
    s.send({ type: 'entryWrite', position: { ...entryPosition(project, first), measureId: staff.score.measures.at(-1)!.id, start: fraction(1) }, letter: 'C' })
    expect(s.state.present.project.parts.every(part => part.staves.every(staff => staff.score.measures.length === 5))).toBe(true)
    expect(validateProject(s.state.present.project)).toEqual([])
    s.send({ type: 'undo' }); expect(s.state.present.project).toEqual(project)
    s.send({ type: 'redo' }); expect(primaryScore(s.state.present.project).measures).toHaveLength(5)
  })
  it('keeps 16th-note cursor arithmetic exact within a rest', () => {
    const project = createProject(false), entry = beginEntry(project, createNoteEntry(), null)
    const result = writeEntry(project, { ...entry, duration: fraction(1, 16) }, { step: 'C', octave: 4, alter: 0 }, { ...entry.cursor!, start: fraction(3, 16) })
    expect(locate(primaryScore(result.project), result.selection).event.start).toEqual(fraction(3, 16))
    expect(result.entry.cursor?.start).toEqual(fraction(1, 4))
    expect(validateProject(result.project)).toEqual([])
  })
  it('refuses unsupported automatic multi-fragment rewriting instead of silently retriggering a held note', () => {
    let project = createProject(false)
    const first = allSelections(project)[0]
    project = replaceEvent(project, first, event => ({ ...event, kind: 'note', pitch: { step: 'C', octave: 4, alter: 0 } }))
    const entry = beginEntry(project, createNoteEntry(), first)
    expect(() => writeEntry(project, { ...entry, duration: fraction(1, 16) }, { step: 'D', octave: 4, alter: 0 })).toThrow('붙임줄')
    expect(tones(project)).toEqual([60])
  })
  it('restores the next input position through Undo/Redo while keeping the chosen duration and mode', () => {
    const s = session(); s.send({ type: 'entryMode', enabled: true }); s.send({ type: 'entryWrite', letter: 'C' }); s.send({ type: 'entryWrite', letter: 'D' })
    s.send({ type: 'undo' }); expect(s.state.present.entry.cursor?.start).toEqual(fraction(1, 4))
    s.send({ type: 'redo' }); expect(s.state.present.entry.cursor?.start).toEqual(fraction(1, 2))
    s.send({ type: 'undo' }); s.send({ type: 'entryWrite', letter: 'E' })
    expect(notes(s.state.present.project).slice(0, 2).map(event => eventPitches(event)[0].step)).toEqual(['C', 'E'])
    expect(s.state.future).toHaveLength(0)
    expect(s.state.present.entry.enabled).toBe(true)
  })
  it('creates an input voice when requested, writes there only and undoes voice creation', () => {
    const s = session(); s.send({ type: 'entryMode', enabled: true }); s.send({ type: 'entryVoice', index: 1 })
    s.send({ type: 'entryWrite', letter: 'C' })
    const bar = primaryScore(s.state.present.project).measures[0]
    expect(bar.voices[0].events.every(event => event.kind === 'rest')).toBe(true)
    expect(bar.voices[1].events[0].kind).toBe('note')
    s.send({ type: 'undo' }); s.send({ type: 'undo' })
    expect(primaryScore(s.state.present.project).measures.every(bar => bar.voices.length === 1)).toBe(true)
    expect(validateProject(s.state.present.project)).toEqual([])
    const project = createProject(), other = session(project)
    other.send({ type: 'entryMode', enabled: true }); other.send({ type: 'entryMode', enabled: false })
    const guitar = allSelections(project).find(point => point.partId === project.parts[1].id)!
    other.send({ type: 'pick', selection: guitar }); other.send({ type: 'entryVoice', index: 1 })
    expect(primaryScore(other.state.present.project).measures[0].voices).toHaveLength(1)
    expect(staffAt(other.state.present.project, guitar).staff.score.measures[0].voices).toHaveLength(2)
  })
  it('deletes only the selected chord component and preserves rhythmic lengths', () => {
    const s = session(); s.send({ type: 'entryMode', enabled: true }); s.send({ type: 'entryWrite', letter: 'C' }); s.send({ type: 'entryWrite', letter: 'E', chord: true }); s.send({ type: 'entryWrite', letter: 'G', chord: true })
    s.send({ type: 'selection', selection: { ...s.state.present.selection!, pitchIndex: 1 } })
    s.send({ type: 'deleteSelected' }); expect(tones(s.state.present.project)).toEqual([60, 67])
    expect(notes(s.state.present.project)[0].duration).toEqual(fraction(1, 4))
    s.send({ type: 'undo' }); expect(tones(s.state.present.project)).toEqual([60, 64, 67])
  })
  it('toggles supported dotted values and explicitly rejects unsupported ones', () => {
    expect(dottedDuration(fraction(1, 4))).toEqual(fraction(3, 8))
    expect(dottedDuration(fraction(3, 8))).toEqual(fraction(1, 4))
    expect(dottedDuration(fraction(1, 16))).toEqual(fraction(3, 32))
    expect(dottedDuration(fraction(1, 32))).toEqual(fraction(3, 64))
    expect(() => dottedDuration(fraction(1, 64))).toThrow('점음표')
  })
  it('keeps the graphical chord tool preference out of score history and preserves redo', () => {
    const s = session(); s.send({ type: 'entryMode', enabled: true }); s.send({ type: 'entryWrite', letter: 'C' })
    s.send({ type: 'entrySettings', settings: { chord: true } })
    s.send({ type: 'entryWrite', letter: 'E', chord: true })
    s.send({ type: 'undo' })
    expect(tones(s.state.present.project)).toEqual([60])
    expect(s.state.present.entry.chord).toBe(true)
    s.send({ type: 'entrySettings', settings: { chord: false } })
    expect(s.state.future).toHaveLength(1)
    s.send({ type: 'redo' })
    expect(tones(s.state.present.project)).toEqual([60, 64])
    expect(s.state.present.entry.chord).toBe(false)
    expect(s.state.present.entry.cursor?.start).toEqual(fraction(1, 4))
    expect(validateProject(s.state.present.project)).toEqual([])
  })
})
