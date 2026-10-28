import { add, compare, equal, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { DURATIONS, eventPitches } from '../music/score'
import type { RhythmEvent, Score, Selection } from '../music/score'
import type { Pitch } from '../music/pitch'
import { midi } from '../music/pitch'
import { measureDuration } from '../music/settings'
import { reconcileTieEdits, withTies } from '../music/ties'
import { primaryScore, uid } from './model'
import type { Project } from './model'
import { addMeasure } from './structure'

export type RhythmMaterial = Readonly<{ offset: Rational; duration: Rational; pitches: readonly Pitch[]; tieTo?: readonly number[] }>
export const barStart = (capacity: Rational, index: number) => fraction(capacity.n * index, capacity.d)
const min = (a: Rational, b: Rational) => compare(a, b) <= 0 ? a : b
const max = (a: Rational, b: Rational) => compare(a, b) >= 0 ? a : b
const onGrid = (value: Rational) => Number.isSafeInteger(value.n * 64) && (value.n * 64) % value.d === 0

export function extendForRhythm(project: Project, end: Rational): Project {
  const score = primaryScore(project), capacity = measureDuration(score.timeSignature)
  let count = score.measures.length
  while (compare(barStart(capacity, count), end) < 0) {
    if (++count > 128) throw new Error('입력하면 128마디 제한을 넘습니다. 변경을 취소했습니다.')
  }
  while (primaryScore(project).measures.length < count) project = addMeasure(project)
  return project
}

function filledMaterials(materials: readonly RhythmMaterial[], span: Rational): RhythmMaterial[] {
  const result: RhythmMaterial[] = []
  let end = ZERO
  for (const item of materials) {
    if (!onGrid(item.offset) || !onGrid(item.duration) || compare(item.offset, end) < 0 || compare(item.duration, ZERO) <= 0 || compare(add(item.offset, item.duration), span) > 0)
      throw new Error('입력 구간의 시점이나 길이가 올바르지 않습니다. 64분음표 격자를 사용하세요.')
    if (compare(item.offset, end) > 0) result.push({ offset: end, duration: subtract(item.offset, end), pitches: [] })
    result.push(item); end = add(item.offset, item.duration)
  }
  if (compare(end, span) < 0) result.push({ offset: end, duration: subtract(span, end), pitches: [] })
  return result
}

// One exact-duration operation for step-time input and clipboard overwrite.
// Existing endpoints are reconciled BEFORE adding intentional fragment links:
// a retained source ID must not lose its newly created internal tie.
export function overwriteRhythm(score: Score, voiceId: string, start: Rational, span: Rational, materials: readonly RhythmMaterial[], percussion = false): { score: Score; inserted: Selection[] } {
  const capacity = measureDuration(score.timeSignature), end = add(start, span)
  if (!onGrid(start) || !onGrid(span) || compare(start, ZERO) < 0 || compare(span, ZERO) <= 0 || compare(end, barStart(capacity, score.measures.length)) > 0)
    throw new Error('입력 범위가 올바르지 않습니다. 64분음표 격자와 악보 길이를 확인하세요.')
  if (!score.measures[0].voices.some(voice => voice.id === voiceId)) throw new Error('입력할 성부를 찾을 수 없습니다.')
  const plannedTies = new Map<string, readonly number[]>()
  function pieces(local: Rational, duration: Rational, pitches: readonly Pitch[], outgoing: readonly number[] = [], firstId?: string): RhythmEvent[] {
    const result: RhythmEvent[] = []
    let remaining = duration, at = local
    for (const value of [...DURATIONS].reverse()) while (compare(remaining, value) >= 0) {
      const base = { id: result.length === 0 && firstId ? firstId : uid(), start: at, duration: value }
      result.push(pitches.length ? { ...base, kind: 'note', pitch: { ...pitches[0] }, ...(pitches.length > 1 ? { chord: pitches.slice(1).map(pitch => ({ ...pitch })) } : {}) } : { ...base, kind: 'rest' })
      at = add(at, value); remaining = subtract(remaining, value)
    }
    if (!equal(remaining, ZERO)) throw new Error('64분음표 격자로 표현할 수 없는 길이입니다.')
    if (percussion && pitches.length && (result.length > 1 || outgoing.length)) throw new Error('타악기 음표의 자동 붙임줄 분할은 아직 지원하지 않습니다. 짧은 길이로 입력하세요.')
    return result.map((event, i) => {
      if (event.kind !== 'note') return event
      const ties = i < result.length - 1 ? pitches.map(midi) : outgoing
      if (ties.length) plannedTies.set(event.id, ties)
      return withTies(event, ties)
    })
  }
  const insertedByBar = new Map<number, RhythmEvent[]>(), inserted: Selection[] = []
  for (const item of filledMaterials(materials, span)) {
    const a = add(start, item.offset), b = add(a, item.duration)
    for (let m = 0; m < score.measures.length; m++) {
      const base = barStart(capacity, m), limit = add(base, capacity)
      if (compare(a, limit) >= 0 || compare(b, base) <= 0) continue
      const local = subtract(max(a, base), base), duration = subtract(min(b, limit), max(a, base))
      const outgoing = compare(b, limit) > 0 ? item.pitches.map(midi) : item.tieTo
      const events = pieces(local, duration, item.pitches, outgoing)
      insertedByBar.set(m, [...(insertedByBar.get(m) ?? []), ...events])
      for (const event of events) inserted.push({ measureId: score.measures[m].id, voiceId, eventId: event.id })
    }
  }
  const measures = score.measures.map((bar, m) => {
    const base = barStart(capacity, m), limit = add(base, capacity)
    if (compare(base, end) >= 0 || compare(limit, start) <= 0) return bar
    const left = subtract(max(start, base), base), right = subtract(min(end, limit), base)
    return { ...bar, voices: bar.voices.map(voice => {
      if (voice.id !== voiceId) return voice
      const before: RhythmEvent[] = [], after: RhythmEvent[] = []
      for (const event of voice.events) {
        const eventEnd = add(event.start, event.duration)
        if (compare(eventEnd, left) <= 0) before.push(event)
        else if (compare(event.start, right) >= 0) after.push(event)
        else {
          if (compare(event.start, left) < 0) before.push(...pieces(event.start, subtract(left, event.start), eventPitches(event), [], event.id))
          if (compare(eventEnd, right) > 0) after.push(...pieces(right, subtract(eventEnd, right), eventPitches(event), event.kind === 'note' ? event.tieTo : []))
        }
      }
      return { ...voice, events: [...before, ...(insertedByBar.get(m) ?? []), ...after] }
    }) }
  })
  const reconciled = reconcileTieEdits(score, { ...score, measures })
  return { score: { ...reconciled, measures: reconciled.measures.map(bar => {
    const voices = bar.voices.map(voice => {
      if (voice.id !== voiceId) return voice
      const events = voice.events.map(event => event.kind === 'note' && plannedTies.has(event.id) ? withTies(event, plannedTies.get(event.id)!) : event)
      return events.every((event, i) => event === voice.events[i]) ? voice : { ...voice, events }
    })
    return voices.every((voice, i) => voice === bar.voices[i]) ? bar : { ...bar, voices }
  }) }, inserted }
}
