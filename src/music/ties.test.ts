// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { heldRhythmProject, longHeldProject, rhythmProject, rhythmTarget as target } from '../../tests/fixtures/rhythm'
import { clearTies, reconcileTieEdits, tieLinks, toggleTie } from './ties'
import { eventPitches, locate, resizeEvent, setAccidental, setTimeSignature, transposeEvent, validateScore } from './score'
import type { RhythmEvent } from './score'
import { fraction, ZERO } from './rational'
import { midi } from './pitch'
import { primaryScore, updateStaff, validateProject } from '../project/model'
import type { Project } from '../project/model'
import { createProjectState, projectReducer } from '../project/state'
import { pickSelection, rangeSelection, singleSelection } from '../project/selection'
import { copyScoreSelection, pasteScoreSelection } from '../project/clipboard'
import { removeMeasure } from '../project/structure'
import { parseProject, serializeProject } from '../files/project'
import { activeAlter, beginEntry, createNoteEntry, writeEntry } from '../project/noteEntry'
import { measureAccidentals } from './accidentals'
import { tiedContinuations } from './ties'
import { beamGroups } from '../notation/engraving'
import { compileTimeline } from '../playback/timeline'

const connectedProject = heldRhythmProject
const event = (project: Project, point = target()) => locate(primaryScore(project), point).event
const values = (project: Project, point = target()) => eventPitches(event(project, point)).map(midi)
const freeze = (value: unknown) => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } }

describe('64th-grid rhythm and tied-note invariants', () => {
  it('edits short rests and enters at the last 64th without moving another voice', () => {
    const project = rhythmProject(), source = primaryScore(project), point = target(2)
    const next = resizeEvent(source, point, fraction(1, 64))
    expect(validateScore(next)).toEqual([])
    expect(next.measures[2].voices[0].events[0].duration).toEqual(fraction(1, 64))
    expect(next.measures[2].voices[1]).toBe(source.measures[2].voices[1])
    const entry = beginEntry(project, createNoteEntry(), point)
    const result = writeEntry(project, { ...entry, duration: fraction(1, 64) }, { step: 'C', octave: 4, alter: 0 }, { ...entry.cursor!, start: fraction(63, 64) })
    expect(event(result.project, result.selection).start).toEqual(fraction(63, 64))
    expect(result.entry.cursor).toMatchObject({ measureId: 'rhythm-m3', start: ZERO })
    expect(validateProject(result.project)).toEqual([])
  })
  it('round-trips a full 12/8 bar with 96 exact 64ths and derives compound beams', () => {
    const source = rhythmProject(), original = primaryScore(source)
    const events: RhythmEvent[] = Array.from({ length: 96 }, (_, i) => ({ id: `dense-${i}`, kind: 'note', pitch: { step: 'C', octave: 4, alter: 0 }, start: fraction(i, 64), duration: fraction(1, 64) }))
    const project = updateStaff({ ...source, tempos: [{ measure: 0, bpm: 120 }] }, target().staffId, staff => ({ ...staff,
      score: { ...original, timeSignature: '12/8', measures: [{ id: 'dense-bar', voices: [{ id: 'dense-voice', events }] }] },
    }))
    expect(validateProject(project)).toEqual([])
    expect(parseProject(serializeProject(project))).toEqual(project)
    expect(beamGroups(events, '12/8').map(group => group.length)).toEqual([24, 24, 24, 24])
  })
  it('toggles only one chord tone and leaves the source immutable', () => {
    const score = primaryScore(rhythmProject()), before = structuredClone(score); freeze(score)
    const next = toggleTie(score, target())
    expect(tieLinks(next).map(link => [link.from.event.id, link.to.event.id, link.midi])).toEqual([['rhythm-0-0-0', 'rhythm-0-0-1', 60]])
    expect(locate(next, target()).event).toMatchObject({ tieTo: [60] })
    expect(validateScore(next)).toEqual([])
    expect(toggleTie(next, target())).toEqual(score)
    expect(score).toEqual(before)
  })
  it('connects through barlines only within the same voice, with exact chained endpoints', () => {
    const project = connectedProject(), links = tieLinks(primaryScore(project))
    expect(links.map(link => link.midi)).toEqual([60, 66, 66, 66])
    expect(links.filter(link => link.from.measure !== link.to.measure)).toHaveLength(1)
    expect(links.every(link => link.from.selection.voiceId === link.to.selection.voiceId)).toBe(true)
    expect(parseProject(serializeProject(project))).toEqual(project)
  })
  it.each([target(0, 0, 1), target(1, 2), target(1, 3), target(3, 3)])('refuses incompatible pitch, rest or end destinations %j without mutation', point => {
    const score = primaryScore(rhythmProject()), before = structuredClone(score)
    expect(() => toggleTie(score, point)).toThrow(/음표|같은 음높이/)
    expect(score).toEqual(before)
  })
  it.each([[], [60, 60], [99], [60.5]].map(tieTo => ({ tieTo })))('rejects malformed or unowned tie pitches $tieTo', ({ tieTo }) => {
    const project = rhythmProject(), score = primaryScore(project)
    const changed = { ...score, measures: score.measures.map((bar, i) => i ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice, events: voice.events.map((item, e) => e ? item : { ...item, tieTo }) }) }) }
    expect(validateScore(changed).join(' ')).toContain('붙임줄')
    expect(() => parseProject(JSON.stringify(updateStaff(project, target().staffId, staff => ({ ...staff, score: changed }))))).toThrow('붙임줄')
  })
  it('transposes a whole logical tone from either end and preserves other chord/voice pitches', () => {
    const project = connectedProject(), score = primaryScore(project)
    const next = transposeEvent(score, target(0, 1), 1, true)
    expect(eventPitches(locate(next, target()).event).map(midi)).toEqual([61, 64])
    expect(eventPitches(locate(next, target(0, 1)).event).map(midi)).toEqual([61, 67])
    expect(locate(next, target()).event).toMatchObject({ tieTo: [61] })
    expect(next.measures[0].voices[1]).toBe(score.measures[0].voices[1])
    expect(validateScore(next)).toEqual([])
    expect(() => transposeEvent(score, target(), 7, true)).toThrow('겹칩니다')
    const sharp = setAccidental(score, target(0, 1), 1)
    expect(tieLinks(sharp)[0].midi).toBe(61)
  })
  it('moves a group containing both ends once and undoes the music without reverting current sound', () => {
    const project = connectedProject()
    let state = createProjectState(project)
    const selected = pickSelection(project, singleSelection(target()), target(0, 1), false, true)!
    state = { ...state, present: { ...state.present, selected, selection: selected.focus } }
    state = projectReducer(state, { type: 'canvas', ...target(), action: { type: 'pitch', amount: 1, chromatic: true } })
    expect(values(state.present.project)).toEqual([61, 64])
    expect(values(state.present.project, target(0, 1))).toEqual([61, 67])
    expect(state.past).toHaveLength(1)
    state = projectReducer(state, { type: 'sound', change: before => ({ ...before, masterVolume: 0.2 }) })
    state = projectReducer(state, { type: 'undo' })
    expect(state.present.project.masterVolume).toBe(0.2)
    expect(values(state.present.project)).toEqual([60, 64])
    state = projectReducer(state, { type: 'redo' })
    expect(values(state.present.project)).toEqual([61, 64])
  })
  it('rejects tied duration/meter edits until explicitly cleared and supports clearing from a stop note', () => {
    const score = primaryScore(connectedProject())
    expect(() => resizeEvent(score, target(0, 1), fraction(1, 32))).toThrow('붙임줄')
    expect(() => setTimeSignature(score, '6/8')).toThrow('붙임줄')
    const next = clearTies(score, [target(0, 1)])
    expect(tieLinks(next).map(link => link.midi)).toEqual([66, 66, 66])
    expect(validateScore(next)).toEqual([])
  })
  it('suppresses carried accidentals without silently altering the next independent attack or input', () => {
    const project = connectedProject(), score = primaryScore(project), bar = score.measures[1]
    const signs = measureAccidentals(bar, score.keySignature, tiedContinuations(score))
    expect(signs.has('rhythm-0-1-0')).toBe(false)
    expect(signs.has('rhythm-0-1-1')).toBe(false)
    const entry = beginEntry(project, createNoteEntry(), target(1, 2))
    expect(activeAlter(project, entry.cursor!, 'F', 4)).toBe(0)
    const untied = clearTies(score, [target(1, 1)])
    expect(measureAccidentals(untied.measures[1], 0, tiedContinuations(untied)).get('rhythm-0-1-1')).toBe(1)
  })
  it('does not reconnect an old tie to a coincidental same-pitch replacement or after bar deletion', () => {
    const project = connectedProject(), clip = copyScoreSelection(project, singleSelection(target(0, 1)))
    const pasted = pasteScoreSelection(project, clip, target(0, 1)).project
    expect(event(pasted)).not.toHaveProperty('tieTo')
    expect(validateProject(pasted)).toEqual([])
    const removed = removeMeasure(project, 1)
    expect(event(removed, target(0, 3))).not.toHaveProperty('tieTo')
    expect(validateProject(removed)).toEqual([])
    expect(reconcileTieEdits(primaryScore(project), primaryScore(project))).toBe(primaryScore(project))
  })
  it('copies internal ties with selected chord tones and omits connections outside the clipboard span', () => {
    const project = connectedProject()
    freeze(project)
    const clip = copyScoreSelection(project, rangeSelection(project, target(), target(0, 1)))
    freeze(clip)
    expect(clip.rows[0].events[0].tieTo).toEqual([60])
    expect(copyScoreSelection(project, singleSelection(target())).rows[0].events[0].tieTo).toBeUndefined()
    const result = pasteScoreSelection(project, clip, target(2))
    expect(tieLinks(primaryScore(result.project)).filter(link => link.from.measure === 2).map(link => link.midi)).toEqual([60])
    expect(validateProject(result.project)).toEqual([])
  })
  it('deleting a tied component clears its adjacent connections and preserves unrelated ties', () => {
    const project = connectedProject()
    let state = createProjectState(project)
    state = projectReducer(state, { type: 'pick', selection: target(0, 3) })
    state = projectReducer(state, { type: 'deleteSelected' })
    expect(event(state.present.project, target(0, 3)).kind).toBe('rest')
    expect(tieLinks(primaryScore(state.present.project)).map(link => link.midi)).toEqual([60, 66])
    expect(validateProject(state.present.project)).toEqual([])
    state = projectReducer(state, { type: 'undo' })
    expect(state.present.project).toEqual(project)
  })
  it('preserves incoming and outgoing sound outside a note-entry overwrite inside a tied continuation', () => {
    const project = longHeldProject(), point = target(1), entry = beginEntry(project, createNoteEntry(), point)
    const result = writeEntry(project, entry, { step: 'D', octave: 4, alter: 0 }, { ...entry.cursor!, start: fraction(1, 4) })
    expect(validateProject(result.project)).toEqual([])
    expect(compileTimeline(result.project).notes.filter(note => note.midi === 60).map(note => [note.startTick, note.endTick])).toEqual([[0, 2400], [2880, 7680]])
    expect(compileTimeline(result.project).notes.filter(note => note.midi === 62).map(note => [note.startTick, note.endTick])).toEqual([[2400, 2880]])
  })
  it('preserves a tied tail outside a pasted time span, with fresh fragment identity', () => {
    const source = rhythmProject(), clip = copyScoreSelection(source, singleSelection(target(1, 2))), project = longHeldProject()
    const result = pasteScoreSelection(project, clip, target()).project
    expect(validateProject(result)).toEqual([])
    expect(compileTimeline(result).notes.filter(note => note.midi === 60).map(note => [note.startTick, note.endTick])).toEqual([[480, 7680]])
  })
  it('loads a complete project verbatim when source IDs match but its valid destination IDs changed', () => {
    const source = connectedProject(), replacement = parseProject(serializeProject(source))
    const loaded = { ...replacement, parts: replacement.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
      measures: staff.score.measures.map((bar, b) => b ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice, events: voice.events.map((event, i) => i === 1 ? { ...event, id: 'loaded-new-target' } : event) }) }),
    } })) })) }
    let state = projectReducer(createProjectState(source), { type: 'change', change: () => loaded, selection: null })
    expect(state.present.project).toEqual(loaded)
    expect(tieLinks(primaryScore(state.present.project))).toHaveLength(4)
    state = projectReducer(state, { type: 'undo' }); expect(state.present.project).toEqual(source)
    state = projectReducer(state, { type: 'redo' }); expect(state.present.project).toEqual(loaded)
  })
})
