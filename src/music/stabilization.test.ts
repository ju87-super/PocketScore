// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEditor, editorReducer } from '../editor/state'
import type { EditorState } from '../editor/state'
import { longScore } from '../../tests/fixtures/scores'
import { measureAccidentals } from './accidentals'
import { movePitch, STEPS } from './pitch'
import { add, compare, fraction, subtract, ZERO } from './rational'
import { DURATIONS, locate, resizeEvent, retime, selections, setAccidental, setKeySignature, setTimeSignature, transposeEvent, validateScore } from './score'
import type { Score } from './score'
import { keyAlter, measureDuration, TIME_SIGNATURES } from './settings'

const first = { measureId: 'm1', voiceId: 'v1', eventId: 'm1-e1' }
const tinyScore = (): Score => ({ ...longScore(4), measures: longScore(4).measures.map(m => ({ ...m,
  voices: [{ id: 'v1', events: retime([
    { id: `${m.id}-e1`, kind: 'note', pitch: { step: 'C', octave: 4, alter: 0 }, start: ZERO, duration: fraction(1, 4) },
    { id: `${m.id}-rest`, kind: 'rest', start: ZERO, duration: fraction(3, 4) },
  ]) }],
})) })

describe('exact rational safe integer boundaries', () => {
  it('compares distinct fractions even when their cross products round to the same float', () => {
    const a = fraction(9007199254740990, 9007199254740991)
    const b = fraction(9007199254740989, 9007199254740990)
    expect(compare(a, b)).toBe(1)
    expect(compare(b, a)).toBe(-1)
  })
  it('reduces representable sums/differences before rejecting unsafe intermediates', () => {
    const a = fraction(Number.MAX_SAFE_INTEGER, 2)
    expect(add(a, a)).toEqual(fraction(Number.MAX_SAFE_INTEGER))
    const b = fraction(-Number.MAX_SAFE_INTEGER, 2)
    expect(subtract(a, b)).toEqual(fraction(Number.MAX_SAFE_INTEGER))
    expect(() => add(fraction(Number.MAX_SAFE_INTEGER), fraction(1))).toThrow()
  })
})

const cases = TIME_SIGNATURES.flatMap(time => Array.from({ length: 15 }, (_, i) => ({ key: i - 7, time })))
describe('all key/meter combinations', () => {
  it.each(cases)('preserves exact data and history with key $key and meter $time', ({ key, time }) => {
    const original = tinyScore()
    let state: EditorState = { ...createEditor(), present: { score: original, selection: first } }
    state = editorReducer(state, { type: 'keySignature', key })
    state = editorReducer(state, { type: 'timeSignature', time })
    const configured = state
    for (const alter of [1, -1, 0] as const) {
      const before = state
      state = editorReducer(state, { type: 'accidental', alter })
      expect(validateScore(state.present.score)).toEqual([])
      expect(locate(state.present.score, first).event).toMatchObject({ pitch: { alter } })
      expect(editorReducer(editorReducer(state, { type: 'undo' }), { type: 'redo' }).present).toEqual(state.present)
      expect(before.present.score.measures[0].voices[0].events[0].start).toEqual(ZERO)
    }
    const score = configured.present.score
    const events = score.measures[0].voices[0].events
    expect(events[0]).toEqual(original.measures[0].voices[0].events[0])
    expect(events.reduce((sum, e) => add(sum, e.duration), ZERO)).toEqual(measureDuration(time))
    const moved = transposeEvent(score, first, 1)
    expect(locate(moved, first).event).toMatchObject({ pitch: { step: 'D', alter: keyAlter(key, 'D') } })
    expect(validateScore(moved)).toEqual([])
    expect(measureAccidentals(score.measures[0], key).has(first.eventId)).toBe(keyAlter(key, 'C') !== 0)
  })
})

describe('deterministic adversarial edit sequences', () => {
  it('keeps all IDs, notes and onset invariants through seeded edits, rejection and undo/redo', () => {
    let seed = 0x5c0ae
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
    let state: EditorState = { ...createEditor(), present: { score: tinyScore(), selection: first } }
    for (let index = 0; index < 500; index++) {
      const before = state
      const all = selections(state.present.score)
      const commands = [
        () => editorReducer(state, { type: 'select', selection: all[random(all.length)] }),
        () => editorReducer(state, { type: 'duration', duration: DURATIONS[random(DURATIONS.length)] }),
        () => editorReducer(state, { type: 'pitch', amount: random(2) ? 1 : -1, chromatic: random(2) === 1 }),
        () => editorReducer(state, { type: 'keySignature', key: random(15) - 7 }),
        () => editorReducer(state, { type: 'timeSignature', time: TIME_SIGNATURES[random(TIME_SIGNATURES.length)] }),
        () => editorReducer(state, { type: random(2) ? 'undo' : 'redo' }),
        () => editorReducer(state, { type: 'accidental', alter: (random(3) - 1) as -1 | 0 | 1 }),
      ]
      state = commands[random(commands.length)]()
      expect(validateScore(state.present.score), `seed=0x5c0ae step=${index}`).toEqual([])
      if (state.present.selection) expect(() => locate(state.present.score, state.present.selection!)).not.toThrow()
      if (state.notice) {
        expect(state.present).toBe(before.present)
        expect(state.past).toBe(before.past)
        expect(state.future).toBe(before.future)
      }
    }
  })

  it('preserves note boundaries across repeated rest resizes in all meters', () => {
    for (const time of TIME_SIGNATURES) {
      let score = setTimeSignature(tinyScore(), time)
      const original = score.measures.map(m => m.voices[0].events[0])
      for (let round = 0; round < 12; round++) {
        for (const selection of selections(score)) {
          if (!selections(score).some(item => item.eventId === selection.eventId) || locate(score, selection).event.kind !== 'rest') continue
          try { score = resizeEvent(score, selection, DURATIONS[round % DURATIONS.length]) }
          catch (error) { expect((error as Error).message).toMatch(/부족/) }
          expect(validateScore(score)).toEqual([])
        }
      }
      expect(score.measures.map(m => m.voices[0].events[0])).toEqual(original)
    }
  })

  it('respects all seven altered steps at both sounding pitch limits', () => {
    for (let key = -7; key <= 7; key++) {
      for (const step of STEPS) {
        const pitch = { step, octave: 4, alter: keyAlter(key, step) }
        expect(movePitch(pitch, 7, false, key)).toEqual({ ...pitch, octave: 5 })
        expect(movePitch(pitch, -7, false, key)).toEqual({ ...pitch, octave: 3 })
      }
      const score = setKeySignature(tinyScore(), key)
      expect(validateScore(setAccidental(score, first, 0))).toEqual([])
    }
    expect(() => movePitch({ step: 'C', octave: 2, alter: 0 }, -1, true)).toThrow(/음역/)
    expect(() => movePitch({ step: 'C', octave: 7, alter: 0 }, 1, true)).toThrow(/음역/)
  })
})
