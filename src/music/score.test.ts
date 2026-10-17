// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { add, equal, fraction, WHOLE, ZERO } from './rational'
import { movePitch, pitchName } from './pitch'
import { createInitialScore, DURATIONS, locate, moveCursor, resizeEvent, retime, selections, transposeEvent, validateScore } from './score'
import type { RhythmEvent, Score, Selection } from './score'

const first: Selection = { measureId: 'm1', voiceId: 'v1', eventId: 'm1-e1' }
const second: Selection = { ...first, eventId: 'm1-e2' }
const q = fraction(1, 4)
const e = fraction(1, 8)
const h = fraction(1, 2)
const events = (score: Score) => score.measures[0].voices[0].events

function restScore(durations = [q, e, e, h]): Score {
  return { measures: [{ id: 'm1', voices: [{ id: 'v1', events: retime(durations.map((duration, index) => ({
    id: `m1-e${index + 1}`, kind: 'rest' as const, start: ZERO, duration,
  }))) }] }] }
}

describe('exact timing and invariants', () => {
  it('normalizes fractions and sums without rounding', () => {
    expect(fraction(2, 8)).toEqual(q)
    expect(fraction(1, -4)).toEqual(fraction(-1, 4))
    expect(add(fraction(1, 3), fraction(2, 3))).toEqual(WHOLE)
    expect(() => fraction(1, 0)).toThrow()
    expect(() => fraction(0.5)).toThrow()
  })

  it('starts with exactly four valid 4/4 measures', () => {
    const score = createInitialScore()
    expect(score.measures).toHaveLength(4)
    expect(validateScore(score)).toEqual([])
    expect(events(score).map(event => event.start)).toEqual([ZERO, q, h, fraction(3, 4)])
  })

  it('detects gaps, incorrect totals, duplicate IDs, and invalid durations', () => {
    const original = events(createInitialScore())
    const broken: RhythmEvent[] = [original[0], { ...original[1], id: original[0].id, start: ZERO, duration: fraction(1, 3) }]
    const score: Score = { measures: [{ id: 'm1', voices: [{ id: 'v1', events: broken }] }] }
    const errors = validateScore(score).join(' ')
    expect(errors).toMatch(/시작 시점/)
    expect(errors).toMatch(/박자 합계/)
    expect(errors).toMatch(/중복 이벤트/)
    expect(errors).toMatch(/지원하지 않는 길이/)
  })
})

describe('duration edits', () => {
  it('shortens a rest and creates a new adjacent rest without undoing the selected length', () => {
    const original = createInitialScore()
    const next = resizeEvent(original, second, e)
    expect(events(next).map(event => event.duration)).toEqual([q, e, e, q, q])
    expect(events(next)[1].id).toBe(second.eventId)
    expect(events(next)[2].kind).toBe('rest')
    expect(events(next)[2].id).not.toBe(second.eventId)
    expect(events(next)[3].start).toEqual(h)
    expect(validateScore(next)).toEqual([])
    expect(events(original)).toHaveLength(4)
  })

  it('merges released time with the following consecutive rest run', () => {
    const next = resizeEvent(restScore(), first, e)
    expect(events(next).map(event => event.duration)).toEqual([e, fraction(3, 4), e])
    expect(events(next)[0].id).toBe(first.eventId)
    expect(validateScore(next)).toEqual([])
  })

  it('shortens a note and merges the released duration into following rests', () => {
    const next = resizeEvent(createInitialScore(), first, e)
    expect(events(next).map(event => event.duration)).toEqual([e, fraction(3, 8), q, q])
    expect(events(next)[0].kind).toBe('note')
    expect(events(next)[1].kind).toBe('rest')
    expect(events(next)[2].start).toEqual(h)
  })

  it('lengthens a note using only the following rest', () => {
    const next = resizeEvent(createInitialScore(), first, h)
    expect(events(next).map(event => event.duration)).toEqual([h, q, q])
    expect(events(next)[1].id).toBe('m1-e3')
    expect(events(next)[1].start).toEqual(h)
  })

  it('absorbs multiple immediately adjacent rests and decomposes leftover time exactly', () => {
    const next = resizeEvent(restScore(), first, fraction(3, 8))
    expect(events(next).map(event => event.duration)).toEqual([fraction(3, 8), h, e])
    expect(validateScore(next)).toEqual([])
  })

  it('stops at a following note even if there is another rest later', () => {
    expect(() => resizeEvent(createInitialScore(), second, h)).toThrow(/음표와 마디선/)
    expect(() => resizeEvent(createInitialScore(), first, fraction(3, 4))).toThrow(/부족/)
  })

  it('cannot consume rests across a barline or from another voice', () => {
    const score = createInitialScore()
    const last = { ...first, eventId: 'm1-e4' }
    expect(() => resizeEvent(score, last, h)).toThrow(/마디선/)
    const withVoice: Score = { measures: [{ ...score.measures[0], voices: [score.measures[0].voices[0], { ...restScore([WHOLE]).measures[0].voices[0], id: 'v2', events: [{ id: 'other', kind: 'rest', start: ZERO, duration: WHOLE }] }] }] }
    expect(() => resizeEvent(withVoice, second, h)).toThrow(/부족/)
    const next = resizeEvent(withVoice, first, h)
    expect(next.measures[0].voices[1]).toBe(withVoice.measures[0].voices[1])
  })

  it('preserves unchanged scores and rejects unsupported durations or stale selections', () => {
    const score = createInitialScore()
    expect(resizeEvent(score, first, q)).toBe(score)
    expect(() => resizeEvent(score, first, fraction(1, 3))).toThrow(/지원하지/)
    expect(() => resizeEvent(score, { ...first, eventId: 'missing' }, e)).toThrow(/찾을 수/)
  })

  it('keeps every voice total, start, and ID valid over a deterministic edit sequence', () => {
    let score = createInitialScore()
    for (let round = 0; round < 6; round++) {
      for (const selection of selections(score)) {
        for (const duration of DURATIONS) {
          // Earlier resizes may have removed a rest from this traversal snapshot.
          if (!selections(score).some(item => item.eventId === selection.eventId)) continue
          const before = JSON.stringify(score)
          try {
            const next = resizeEvent(score, selection, duration)
            expect(validateScore(next)).toEqual([])
            expect(JSON.stringify(score)).toBe(before)
            score = next
          } catch (error) {
            expect((error as Error).message).toMatch(/길이가 부족/)
            expect(JSON.stringify(score)).toBe(before)
          }
        }
      }
    }
    expect(score.measures.every(measure => measure.voices.every(voice => equal(voice.events.reduce((sum, event) => add(sum, event.duration), ZERO), WHOLE)))).toBe(true)
  })
})

describe('pitch and cursor', () => {
  it.each([
    ['B', 4, 1, false, 'C5'], ['C', 4, -1, false, 'B3'],
    ['C', 4, 1, true, 'C♯4'], ['D', 4, -1, true, 'D♭4'],
    ['B', 4, 1, true, 'C5'], ['E', 4, 1, true, 'F4'],
    ['C', 4, -1, true, 'B3'],
  ] as const)('moves %s%d by %d (chromatic=%s) to %s', (step, octave, amount, chromatic, expected) => {
    expect(pitchName(movePitch({ step, octave, alter: 0 }, amount, chromatic))).toBe(expected)
  })

  it('continues semitone edits from an accidental and uses natural letters for diatonic edits', () => {
    const sharp = movePitch({ step: 'C', octave: 4, alter: 0 }, 1, true)
    expect(pitchName(movePitch(sharp, 1, true))).toBe('D4')
    expect(pitchName(movePitch(sharp, 1))).toBe('D4')
    expect(() => movePitch({ step: 'C', octave: 7, alter: 0 }, 1)).toThrow(/음역/)
  })

  it('leaves rests unchanged for both pitch commands', () => {
    const score = createInitialScore()
    expect(transposeEvent(score, second, 1)).toBe(score)
    expect(transposeEvent(score, second, -1, true)).toBe(score)
    expect(validateScore(transposeEvent(score, first, 1))).toEqual([])
  })

  it('traverses every note and rest across barlines in both directions', () => {
    const score = createInitialScore()
    const all = selections(score)
    let current = moveCursor(score, null, 1)
    expect(current).toEqual(all[0])
    for (const expected of all.slice(1)) {
      current = moveCursor(score, current, 1)
      expect(current).toEqual(expected)
    }
    expect(moveCursor(score, current, 1)).toEqual(all.at(-1))
    for (const expected of all.slice(0, -1).reverse()) {
      current = moveCursor(score, current, -1)
      expect(current).toEqual(expected)
    }
    expect(moveCursor(score, current, -1)).toEqual(all[0])
    expect(moveCursor(score, null, -1)).toEqual(all.at(-1))
    expect(locate(score, all[1]).event.kind).toBe('rest')
  })
})
