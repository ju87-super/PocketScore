// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { allSelections, createProject, replaceEvent } from '../project/model'
import { compileTimeline, timelineMIDI, ticks } from './timeline'
import { fraction } from '../music/rational'
import { setTimeSignature } from '../music/score'

describe('deterministic playback contract (no audio device or SoundFont)', () => {
  it('schedules simultaneous parts/chords and tempo changes at exact musical ticks', () => {
    const initial = createProject()
    const project = { ...replaceEvent(initial, allSelections(initial)[0], event => event.kind === 'note' ? { ...event, chord: [{ step: 'E', octave: 4, alter: 0 }] } : event), tempos: [{ measure: 0, bpm: 120 }, { measure: 2, bpm: 60 }] }
    const result = compileTimeline(project)
    expect(result.measureTimes).toEqual([0, 2, 4, 8])
    expect(result.duration).toBe(12)
    expect(result.notes.filter(note => note.startTick === 0).map(note => [note.midi, note.endTick])).toEqual([[60, 480], [64, 480], [60, 480], [40, 480], [36, 480]])
    expect(result.notes.some(note => note.startTick === 480)).toBe(false)
    expect(ticks(fraction(3, 16))).toBe(360)
    expect(() => ticks(fraction(1, 7))).toThrow('정확하게')
  })
  it('retains full silent/trailing-rest measure length including compound meter', () => {
    const initial = createProject(false)
    const project = { ...initial, parts: initial.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: setTimeSignature(staff.score, '6/8') })) })), tempos: [{ measure: 0, bpm: 120 }] }
    const timeline = compileTimeline(project)
    expect(timeline.notes).toEqual([])
    expect(timeline.measureTimes).toEqual([0, 1.5, 3, 4.5])
    expect(timeline.duration).toBe(6)
    expect(timeline.totalTicks).toBe(5760)
    expect(timelineMIDI(project, timeline).byteLength).toBeGreaterThan(14)
  })
  it('honors mute/solo/master metadata without mutating source events', () => {
    const source = createProject()
    const before = JSON.stringify(source)
    const project = { ...source, masterVolume: 0.2, parts: source.parts.map((part, i) => ({ ...part, mixer: { ...part.mixer, volume: 0.3, pan: -0.5, solo: i === 1 } })) }
    expect(new Set(compileTimeline(project).notes.map(note => note.partId))).toEqual(new Set([source.parts[1].id]))
    const muted = { ...project, parts: project.parts.map(part => ({ ...part, mixer: { ...part.mixer, mute: true } })) }
    expect(compileTimeline(muted).notes).toEqual([])
    expect(JSON.stringify(source)).toBe(before)
    // Mixer CC7/CC10 and presets are actual MIDI messages, not SVG properties.
    const bytes = [...new Uint8Array(timelineMIDI(project, compileTimeline(project)))]
    expect(bytes.join(',')).toContain('176,7,38')
    expect(bytes.join(',')).toContain('176,10,32')
  })
})
