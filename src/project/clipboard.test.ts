// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clipboardProject, clipboardTarget as target } from '../../tests/fixtures/clipboard'
import { copyScoreSelection, pasteScoreSelection } from './clipboard'
import { isGroupSelection, pickSelection, rangeSelection, singleSelection, voiceRows } from './selection'
import { eventPitches, locate, retime } from '../music/score'
import { add, fraction, ZERO } from '../music/rational'
import { midi } from '../music/pitch'
import { makePart, primaryScore, replaceEvent, rests, staffAt, validateProject } from './model'
import type { Project, ProjectSelection } from './model'
import { createProjectState, projectReducer } from './state'
import { removeMeasure } from './structure'
import { parseProject, serializeProject } from '../files/project'
import { compileTimeline } from '../playback/timeline'

const event = (project: Project, point: ProjectSelection) => locate(staffAt(project, point).staff.score, point).event
const notes = (project: Project, p = 0, v = 0, m = 0) => project.parts[p].staves[0].score.measures[m].voices[v].events
const pitches = (project: Project, p = 0, v = 0, m = 0) => notes(project, p, v, m).map(item => eventPitches(item).map(midi))
const freeze = (value: unknown) => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } }

describe('detached musical clipboard', () => {
  it('copies only the chosen chord tone for a single selection and detaches all values', () => {
    const project = clipboardProject(), before = structuredClone(project)
    freeze(project)
    const clip = copyScoreSelection(project, singleSelection(target(0, 0, 0, 0, 1)))
    expect(clip).toEqual({ span: fraction(1, 4), rows: [{ events: [{ offset: ZERO, duration: fraction(1, 4), pitches: [{ step: 'E', octave: 4, alter: 0 }] }] }] })
    expect(clip.rows[0].events[0].pitches[0]).not.toBe(eventPitches(event(project, target()))[1])
    expect(project).toEqual(before)
    expect(JSON.stringify(clip)).not.toContain('event-')
  })
  it('copies a complete chord and intervening voices for a loose same-time Shift range', () => {
    const project = clipboardProject(), clip = copyScoreSelection(project, rangeSelection(project, target(), target(1)))
    expect(clip.rows).toHaveLength(3)
    expect(clip.rows.map(row => row.events[0].pitches.map(midi))).toEqual([[60, 64, 67], [48], [72]])
    expect(clip.span).toEqual(fraction(1, 4))
  })
  it('copies Ctrl-picked pitches and only the explicitly selected rows, preserving time gaps', () => {
    const project = clipboardProject()
    let selected = singleSelection(target(0, 0, 0, 0, 2))
    selected = pickSelection(project, selected, target(0, 0, 0, 2), false, true)!
    selected = pickSelection(project, selected, target(2), false, true)!
    const clip = copyScoreSelection(project, selected)
    expect(clip.rows).toHaveLength(2)
    expect(clip.rows[0].events.map(item => [item.offset, item.pitches.map(midi)])).toEqual([[ZERO, [67]], [fraction(1, 2), [64]]])
    expect(clip.rows[1].events[0].pitches.map(midi)).toEqual([36])
    expect(clip.span).toEqual(fraction(3, 4))
  })
  it('normalizes reverse ranges and copies full measure time with all its voices', () => {
    const project = clipboardProject()
    expect(copyScoreSelection(project, rangeSelection(project, target(1, 0, 1, 1), target()))).toEqual(copyScoreSelection(project, rangeSelection(project, target(), target(1, 0, 1, 1))))
    const clip = copyScoreSelection(project, pickSelection(project, null, { ...target(0, 1, 0, 2), scope: 'measure' }))
    expect(clip.rows).toHaveLength(2); expect(clip.span).toEqual(fraction(1))
  })
  it('includes selected rests without inventing pitches and refuses empty/stale selections', () => {
    const source = clipboardProject(), project = replaceEvent(source, target(), item => ({ id: item.id, start: item.start, duration: item.duration, kind: 'rest' }))
    expect(copyScoreSelection(project, singleSelection(target())).rows[0].events[0].pitches).toEqual([])
    expect(() => copyScoreSelection(project, null)).toThrow('선택')
    expect(() => copyScoreSelection(project, singleSelection({ ...target(), eventId: 'missing' }))).toThrow('유효')
  })
})

describe('atomic multi-voice overwrite paste', () => {
  it('maps selected rows down existing voices/staves without adding instruments or voices', () => {
    const project = clipboardProject(), before = structuredClone(project)
    const clip = copyScoreSelection(project, rangeSelection(project, target(), target(1)))
    freeze(project); freeze(clip)
    const result = pasteScoreSelection(project, clip, target(0, 1, 1))
    expect(pitches(result.project, 0, 1, 1)[0]).toEqual([60, 64, 67])
    expect(pitches(result.project, 1, 0, 1)[0]).toEqual([48])
    expect(pitches(result.project, 2, 0, 1)[0]).toEqual([72])
    expect(voiceRows(result.project)).toEqual(voiceRows(project))
    expect(result.skippedRows).toBe(0)
    expect(project).toEqual(before)
    expect(validateProject(result.project)).toEqual([])
  })
  it('skips rows beyond the final destination voice and reports their number', () => {
    const project = clipboardProject(), clip = copyScoreSelection(project, rangeSelection(project, target(), target(1)))
    const result = pasteScoreSelection(project, clip, target(2, 0, 1))
    expect(result.skippedRows).toBe(2)
    expect(pitches(result.project, 2, 0, 1)[0]).toEqual([60, 64, 67])
    expect(result.project.parts[0].staves[0].score).toBe(project.parts[0].staves[0].score) // music on unaffected staves is retained below
  })
  it('overwrites only the pasted time span and preserves later events, tempo and sound', () => {
    const project = clipboardProject(), clip = copyScoreSelection(project, singleSelection(target(1)))
    const result = pasteScoreSelection(project, clip, target(0, 0, 1, 1))
    expect(pitches(result.project, 0, 0, 1)).toEqual([[60, 64, 67], [72], [64], [67]])
    expect(notes(result.project, 0, 0, 1)[0]).toBe(notes(project, 0, 0, 1)[0])
    expect(notes(result.project, 0, 0, 1)[2]).toBe(notes(project, 0, 0, 1)[2])
    expect(result.project.tempos).toBe(project.tempos)
    expect(result.project.parts.map(part => part.mixer)).toEqual(project.parts.map(part => part.mixer))
  })
  it('retains sparse Ctrl time offsets and fills the copied holes with rests', () => {
    const project = clipboardProject()
    const selected = pickSelection(project, singleSelection(target()), target(0, 0, 0, 2), false, true)!
    const result = pasteScoreSelection(project, copyScoreSelection(project, selected), target(1, 0, 1))
    expect(notes(result.project, 1, 0, 1).map(item => [item.kind, item.start, item.duration])).toEqual([
      ['note', ZERO, fraction(1, 4)], ['rest', fraction(1, 4), fraction(1, 4)], ['note', fraction(1, 2), fraction(1, 4)], ['note', fraction(3, 4), fraction(1, 4)],
    ])
  })
  it('appends only the missing measures across the whole score, with silence on other rows', () => {
    const project = clipboardProject(), clip = copyScoreSelection(project, rangeSelection(project, { ...target(), scope: 'measure' }, { ...target(0, 0, 1), scope: 'measure' }))
    const result = pasteScoreSelection(project, clip, target(0, 0, 3))
    expect(result.addedMeasures).toBe(1)
    expect(result.project.parts.every(part => part.staves.every(staff => staff.score.measures.length === 5))).toBe(true)
    expect(notes(result.project, 2, 0, 4).every(item => item.kind === 'rest')).toBe(true)
    expect(isGroupSelection(result.selected)).toBe(true)
    expect(new Set(result.project.parts.flatMap(part => part.staves.flatMap(staff => staff.score.measures.flatMap(bar => bar.voices.flatMap(voice => voice.events.map(item => item.id)))))).size).toBe(result.project.parts.flatMap(part => part.staves.flatMap(staff => staff.score.measures.flatMap(bar => bar.voices.flatMap(voice => voice.events)))).length)
  })
  it('preserves actual pitches and spelling across a different clef and key', () => {
    const source = clipboardProject(), clip = copyScoreSelection(source, rangeSelection(source, target(), target(0, 0, 0, 0, 2)))
    const project = { ...source, parts: source.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, keySignature: 7 } })) })) }
    const result = pasteScoreSelection(project, clip, target(2, 0, 1))
    expect(pitches(result.project, 2, 0, 1)[0]).toEqual([60, 64, 67])
    expect(result.project.parts[2].staves[0].clef).toBe('bass')
  })
  it('allows a different meter when notes fit, splitting rests at destination barlines', () => {
    const source = clipboardProject(), clip = copyScoreSelection(source, pickSelection(source, null, { ...target(), scope: 'measure' }))
    const state = projectReducer(createProjectState(source), { type: 'canvas', ...target(), action: { type: 'timeSignature', time: '12/8' } })
    const project = state.present.project
    const result = pasteScoreSelection(project, clip, target(0, 0, 1))
    expect(notes(result.project, 0, 0, 1).slice(0, 4).map(item => item.duration)).toEqual(Array(4).fill(fraction(1, 4)))
    expect(validateProject(result.project)).toEqual([])
    const restClip = { span: fraction(1), rows: [{ events: [{ offset: ZERO, duration: fraction(1), pitches: [] }] }] }
    const smaller = projectReducer(createProjectState(source), { type: 'change', change: before => ({ ...before, parts: before.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, timeSignature: '2/4', measures: staff.score.measures.map(bar => ({ ...bar, voices: bar.voices.map(voice => ({ ...voice, events: [{ id: voice.events[0].id, kind: 'rest', start: ZERO, duration: fraction(1, 2) }] })) })) } })) })) }) }).present.project
    const next = pasteScoreSelection(smaller, restClip, target())
    expect(notes(next.project)[0]).toMatchObject({ kind: 'rest', duration: fraction(1, 2) })
    expect(notes(next.project, 0, 0, 1)[0].kind).toBe('rest')
  })
  it('preserves representable fragments outside an overwrite window', () => {
    const source = clipboardProject(), clip = copyScoreSelection(source, singleSelection(target(1)))
    const project = { ...source, parts: source.parts.map((part, p) => p ? part : { ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map((bar, m) => m !== 1 ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice, events: [{ ...voice.events[0], duration: fraction(1) }] }) }) } })) }) }
    const alteredTarget = { ...target(0, 0, 1), scope: 'measure' as const }
    const next = pasteScoreSelection(project, clip, alteredTarget)
    expect(notes(next.project, 0, 0, 1).map(item => item.duration)).toEqual([fraction(1, 4), fraction(3, 4)])
    expect(validateProject(next.project)).toEqual([])
  })
  it('rejects bar-crossing notes or unsupported boundary fragments without changing inputs', () => {
    const project = clipboardProject(), before = structuredClone(project)
    const long = { span: fraction(1, 2), rows: [{ events: [{ offset: ZERO, duration: fraction(1, 2), pitches: [{ step: 'C' as const, octave: 4, alter: 0 as const }] }] }] }
    expect(() => pasteScoreSelection(project, long, target(0, 0, 3, 3))).toThrow('마디선')
    const whole = { ...project, parts: project.parts.map((part, p) => p ? part : { ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map((bar, m) => m ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice, events: [{ ...voice.events[0], duration: fraction(1) }] }) }) } })) }) }
    const short = { span: fraction(1, 16), rows: [{ events: [{ offset: ZERO, duration: fraction(1, 16), pitches: [{ step: 'C' as const, octave: 5, alter: 0 as const }] }] }] }
    expect(() => pasteScoreSelection(whole, short, target())).toThrow('붙임줄')
    expect(project).toEqual(before)
  })
  it('rejects project size overflow and stale or missing destinations atomically', () => {
    const project = clipboardProject(), clip = copyScoreSelection(project, singleSelection(target()))
    expect(() => pasteScoreSelection(project, null, target())).toThrow('복사')
    expect(() => pasteScoreSelection(project, clip, null)).toThrow('선택')
    expect(() => pasteScoreSelection(project, clip, { ...target(), eventId: 'missing' })).toThrow('선택')
    expect(() => pasteScoreSelection(project, { ...clip, span: fraction(129) }, target())).toThrow('128')
  })
  it('round-trips pasted notes/rests/chords and compiles actual playback from canonical data', () => {
    const project = clipboardProject(), clip = copyScoreSelection(project, rangeSelection(project, target(), target(1, 0, 1, 2)))
    const next = pasteScoreSelection(project, clip, target(0, 0, 2)).project
    expect(parseProject(serializeProject(next))).toEqual(next)
    expect(compileTimeline(next).notes.length).toBeGreaterThan(0)
    expect(notes(next, 0, 0, 2).reduce((end, item) => add(end, item.duration), ZERO)).toEqual(fraction(1))
  })
  it('preserves exact sixteenth offsets and dotted lengths without quantizing pasted notes', () => {
    const source = clipboardProject()
    const project = { ...source, parts: source.parts.map((part, p) => p ? part : { ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
      measures: staff.score.measures.map((bar, m) => m ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice, events: retime([
        { id: 'lead', kind: 'rest', start: ZERO, duration: fraction(1, 16) },
        { id: 'dot', kind: 'note', pitch: { step: 'F', octave: 4, alter: 1 }, start: ZERO, duration: fraction(3, 16) },
        { id: 'short', kind: 'note', pitch: { step: 'G', octave: 4, alter: 0 }, start: ZERO, duration: fraction(1, 16) }, ...rests(fraction(11, 16)),
      ]) }) }),
    } })) }) }
    const clip = copyScoreSelection(project, rangeSelection(project, { ...target(), eventId: 'dot' }, { ...target(), eventId: 'short' }))
    expect(clip.span).toEqual(fraction(1, 4))
    expect(clip.rows[0].events[1].offset).toEqual(fraction(3, 16))
    const pasted = pasteScoreSelection(project, clip, target(1, 0, 1, 1)).project
    expect(notes(pasted, 1, 0, 1).slice(1, 3).map(item => [item.start, item.duration])).toEqual([[fraction(1, 4), fraction(3, 16)], [fraction(7, 16), fraction(1, 16)]])
    expect(validateProject(pasted)).toEqual([])
  })
  it('rejects an unsupported drum destination after other rows were prepared, including new bars', () => {
    const source = clipboardProject(), project = { ...source, parts: [...source.parts, makePart('drums', primaryScore(source))] }
    const clip = copyScoreSelection(project, rangeSelection(project, { ...target(), scope: 'measure' }, { ...target(1, 0, 1), scope: 'measure' }))
    const before = structuredClone(project); freeze(project)
    expect(() => pasteScoreSelection(project, clip, target(1, 0, 3))).toThrow('드럼')
    expect(project).toEqual(before)
    expect(primaryScore(project).measures).toHaveLength(4)
  })
})

describe('clipboard history and external sound isolation', () => {
  it('copy preserves redo and lives outside score snapshots, undo and project replacement', () => {
    let state = projectReducer(createProjectState(clipboardProject()), { type: 'pick', selection: target() })
    state = projectReducer(state, { type: 'canvas', ...target(), action: { type: 'pitch', amount: -1, chromatic: true } })
    state = projectReducer(state, { type: 'undo' })
    state = projectReducer(state, { type: 'copySelected' })
    expect(state.future).toHaveLength(1); expect(state.past).toHaveLength(0)
    const clip = state.clipboard
    state = projectReducer(state, { type: 'redo' })
    expect(state.clipboard).toBe(clip)
    state = projectReducer(state, { type: 'change', change: before => removeMeasure(before, 3), selection: null })
    expect(state.clipboard).toBe(clip)
  })
  it('one undo/redo includes every pasted row and appended bar while keeping current mixers', () => {
    const original = clipboardProject()
    let state = projectReducer(createProjectState(original), { type: 'pick', selection: { ...target(), scope: 'measure' } })
    state = projectReducer(state, { type: 'copySelected' })
    state = projectReducer(state, { type: 'paste', target: target(0, 0, 3, 1) })
    expect(state.past).toHaveLength(1)
    expect(primaryScore(state.present.project).measures).toHaveLength(5)
    const pasted = state.present.project
    state = projectReducer(state, { type: 'sound', change: before => ({ ...before, masterVolume: 0.3, parts: before.parts.map((part, i) => i ? part : { ...part, mixer: { ...part.mixer, pan: -0.4, mute: true, solo: true, program: 10 } }) }) })
    state = projectReducer(state, { type: 'undo' })
    expect(primaryScore(state.present.project).measures).toHaveLength(4)
    expect(state.present.project.masterVolume).toBe(0.3)
    expect(state.present.project.parts[0].mixer).toMatchObject({ pan: -0.4, mute: true, solo: true, program: 10 })
    state = projectReducer(state, { type: 'redo' })
    expect(primaryScore(state.present.project)).toEqual(primaryScore(pasted))
    expect(state.present.project.parts[0].mixer.pan).toBe(-0.4)
    expect(isGroupSelection(state.present.selected)).toBe(true)
    state = projectReducer(state, { type: 'canvas', ...target(), action: { type: 'duration', duration: fraction(1, 8) } })
    expect(state.notice).toContain('그룹')
  })
  it('failed paste preserves clipboard, music, history and redo with an explanation', () => {
    let state = projectReducer(createProjectState(clipboardProject()), { type: 'pick', selection: target() })
    state = projectReducer(state, { type: 'canvas', ...target(), action: { type: 'pitch', amount: -1, chromatic: true } })
    state = projectReducer(state, { type: 'undo' })
    state = projectReducer(state, { type: 'copySelected' })
    const before = state
    state = projectReducer(state, { type: 'paste', target: { ...target(), eventId: 'gone' } })
    expect(state.present).toBe(before.present)
    expect(state.past).toBe(before.past); expect(state.future).toBe(before.future); expect(state.clipboard).toBe(before.clipboard)
    expect(state.future).toHaveLength(1)
    expect(state.notice).toContain('선택')
  })
})
