// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { add, equal, fraction, ZERO } from '../music/rational'
import { DURATIONS, eventPitches } from '../music/score'
import { measureDuration, TIME_SIGNATURES } from '../music/settings'
import type { TimeSignature } from '../music/settings'
import { midi } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { tieLinks } from '../music/ties'
import { compileTimeline } from '../playback/timeline'
import { parseProject, serializeProject } from '../files/project'
import { allSelections, createProject, makePart, primaryScore, rests, staffAt, validateProject } from './model'
import type { Project } from './model'
import { activeAlter, addEntryChord, beginEntry, createNoteEntry, writeEntry } from './noteEntry'
import { createProjectState, projectReducer } from './state'
import type { ProjectState } from './state'
import { copyScoreSelection, pasteScoreSelection } from './clipboard'
import { rangeSelection, singleSelection } from './selection'
import { longHeldProject, rhythmProject, rhythmTarget as target } from '../../tests/fixtures/rhythm'

const C: Pitch = { step: 'C', octave: 4, alter: 0 }
const E: Pitch = { step: 'E', octave: 4, alter: 0 }
function blank(time: TimeSignature, count = 4): Project {
  const project = createProject(false), capacity = measureDuration(time)
  return { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, timeSignature: time,
    measures: Array.from({ length: count }, (_, m) => ({ id: `bar-${m}`, voices: [{ id: 'voice', events: rests(capacity) }] })),
  } })) })) }
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) }
  return value
}
const stream = (project: Project) => primaryScore(project).measures.flatMap(bar => bar.voices[0].events)
const intervals = (project: Project, pitch = 60) => compileTimeline(project).notes.filter(note => note.midi === pitch).map(note => [note.startTick, note.endTick])

describe('automatic barline input', () => {
  it.each(TIME_SIGNATURES)('keeps every grid onset and supported duration exact in %s', time => {
    const project = blank(time), entry = beginEntry(project, createNoteEntry(), null), capacity = measureDuration(time)
    for (let offset = 0; offset <= capacity.n * 64 / capacity.d; offset++) for (const duration of DURATIONS) {
      const result = writeEntry(project, { ...entry, duration }, C, { ...entry.cursor!, start: fraction(offset, 64) })
      expect(validateProject(result.project)).toEqual([])
      const notes = compileTimeline(result.project).notes
      expect(notes).toHaveLength(1)
      expect([notes[0].startTick, notes[0].endTick]).toEqual([offset * 30, offset * 30 + duration.n * 1920 / duration.d])
      expect(stream(result.project).filter(event => event.kind === 'note').reduce((sum, event) => add(sum, event.duration), ZERO)).toEqual(duration)
      expect(result.entry.segments).toHaveLength(stream(result.project).filter(event => event.kind === 'note').length)
    }
  })
  it('splits a whole note across four 3/8 bars and adds exactly the missing bars to all staves', () => {
    const source = blank('3/8', 1), project = { ...source, parts: [...source.parts, makePart('bass', primaryScore(source))] }
    frozen(project)
    const entry = beginEntry(project, createNoteEntry(), null)
    const result = writeEntry(project, { ...entry, duration: fraction(1) }, C, { ...entry.cursor!, start: fraction(1, 4) })
    expect(primaryScore(result.project).measures).toHaveLength(4)
    expect(stream(result.project).filter(event => event.kind === 'note').map(event => event.duration)).toEqual([fraction(1, 8), fraction(3, 8), fraction(3, 8), fraction(1, 8)])
    expect(tieLinks(primaryScore(result.project))).toHaveLength(3)
    expect(result.entry.cursor).toMatchObject({ measureId: primaryScore(result.project).measures[3].id, start: fraction(1, 8) })
    expect(result.project.parts[1].staves[0].score.measures.every(bar => bar.voices[0].events.every(event => event.kind === 'rest'))).toBe(true)
    expect(intervals(result.project)).toEqual([[480, 2400]])
    expect(validateProject(result.project)).toEqual([])
    expect(primaryScore(project).measures).toHaveLength(1)
  })
  it('adds chord pitches to every automatically written fragment without advancing again', () => {
    const project = blank('3/8', 1), entry = beginEntry(project, createNoteEntry(), null)
    const note = writeEntry(project, { ...entry, duration: fraction(1) }, C, { ...entry.cursor!, start: fraction(1, 4) })
    const chord = addEntryChord(note.project, note.entry, note.selection, E)
    expect(stream(chord.project).filter(event => event.kind === 'note').map(event => eventPitches(event).map(midi))).toEqual(Array(4).fill([60, 64]))
    expect(tieLinks(primaryScore(chord.project)).map(link => link.midi)).toEqual([60, 64, 60, 64, 60, 64])
    expect(intervals(chord.project, 64)).toEqual([[480, 2400]])
    expect(chord.entry.cursor).toEqual(note.entry.cursor)
    expect(() => addEntryChord(chord.project, chord.entry, chord.selection, E)).toThrow('이미')
  })
  it('splits rests across bars without creating any sounded notes or ties', () => {
    const project = blank('2/4', 1), entry = beginEntry(project, createNoteEntry(), null)
    const result = writeEntry(project, { ...entry, duration: fraction(1) }, null, { ...entry.cursor!, start: fraction(1, 4) })
    expect(primaryScore(result.project).measures).toHaveLength(3)
    expect(stream(result.project).every(event => event.kind === 'rest')).toBe(true)
    expect(tieLinks(primaryScore(result.project))).toEqual([])
    expect(result.entry.last).toBeNull(); expect(result.entry.segments).toEqual([])
    expect(result.entry.cursor?.start).toEqual(fraction(1, 4))
  })
  it('carries a split altered pitch without changing the new bar accidental state', () => {
    const project = blank('4/4'), entry = beginEntry(project, createNoteEntry(), null)
    const result = writeEntry(project, { ...entry, duration: fraction(1, 2) }, { step: 'F', octave: 4, alter: 1 }, { ...entry.cursor!, start: fraction(3, 4) })
    expect(activeAlter(result.project, result.entry.cursor!, 'F', 4)).toBe(0)
    expect(stream(result.project).filter(event => event.kind === 'note').map(event => eventPitches(event).map(midi))).toEqual([[66], [66]])
  })
  it('rejects event-count overflow from automatic fragments without touching the valid source', () => {
    const base = blank('4/4', 128), template = primaryScore(base)
    const project: Project = { ...base, parts: [0, 1].map(p => {
      const part = makePart('piano', template)
      return { ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map((bar, m) => {
        const short = p === 0 || m < 121 ? 64 : m === 121 ? 56 : 0
        return { ...bar, voices: bar.voices.map(voice => ({ ...voice, events: [
          ...Array.from({ length: short }, (_, i) => ({ id: `limit-${p}-${m}-${i}`, kind: 'rest' as const, start: fraction(i, 64), duration: fraction(1, 64) })),
          ...(short < 64 ? [{ id: `limit-${p}-${m}-tail`, kind: 'rest' as const, start: fraction(short, 64), duration: fraction(64 - short, 64) }] : []),
        ] })) }
      }) } })) }
    }) }
    expect(validateProject(project)).toEqual([])
    const destination = allSelections(project).find(point => point.partId === project.parts[1].id && point.measureId === project.parts[1].staves[0].score.measures[122].id)!
    const entry = beginEntry(project, createNoteEntry(), destination), before = serializeProject(project)
    expect(() => writeEntry(project, { ...entry, duration: fraction(1, 64) }, C)).toThrow('16,000')
    expect(serializeProject(project)).toBe(before)
  })
  it('commits the entire split and all appended bars as one undo while retaining current sound settings', () => {
    const project = blank('3/8', 1)
    let state = projectReducer(createProjectState(project), { type: 'entryMode', enabled: true })
    state = projectReducer(state, { type: 'entrySettings', settings: { duration: fraction(1) } })
    const cursor = { ...state.present.entry.cursor!, start: fraction(1, 4) }
    state = projectReducer(state, { type: 'entryWrite', position: cursor, pitch: C })
    expect(state.past).toHaveLength(1)
    const written = state.present.project, afterCursor = state.present.entry.cursor
    state = projectReducer(state, { type: 'sound', change: p => ({ ...p, masterVolume: 0.2 }) })
    state = projectReducer(state, { type: 'undo' })
    expect(primaryScore(state.present.project)).toEqual(primaryScore(project))
    expect(state.present.project.masterVolume).toBe(0.2)
    state = projectReducer(state, { type: 'redo' })
    expect(primaryScore(state.present.project)).toEqual(primaryScore(written))
    expect(state.present.entry.cursor).toEqual(afterCursor)
    state = projectReducer(state, { type: 'entryWrite', pitch: { step: 'G', octave: 4, alter: 0 }, chord: true })
    expect(intervals(state.present.project, 67)).toEqual([[480, 2400]])
  })
  it('rejects off-grid positions, drum ties and the 128-bar limit atomically, keeping redo', () => {
    const project = blank('4/4', 128)
    let state = projectReducer(createProjectState(project), { type: 'entryMode', enabled: true })
    state = projectReducer(state, { type: 'entryWrite', pitch: C })
    state = projectReducer(state, { type: 'undo' })
    const before = state
    state = projectReducer(state, { type: 'entryWrite', position: { ...state.present.entry.cursor!, measureId: 'bar-127', start: fraction(3, 4) }, pitch: C })
    // Quarter ends exactly at bar 128, with no superfluous appended bar.
    expect(primaryScore(state.present.project).measures).toHaveLength(128)
    state = projectReducer(before, { type: 'entrySettings', settings: { duration: fraction(1, 2) } })
    const attempted = state
    state = projectReducer(state, { type: 'entryWrite', position: { ...state.present.entry.cursor!, measureId: 'bar-127', start: fraction(3, 4) }, pitch: C })
    expect(state.present).toBe(attempted.present); expect(state.future).toBe(attempted.future); expect(state.past).toBe(attempted.past)
    expect(state.notice).toContain('128')
    const entry = beginEntry(project, createNoteEntry(), null)
    expect(() => writeEntry(project, entry, C, { ...entry.cursor!, start: fraction(1, 128) })).toThrow('64분')
    const drum = makePart('drums', primaryScore(project)), drums = { ...project, parts: [drum] }
    const drumEntry = beginEntry(drums, createNoteEntry(), null)
    expect(() => writeEntry(drums, { ...drumEntry, duration: fraction(1, 2) }, { step: 'C', octave: 2, alter: 0 }, { ...drumEntry.cursor!, start: fraction(3, 4) })).toThrow('타악기')
  })
})

describe('overwrite boundaries and shifted clipboard ties', () => {
  it.each([C, { step: 'D', octave: 4, alter: 0 } as Pitch])('keeps only the unoverwritten sustained intervals when inserting $step', pitch => {
    const project = frozen(longHeldProject()), entry = beginEntry(project, createNoteEntry(), target(1))
    const result = writeEntry(project, { ...entry, duration: fraction(1, 16) }, pitch, { ...entry.cursor!, start: fraction(5, 16) })
    const expected = pitch.step === 'C' ? [[0, 2520], [2520, 2640], [2640, 7680]] : [[0, 2520], [2640, 7680]]
    expect(intervals(result.project)).toEqual(expected)
    expect(primaryScore(result.project).measures[1].voices[0].events[0].id).toBe(target(1).eventId)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(serializeProject(result.project))).toEqual(result.project)
  })
  it('uses the same multi-fragment preservation when pasting into a held note', () => {
    const source = frozen(longHeldProject()), entry = beginEntry(source, createNoteEntry(), target(1))
    // Introduce a real onset at 5/16 while preserving the surrounding held note.
    const prepared = writeEntry(source, { ...entry, duration: fraction(1, 64) }, C, { ...entry.cursor!, start: fraction(5, 16) }).project
    const score = primaryScore(prepared), onset = score.measures[1].voices[0].events.find(event => equal(event.start, fraction(5, 16)))!
    const clip = frozen({ span: fraction(1, 16), rows: [{ events: [{ offset: ZERO, duration: fraction(1, 16), pitches: [E] }] }] })
    const result = pasteScoreSelection(frozen(prepared), clip, { ...target(1), eventId: onset.id }).project
    expect(intervals(result)).toEqual([[0, 2520], [2640, 7680]])
    expect(intervals(result, 64)).toEqual([[2520, 2640]])
    expect(validateProject(result)).toEqual([])
  })
  it('splits every chord component on shifted paste and preserves partial outgoing ties', () => {
    const project = rhythmProject(), score = primaryScore(project)
    const clip = frozen({ span: fraction(1, 2), rows: [{ events: [
      { offset: ZERO, duration: fraction(1, 4), pitches: [C, E], tieTo: [60] },
      { offset: fraction(1, 4), duration: fraction(1, 4), pitches: [C, { step: 'G' as const, octave: 4, alter: 0 as const }] },
    ] }] })
    // Destination 7/8 comes from a normal short-note edit, not a fake clipboard cursor.
    const entry = beginEntry(project, createNoteEntry(), target(3, 3))
    const prepared = writeEntry(project, { ...entry, duration: fraction(1, 8) }, null).project
    const tail = primaryScore(prepared).measures[3].voices[0].events.at(-1)!
    const result = pasteScoreSelection(prepared, clip, { ...target(3), eventId: tail.id })
    expect(result.addedMeasures).toBe(1)
    expect(intervals(result.project).filter(([start]) => start >= 7440)).toEqual([[7440, 8400]])
    expect(intervals(result.project, 64).filter(([start]) => start >= 7440)).toEqual([[7440, 7920]])
    expect(intervals(result.project, 67).filter(([start]) => start >= 7440)).toEqual([[7920, 8400]])
    expect(result.selected.targets).toHaveLength(6)
    expect(staffAt(result.project, target()).staff.score.measures.slice(0, 3)).toEqual(score.measures.slice(0, 3))
    expect(validateProject(result.project)).toEqual([])
  })
  it('maps multiple copied rows downward, skips excess rows and restores the entire paste with one undo', () => {
    const project = rhythmProject(), clip = copyScoreSelection(project, rangeSelection(project, target(0), target(0, 1, 0, 1)))
    let state: ProjectState = { ...createProjectState(project), clipboard: clip }
    state = projectReducer(state, { type: 'paste', target: target(3, 1, 0, 1) })
    expect(state.notice).toContain('1개 성부 건너뜀')
    expect(primaryScore(state.present.project).measures).toHaveLength(5)
    expect(primaryScore(state.present.project).measures[3].voices[0]).toBe(primaryScore(project).measures[3].voices[0])
    expect(state.past).toHaveLength(1)
    state = projectReducer(state, { type: 'undo' }); expect(state.present.project).toEqual(project)
  })
  it('pastes across a different meter using actual timing and never carries an unselected external tie', () => {
    const source = longHeldProject(), clip = copyScoreSelection(source, singleSelection(target()))
    expect(clip.rows[0].events[0].tieTo).toBeUndefined()
    const project = blank('3/8', 1), destination = allSelections(project)[0]
    const result = pasteScoreSelection(project, clip, destination)
    expect(intervals(result.project)).toEqual([[0, 1920]])
    expect(tieLinks(primaryScore(result.project))).toHaveLength(2)
    expect(validateProject(result.project)).toEqual([])
  })
  it('does not sanitize invalid copied ties into a false success or change the source on failure', () => {
    const project = frozen(rhythmProject()), clip = frozen({ span: fraction(1, 4), rows: [{ events: [{ offset: ZERO, duration: fraction(1, 4), pitches: [C], tieTo: [61] }] }] })
    expect(() => pasteScoreSelection(project, clip, target(3))).toThrow('붙임줄')
    expect(primaryScore(project).measures).toHaveLength(4)
  })
})
