import { describe, expect, it } from 'vitest'
import { allSelections, createProject, insertAt, primaryScore, replaceEvent, staffAt, validateProject } from './model'
import { addMeasure, addStaff, addVoice, removeMeasure, removeVoice } from './structure'
import { createProjectState, projectReducer } from './state'
import { eventPitches, locate } from '../music/score'
import { fraction, ZERO } from '../music/rational'
import { midi } from '../music/pitch'
import { parseProject, serializeProject } from '../files/project'
import { exportMusicXML, importMusicXML } from '../files/musicxml'
import { compileTimeline, timelineMIDI } from '../playback/timeline'

const C = { step: 'C', octave: 4, alter: 0 } as const
const E = { step: 'E', octave: 4, alter: 0 } as const
const get = (project = createProject()) => { const selection = allSelections(project)[0]; return { project, selection, staff: staffAt(project, selection).staff } }
const music = (project: ReturnType<typeof createProject>) => project.parts.map(part => part.staves.map(staff => staff.score.measures.map(measure => measure.voices.map(voice => voice.events.map(event => ({ start: event.start, duration: event.duration, pitches: eventPitches(event).map(midi) }))))))

describe('Alpha canonical project and transactions', () => {
  it('creates four simultaneously playable instruments and an independently editable blank project', () => {
    const project = createProject()
    expect(validateProject(project)).toEqual([])
    expect(project.parts.map(part => part.instrument)).toEqual(['piano', 'guitar', 'bass', 'drums'])
    expect(compileTimeline(project).channels.get(project.parts[3].id)).toBe(9)
    expect(compileTimeline(createProject(false)).notes).toEqual([])
  })
  it('adds/removes staves, voices and measures without sharing events or breaking exact sums', () => {
    const fixture = get()
    const { selection } = fixture
    let { project } = fixture
    project = addStaff(project, selection.partId)
    project = addVoice(project, selection.staffId)
    project = addMeasure(project)
    expect(validateProject(project)).toEqual([])
    expect(project.parts[0].staves).toHaveLength(2)
    expect(primaryScore(project).measures.every(measure => measure.voices.length === 2)).toBe(true)
    project = removeVoice(project, selection.staffId, primaryScore(project).measures[0].voices[1].id)
    project = removeMeasure(project, 1)
    expect(validateProject(project)).toEqual([])
    expect(primaryScore(project).measures).toHaveLength(4)
  })
  it('inserts into an exact rest subdivision, preserves later onsets, and refuses note/barline overwrite', () => {
    const { project, selection } = get(createProject(false))
    const next = insertAt(project, selection, fraction(1, 8), fraction(1, 4), E)
    const voice = primaryScore(next).measures[0].voices[0]
    expect(voice.events.map(event => event.start)).toEqual([ZERO, fraction(1, 8), fraction(3, 8), fraction(7, 8)])
    expect(voice.events[1]).toMatchObject({ kind: 'note', pitch: E, duration: fraction(1, 4) })
    expect(validateProject(next)).toEqual([])
    expect(() => insertAt(next, selection, fraction(1, 8), fraction(1, 4), C)).toThrow('빈 쉼표')
    expect(() => insertAt(next, selection, fraction(7, 8), fraction(1, 4), C)).toThrow('마디선')
  })
  it('transposes only the explicitly chosen chord tone and records one gesture undo', () => {
    const fixture = get()
    const { selection } = fixture
    let { project } = fixture
    project = replaceEvent(project, selection, event => event.kind === 'note' ? { ...event, chord: [E] } : event)
    let state = createProjectState(project)
    const canvas = (action: import('../editor/state').Action) => { state = projectReducer(state, { type: 'canvas', partId: selection.partId, staffId: selection.staffId, action }) }
    state = projectReducer(state, { type: 'selection', selection: { ...selection, pitchIndex: 1 } })
    canvas({ type: 'begin', selection })
    canvas({ type: 'previewPitch', amount: 1 })
    canvas({ type: 'previewPitch', amount: 2 })
    canvas({ type: 'commit' })
    const tones = eventPitches(locate(primaryScore(state.present.project), selection).event)
    expect(tones.map(midi)).toEqual([60, 67])
    expect(state.past).toHaveLength(1)
    state = projectReducer(state, { type: 'undo' })
    expect(music(state.present.project)).toEqual(music(project))
    state = projectReducer(state, { type: 'redo' })
    expect(eventPitches(locate(primaryScore(state.present.project), selection).event).map(midi)).toEqual([60, 67])
  })
  it('previews from the snapshot, including returning to zero, and rolls back cancel', () => {
    const { project, selection } = get()
    let state = createProjectState(project)
    for (const action of [{ type: 'begin', selection }, { type: 'previewPitch', amount: 3 }, { type: 'previewPitch', amount: 0 }, { type: 'cancel' }] as const) state = projectReducer(state, { type: 'canvas', partId: selection.partId, staffId: selection.staffId, action })
    expect(state.present.project).toBe(project)
    expect(state.past).toHaveLength(0)
  })
  it('walks every event, including rests, from the last bar into the next instrument', () => {
    const { project } = get()
    const selections = allSelections(project)
    let state = createProjectState(project)
    state = projectReducer(state, { type: 'selection', selection: selections[13] })
    state = projectReducer(state, { type: 'canvas', ...selections[13], action: { type: 'cursor', direction: 1 } })
    expect(state.present.selection).toEqual(selections[14])
    expect(state.present.selection?.partId).toBe(project.parts[1].id)
  })
  it('applies key/meter atomically across all staves and refuses clipping sounding notes', () => {
    const { project, selection } = get()
    let state = createProjectState(project)
    state = projectReducer(state, { type: 'canvas', ...selection, action: { type: 'keySignature', key: 3 } })
    expect(state.present.project.parts.every(part => part.staves.every(staff => staff.score.keySignature === 3))).toBe(true)
    expect(music(state.present.project)).toEqual(music(project))
    const before = state.present.project
    state = projectReducer(state, { type: 'canvas', ...selection, action: { type: 'timeSignature', time: '2/4' } })
    expect(state.present.project).toBe(before)
    expect(state.notice).toContain('거부')
    state = projectReducer(state, { type: 'canvas', ...selection, action: { type: 'timeSignature', time: '12/8' } })
    expect(validateProject(state.present.project)).toEqual([])
    expect(state.past).toHaveLength(2)
  })
  it('refuses invalid structural edits without changing the prior project', () => {
    const { project, selection } = get(createProject(false))
    const state = projectReducer(createProjectState(project), { type: 'change', change: before => removeVoice(before, selection.staffId, selection.voiceId) })
    expect(state.present.project).toBe(project)
    expect(state.notice).toBeTruthy()
  })
})

describe('project persistence and MusicXML subset', () => {
  it('round-trips every project field including mixer/tempo/chord and rejects unknown data', () => {
    const { project, selection } = get()
    const next = { ...replaceEvent(project, selection, event => event.kind === 'note' ? { ...event, chord: [E] } : event), tempos: [{ measure: 0, bpm: 90 }, { measure: 2, bpm: 140 }] }
    expect(parseProject(serializeProject(next))).toEqual(next)
    expect(() => parseProject(JSON.stringify({ ...next, unsupportedSlurs: [] }))).toThrow('필드')
    const data = JSON.parse(serializeProject(next))
    data.parts[0].staves[0].score.measures[0].voices[0].events[0].tie = true
    expect(() => parseProject(JSON.stringify(data))).toThrow('필드')
  })
  it.each([null, [], { version: 1 }, { version: 2, title: 'X', parts: [], tempos: [], masterVolume: 0.7 }])('rejects malformed JSON project: %j', data => {
    expect(() => parseProject(JSON.stringify(data))).toThrow()
  })
  it('rejects unreduced fractions before they can change engraving duration semantics', () => {
    const project = JSON.parse(serializeProject(createProject()))
    project.parts[0].staves[0].score.measures[0].voices[0].events[0].duration = { n: 2, d: 8 }
    expect(() => parseProject(JSON.stringify(project))).toThrow('기약분수')
  })
  it('round-trips multiple staves/voices/chords/drums/tempo with exact musical structure', () => {
    const fixture = get()
    const { selection } = fixture
    let { project } = fixture
    project = addStaff(addVoice(project, selection.staffId), selection.partId)
    project = replaceEvent(project, selection, event => event.kind === 'note' ? { ...event, chord: [E] } : event)
    project = { ...project, title: '악보 <&> 제목', tempos: [{ measure: 0, bpm: 96 }, { measure: 2, bpm: 120 }] }
    const source = exportMusicXML(project)
    expect(source).toContain('<chord/>')
    expect(source).toContain('<backup>')
    expect(source).toContain('<unpitched>')
    const reloaded = importMusicXML(source)
    expect(validateProject(reloaded)).toEqual([])
    expect(music(reloaded)).toEqual(music(project))
    expect(reloaded.title).toBe(project.title)
    expect(reloaded.tempos).toEqual(project.tempos)
    expect(reloaded.parts.map(part => part.mixer)).toEqual(project.parts.map(part => part.mixer))
  })
  it.each(['<tie type="start"/>', '<notations><slur type="start"/></notations>', '<time-modification/>', '<grace/>'])('rejects unsupported MusicXML instead of silently dropping %s', element => {
    const source = exportMusicXML(createProject()).replace('<note>', `<note>${element}`)
    expect(() => importMusicXML(source)).toThrow('지원하지 않는 MusicXML')
  })
  it('rejects external entities, malformed documents and structural time corruption', () => {
    expect(() => importMusicXML('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><score-partwise/>')).toThrow('DOCTYPE')
    expect(() => importMusicXML('<score-partwise>')).toThrow('올바른')
    const source = exportMusicXML(createProject()).replace('<duration>4</duration>', '<duration>16</duration>')
    expect(() => importMusicXML(source)).toThrow()
  })
})

describe('score-derived playback, independent of SVG', () => {
  it('computes quarter-note BPM, measure tempos, simultaneous parts/voices/chords and silence', () => {
    const fixture = get()
    const { selection } = fixture
    let { project } = fixture
    project = addVoice(project, selection.staffId)
    project = replaceEvent(project, selection, event => event.kind === 'note' ? { ...event, chord: [E] } : event)
    project = { ...project, tempos: [{ measure: 0, bpm: 120 }, { measure: 2, bpm: 60 }] }
    const timeline = compileTimeline(project)
    expect(timeline.measureTimes).toEqual([0, 2, 4, 8])
    expect(timeline.duration).toBe(12)
    expect(timeline.notes.filter(note => note.start === 0)).toHaveLength(5)
    expect(timeline.notes[0]).toMatchObject({ startTick: 0, endTick: 480, start: 0, end: 0.5 })
    expect(timeline.notes.some(note => note.start === 0.5)).toBe(false)
    expect(new Uint8Array(timelineMIDI(project, timeline)).slice(0, 4)).toEqual(new Uint8Array([77, 84, 104, 100]))
  })
  it('honors solo/mute and supplies a real MIDI metronome without mutating canonical notes', () => {
    const project = createProject()
    const next = { ...project, parts: project.parts.map((part, i) => ({ ...part, mixer: { ...part.mixer, solo: i === 1 } })) }
    const timeline = compileTimeline(next)
    expect(new Set(timeline.notes.map(note => note.partId))).toEqual(new Set([project.parts[1].id]))
    expect(timelineMIDI(next, timeline, true).byteLength).toBeGreaterThan(timelineMIDI(next, timeline, false).byteLength)
    expect(project.parts.every(part => !part.mixer.solo)).toBe(true)
  })
})
