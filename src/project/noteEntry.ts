import { eventPitches, DURATIONS, locate } from '../music/score'
import { add, compare, equal, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { midi, STEPS } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { keyAlter, measureDuration } from '../music/settings'
import { allSelections, staffAt, updateStaff, validateProject } from './model'
import type { Project, ProjectSelection } from './model'
import { barStart, extendForRhythm, overwriteRhythm } from './rhythmEdit'
import { tiedContinuations, withTies } from '../music/ties'

export type EntryPosition = Readonly<{ partId: string; staffId: string; voiceId: string; measureId: string; start: Rational }>
export type NoteEntry = Readonly<{
  enabled: boolean; cursor: EntryPosition | null; last: ProjectSelection | null; segments: readonly ProjectSelection[]
  duration: Rational; reference: Pitch; accidental: Pitch['alter'] | null; rest: boolean; chord: boolean
}>
export const createNoteEntry = (): NoteEntry => ({ enabled: false, cursor: null, last: null, segments: [], duration: fraction(1, 4), reference: { step: 'C', octave: 4, alter: 0 }, accidental: null, rest: false, chord: false })
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
    const segments = last && entry.segments.every((target, i) => {
      try {
        const event = locate(score, target).event, next = entry.segments[i + 1]
        if (event.kind !== 'note') return false
        if (!next) return true
        const pitches = eventPitches(locate(score, next).event).map(midi)
        return eventPitches(event).every(pitch => pitches.includes(midi(pitch)) && event.tieTo?.includes(midi(pitch)))
      } catch { return false }
    }) ? entry.segments : []
    return { ...entry, last, segments }
  } catch { return { ...entry, cursor: null, last: null, segments: [] } }
}
export function beginEntry(project: Project, entry: NoteEntry, selection: ProjectSelection | null): NoteEntry {
  const target = selection ?? allSelections(project)[0]
  const event = locate(staffAt(project, target).staff.score, target).event
  return { ...entry, enabled: true, chord: false, segments: [], cursor: entryPosition(project, target), last: event.kind === 'note' ? target : null,
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
export type EntryResult = { project: Project; entry: NoteEntry; selection: ProjectSelection }
export function followingPosition(project: Project, cursor: EntryPosition, duration: Rational): EntryPosition {
  const score = staffAt(project, cursor).staff.score, capacity = measureDuration(score.timeSignature)
  let index = score.measures.findIndex(bar => bar.id === cursor.measureId), start = add(cursor.start, duration)
  while (compare(start, capacity) >= 0 && score.measures[index + 1]) { start = subtract(start, capacity); index++ }
  return { ...cursor, measureId: score.measures[index].id, start }
}
export function writeEntry(project: Project, entry: NoteEntry, value: Pitch | null, position = entry.cursor): EntryResult {
  if (!entry.enabled || !position) throw new Error('N으로 음표 입력을 켜고 위치를 선택하세요.')
  if (!DURATIONS.some(item => equal(item, entry.duration))) throw new Error('지원하지 않는 입력 길이입니다.')
  const { part, staff } = staffAt(project, position), capacity = measureDuration(staff.score.timeSignature)
  const index = staff.score.measures.findIndex(bar => bar.id === position.measureId)
  if (index < 0) throw new Error('입력할 마디를 찾을 수 없습니다. 위치를 다시 선택하세요.')
  if (compare(position.start, ZERO) < 0 || compare(position.start, capacity) > 0) throw new Error('입력 위치가 마디 범위를 벗어납니다.')
  const start = add(barStart(capacity, index), position.start), end = add(start, entry.duration)
  project = extendForRhythm(project, end)
  const score = staffAt(project, position).staff.score
  const result = overwriteRhythm(score, position.voiceId, start, entry.duration, [{ offset: ZERO, duration: entry.duration, pitches: value ? [value] : [] }], part.instrument === 'drums')
  project = { ...project, parts: project.parts.map(item => item.id !== part.id ? item : { ...item,
    staves: item.staves.map(item => item.id === staff.id ? { ...item, score: result.score } : item),
  }) }
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  const segments = result.inserted.map(target => ({ ...target, partId: part.id, staffId: staff.id, pitchIndex: 0 }))
  const selection = segments[0], next = followingPosition(project, position, entry.duration)
  return { project, selection, entry: { ...entry, cursor: next, last: value ? selection : null, segments: value ? segments : [], reference: value ?? entry.reference, accidental: null } }
}
export function addEntryChord(project: Project, entry: NoteEntry, target: ProjectSelection, value: Pitch): EntryResult {
  const { part, staff } = staffAt(project, target)
  const event = locate(staff.score, target).event
  if (part.instrument === 'drums' || event.kind !== 'note') throw new Error('화음은 일반 악기의 음표를 선택한 뒤 입력하세요.')
  const segments = entry.enabled && entry.last?.eventId === target.eventId && entry.segments.length > 1 ? entry.segments : [target]
  const changed = new Map(segments.map((point, i) => {
    const item = locate(staff.score, point).event
    if (item.kind !== 'note') throw new Error('화음에 추가할 음표를 다시 선택하세요.')
    const pitches = [...eventPitches(item)]
    if (pitches.some(pitch => midi(pitch) === midi(value))) throw new Error('같은 음높이가 이미 화음에 있습니다.')
    if (pitches.length >= 8) throw new Error('화음은 8개 구성음까지 지원합니다.')
    pitches.push(value)
    return [item.id, withTies({ ...item, pitch: pitches[0], chord: pitches.slice(1) }, [...(item.tieTo ?? []), ...(i < segments.length - 1 ? [midi(value)] : [])])] as const
  }))
  const next = updateStaff(project, staff.id, item => ({ ...item, score: { ...item.score, measures: item.score.measures.map(bar => {
    const voices = bar.voices.map(voice => {
      const events = voice.events.map(item => changed.get(item.id) ?? item)
      return events.every((event, i) => event === voice.events[i]) ? voice : { ...voice, events }
    })
    return voices.every((voice, i) => voice === bar.voices[i]) ? bar : { ...bar, voices }
  }) } }))
  const tail = segments.at(-1)!, tailEvent = locate(staff.score, tail).event
  const cursor = segments.length > 1 ? followingPosition(project, entryPosition(project, tail), tailEvent.duration) : entry.cursor
  return { project: next, selection: { ...target, scope: undefined, pitchIndex: eventPitches(event).length }, entry: { ...entry, cursor, last: target, reference: value, accidental: null } }
}
export const isNoteLetter = (key: string): key is Pitch['step'] => STEPS.includes(key as Pitch['step'])
