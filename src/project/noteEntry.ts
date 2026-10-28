import { eventPitches, DURATIONS, locate, retime } from '../music/score'
import type { RhythmEvent } from '../music/score'
import { add, compare, equal, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { midi, STEPS } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { keyAlter, measureDuration } from '../music/settings'
import { allSelections, rests, staffAt, uid, updateStaff } from './model'
import type { Project, ProjectSelection } from './model'
import { addMeasure } from './structure'
import { tiedContinuations } from '../music/ties'

export type EntryPosition = Readonly<{ partId: string; staffId: string; voiceId: string; measureId: string; start: Rational }>
export type NoteEntry = Readonly<{
  enabled: boolean; cursor: EntryPosition | null; last: ProjectSelection | null
  duration: Rational; reference: Pitch; accidental: Pitch['alter'] | null; rest: boolean; chord: boolean
}>
export const createNoteEntry = (): NoteEntry => ({ enabled: false, cursor: null, last: null, duration: fraction(1, 4), reference: { step: 'C', octave: 4, alter: 0 }, accidental: null, rest: false, chord: false })
export const ENTRY_DURATIONS: Readonly<Record<string, Rational>> = { '1': fraction(1, 64), '2': fraction(1, 32), '3': fraction(1, 16), '4': fraction(1, 8), '5': fraction(1, 4), '6': fraction(1, 2), '7': fraction(1) }
export function dottedDuration(duration: Rational): Rational {
  const next = duration.n === 3 ? fraction(1, duration.d / 2) : fraction(duration.n * 3, duration.d * 2)
  if (!DURATIONS.some(item => equal(item, next))) throw new Error('점음표는 점32분부터 점2분까지 지원합니다. 점64분·점온음표는 아직 지원하지 않습니다.')
  return next
}
export function entryPosition(project: Project, target: ProjectSelection): EntryPosition {
  const event = locate(staffAt(project, target).staff.score, target).event
  return { partId: target.partId, staffId: target.staffId, voiceId: target.voiceId, measureId: target.measureId, start: target.scope === 'measure' ? ZERO : event.start }
}
export function reconcileEntry(project: Project, entry: NoteEntry): NoteEntry {
  try {
    if (!entry.cursor) return entry
    const score = staffAt(project, entry.cursor).staff.score
    const bar = score.measures.find(measure => measure.id === entry.cursor!.measureId)
    if (!bar?.voices.some(voice => voice.id === entry.cursor!.voiceId) || compare(entry.cursor.start, measureDuration(score.timeSignature)) > 0) throw new Error()
    let last: ProjectSelection | null = null
    try { if (entry.last && locate(staffAt(project, entry.last).staff.score, entry.last).event.kind === 'note') last = entry.last } catch { /* The cursor can outlive a replaced note. */ }
    return { ...entry, last }
  } catch { return { ...entry, cursor: null, last: null } }
}
export function beginEntry(project: Project, entry: NoteEntry, selection: ProjectSelection | null): NoteEntry {
  const target = selection ?? allSelections(project)[0]
  const event = locate(staffAt(project, target).staff.score, target).event
  return { ...entry, enabled: true, chord: false, cursor: entryPosition(project, target), last: event.kind === 'note' ? target : null,
    reference: eventPitches(event)[target.pitchIndex ?? 0] ?? entry.reference, accidental: null }
}
// Accidental state belongs to a written step/octave and resets at a barline.
// Conflicting simultaneous alterations fall back to the key until specified.
export function activeAlter(project: Project, cursor: EntryPosition, step: Pitch['step'], octave: number): Pitch['alter'] {
  const score = staffAt(project, cursor).staff.score
  if (equal(cursor.start, measureDuration(score.timeSignature))) return keyAlter(score.keySignature, step)
  const bar = score.measures.find(measure => measure.id === cursor.measureId)!
  const continuations = tiedContinuations(score)
  const occurrences = bar.voices.flatMap(voice => voice.events.flatMap(event => compare(event.start, cursor.start) < 0
    ? eventPitches(event).flatMap((pitch, i) => pitch.step === step && pitch.octave === octave && !continuations.has(i ? `${event.id}:${i}` : event.id) ? [{ start: event.start, alter: pitch.alter }] : []) : []))
    .sort((a, b) => compare(b.start, a.start))
  if (!occurrences.length || occurrences.some(item => equal(item.start, occurrences[0].start) && item.alter !== occurrences[0].alter)) return keyAlter(score.keySignature, step)
  return occurrences[0].alter
}
export function letterPitch(project: Project, entry: NoteEntry, step: Pitch['step'], above?: Pitch): Pitch {
  if (!entry.cursor) throw new Error('먼저 입력 위치를 선택하세요.')
  const candidates = Array.from({ length: 6 }, (_, i) => ({ step, octave: i + 2, alter: entry.accidental ?? activeAlter(project, entry.cursor!, step, i + 2) }))
    .filter(pitch => midi(pitch) >= 36 && midi(pitch) <= 96 && (!above || midi(pitch) > midi(above)))
  const written = (pitch: Pitch) => pitch.octave * 7 + STEPS.indexOf(pitch.step)
  candidates.sort((a, b) => above ? midi(a) - midi(b) : Math.abs(written(a) - written(entry.reference)) - Math.abs(written(b) - written(entry.reference)))
  if (!candidates.length) throw new Error('입력할 음이 지원 음역 C2–C7을 벗어납니다.')
  return candidates[0]
}
function fragment(event: RhythmEvent, duration: Rational, side: 'before' | 'after'): RhythmEvent[] {
  if (equal(duration, ZERO)) return []
  if (event.kind === 'rest') return rests(duration)
  if (!DURATIONS.some(item => equal(item, duration))) throw new Error('기존 음표를 여러 조각의 붙임줄로 자동 분할해야 합니다. 이 입력은 아직 지원하지 않아 변경을 취소했습니다.')
  const fragment = { ...event, id: side === 'before' ? event.id : uid(), duration }
  if (side === 'before') delete fragment.tieTo
  return [fragment]
}
export type EntryResult = { project: Project; entry: NoteEntry; selection: ProjectSelection }
export function followingPosition(project: Project, cursor: EntryPosition, duration: Rational): EntryPosition {
  const score = staffAt(project, cursor).staff.score, end = add(cursor.start, duration)
  const next = score.measures[score.measures.findIndex(bar => bar.id === cursor.measureId) + 1]
  return equal(end, measureDuration(score.timeSignature)) && next ? { ...cursor, measureId: next.id, start: ZERO } : { ...cursor, start: end }
}
export function writeEntry(project: Project, entry: NoteEntry, value: Pitch | null, position = entry.cursor): EntryResult {
  if (!entry.enabled || !position) throw new Error('N으로 음표 입력을 켜고 위치를 선택하세요.')
  if (!DURATIONS.some(item => equal(item, entry.duration))) throw new Error('지원하지 않는 입력 길이입니다.')
  let cursor = position
  let score = staffAt(project, cursor).staff.score
  if (!score.measures.some(bar => bar.id === cursor.measureId)) throw new Error('입력할 마디를 찾을 수 없습니다. 위치를 다시 선택하세요.')
  const capacity = measureDuration(score.timeSignature)
  if (equal(cursor.start, capacity)) {
    const index = score.measures.findIndex(bar => bar.id === cursor.measureId)
    if (!score.measures[index + 1]) project = addMeasure(project)
    score = staffAt(project, cursor).staff.score
    cursor = { ...cursor, measureId: score.measures[index + 1].id, start: ZERO }
  }
  const end = add(cursor.start, entry.duration)
  if (compare(cursor.start, ZERO) < 0 || compare(end, capacity) > 0) throw new Error('입력 길이가 마디선을 넘습니다. 자동 분할 입력은 아직 지원하지 않습니다. 각 마디에 음표를 입력한 뒤 붙임줄로 연결하세요.')
  const bar = score.measures.find(measure => measure.id === cursor.measureId)
  const voice = bar?.voices.find(item => item.id === cursor.voiceId)
  if (!bar || !voice) throw new Error('입력할 마디와 성부를 선택하세요.')
  const inserted: RhythmEvent = { id: uid(), start: cursor.start, duration: entry.duration, ...(value ? { kind: 'note', pitch: value } : { kind: 'rest' }) }
  const before: RhythmEvent[] = [], after: RhythmEvent[] = []
  for (const event of voice.events) {
    const eventEnd = add(event.start, event.duration)
    if (compare(eventEnd, cursor.start) <= 0) before.push(event)
    else if (compare(event.start, end) >= 0) after.push(event)
    else {
      if (compare(event.start, cursor.start) < 0) before.push(...fragment(event, subtract(cursor.start, event.start), 'before'))
      if (compare(eventEnd, end) > 0) after.push(...fragment(event, subtract(eventEnd, end), 'after'))
    }
  }
  project = updateStaff(project, cursor.staffId, staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map(measure => measure.id !== cursor.measureId ? measure : { ...measure,
    voices: measure.voices.map(item => item.id !== cursor.voiceId ? item : { ...item, events: retime([...before, inserted, ...after]) }),
  }) } }))
  const selection: ProjectSelection = { partId: cursor.partId, staffId: cursor.staffId, voiceId: cursor.voiceId, measureId: cursor.measureId, eventId: inserted.id, pitchIndex: 0 }
  const next = followingPosition(project, cursor, entry.duration)
  return { project, selection, entry: { ...entry, cursor: next, last: value ? selection : null, reference: value ?? entry.reference, accidental: null } }
}
export function addEntryChord(project: Project, entry: NoteEntry, target: ProjectSelection, value: Pitch): EntryResult {
  const { part, staff } = staffAt(project, target)
  const event = locate(staff.score, target).event
  if (part.instrument === 'drums' || event.kind !== 'note') throw new Error('화음은 일반 악기의 음표를 선택한 뒤 입력하세요.')
  const pitches = [...eventPitches(event)]
  if (pitches.some(pitch => midi(pitch) === midi(value))) throw new Error('같은 음높이가 이미 화음에 있습니다.')
  if (pitches.length >= 8) throw new Error('화음은 8개 구성음까지 지원합니다.')
  pitches.push(value)
  const next = updateStaff(project, staff.id, item => ({ ...item, score: { ...item.score, measures: item.score.measures.map(bar => bar.id !== target.measureId ? bar : { ...bar,
    voices: bar.voices.map(voice => voice.id !== target.voiceId ? voice : { ...voice, events: voice.events.map(item => item.id !== event.id ? item : { ...event, pitch: pitches[0], chord: pitches.slice(1) }) }),
  }) } }))
  return { project: next, selection: { ...target, scope: undefined, pitchIndex: pitches.length - 1 }, entry: { ...entry, last: target, reference: value, accidental: null } }
}
export const isNoteLetter = (key: string): key is Pitch['step'] => STEPS.includes(key as Pitch['step'])
