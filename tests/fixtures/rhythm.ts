import type { Project, ProjectSelection } from '../../src/project/model'
import type { Pitch } from '../../src/music/pitch'
import type { RhythmEvent } from '../../src/music/score'
import { retime } from '../../src/music/score'
import { fraction, ZERO } from '../../src/music/rational'

export const rhythmTarget = (bar = 0, event = 0, pitchIndex = 0, voice = 0): ProjectSelection => ({
  partId: 'rhythm-piano', staffId: 'rhythm-staff', voiceId: `rhythm-v${voice}`, measureId: `rhythm-m${bar}`, eventId: `rhythm-${voice}-${bar}-${event}`, pitchIndex,
})
export function rhythmProject(): Project {
  const p = (step: Pitch['step'], octave = 4, alter: Pitch['alter'] = 0): Pitch => ({ step, octave, alter })
  const q = fraction(1, 4)
  const melodies: (Pitch[] | null)[][] = [
    [[p('C'), p('E')], [p('C'), p('G')], [p('F', 4, 1)], [p('F', 4, 1)]],
    [[p('F', 4, 1)], [p('F', 4, 1)], [p('D')], null],
    [null, null, null, null], [null, null, null, null],
  ]
  const score = { keySignature: 0, timeSignature: '4/4' as const, measures: melodies.map((tones, bar) => ({
    id: `rhythm-m${bar}`, voices: [
      { id: 'rhythm-v0', events: retime(tones.map((pitches, i): RhythmEvent => ({
        id: `rhythm-0-${bar}-${i}`, start: ZERO, duration: q,
        ...(pitches ? { kind: 'note', pitch: pitches[0], ...(pitches.length > 1 ? { chord: pitches.slice(1) } : {}) } : { kind: 'rest' }),
      }))) },
      { id: 'rhythm-v1', events: retime([p('C', 3), p('G', 3)].map((pitch, i) => ({ id: `rhythm-1-${bar}-${i}`, start: ZERO, duration: fraction(1, 2), kind: 'note' as const, pitch }))) },
    ],
  })) }
  return { version: 2, title: '리듬과 붙임줄 검증', tempos: [{ measure: 0, bpm: 120 }], masterVolume: 0.7, parts: [{
    id: 'rhythm-piano', name: '피아노', instrument: 'piano', mixer: { program: 0, volume: 0.8, pan: 0, mute: false, solo: false },
    staves: [{ id: 'rhythm-staff', name: '피아노', clef: 'treble', score }],
  }] }
}
// A fixed musical golden, independent of the editor's tie command.
export function heldRhythmProject(): Project {
  const source = rhythmProject()
  const outgoing = new Map([['rhythm-0-0-0', 60], ['rhythm-0-0-2', 66], ['rhythm-0-0-3', 66], ['rhythm-0-1-0', 66]])
  return { ...source, parts: source.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
    measures: staff.score.measures.map(bar => ({ ...bar, voices: bar.voices.map(voice => ({ ...voice, events: voice.events.map(event => event.kind === 'note' && outgoing.has(event.id) ? { ...event, tieTo: [outgoing.get(event.id)!] } : event) })) })),
  } })) })) }
}
export function longHeldProject(): Project {
  const source = rhythmProject()
  return { ...source, parts: source.parts.map(part => ({ ...part, mixer: { ...part.mixer, program: 16 }, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
    measures: staff.score.measures.map((bar, i) => ({ ...bar, voices: [{ id: 'rhythm-v0', events: [{ id: `rhythm-0-${i}-0`, start: ZERO, duration: fraction(1), kind: 'note' as const, pitch: { step: 'C' as const, octave: 4, alter: 0 as const }, ...(i < 3 ? { tieTo: [60] } : {}) }] }] })),
  } })) })) }
}
