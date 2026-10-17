import { add, compare, equal, formatFraction, fraction, subtract, WHOLE, ZERO } from './rational'
import type { Rational } from './rational'
import { midi, movePitch, pitchName, STEPS } from './pitch'
import type { Pitch } from './pitch'

type EventBase = Readonly<{ id: string; start: Rational; duration: Rational }>
export type RhythmEvent = EventBase & (
  | Readonly<{ kind: 'note'; pitch: Pitch }>
  | Readonly<{ kind: 'rest' }>
)
export type Voice = Readonly<{ id: string; events: readonly RhythmEvent[] }>
export type Measure = Readonly<{ id: string; voices: readonly Voice[] }>
export type Score = Readonly<{ measures: readonly Measure[] }>
export type Selection = Readonly<{ measureId: string; voiceId: string; eventId: string }>

// Durations are whole-note fractions, including a single dot. No floating-point timing.
export const DURATIONS = [fraction(1, 16), fraction(1, 8), fraction(3, 16), fraction(1, 4), fraction(3, 8), fraction(1, 2), fraction(3, 4), WHOLE]
const LABELS = ['16분', '8분', '점8분', '4분', '점4분', '2분', '점2분', '온']
export const durationName = (duration: Rational) => LABELS[DURATIONS.findIndex(item => equal(item, duration))] ?? formatFraction(duration)
export const eventName = (event: RhythmEvent) => event.kind === 'note'
  ? `${pitchName(event.pitch)} ${durationName(event.duration)}음표`
  : `${durationName(event.duration)}쉼표`

export function retime(events: readonly RhythmEvent[]): RhythmEvent[] {
  let start = ZERO
  return events.map(event => {
    const next = { ...event, start }
    start = add(start, event.duration)
    return next
  })
}

export function validateScore(score: Score): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const measureIds = new Set<string>()
  if (score.measures.length === 0) errors.push('마디가 없습니다.')
  for (const measure of score.measures) {
    if (measureIds.has(measure.id)) errors.push('중복 마디 ID')
    measureIds.add(measure.id)
    const voiceIds = new Set<string>()
    if (measure.voices.length === 0) errors.push('성부가 없습니다.')
    for (const voice of measure.voices) {
      if (voiceIds.has(voice.id)) errors.push('중복 성부 ID')
      voiceIds.add(voice.id)
      let end = ZERO
      for (const event of voice.events) {
        if (ids.has(event.id)) errors.push('중복 이벤트 ID')
        ids.add(event.id)
        if (!equal(event.start, end)) errors.push('이벤트 시작 시점이 연속적이지 않습니다.')
        if (!DURATIONS.some(duration => equal(duration, event.duration))) errors.push('지원하지 않는 길이')
        if (event.kind === 'note' && (!STEPS.includes(event.pitch.step) || !Number.isInteger(event.pitch.octave)
          || ![-1, 0, 1].includes(event.pitch.alter) || midi(event.pitch) < 36 || midi(event.pitch) > 96)) errors.push('잘못된 음높이')
        end = add(end, event.duration)
      }
      if (!equal(end, WHOLE)) errors.push(`${measure.id}/${voice.id}: 박자 합계 ${formatFraction(end)} (4/4 필요)`)
    }
  }
  return errors
}

export function locate(score: Score, selection: Selection) {
  const measure = score.measures.find(item => item.id === selection.measureId)
  const voice = measure?.voices.find(item => item.id === selection.voiceId)
  const index = voice?.events.findIndex(item => item.id === selection.eventId) ?? -1
  if (!measure || !voice || index < 0) throw new Error('선택한 이벤트를 찾을 수 없습니다.')
  return { measure, voice, index, event: voice.events[index] }
}

function replaceVoice(score: Score, selection: Selection, events: readonly RhythmEvent[]): Score {
  const next = {
    ...score,
    measures: score.measures.map(measure => measure.id !== selection.measureId ? measure : {
      ...measure,
      voices: measure.voices.map(voice => voice.id !== selection.voiceId ? voice : { ...voice, events: retime(events) }),
    }),
  }
  const errors = validateScore(next)
  if (errors.length) throw new Error(errors.join(' '))
  return next
}

function makeRests(score: Score, amount: Rational): RhythmEvent[] {
  const used = new Set(score.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => event.id))))
  let serial = 1
  const rests: RhythmEvent[] = []
  let remaining = amount
  for (const duration of [...DURATIONS].reverse()) {
    while (compare(remaining, duration) >= 0) {
      while (used.has(`rest-${serial}`)) serial++
      const id = `rest-${serial++}`
      used.add(id)
      rests.push({ id, kind: 'rest', start: ZERO, duration })
      remaining = subtract(remaining, duration)
    }
  }
  if (!equal(remaining, ZERO)) throw new Error('16분음표보다 짧은 길이는 지원하지 않습니다.')
  return rests
}

export function resizeEvent(score: Score, selection: Selection, duration: Rational): Score {
  if (!DURATIONS.some(item => equal(item, duration))) throw new Error('지원하지 않는 길이입니다.')
  const { voice, index, event } = locate(score, selection)
  if (equal(duration, event.duration)) return score
  const delta = subtract(duration, event.duration)
  let nextIndex = index + 1
  let restSpace = ZERO
  // Only the immediately following rest run is available. Notes and barlines are barriers.
  while (nextIndex < voice.events.length && voice.events[nextIndex].kind === 'rest') {
    restSpace = add(restSpace, voice.events[nextIndex].duration)
    nextIndex++
  }
  if (compare(delta, restSpace) > 0) throw new Error('바로 뒤 쉼표의 길이가 부족합니다. 음표와 마디선을 넘을 수 없습니다.')
  const remainder = subtract(restSpace, delta)
  // Keep the selected event separate so shortening a rest remains visible and undoable.
  return replaceVoice(score, selection, [
    ...voice.events.slice(0, index),
    { ...event, duration },
    ...makeRests(score, remainder),
    ...voice.events.slice(nextIndex),
  ])
}

export function transposeEvent(score: Score, selection: Selection, amount: number, chromatic = false): Score {
  const { voice, index, event } = locate(score, selection)
  if (event.kind === 'rest' || amount === 0) return score
  const pitch = movePitch(event.pitch, amount, chromatic)
  return replaceVoice(score, selection, voice.events.map((item, i) => i === index ? { ...event, pitch } : item))
}

export function selections(score: Score): Selection[] {
  return score.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => ({
    measureId: measure.id, voiceId: voice.id, eventId: event.id,
  }))))
}

export function moveCursor(score: Score, selected: Selection | null, direction: -1 | 1): Selection {
  const all = selections(score)
  const current = selected ? all.findIndex(item => item.eventId === selected.eventId) : -1
  const index = current < 0 ? (direction === 1 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, current + direction))
  return all[index]
}

export function createInitialScore(): Score {
  const quarter = fraction(1, 4)
  const eighth = fraction(1, 8)
  const definitions: Array<Array<['note' | 'rest', Rational, Pitch?]>> = [
    [['note', quarter, { step: 'C', octave: 4, alter: 0 }], ['rest', quarter], ['note', quarter, { step: 'E', octave: 4, alter: 0 }], ['rest', quarter]],
    [['note', eighth, { step: 'G', octave: 4, alter: 0 }], ['note', eighth, { step: 'A', octave: 4, alter: 0 }], ['rest', quarter], ['note', quarter, { step: 'F', octave: 4, alter: 0 }], ['rest', quarter]],
    [['rest', fraction(1, 2)], ['note', quarter, { step: 'D', octave: 4, alter: 0 }], ['rest', quarter]],
    [['note', quarter, { step: 'G', octave: 4, alter: 0 }], ['rest', fraction(3, 4)]],
  ]
  return { measures: definitions.map((items, m) => ({
    id: `m${m + 1}`,
    voices: [{ id: 'v1', events: retime(items.map(([kind, duration, pitch], e) => ({
      id: `m${m + 1}-e${e + 1}`, start: ZERO, duration,
      ...(kind === 'note' && pitch ? { kind: 'note' as const, pitch } : { kind: 'rest' as const }),
    }))) }],
  })) }
}
