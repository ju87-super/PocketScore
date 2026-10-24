import { eventPitches, locate } from '../music/score'
import { compare, ZERO } from '../music/rational'
import { midi, movePitch } from '../music/pitch'
import { staffAt } from './model'
import type { Project, ProjectSelection } from './model'

export type ScoreSelection = Readonly<{
  kind: 'single' | 'range' | 'list' | 'measure'
  anchor: ProjectSelection
  focus: ProjectSelection
  targets: readonly ProjectSelection[]
}>
export const targetKey = (target: ProjectSelection) => JSON.stringify([target.partId, target.staffId, target.voiceId, target.measureId, target.eventId, target.pitchIndex ?? 0])
export const voiceRows = (project: Project) => project.parts.flatMap(part => part.staves.flatMap(staff => staff.score.measures[0].voices.map(voice => ({ partId: part.id, staffId: staff.id, voiceId: voice.id }))))
export const navigationTargets = (project: Project): ProjectSelection[] => voiceRows(project).flatMap(row => staffAt(project, row).staff.score.measures.flatMap(measure => measure.voices.find(voice => voice.id === row.voiceId)!.events.map(event => ({ ...row, measureId: measure.id, eventId: event.id }))))
export function validTarget(project: Project, target: ProjectSelection) {
  try {
    const { staff } = staffAt(project, target)
    const event = locate(staff.score, target).event
    return (target.pitchIndex ?? 0) < Math.max(1, eventPitches(event).length) && (target.pitchIndex ?? 0) >= 0
  } catch { return false }
}
export function singleSelection(target: ProjectSelection): ScoreSelection {
  return { kind: 'single', anchor: target, focus: target, targets: [target] }
}
function position(project: Project, target: ProjectSelection) {
  const { staff } = staffAt(project, target)
  const measure = staff.score.measures.findIndex(item => item.id === target.measureId)
  return { measure, start: target.scope === 'measure' ? ZERO : locate(staff.score, target).event.start }
}
function comparePosition(a: ReturnType<typeof position>, b: ReturnType<typeof position>) {
  return a.measure - b.measure || compare(a.start, b.start)
}
export function rangeSelection(project: Project, anchor: ProjectSelection, focus: ProjectSelection): ScoreSelection {
  const rows = voiceRows(project)
  const rowIndex = (target: ProjectSelection, last = false) => {
    const matches = rows.flatMap((row, i) => row.staffId === target.staffId && (target.scope === 'measure' || row.voiceId === target.voiceId) ? [i] : [])
    return last ? matches.at(-1)! : matches[0]
  }
  const first = Math.min(rowIndex(anchor), rowIndex(focus)), last = Math.max(rowIndex(anchor, true), rowIndex(focus, true))
  const a = position(project, anchor), b = position(project, focus)
  const low = comparePosition(a, b) <= 0 ? a : b, high = low === a ? b : a
  const fullEnd = (high === a ? anchor : focus).scope === 'measure'
  const targets: ProjectSelection[] = []
  rows.slice(first, last + 1).forEach(row => {
    const { staff } = staffAt(project, row)
    staff.score.measures.forEach((measure, index) => measure.voices.find(voice => voice.id === row.voiceId)!.events.forEach(event => {
      const point = { measure: index, start: event.start }
      if (comparePosition(point, low) < 0 || (fullEnd ? index > high.measure : comparePosition(point, high) > 0)) return
      const tones = Math.max(1, eventPitches(event).length)
      for (let pitchIndex = 0; pitchIndex < tones; pitchIndex++) targets.push({ ...row, measureId: measure.id, eventId: event.id, pitchIndex })
    }))
  })
  return { kind: anchor.scope === 'measure' && focus.scope === 'measure' ? 'measure' : 'range', anchor, focus, targets }
}
export function pickSelection(project: Project, previous: ScoreSelection | null, target: ProjectSelection, extend = false, additive = false): ScoreSelection | null {
  if (!validTarget(project, target)) throw new Error('선택한 음표가 없습니다.')
  if (additive) {
    if (target.scope === 'measure' || locate(staffAt(project, target).staff.score, target).event.kind !== 'note') return previous
    const targets = previous?.targets.filter(item => locate(staffAt(project, item).staff.score, item).event.kind === 'note') ?? []
    const exists = targets.some(item => targetKey(item) === targetKey(target))
    const next = exists ? targets.filter(item => targetKey(item) !== targetKey(target)) : [...targets, target]
    return next.length ? { kind: 'list', anchor: previous?.anchor ?? target, focus: next.at(-1)!, targets: next } : null
  }
  if (extend) return rangeSelection(project, previous?.anchor ?? target, target)
  if (target.scope === 'measure') return rangeSelection(project, target, target)
  return singleSelection(target)
}
export const isGroupSelection = (selection: ScoreSelection | null | undefined) => !!selection && (selection.kind === 'range' || selection.kind === 'measure' || selection.targets.length > 1)
export function reconcileSelection(project: Project, selection: ScoreSelection | null | undefined) {
  if (!selection) return null
  const refresh = (target: ProjectSelection) => {
    try {
      if (target.scope !== 'measure') return validTarget(project, target) ? target : null
      const measure = staffAt(project, target).staff.score.measures.find(bar => bar.id === target.measureId)
      return measure ? { ...target, voiceId: measure.voices[0].id, eventId: measure.voices[0].events[0].id, pitchIndex: 0 } : null
    } catch { return null }
  }
  const anchor = refresh(selection.anchor), focus = refresh(selection.focus)
  if ((selection.kind === 'range' || selection.kind === 'measure') && anchor && focus) return rangeSelection(project, anchor, focus)
  const targets = selection.targets.filter(target => validTarget(project, target))
  if (!targets.length) return null
  return { ...selection, targets, anchor: anchor ?? targets[0], focus: focus ?? targets.at(-1)! }
}

// The selection contains only musical identities, never SVG nodes/coordinates.
// Build the complete result first: any collision/range error rejects the batch.
export function transposeSelection(project: Project, selection: ScoreSelection, amount: number, chromatic = true, origin?: ProjectSelection): Project {
  if (amount === 0) return project
  const pitched = (target: ProjectSelection) => {
    const { part, staff } = staffAt(project, target)
    return part.instrument !== 'drums' && locate(staff.score, target).event.kind === 'note'
  }
  const anchor = origin && pitched(origin) ? origin : selection.targets.find(pitched)
  if (!anchor) return project
  const anchorStaff = staffAt(project, anchor).staff
  const pitch = eventPitches(locate(anchorStaff.score, anchor).event)[anchor.pitchIndex ?? 0]
  const delta = chromatic ? amount : midi(movePitch(pitch, amount, false, anchorStaff.score.keySignature)) - midi(pitch)
  const keys = new Set(selection.targets.map(targetKey))
  let changed = false
  const parts = project.parts.map(part => part.instrument === 'drums' ? part : { ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map(measure => {
    let touched = false
    const voices = measure.voices.map(voice => ({ ...voice, events: voice.events.map(event => {
      if (event.kind !== 'note') return event
      let modified = false
      const pitches = eventPitches(event).map((value, pitchIndex) => {
        if (!keys.has(targetKey({ partId: part.id, staffId: staff.id, voiceId: voice.id, measureId: measure.id, eventId: event.id, pitchIndex }))) return value
        modified = true
        return movePitch(value, delta, true, staff.score.keySignature)
      })
      if (!modified) return event
      if (new Set(pitches.map(midi)).size !== pitches.length) throw new Error('선택하지 않은 화음 구성음과 음높이가 겹칩니다. 변경을 취소했습니다.')
      changed = true; touched = true
      return { ...event, pitch: pitches[0], chord: pitches.slice(1) }
    }) }))
    return touched ? { ...measure, voices } : measure
  }) } })) })
  return changed ? { ...project, parts } : project
}
