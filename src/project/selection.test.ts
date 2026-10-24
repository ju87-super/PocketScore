// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { allSelections, createProject, primaryScore, replaceEvent, staffAt, validateProject } from './model'
import type { Project, ProjectSelection } from './model'
import { addVoice } from './structure'
import { isGroupSelection, pickSelection, rangeSelection, singleSelection, transposeSelection } from './selection'
import { createProjectState, projectReducer } from './state'
import { eventPitches, locate } from '../music/score'
import { midi } from '../music/pitch'
import { fraction } from '../music/rational'

const E = { step: 'E', octave: 4, alter: 0 } as const
const G = { step: 'G', octave: 4, alter: 0 } as const
function fixture() {
  let project = createProject()
  const first = allSelections(project)[0]
  project = addVoice(project, first.staffId)
  project = replaceEvent(project, first, event => event.kind === 'note' ? { ...event, chord: [E, G] } : event)
  const second = allSelections(project).find(point => point.staffId === first.staffId && point.voiceId !== first.voiceId)!
  project = replaceEvent(project, second, event => ({ ...event, kind: 'note', pitch: E }))
  const guitar = allSelections(project).find(point => point.partId === project.parts[1].id)!
  return { project, first: { ...first, pitchIndex: 0 }, second, guitar }
}
const pitches = (project: Project, target: ProjectSelection) => eventPitches(locate(staffAt(project, target).staff.score, target).event).map(midi)

describe('score identity selection, independent of notation geometry', () => {
  it('selects a loose same-time column across voices and instruments, including intermediate rows', () => {
    const { project, first, guitar } = fixture()
    const selected = rangeSelection(project, first, guitar)
    expect(selected.targets).toHaveLength(5)
    expect(new Set(selected.targets.map(target => target.staffId)).size).toBe(2)
    expect(new Set(selected.targets.map(target => target.voiceId)).size).toBe(3)
    expect(selected.targets.every(target => locate(staffAt(project, target).staff.score, target).event.start.n === 0)).toBe(true)
  })
  it('uses measure plus exact rational onset, not just beat number, and supports reverse ranges', () => {
    const { project, first, guitar } = fixture()
    const later = allSelections(project).find(target => target.staffId === guitar.staffId && target.measureId !== guitar.measureId)!
    const forward = rangeSelection(project, first, later)
    const reverse = rangeSelection(project, later, first)
    expect(reverse.targets).toEqual(forward.targets)
    expect(forward.targets.length).toBeGreaterThan(5)
    expect(forward.targets.some(target => locate(staffAt(project, target).staff.score, target).event.kind === 'rest')).toBe(true)
  })
  it('Ctrl chooses individual chord tones across staves, toggles them, and ignores rests/measures', () => {
    const { project, first, guitar } = fixture()
    let selected = singleSelection(first)
    expect(isGroupSelection(pickSelection(project, null, first, false, true))).toBe(false)
    selected = pickSelection(project, selected, { ...first, pitchIndex: 2 }, false, true)!
    selected = pickSelection(project, selected, guitar, false, true)!
    expect(selected.targets).toHaveLength(3)
    const rest = allSelections(project).find(target => locate(staffAt(project, target).staff.score, target).event.kind === 'rest')!
    expect(pickSelection(project, selected, rest, false, true)).toBe(selected)
    expect(pickSelection(project, selected, { ...first, scope: 'measure' }, false, true)).toBe(selected)
    selected = pickSelection(project, selected, guitar, false, true)!
    expect(selected.targets).toHaveLength(2)
    expect(pitches(transposeSelection(project, selected, 1), first)).toEqual([61, 64, 68])
    expect(pitches(project, first)).toEqual([60, 64, 67])
  })
  it('selects every voice of a measure and retains an anchor when the range contracts', () => {
    const { project, first, guitar } = fixture()
    const bar = pickSelection(project, null, { ...first, scope: 'measure' })!
    expect(bar.targets.some(target => target.voiceId !== first.voiceId)).toBe(true)
    expect(isGroupSelection(bar)).toBe(true)
    const expanded = pickSelection(project, singleSelection(first), guitar, true)!
    const contracted = pickSelection(project, expanded, first, true)!
    expect(contracted.anchor).toEqual(first)
    expect(contracted.targets).toHaveLength(3)
  })
  it('rejects an out-of-range batch and collisions atomically, preserving intervals otherwise', () => {
    const { project, first, guitar } = fixture()
    const selection = rangeSelection(project, first, guitar)
    const next = transposeSelection(project, selection, 1)
    expect(pitches(next, first)).toEqual([61, 65, 68])
    expect(validateProject(next)).toEqual([])
    expect(() => transposeSelection(project, singleSelection(first), 4)).toThrow('겹칩니다')
    expect(() => transposeSelection(project, selection, 50)).toThrow('음역')
    expect(pitches(project, first)).toEqual([60, 64, 67])
  })
  it('leaves non-pitched percussion and rests unchanged in a multi-instrument batch', () => {
    const project = createProject(), all = allSelections(project)
    const selected = rangeSelection(project, all[0], all.at(-1)!)
    const next = transposeSelection(project, selected, 1)
    expect(next.parts[3]).toBe(project.parts[3])
    expect(pitches(next, all[0])).toEqual([61])
    expect(validateProject(next)).toEqual([])
  })
})

describe('score history and group transactions', () => {
  it('reconciles whole-measure selection after a meter edit creates new rests', () => {
    const project = createProject(false), first = allSelections(project)[0]
    let state = projectReducer(createProjectState(project), { type: 'pick', selection: { ...first, scope: 'measure' } })
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'timeSignature', time: '12/8' } })
    expect(state.present.selected?.targets).toHaveLength(primaryScore(state.present.project).measures[0].voices[0].events.length)
    expect(isGroupSelection(state.present.selected)).toBe(true)
    expect(validateProject(state.present.project)).toEqual([])
  })
  it('cancellation restores the complete pre-gesture selection and score, without history', () => {
    const { project, first, guitar } = fixture()
    let state = projectReducer(createProjectState(project), { type: 'pick', selection: guitar })
    const before = state.present
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'begin', selection: first } })
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'previewPitch', amount: 1 } })
    state = projectReducer(state, { type: 'cancel' })
    expect(state.present).toBe(before)
    expect(state.past).toHaveLength(0)
  })
  it('records a group pitch drag once, previews from its origin, cancels and redoes the whole batch', () => {
    const { project, first, guitar } = fixture()
    let state = projectReducer(createProjectState(project), { type: 'pick', selection: first })
    state = projectReducer(state, { type: 'pick', selection: guitar, extend: true })
    const canvas = (action: import('../editor/state').Action) => { state = projectReducer(state, { type: 'canvas', ...first, action }) }
    canvas({ type: 'begin', selection: first })
    canvas({ type: 'previewPitch', amount: 1 }); canvas({ type: 'previewPitch', amount: 2 })
    canvas({ type: 'commit' })
    expect(state.past).toHaveLength(1)
    expect(pitches(state.present.project, first)).toEqual([64, 68, 71])
    state = projectReducer(state, { type: 'undo' })
    expect(pitches(state.present.project, first)).toEqual([60, 64, 67])
    state = projectReducer(state, { type: 'redo' })
    expect(pitches(state.present.project, first)).toEqual([64, 68, 71])
    const before = state.present.project
    canvas({ type: 'begin', selection: first }); canvas({ type: 'previewPitch', amount: -1 }); canvas({ type: 'cancel' })
    expect(state.present.project).toBe(before)
    expect(state.past).toHaveLength(1)
  })
  it('blocks both shorter and longer group durations in commands and drags', () => {
    const { project, first, guitar } = fixture()
    let state = projectReducer(createProjectState(project), { type: 'pick', selection: first })
    state = projectReducer(state, { type: 'pick', selection: guitar, extend: true })
    for (const duration of [fraction(1, 8), fraction(1, 2)]) {
      state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'duration', duration } })
      expect(state.present.project).toBe(project)
      expect(state.notice).toContain('그룹')
    }
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'begin', selection: first } })
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'previewDuration', duration: fraction(1, 8) } })
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'commit' } })
    expect(state.present.project).toBe(project)
    expect(state.past).toHaveLength(0)
  })
  it('keeps current mixer/master state through undo/redo and does not clear redo on sound changes', () => {
    const { project, first } = fixture()
    let state = projectReducer(createProjectState(project), { type: 'selection', selection: first })
    state = projectReducer(state, { type: 'canvas', ...first, action: { type: 'pitch', amount: 1, chromatic: true } })
    state = projectReducer(state, { type: 'undo' })
    const history = state.past.length
    state = projectReducer(state, { type: 'sound', change: before => ({ ...before, masterVolume: 0.2, parts: before.parts.map((part, i) => i ? part : { ...part, mixer: { ...part.mixer, volume: 0.3, pan: -0.6, mute: true, solo: true, program: 10 } }) }) })
    expect(state.past).toHaveLength(history)
    expect(state.future).toHaveLength(1)
    state = projectReducer(state, { type: 'redo' })
    expect(pitches(state.present.project, first)[0]).toBe(61)
    expect(state.present.project.masterVolume).toBe(0.2)
    expect(state.present.project.parts[0].mixer).toMatchObject({ volume: 0.3, pan: -0.6, mute: true, solo: true, program: 10 })
    state = projectReducer(state, { type: 'undo' })
    expect(state.present.project.parts[0].mixer.volume).toBe(0.3)
  })
  it('restores removed score content with its latest sound settings without reverting other mixers', () => {
    let state = createProjectState()
    const removed = state.present.project.parts[1]
    state = projectReducer(state, { type: 'sound', change: before => ({ ...before, parts: before.parts.map(part => part.id === removed.id ? { ...part, mixer: { ...part.mixer, pan: 0.5 } } : part) }) })
    state = projectReducer(state, { type: 'change', change: before => ({ ...before, parts: before.parts.filter(part => part.id !== removed.id) }) })
    state = projectReducer(state, { type: 'undo' })
    expect(state.present.project.parts[1].mixer.pan).toBe(0.5)
    expect(validateProject(state.present.project)).toEqual([])
    expect(primaryScore(state.present.project).measures).toHaveLength(4)
  })
})
