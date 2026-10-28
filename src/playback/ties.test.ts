// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { heldRhythmProject, longHeldProject, rhythmProject } from '../../tests/fixtures/rhythm'
import { activeMelodicNotes, compileTimeline, ticks, timelineMIDI } from './timeline'
import { fraction } from '../music/rational'
import { clearTies } from '../music/ties'
import { rhythmTarget as target } from '../../tests/fixtures/rhythm'
import { updateStaff } from '../project/model'
import { beginEntry, createNoteEntry, writeEntry, addEntryChord } from '../project/noteEntry'

// Decode the public SMF bytes independently of the timeline builder.
function midiNotes(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer), result: { tick: number; on: boolean; pitch: number }[] = []
  let offset = 22, tick = 0
  const variable = () => { let value = 0, byte: number; do { byte = bytes[offset++]; value = value * 128 + (byte & 127) } while (byte & 128); return value }
  while (offset < bytes.length) {
    tick += variable()
    const status = bytes[offset++]
    if (status === 255) { offset++; const size = variable(); offset += size; continue }
    const kind = status >> 4, first = bytes[offset++], second = kind === 12 || kind === 13 ? 0 : bytes[offset++]
    if (kind === 8 || kind === 9) result.push({ tick, on: kind === 9 && second > 0, pitch: first })
  }
  return result
}
describe('tied performance and exact short-note timing', () => {
  it('emits one MIDI attack/release per automatically split chord pitch across a tempo change', () => {
    const source = rhythmProject(), project = { ...source, tempos: [{ measure: 0, bpm: 120 }, { measure: 1, bpm: 60 }] }
    const entry = beginEntry(project, createNoteEntry(), target(0, 3))
    const note = writeEntry(project, { ...entry, duration: fraction(1) }, { step: 'C', octave: 4, alter: 0 })
    const chord = addEntryChord(note.project, note.entry, note.selection, { step: 'E', octave: 4, alter: 0 }).project
    const timeline = compileTimeline(chord), messages = midiNotes(timelineMIDI(chord, timeline))
    for (const pitch of [60, 64]) {
      expect(timeline.notes.filter(note => note.midi === pitch && note.startTick >= 1440)).toMatchObject([{ startTick: 1440, endTick: 3360, start: 1.5, end: 5 }])
      expect(messages.filter(item => item.pitch === pitch && item.tick >= 1440)).toEqual([{ tick: 1440, on: true, pitch }, { tick: 3360, on: false, pitch }])
    }
  })
  it('holds selected chord tones once while articulating the other chord components independently', () => {
    const project = heldRhythmProject(), timeline = compileTimeline(project)
    expect(timeline.notes.filter(note => note.midi === 60)).toMatchObject([{ startTick: 0, endTick: 960, start: 0, end: 1 }])
    expect(timeline.notes.filter(note => note.midi === 64)).toMatchObject([{ startTick: 0, endTick: 480 }])
    expect(timeline.notes.filter(note => note.midi === 67)).toMatchObject([{ startTick: 480, endTick: 960 }])
    expect(timeline.events.filter(event => event.measure === 0 && event.selection.voiceId === 'rhythm-v0')).toHaveLength(4)
    const messages = midiNotes(timelineMIDI(project, timeline))
    expect(messages.filter(item => item.pitch === 60)).toEqual([{ tick: 0, on: true, pitch: 60 }, { tick: 960, on: false, pitch: 60 }])
  })
  it('sustains through a barline and tempo change using the sum of actual segment times', () => {
    const source = heldRhythmProject(), project = { ...source, tempos: [{ measure: 0, bpm: 120 }, { measure: 1, bpm: 60 }] }
    const timeline = compileTimeline(project)
    expect(timeline.notes.filter(note => note.midi === 66)).toEqual([expect.objectContaining({ startTick: 960, endTick: 2880, start: 1, end: 4 })])
    expect(midiNotes(timelineMIDI(project, timeline)).filter(item => item.pitch === 66)).toEqual([{ tick: 960, on: true, pitch: 66 }, { tick: 2880, on: false, pitch: 66 }])
    expect(timeline.duration).toBe(14)
    expect(timeline.measureTimes).toEqual([0, 2, 6, 10])
  })
  it('releases only the chosen connection and never merges ordinary consecutive repetitions', () => {
    const source = heldRhythmProject(), project = updateStaff(source, target().staffId, staff => ({ ...staff, score: clearTies(staff.score, [target(0, 1)]) }))
    expect(compileTimeline(project).notes.filter(note => note.midi === 60).map(note => [note.startTick, note.endTick])).toEqual([[0, 480], [480, 960]])
    expect(compileTimeline(rhythmProject()).notes.filter(note => note.midi === 66)).toHaveLength(4)
  })
  it('retains exact 32nd/64th/dotted ticks, voice independence and mute/solo behavior', () => {
    expect(ticks(fraction(1, 64))).toBe(30)
    expect(ticks(fraction(1, 32))).toBe(60)
    expect(ticks(fraction(3, 64))).toBe(90)
    const project = heldRhythmProject(), before = structuredClone(project)
    const timeline = compileTimeline(project)
    expect(timeline.notes.filter(note => note.midi === 48)).toHaveLength(4)
    const muted = { ...project, parts: project.parts.map(part => ({ ...part, mixer: { ...part.mixer, mute: true } })) }
    expect(compileTimeline(muted).notes).toEqual([])
    expect(project).toEqual(before)
  })
  it('restores a multi-bar held note only inside its sounding interval', () => {
    const timeline = compileTimeline(longHeldProject())
    expect(activeMelodicNotes(timeline, 0)).toEqual([])
    expect(activeMelodicNotes(timeline, 3)).toMatchObject([{ midi: 60, start: 0, end: 8 }])
    expect(activeMelodicNotes(timeline, 8)).toEqual([])
    expect(activeMelodicNotes(null, 1)).toEqual([])
  })
  it('leaves exact-boundary note-on events to MIDI, avoiding a double attack at seek', () => {
    const timeline = compileTimeline(rhythmProject())
    expect(activeMelodicNotes(timeline, 0.5).some(note => note.midi === 60)).toBe(false)
    expect(activeMelodicNotes(timeline, 0.75).some(note => note.midi === 60)).toBe(true)
    expect(activeMelodicNotes(timeline, 1).some(note => note.midi === 60)).toBe(false)
  })
  it('restores overlapping unisons once and does not retrigger drum hits after a seek', () => {
    const original = compileTimeline(longHeldProject()), note = original.notes[0]
    const timeline = { ...original, notes: [note, { ...note, start: 2, end: 6, startTick: 1920, endTick: 5760 }, { ...note, channel: 9, midi: 36 }] }
    const before = structuredClone(timeline.notes)
    expect(activeMelodicNotes(timeline, 3)).toEqual([note])
    expect(timeline.notes).toEqual(before)
  })
})
