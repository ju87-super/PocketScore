import { add, compare, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { eventPitches, locate } from '../music/score'
import type { RhythmEvent } from '../music/score'
import { measureDuration } from '../music/settings'
import { primaryScore, staffAt, validateProject } from './model'
import type { Project, ProjectSelection } from './model'
import { validTarget, voiceRows } from './selection'
import type { ScoreSelection } from './selection'
import { tieLinks } from '../music/ties'
import { midi } from '../music/pitch'
import { barStart, extendForRhythm, overwriteRhythm } from './rhythmEdit'
import type { RhythmMaterial } from './rhythmEdit'

export type ClipboardEvent = RhythmMaterial
export type ScoreClipboard = Readonly<{ span: Rational; rows: readonly Readonly<{ events: readonly ClipboardEvent[] }>[] }>
const rowKey = (row: { staffId: string; voiceId: string }) => JSON.stringify([row.staffId, row.voiceId])
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
  let project = extendForRhythm(original, end)
  const targets: ProjectSelection[] = []
  mapped.forEach((row, r) => {
    const { part, staff } = staffAt(project, row)
    const result = overwriteRhythm(staff.score, row.voiceId, start, clipboard.span, clipboard.rows[r].events, part.instrument === 'drums')
    // The shared editor already reconciles old endpoints and creates new links.
    // Do not reconcile again against the old score: fragment links are intentional.
    project = { ...project, parts: project.parts.map(item => item.id !== part.id ? item : { ...item,
      staves: item.staves.map(item => item.id === staff.id ? { ...item, score: result.score } : item),
    }) }
    result.inserted.forEach(point => {
      const event = locate(result.score, point).event
      for (let pitchIndex = 0; pitchIndex < Math.max(1, eventPitches(event).length); pitchIndex++) targets.push({ ...row, ...point, pitchIndex })
    })
  })
  const errors = validateProject(project)
  if (errors.length) throw new Error(`붙여넣기를 취소했습니다: ${errors.join(' ')}`)
  if (!targets.length) throw new Error('붙여넣을 요소가 없습니다.')
  return { project, selection: targets[0], selected: { kind: targets.length === 1 ? 'single' : 'list', anchor: targets[0], focus: targets.at(-1)!, targets },
    addedMeasures: primaryScore(project).measures.length - initialCount, skippedRows: clipboard.rows.length - mapped.length }
}
