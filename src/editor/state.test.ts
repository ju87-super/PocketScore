// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEditor, editorReducer } from './state'
import { fraction } from '../music/rational'
import { locate, validateScore } from '../music/score'
import { pitchName } from '../music/pitch'

const selection = { measureId: 'm1', voiceId: 'v1', eventId: 'm1-e1' }
const selected = () => editorReducer(createEditor(), { type: 'select', selection })
const currentPitch = (state: ReturnType<typeof createEditor>) => {
  const event = locate(state.present.score, selection).event
  return event.kind === 'note' ? pitchName(event.pitch) : 'rest'
}

describe('history and gesture transactions', () => {
  it('undoes/redoes global signatures without selection and ignores no-op settings', () => {
    const before = createEditor()
    let state = editorReducer(before, { type: 'keySignature', key: 7 })
    state = editorReducer(state, { type: 'timeSignature', time: '12/8' })
    expect(state.past).toHaveLength(2)
    expect(editorReducer(state, { type: 'timeSignature', time: '12/8' }).past).toHaveLength(2)
    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.present.score.timeSignature).toBe('4/4')
    expect(editorReducer(undone, { type: 'redo' }).present).toEqual(state.present)
    expect(editorReducer(undone, { type: 'undo' }).present).toEqual(before.present)
  })

  it('restores removed rest selections on undo and leaves failed meter edits out of history', () => {
    let state = editorReducer(createEditor(), { type: 'select', selection: { ...selection, eventId: 'm1-e4' } })
    const before = state.present
    state = editorReducer(state, { type: 'timeSignature', time: '3/4' })
    expect(state.present.selection).toBeNull()
    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.present).toEqual(before)
    const failed = editorReducer(undone, { type: 'timeSignature', time: '2/4' })
    expect(failed.present).toBe(undone.present)
    expect(failed.notice).toMatch(/1마디.*음표/)
    expect(failed.future).toEqual(undone.future)
    expect(failed.past).toEqual(undone.past)
  })

  it('records accidental edits with complete pitch and selection snapshots', () => {
    const before = selected()
    const sharp = editorReducer(before, { type: 'accidental', alter: 1 })
    const flat = editorReducer(sharp, { type: 'accidental', alter: -1 })
    const natural = editorReducer(flat, { type: 'accidental', alter: 0 })
    expect(currentPitch(sharp)).toBe('C♯4')
    expect(currentPitch(flat)).toBe('C♭4')
    expect(currentPitch(natural)).toBe('C4')
    expect(editorReducer(natural, { type: 'undo' }).present).toEqual(flat.present)
    const undone = editorReducer(sharp, { type: 'undo' })
    expect(undone.present).toEqual(before.present)
    expect(editorReducer(undone, { type: 'redo' }).present).toEqual(sharp.present)
    const rest = editorReducer(before, { type: 'cursor', direction: 1 })
    expect(editorReducer(rest, { type: 'accidental', alter: 1 }).past).toHaveLength(0)
  })
  it('undoes/redoes a duration edit including generated rests, IDs and selection', () => {
    const before = selected()
    const edited = editorReducer(before, { type: 'duration', duration: fraction(1, 8) })
    expect(edited.past).toHaveLength(1)
    expect(editorReducer(edited, { type: 'undo' }).present).toEqual(before.present)
    const undone = editorReducer(edited, { type: 'undo' })
    expect(editorReducer(undone, { type: 'redo' }).present).toEqual(edited.present)
  })

  it('previews from the original pitch and commits a whole drag as one undo entry', () => {
    const before = selected()
    let state = editorReducer(before, { type: 'begin', selection })
    state = editorReducer(state, { type: 'previewPitch', amount: 1 })
    expect(currentPitch(state)).toBe('D4')
    state = editorReducer(state, { type: 'previewPitch', amount: 2 })
    expect(currentPitch(state)).toBe('E4')
    expect(state.past).toHaveLength(0)
    state = editorReducer(state, { type: 'commit' })
    expect(state.past).toHaveLength(1)
    expect(editorReducer(state, { type: 'undo' }).present).toEqual(before.present)
  })

  it('rolls pointer cancel back to the original score, selection and redo stack', () => {
    const before = createEditor()
    let state = editorReducer(before, { type: 'begin', selection })
    state = editorReducer(state, { type: 'previewDuration', duration: fraction(1, 8) })
    state = editorReducer(state, { type: 'cancel' })
    expect(state.present).toBe(before.present)
    expect(state.past).toHaveLength(0)
    expect(state.future).toEqual(before.future)
    expect(state.gesture).toBeNull()
  })

  it('restores the baseline for an invalid preview after a valid preview', () => {
    const before = selected()
    let state = editorReducer(before, { type: 'begin', selection })
    state = editorReducer(state, { type: 'previewDuration', duration: fraction(1, 8) })
    state = editorReducer(state, { type: 'previewDuration', duration: fraction(3, 4) })
    expect(state.present.score).toBe(before.present.score)
    expect(state.notice).toMatch(/부족/)
    expect(validateScore(state.present.score)).toEqual([])
    const committed = editorReducer(state, { type: 'commit' })
    expect(committed.past).toHaveLength(0)
    expect(committed.notice).toMatch(/부족/)
  })

  it('does not record clicks, no-op pitch edits on rests, or a drag back to origin', () => {
    let state = selected()
    state = editorReducer(state, { type: 'begin', selection })
    state = editorReducer(state, { type: 'previewPitch', amount: 1 })
    state = editorReducer(state, { type: 'previewPitch', amount: 0 })
    state = editorReducer(state, { type: 'commit' })
    expect(state.past).toHaveLength(0)
    state = editorReducer(state, { type: 'cursor', direction: 1 })
    expect(editorReducer(state, { type: 'pitch', amount: 1 }).past).toHaveLength(0)
  })

  it('keeps failed edits out of history and invalidates redo only after a new successful edit', () => {
    let state = editorReducer(selected(), { type: 'pitch', amount: 1 })
    state = editorReducer(state, { type: 'undo' })
    const failed = editorReducer(state, { type: 'duration', duration: fraction(1) })
    expect(failed.future).toHaveLength(1)
    expect(failed.past).toHaveLength(0)
    const next = editorReducer(failed, { type: 'pitch', amount: -1 })
    expect(next.future).toHaveLength(0)
    expect(currentPitch(next)).toBe('B3')
  })

  it('ignores keyboard and history edits during an active gesture', () => {
    const state = editorReducer(selected(), { type: 'begin', selection })
    expect(editorReducer(state, { type: 'undo' })).toBe(state)
    expect(editorReducer(state, { type: 'cursor', direction: 1 })).toBe(state)
    expect(editorReducer(state, { type: 'pitch', amount: 1 })).toBe(state)
    expect(editorReducer(state, { type: 'keySignature', key: 1 })).toBe(state)
    expect(editorReducer(state, { type: 'timeSignature', time: '3/4' })).toBe(state)
    expect(editorReducer(state, { type: 'accidental', alter: 1 })).toBe(state)
  })

  it('reports a missing selection and ignores orphaned preview events', () => {
    const state = createEditor()
    expect(editorReducer(state, { type: 'pitch', amount: 1 }).notice).toMatch(/선택/)
    expect(editorReducer(state, { type: 'previewPitch', amount: 1 })).toBe(state)
    expect(editorReducer(state, { type: 'undo' })).toBe(state)
  })
})
