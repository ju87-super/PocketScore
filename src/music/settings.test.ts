// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { measureAccidentals } from './accidentals'
import type { Pitch } from './pitch'
import { midi, movePitch } from './pitch'
import { add, compare, fraction, ZERO } from './rational'
import { createInitialScore, locate, resizeEvent, retime, setAccidental, setKeySignature, setTimeSignature, transposeEvent, validateScore } from './score'
import type { Measure, Score } from './score'
import { keyAlter, measureDuration, TIME_SIGNATURES } from './settings'

const selection = { measureId: 'm1', voiceId: 'v1', eventId: 'n0' }
const pitch = (step: Pitch['step'] = 'F', alter: Pitch['alter'] = 0, octave = 4): Pitch => ({ step, alter, octave })
function measure(pitches: Pitch[], id = 'm1'): Measure {
  return { id, voices: [{ id: 'v1', events: retime(pitches.map((value, i) => ({ id: `n${i}`, kind: 'note' as const, pitch: value, start: ZERO, duration: fraction(1, 8) }))) }] }
}
function shortScore(): Score {
  const m = measure([pitch('C')])
  return { keySignature: 0, timeSignature: '4/4', measures: [{ ...m, voices: [{ id: 'v1', events: retime([
    ...m.voices[0].events, { id: 'r1', kind: 'rest', start: ZERO, duration: fraction(3, 4) }, { id: 'r2', kind: 'rest', start: ZERO, duration: fraction(1, 8) },
  ]) }] }] }
}

describe('key signatures and explicit pitches', () => {
  it('supports all fifteen signatures without changing pitches, timing or event IDs', () => {
    const original = createInitialScore()
    for (let key = -7; key <= 7; key++) {
      const next = setKeySignature(original, key)
      expect(next.measures).toBe(original.measures)
      expect(validateScore(next)).toEqual([])
      expect(keyAlter(key, key < 0 ? 'B' : 'F')).toBe(key === 0 ? 0 : key < 0 ? -1 : 1)
    }
    expect(() => setKeySignature(original, 8)).toThrow(/조표/)
    expect(() => setKeySignature(original, 0.5)).toThrow(/조표/)
  })

  it('moves diatonically in the key while keeping chromatic movement and pitch limits', () => {
    expect(movePitch(pitch('E'), 1, false, 1)).toEqual(pitch('F', 1))
    expect(movePitch(pitch('A'), 1, false, -1)).toEqual(pitch('B', -1))
    expect(movePitch(pitch('B'), 1, false, 7)).toEqual(pitch('C', 1, 5))
    expect(movePitch(pitch('C'), -1, false, -7)).toEqual(pitch('B', -1, 3))
    expect(movePitch(pitch('E'), 1, true, 1)).toEqual(pitch('F'))
    expect(() => movePitch(pitch('B', 0, 6), 1, false, 7)).toThrow(/음역/)
    const score = setKeySignature(shortScore(), -1)
    const next = transposeEvent(score, selection, -1)
    expect(locate(next, selection).event).toMatchObject({ pitch: pitch('B', -1, 3) })
  })

  it('sets sharps/flats/naturals absolutely and ignores rests and no-ops', () => {
    const score = shortScore()
    for (const alter of [-1, 0, 1] as const) {
      const next = setAccidental(score, selection, alter)
      const event = locate(next, selection).event
      expect(event).toMatchObject({ pitch: pitch('C', alter) })
      if (event.kind === 'note') expect(midi(event.pitch)).toBe(60 + alter)
      expect(validateScore(next)).toEqual([])
    }
    expect(setAccidental(score, { ...selection, eventId: 'r1' }, 1)).toBe(score)
    const high = { ...score, measures: [measure([pitch('C', 0, 7)])] }
    expect(() => setAccidental(high, selection, 1)).toThrow(/음높이/)
  })
})

describe('measure accidental state', () => {
  it('suppresses repeats, cancels alterations and resets at each barline', () => {
    const m = measure([pitch('F', 1), pitch('F', 1), pitch(), pitch(), pitch('F', -1), pitch('F', -1), pitch('F', 1)])
    expect([...measureAccidentals(m, 0)]).toEqual([['n0', 1], ['n2', 0], ['n4', -1], ['n6', 1]])
    expect([...measureAccidentals(measure([pitch('F', 1)], 'm2'), 0)]).toEqual([['n0', 1]])
  })

  it('uses the signature baseline, preserves octave independence and natural cancellations', () => {
    expect([...measureAccidentals(measure([pitch('F', 1), pitch(), pitch(), pitch('F', 1), pitch('F', 0, 5)]), 1)])
      .toEqual([['n1', 0], ['n3', 1], ['n4', 0]])
    expect([...measureAccidentals(measure([pitch('B', -1), pitch('B'), pitch('B', -1)]), -1)])
      .toEqual([['n1', 0], ['n2', -1]])
    for (const key of [-7, 7]) {
      const naturals = measure(['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(step => pitch(step as Pitch['step'])))
      expect(measureAccidentals(naturals, key).size).toBe(7)
    }
  })

  it('shares state across voices by onset and disambiguates simultaneous conflicts', () => {
    const m = measure([pitch('F', 1), pitch('F', 1)])
    const second = { id: 'v2', events: m.voices[0].events.map((event, i) => ({ ...event, id: `v2-${i}`, pitch: pitch() })) }
    expect([...measureAccidentals({ ...m, voices: [...m.voices, second] }, 0)])
      .toEqual([['n0', 1], ['v2-0', 0], ['n1', 1], ['v2-1', 0]])
  })
})

describe('exact global meter changes', () => {
  it.each(TIME_SIGNATURES)('fits %s by changing only rests, preserving every note and validating edits', time => {
    const score = shortScore()
    const next = setTimeSignature(score, time)
    expect(validateScore(next)).toEqual([])
    expect(locate(next, selection).event).toEqual(locate(score, selection).event)
    expect(next.measures[0].voices[0].events.reduce((sum, event) => add(sum, event.duration), ZERO)).toEqual(measureDuration(time))
    // Duration edits must use the new meter's available space, never 4/4.
    expect(validateScore(resizeEvent(next, selection, fraction(1, 4)))).toEqual([])
    if (compare(measureDuration(time), fraction(1)) < 0) expect(() => resizeEvent(next, selection, fraction(1))).toThrow(/부족/)
    expect(validateScore(score)).toEqual([])
  })

  it('rejects any cut/removed note atomically, including later measures and other voices', () => {
    const score = createInitialScore()
    const before = JSON.stringify(score)
    expect(() => setTimeSignature(score, '2/4')).toThrow(/1마디.*음표/)
    expect(() => setTimeSignature(score, '3/8')).toThrow(/음표/)
    expect(JSON.stringify(score)).toBe(before)
    const later = { ...shortScore(), measures: [...shortScore().measures, score.measures[1]] }
    expect(() => setTimeSignature(later, '2/4')).toThrow(/2마디/)
    const multi = { ...shortScore(), measures: [{ ...shortScore().measures[0], voices: [shortScore().measures[0].voices[0], { ...score.measures[0].voices[0], id: 'v2' }] }] }
    expect(() => setTimeSignature(multi, '2/4')).toThrow(/음표/)
  })

  it('accepts a note ending exactly at the barline and keeps all surviving onsets and lengths', () => {
    const score = createInitialScore()
    const next = setTimeSignature(score, '3/4')
    const notes = (value: Score) => value.measures.flatMap(m => m.voices.flatMap(v => v.events.filter(event => event.kind === 'note')))
    expect(notes(next)).toEqual(notes(score))
    expect(validateScore(next)).toEqual([])
    expect(setTimeSignature(next, '3/4')).toBe(next)
    expect(validateScore(setTimeSignature(next, '12/8'))).toEqual([])
  })

  it('allocates unique rests in all voices/measures when growing', () => {
    const score = createInitialScore()
    const multi = { ...score, measures: score.measures.map(m => ({ ...m, voices: [...m.voices, { id: 'v2', events: [{ id: `${m.id}-other`, kind: 'rest' as const, start: ZERO, duration: fraction(1) }] }] })) }
    const next = setTimeSignature(multi, '12/8')
    expect(validateScore(next)).toEqual([])
    expect(next.measures.every(m => m.voices.every(v => v.events.at(-1)?.duration.n === 1))).toBe(true)
  })
})
