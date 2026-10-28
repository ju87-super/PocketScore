import { add, compare, equal, formatFraction, fraction, subtract, WHOLE, ZERO } from './rational'
import type { Rational } from './rational'
import { midi, movePitch, pitchName, STEPS } from './pitch'
import type { Pitch } from './pitch'
import { measureDuration, TIME_SIGNATURES, validKey } from './settings'
import type { TimeSignature } from './settings'
import { rewriteTiedPitches, tieLinks, validateTies } from './ties'

type EventBase = Readonly<{ id: string; start: Rational; duration: Rational }>
export type RhythmEvent = EventBase & (
  | Readonly<{ kind: 'note'; pitch: Pitch; chord?: readonly Pitch[]; tieTo?: readonly number[] }>
  | Readonly<{ kind: 'rest' }>
)
export type Voice = Readonly<{ id: string; events: readonly RhythmEvent[] }>
export type Measure = Readonly<{ id: string; voices: readonly Voice[] }>
export type Score = Readonly<{ keySignature: number; timeSignature: TimeSignature; measures: readonly Measure[] }>
export type Selection = Readonly<{ measureId: string; voiceId: string; eventId: string; pitchIndex?: number }>

export const eventPitches = (event: RhythmEvent): readonly Pitch[] => event.kind === 'note' ? [event.pitch, ...(event.chord ?? [])] : []

// Durations are whole-note fractions, including a single dot. No floating-point timing.
export const DURATIONS = [fraction(1, 64), fraction(1, 32), fraction(3, 64), fraction(1, 16), fraction(3, 32), fraction(1, 8), fraction(3, 16), fraction(1, 4), fraction(3, 8), fraction(1, 2), fraction(3, 4), WHOLE]
const LABELS = ['64분', '32분', '점32분', '16분', '점16분', '8분', '점8분', '4분', '점4분', '2분', '점2분', '온']
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
  if (!validKey(score.keySignature)) errors.push('지원하지 않는 조표')
  if (!TIME_SIGNATURES.includes(score.timeSignature)) return ['지원하지 않는 박자표']
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
        for (const pitch of eventPitches(event)) if (!STEPS.includes(pitch.step) || !Number.isInteger(pitch.octave)
          || ![-1, 0, 1].includes(pitch.alter) || midi(pitch) < 36 || midi(pitch) > 96) errors.push('잘못된 음높이')
        end = add(end, event.duration)
      }
      if (!equal(end, measureDuration(score.timeSignature))) errors.push(`${measure.id}/${voice.id}: 박자 합계 ${formatFraction(end)} (${score.timeSignature} 필요)`)
    }
  }
  return [...errors, ...validateTies(score)]
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

function makeRests(score: Score, amount: Rational, used = new Set(score.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => event.id))))): RhythmEvent[] {
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
  if (!equal(remaining, ZERO)) throw new Error('64분음표보다 짧은 길이는 지원하지 않습니다.')
  return rests
}

export function resizeEvent(score: Score, selection: Selection, duration: Rational): Score {
  if (!DURATIONS.some(item => equal(item, duration))) throw new Error('지원하지 않는 길이입니다.')
  const { voice, index, event } = locate(score, selection)
  if (equal(duration, event.duration)) return score
  if (tieLinks(score).some(link => link.from.event.id === event.id || link.to.event.id === event.id)) throw new Error('붙임줄로 연결된 음표는 붙임줄을 해제한 뒤 길이를 변경하세요.')
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
  const { event } = locate(score, selection)
  if (event.kind === 'rest' || amount === 0) return score
  const pitches = [...eventPitches(event)]
  const tone = selection.pitchIndex ?? 0
  if (!pitches[tone]) throw new Error('선택한 화음 구성음을 찾을 수 없습니다.')
  pitches[tone] = movePitch(pitches[tone], amount, chromatic, score.keySignature)
  if (new Set(pitches.map(midi)).size !== pitches.length) throw new Error('화음에 같은 음높이가 이미 있습니다.')
  const next = rewriteTiedPitches(score, [selection], () => pitches[tone])
  const errors = validateScore(next)
  if (errors.length) throw new Error(errors.join(' '))
  return next
}

export function setAccidental(score: Score, selection: Selection, alter: Pitch['alter']): Score {
  const { event } = locate(score, selection)
  if (event.kind === 'rest') return score
  const pitches = [...eventPitches(event)]
  const tone = selection.pitchIndex ?? 0
  if (!pitches[tone]) throw new Error('선택한 화음 구성음을 찾을 수 없습니다.')
  if (pitches[tone].alter === alter) return score
  if (![-1, 0, 1].includes(alter)) throw new Error('지원하지 않는 임시표입니다.')
  pitches[tone] = { ...pitches[tone], alter }
  if (new Set(pitches.map(midi)).size !== pitches.length) throw new Error('화음에 같은 음높이가 이미 있습니다.')
  const next = rewriteTiedPitches(score, [selection], () => pitches[tone])
  const errors = validateScore(next)
  if (errors.length) throw new Error(errors.join(' '))
  return next
}

export function setKeySignature(score: Score, keySignature: number): Score {
  if (!validKey(keySignature)) throw new Error('조표는 플랫 7개부터 샤프 7개까지 지원합니다.')
  return keySignature === score.keySignature ? score : { ...score, keySignature }
}

export function setTimeSignature(score: Score, timeSignature: TimeSignature): Score {
  if (!TIME_SIGNATURES.includes(timeSignature)) throw new Error('지원하지 않는 박자표입니다.')
  if (timeSignature === score.timeSignature) return score
  if (tieLinks(score).some(link => link.from.measure !== link.to.measure)) throw new Error('마디를 넘는 붙임줄을 해제한 뒤 박자표를 변경하세요.')
  const limit = measureDuration(timeSignature)
  // Reject atomically before touching any voice if a sounding note would be cut.
  for (const [index, measure] of score.measures.entries()) {
    if (measure.voices.some(voice => voice.events.some(event => event.kind === 'note' && compare(add(event.start, event.duration), limit) > 0))) {
      throw new Error(`${index + 1}마디의 음표가 ${timeSignature} 마디 길이를 넘습니다. 음표의 시작과 길이를 보존할 수 없어 박자 변경을 거부했습니다.`)
    }
  }
  const used = new Set(score.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => event.id))))
  const next: Score = { ...score, timeSignature, measures: score.measures.map(measure => ({
    ...measure, voices: measure.voices.map(voice => {
      const events: RhythmEvent[] = []
      for (const event of voice.events) {
        if (compare(event.start, limit) >= 0) break
        if (compare(add(event.start, event.duration), limit) <= 0) events.push(event)
        else {
          // Only a trailing rest can intersect the new barline. Re-spell its
          // remaining duration without moving or resizing any note.
          const rests = makeRests(score, subtract(limit, event.start), used)
          events.push(...rests.map((rest, i) => i === 0 ? { ...rest, id: event.id } : rest))
        }
      }
      const end = events.reduce((sum, event) => add(sum, event.duration), ZERO)
      if (compare(end, limit) < 0) events.push(...makeRests(score, subtract(limit, end), used))
      return { ...voice, events: retime(events) }
    }),
  })) }
  const errors = validateScore(next)
  if (errors.length) throw new Error(errors.join(' '))
  return next
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
  return { keySignature: 0, timeSignature: '4/4', measures: definitions.map((items, m) => ({
    id: `m${m + 1}`,
    voices: [{ id: 'v1', events: retime(items.map(([kind, duration, pitch], e) => ({
      id: `m${m + 1}-e${e + 1}`, start: ZERO, duration,
      ...(kind === 'note' && pitch ? { kind: 'note' as const, pitch } : { kind: 'rest' as const }),
    }))) }],
  })) }
}
