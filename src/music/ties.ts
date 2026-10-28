import type { RhythmEvent, Score, Selection } from './score'
import type { Pitch } from './pitch'
import { midi } from './pitch'
import { add, equal, ZERO } from './rational'
import { measureDuration } from './settings'

type NoteEvent = Extract<RhythmEvent, { kind: 'note' }>
type Point = { selection: Selection; event: RhythmEvent; measure: number }
export type TieLink = { from: Point & { pitchIndex: number }; to: Point & { pitchIndex: number }; midi: number }
const pitches = (event: RhythmEvent) => event.kind === 'note' ? [event.pitch, ...(event.chord ?? [])] : []
const toneKey = (eventId: string, pitch: number) => JSON.stringify([eventId, pitch])

function streams(score: Score) {
  const result = new Map<string, Point[]>()
  score.measures.forEach((measure, index) => measure.voices.forEach(voice => {
    const row = result.get(voice.id) ?? []
    voice.events.forEach(event => row.push({ selection: { measureId: measure.id, voiceId: voice.id, eventId: event.id }, event, measure: index }))
    result.set(voice.id, row)
  }))
  return result
}
function adjacent(score: Score, from: Point, to?: Point) {
  return !!to && (from.measure === to.measure ? equal(add(from.event.start, from.event.duration), to.event.start)
    : to.measure === from.measure + 1 && equal(add(from.event.start, from.event.duration), measureDuration(score.timeSignature)) && equal(to.event.start, ZERO))
}
export function validateTies(score: Score): string[] {
  const errors: string[] = []
  for (const row of streams(score).values()) row.forEach((point, i) => {
    const event = point.event
    if (!('tieTo' in event)) return
    if (event.kind !== 'note' || !Array.isArray(event.tieTo) || !event.tieTo.length || event.tieTo.length > 8
      || new Set(event.tieTo).size !== event.tieTo.length || event.tieTo.some(value => !Number.isInteger(value) || !pitches(event).some(pitch => midi(pitch) === value))) {
      errors.push('붙임줄의 구성음이 올바르지 않습니다.'); return
    }
    const next = row[i + 1]
    if (!adjacent(score, point, next) || event.tieTo.some(value => !pitches(next.event).some(pitch => midi(pitch) === value)))
      errors.push('붙임줄은 같은 성부의 바로 다음 같은 음높이와 연결해야 합니다. 쉼표·빈 시간·악보 끝을 넘을 수 없습니다.')
  })
  return errors
}
export function tieLinks(score: Score): TieLink[] {
  const result: TieLink[] = []
  for (const row of streams(score).values()) row.forEach((point, i) => {
    const event = point.event, next = row[i + 1]
    if (event.kind !== 'note' || !Array.isArray(event.tieTo) || !adjacent(score, point, next)) return
    for (const value of event.tieTo) {
      const first = pitches(event).findIndex(pitch => midi(pitch) === value), last = pitches(next.event).findIndex(pitch => midi(pitch) === value)
      if (first >= 0 && last >= 0) result.push({ from: { ...point, pitchIndex: first }, to: { ...next, pitchIndex: last }, midi: value })
    }
  })
  return result
}
export const withTies = (event: NoteEvent, values: readonly number[]): NoteEvent => {
  const base = { ...event }; delete base.tieTo
  return values.length ? { ...base, tieTo: [...values] } : base
}
function mapEvents(score: Score, transform: (event: RhythmEvent) => RhythmEvent): Score {
  let changed = false
  const measures = score.measures.map(measure => {
    let touched = false
    const voices = measure.voices.map(voice => {
      const events = voice.events.map(transform)
      if (events.every((event, i) => event === voice.events[i])) return voice
      changed = true; touched = true; return { ...voice, events }
    })
    return touched ? { ...measure, voices } : measure
  })
  return changed ? { ...score, measures } : score
}
export function toggleTie(score: Score, selection: Selection): Score {
  const row = streams(score).get(selection.voiceId) ?? [], index = row.findIndex(item => item.selection.eventId === selection.eventId && item.selection.measureId === selection.measureId)
  const point = row[index], tone = point && pitches(point.event)[selection.pitchIndex ?? 0]
  if (!tone || point.event.kind !== 'note') throw new Error('붙임줄은 음표 구성음을 하나 선택한 뒤 연결하세요.')
  const event = point.event, value = midi(tone), removing = event.tieTo?.includes(value)
  if (!removing && (!adjacent(score, point, row[index + 1]) || !pitches(row[index + 1].event).some(pitch => midi(pitch) === value)))
    throw new Error('같은 성부의 바로 다음 위치에 같은 음높이의 음표를 먼저 입력하세요.')
  return mapEvents(score, item => item === event ? withTies(event, removing ? event.tieTo!.filter(item => item !== value) : [...(event.tieTo ?? []), value]) : item)
}

// Only remove old connections whose endpoints were deliberately replaced/deleted.
// New or malformed imported markings are never sanitized into a false success.
export function reconcileTieEdits(before: Score, after: Score): Score {
  if (before === after) return after
  const next = new Map<string, Point | undefined>(), points = new Map<string, Point>()
  for (const row of streams(after).values()) row.forEach((point, i) => { points.set(point.event.id, point); next.set(point.event.id, row[i + 1]) })
  const remove = new Map<string, Set<number>>()
  for (const link of tieLinks(before)) {
    const from = points.get(link.from.event.id), to = next.get(link.from.event.id)
    if (!from || from.event.kind !== 'note' || !from.event.tieTo?.includes(link.midi)) continue
    if (!adjacent(after, from, to) || to?.event.id !== link.to.event.id || !pitches(from.event).some(p => midi(p) === link.midi) || !pitches(to.event).some(p => midi(p) === link.midi)) {
      const values = remove.get(from.event.id) ?? new Set<number>(); values.add(link.midi); remove.set(from.event.id, values)
    }
  }
  return mapEvents(after, event => event.kind === 'note' && remove.has(event.id) ? withTies(event, event.tieTo!.filter(value => !remove.get(event.id)!.has(value))) : event)
}
export function clearTies(score: Score, selections: readonly Selection[]): Score {
  if (!selections.length) return score
  const selected = new Set(selections.map(target => JSON.stringify([target.eventId, target.pitchIndex ?? 0])))
  const remove = new Map<string, Set<number>>()
  for (const link of tieLinks(score)) if (selected.has(JSON.stringify([link.from.event.id, link.from.pitchIndex])) || selected.has(JSON.stringify([link.to.event.id, link.to.pitchIndex]))) {
    const values = remove.get(link.from.event.id) ?? new Set<number>(); values.add(link.midi); remove.set(link.from.event.id, values)
  }
  return mapEvents(score, event => event.kind === 'note' && remove.has(event.id) ? withTies(event, event.tieTo!.filter(value => !remove.get(event.id)!.has(value))) : event)
}
export function rewriteTiedPitches(score: Score, selections: readonly Selection[], transform: (pitch: Pitch) => Pitch): Score {
  const graph = new Map<string, string[]>(), tones = new Map<string, Pitch>(), targets = new Map<string, string>()
  for (const row of streams(score).values()) for (const { event } of row) pitches(event).forEach((pitch, i) => {
    const key = toneKey(event.id, midi(pitch)); tones.set(key, pitch); targets.set(JSON.stringify([event.id, i]), key)
  })
  for (const { from, to, midi: value } of tieLinks(score)) {
    const a = toneKey(from.event.id, value), b = toneKey(to.event.id, value)
    graph.set(a, [...(graph.get(a) ?? []), b]); graph.set(b, [...(graph.get(b) ?? []), a])
  }
  const changes = new Map<string, Pitch>()
  for (const selection of selections) {
    const key = targets.get(JSON.stringify([selection.eventId, selection.pitchIndex ?? 0]))
    if (!key || changes.has(key)) continue
    const value = transform(tones.get(key)!), pending = [key]
    while (pending.length) {
      const current = pending.pop()!
      if (changes.has(current)) continue
      changes.set(current, value); pending.push(...(graph.get(current) ?? []))
    }
  }
  return mapEvents(score, event => {
    if (event.kind !== 'note') return event
    const original = pitches(event), values = original.map(pitch => changes.get(toneKey(event.id, midi(pitch))) ?? pitch)
    if (values.every((pitch, i) => pitch === original[i])) return event
    if (new Set(values.map(midi)).size !== values.length) throw new Error('선택하지 않은 화음 구성음과 음높이가 겹칩니다. 변경을 취소했습니다.')
    return withTies({ ...event, pitch: values[0], chord: values.slice(1) }, (event.tieTo ?? []).map(value => midi(changes.get(toneKey(event.id, value)) ?? original.find(pitch => midi(pitch) === value)!)))
  })
}
// Tied continuations carry their pitch, but do not introduce a new accidental
// state into the destination bar. A differently spelled enharmonic still prints.
export function tiedContinuations(score: Score): Set<string> {
  return new Set(tieLinks(score).flatMap(link => {
    const a = pitches(link.from.event)[link.from.pitchIndex], b = pitches(link.to.event)[link.to.pitchIndex]
    return a.step === b.step && a.octave === b.octave && a.alter === b.alter ? [link.to.pitchIndex ? `${link.to.event.id}:${link.to.pitchIndex}` : link.to.event.id] : []
  }))
}
