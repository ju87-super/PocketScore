import { add, compare, equal, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { DURATIONS, eventPitches, locate } from '../music/score'
import type { RhythmEvent } from '../music/score'
import type { Pitch } from '../music/pitch'
import { measureDuration } from '../music/settings'
import { primaryScore, reconcileProjectTies, rests, staffAt, uid, validateProject } from './model'
import type { Project, ProjectSelection } from './model'
import { validTarget, voiceRows } from './selection'
import type { ScoreSelection } from './selection'
import { tieLinks } from '../music/ties'
import { midi } from '../music/pitch'
import { addMeasure } from './structure'

export type ClipboardEvent = Readonly<{ offset: Rational; duration: Rational; pitches: readonly Pitch[]; tieTo?: readonly number[] }>
export type ScoreClipboard = Readonly<{ span: Rational; rows: readonly Readonly<{ events: readonly ClipboardEvent[] }>[] }>
const rowKey = (row: { staffId: string; voiceId: string }) => JSON.stringify([row.staffId, row.voiceId])
const barStart = (capacity: Rational, index: number) => fraction(capacity.n * index, capacity.d)
const cloneFraction = (value: Rational) => fraction(value.n, value.d)
const min = (a: Rational, b: Rational) => compare(a, b) <= 0 ? a : b
const max = (a: Rational, b: Rational) => compare(a, b) >= 0 ? a : b

// A clipboard is a detached musical snapshot: no source IDs, SVG, mixer or UI.
export function copyScoreSelection(project: Project, selected: ScoreSelection | null): ScoreClipboard {
  if (!selected?.targets.length) throw new Error('복사할 음표·쉼표 또는 마디를 선택하세요.')
  const capacity = measureDuration(primaryScore(project).timeSignature)
  const captured = new Map<string, { row: string; event: RhythmEvent; start: Rational; pitches: Set<number>; measure: number }>()
  for (const target of selected.targets) {
    if (!validTarget(project, target)) throw new Error('복사할 선택이 더 이상 유효하지 않습니다.')
    const score = staffAt(project, target).staff.score, event = locate(score, target).event
    const index = score.measures.findIndex(bar => bar.id === target.measureId)
    const key = JSON.stringify([target.staffId, target.voiceId, event.id])
    const item = captured.get(key) ?? { row: rowKey(target), event, start: add(barStart(capacity, index), event.start), pitches: new Set<number>(), measure: index }
    item.pitches.add(target.pitchIndex ?? 0); captured.set(key, item)
  }
  const items = [...captured.values()]
  const selectedPitches = new Map(items.map(item => [item.event.id, new Set(eventPitches(item.event).filter((_, i) => item.pitches.has(i)).map(midi))]))
  const ties = new Map<string, number[]>()
  for (const staff of project.parts.flatMap(part => part.staves)) for (const link of tieLinks(staff.score)) if (selectedPitches.get(link.from.event.id)?.has(link.midi) && selectedPitches.get(link.to.event.id)?.has(link.midi))
    ties.set(link.from.event.id, [...(ties.get(link.from.event.id) ?? []), link.midi])
  const start = items.reduce((low, item) => min(low, selected.kind === 'measure' ? barStart(capacity, item.measure) : item.start), items[0].start)
  const end = items.reduce((high, item) => max(high, selected.kind === 'measure' ? barStart(capacity, item.measure + 1) : add(item.start, item.event.duration)), start)
  const rows = voiceRows(project).flatMap(row => {
    const events = items.filter(item => item.row === rowKey(row)).sort((a, b) => compare(a.start, b.start)).map(item => ({
      offset: subtract(item.start, start), duration: cloneFraction(item.event.duration),
      pitches: eventPitches(item.event).filter((_, i) => item.pitches.has(i)).map(pitch => ({ ...pitch })),
      ...(ties.has(item.event.id) ? { tieTo: [...ties.get(item.event.id)!] } : {}),
    }))
    return events.length ? [{ events }] : []
  })
  return { span: subtract(end, start), rows }
}

function filledEvents(events: readonly ClipboardEvent[], span: Rational): ClipboardEvent[] {
  const result: ClipboardEvent[] = []
  let end = ZERO
  for (const event of events) {
    if (compare(event.offset, end) < 0 || compare(event.duration, ZERO) <= 0 || compare(add(event.offset, event.duration), span) > 0) throw new Error('복사 구간의 시점이나 길이가 올바르지 않습니다.')
    if (compare(event.offset, end) > 0) result.push({ offset: end, duration: subtract(event.offset, end), pitches: [] })
    result.push(event); end = add(event.offset, event.duration)
  }
  if (compare(end, span) < 0) result.push({ offset: end, duration: subtract(span, end), pitches: [] })
  return result
}
function fragment(event: RhythmEvent, start: Rational, end: Rational): RhythmEvent[] {
  const duration = subtract(end, start)
  if (equal(duration, ZERO)) return []
  if (event.kind === 'rest') return rests(duration).map(item => ({ ...item, start: add(start, item.start) }))
  if (!DURATIONS.some(item => equal(item, duration))) throw new Error('붙여넣기 경계의 기존 음표를 보존하려면 붙임줄이 필요합니다. 변경을 취소했습니다.')
  const next = { ...event, id: equal(start, event.start) ? event.id : uid(), start, duration }
  if (!equal(end, add(event.start, event.duration))) delete next.tieTo
  return [next]
}

export type PasteResult = Readonly<{ project: Project; selected: ScoreSelection; selection: ProjectSelection; addedMeasures: number; skippedRows: number }>
export function pasteScoreSelection(original: Project, clipboard: ScoreClipboard | null, target: ProjectSelection | null): PasteResult {
  if (!clipboard?.rows.length) throw new Error('먼저 악보 요소를 복사하세요.')
  if (!target || !validTarget(original, target)) throw new Error('붙여넣을 음표·쉼표 또는 마디를 선택하세요.')
  if (compare(clipboard.span, ZERO) <= 0) throw new Error('복사 구간의 길이가 올바르지 않습니다.')
  const rows = voiceRows(original), rowIndex = rows.findIndex(row => rowKey(row) === rowKey(target))
  if (rowIndex < 0) throw new Error('붙여넣을 성부를 찾을 수 없습니다.')
  const mapped = rows.slice(rowIndex, rowIndex + clipboard.rows.length)
  const score = staffAt(original, target).staff.score, capacity = measureDuration(score.timeSignature)
  const index = score.measures.findIndex(bar => bar.id === target.measureId)
  const start = add(barStart(capacity, index), target.scope === 'measure' ? ZERO : locate(score, target).event.start)
  const end = add(start, clipboard.span), initialCount = score.measures.length
  let count = initialCount
  while (compare(barStart(capacity, count), end) < 0) { if (++count > 128) throw new Error('붙여넣으면 128마디 제한을 넘습니다. 변경을 취소했습니다.') }
  let project = original
  while (primaryScore(project).measures.length < count) project = addMeasure(project)
  const replacements = new Map<string, Map<number, RhythmEvent[]>>()
  const targets: ProjectSelection[] = []
  mapped.forEach((row, r) => {
    const staff = staffAt(project, row).staff
    const filled = filledEvents(clipboard.rows[r].events, clipboard.span)
    const changes = new Map<number, RhythmEvent[]>()
    for (let m = index; m < count; m++) {
      const base = barStart(capacity, m), limit = add(base, capacity)
      if (compare(base, end) >= 0) break
      const left = subtract(max(start, base), base), right = subtract(min(end, limit), base)
      const bar = staff.score.measures[m], voice = bar.voices.find(item => item.id === row.voiceId)!
      const inserted: RhythmEvent[] = []
      for (const item of filled) {
        const a = add(start, item.offset), b = add(a, item.duration)
        if (compare(a, limit) >= 0 || compare(b, base) <= 0) continue
        const local = subtract(max(a, base), base), duration = subtract(min(b, limit), max(a, base))
        if (item.pitches.length) {
          if (compare(a, base) < 0 || compare(b, limit) > 0) throw new Error('붙여넣을 음표가 마디선을 넘어 붙임줄이 필요합니다. 변경을 취소했습니다.')
          if (!DURATIONS.some(value => equal(value, duration))) throw new Error('지원하지 않는 음표 길이입니다.')
          const pitches = item.pitches.map(pitch => ({ ...pitch }))
          inserted.push({ id: uid(), start: local, duration: cloneFraction(duration), kind: 'note', pitch: pitches[0], ...(pitches.length > 1 ? { chord: pitches.slice(1) } : {}), ...(item.tieTo?.length ? { tieTo: [...item.tieTo] } : {}) })
        } else inserted.push(...rests(duration).map(event => ({ ...event, start: add(local, event.start) })))
      }
      const before: RhythmEvent[] = [], after: RhythmEvent[] = []
      for (const event of voice.events) {
        const eventEnd = add(event.start, event.duration)
        if (compare(eventEnd, left) <= 0) before.push(event)
        else if (compare(event.start, right) >= 0) after.push(event)
        else {
          if (compare(event.start, left) < 0) before.push(...fragment(event, event.start, left))
          if (compare(eventEnd, right) > 0) after.push(...fragment(event, right, eventEnd))
        }
      }
      changes.set(m, [...before, ...inserted, ...after])
      inserted.forEach(event => {
        for (let pitchIndex = 0; pitchIndex < Math.max(1, eventPitches(event).length); pitchIndex++) targets.push({ ...row, measureId: bar.id, eventId: event.id, pitchIndex })
      })
    }
    replacements.set(rowKey(row), changes)
  })
  project = { ...project, parts: project.parts.map(part => {
    const staves = part.staves.map(staff => {
      const measures = staff.score.measures.map((bar, i) => {
        const voices = bar.voices.map(voice => {
          const events = replacements.get(rowKey({ staffId: staff.id, voiceId: voice.id }))?.get(i)
          return events ? { ...voice, events } : voice
        })
        return voices.every((voice, v) => voice === bar.voices[v]) ? bar : { ...bar, voices }
      })
      return measures.every((bar, i) => bar === staff.score.measures[i]) ? staff : { ...staff, score: { ...staff.score, measures } }
    })
    return staves.every((staff, i) => staff === part.staves[i]) ? part : { ...part, staves }
  }) }
  project = reconcileProjectTies(original, project)
  const errors = validateProject(project)
  if (errors.length) throw new Error(`붙여넣기를 취소했습니다: ${errors.join(' ')}`)
  if (!targets.length) throw new Error('붙여넣을 요소가 없습니다.')
  return { project, selection: targets[0], selected: { kind: targets.length === 1 ? 'single' : 'list', anchor: targets[0], focus: targets.at(-1)!, targets },
    addedMeasures: count - initialCount, skippedRows: clipboard.rows.length - mapped.length }
}
