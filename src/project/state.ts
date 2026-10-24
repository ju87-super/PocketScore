import { resizeEvent, setAccidental, setKeySignature, setTimeSignature, transposeEvent } from '../music/score'
import type { Action } from '../editor/state'
import type { Mixer, Project, ProjectSelection } from './model'
import { allSelections, createProject, freshScoreEvents, staffAt, updateStaff, validateProject } from './model'
import { isGroupSelection, navigationTargets, pickSelection, reconcileSelection, singleSelection, targetKey, transposeSelection, validTarget } from './selection'
import type { ScoreSelection } from './selection'

export type Snapshot = Readonly<{ project: Project; selection: ProjectSelection | null; selected: ScoreSelection | null }>
type Sound = Readonly<{ master: number; parts: Readonly<Record<string, Mixer>> }>
export type ProjectState = Readonly<{
  present: Snapshot; past: readonly Snapshot[]; future: readonly Snapshot[]
  gesture: Readonly<{ before: Snapshot; target: ProjectSelection; selected: ScoreSelection }> | null
  notice: string
  sound: Sound
}>
export type ProjectAction =
  | { type: 'canvas'; partId: string; staffId: string; action: Action }
  | { type: 'change'; change: (project: Project) => Project; selection?: ProjectSelection | null }
  | { type: 'selection'; selection: ProjectSelection | null }
  | { type: 'pick'; selection: ProjectSelection; extend?: boolean; additive?: boolean }
  | { type: 'navigate'; direction: -1 | 1; extend?: boolean }
  | { type: 'sound'; change: (project: Project) => Project }
  | { type: 'undo' | 'redo' | 'cancel' }

const captureSound = (project: Project, previous?: Sound): Sound => ({ master: project.masterVolume, parts: { ...previous?.parts, ...Object.fromEntries(project.parts.map(part => [part.id, part.mixer])) } })
function restoreSound(project: Project, sound: Sound): Project {
  return { ...project, masterVolume: sound.master, parts: project.parts.map(part => ({ ...part, mixer: sound.parts[part.id] ?? part.mixer })) }
}
function sameFields(a: object, b: object, excluded: readonly string[]) {
  const keys = Object.keys(a).filter(key => !excluded.includes(key))
  return keys.length === Object.keys(b).filter(key => !excluded.includes(key)).length
    && keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])
}
// Compare all score fields; only explicitly external sound fields are omitted.
const sameMusic = (a: Project, b: Project) => sameFields(a, b, ['masterVolume', 'parts']) && a.parts.length === b.parts.length
  && a.parts.every((part, i) => sameFields(part, b.parts[i], ['mixer']))
export const createProjectState = (project = createProject()): ProjectState => ({ present: { project, selection: null, selected: null }, past: [], future: [], gesture: null, notice: '', sound: captureSound(project) })
function commit(state: ProjectState, next: Snapshot, before = state.present): ProjectState {
  if (next.project === before.project) return { ...state, present: next, gesture: null }
  const errors = validateProject(next.project)
  if (errors.length) throw new Error(errors.join(' '))
  const selected = reconcileSelection(next.project, next.selected)
  const selection = next.selection && validTarget(next.project, next.selection) ? next.selection : selected?.focus ?? null
  const sound = captureSound(next.project, state.sound)
  if (sameMusic(before.project, next.project)) return { ...state, present: { ...next, selection, selected }, sound, gesture: null, notice: '' }
  return { present: { ...next, selection, selected }, past: [...state.past, before].slice(-100), future: [], gesture: null, notice: '', sound }
}

export function projectReducer(state: ProjectState, input: ProjectAction): ProjectState {
  const action = input.type === 'canvas' ? input.action : input
  if (action.type === 'cancel') return state.gesture ? { ...state, present: state.gesture.before, gesture: null, notice: '드래그를 취소했습니다.' } : state
  if (state.gesture && !['previewPitch', 'previewDuration', 'commit'].includes(action.type)) return state
  try {
    if (action.type === 'undo' || action.type === 'redo') {
      const source = action.type === 'undo' ? state.past : state.future
      const next = source.at(-1)
      if (!next) return state
      const restored = { ...next, project: restoreSound(next.project, state.sound) }
      return action.type === 'undo'
        ? { ...state, present: restored, past: state.past.slice(0, -1), future: [...state.future, state.present], notice: '' }
        : { ...state, present: restored, past: [...state.past, state.present], future: state.future.slice(0, -1), notice: '' }
    }
    if (input.type === 'sound') {
      const project = input.change(state.present.project)
      if (!sameMusic(project, state.present.project)) throw new Error('음원 설정에서 악보를 변경할 수 없습니다.')
      const errors = validateProject(project)
      if (errors.length) throw new Error(errors.join(' '))
      return { ...state, present: { ...state.present, project }, sound: captureSound(project, state.sound), notice: '' }
    }
    if (input.type === 'change') return commit(state, { ...state.present, project: input.change(state.present.project), selection: input.selection === undefined ? state.present.selection : input.selection,
      selected: input.selection === undefined ? state.present.selected : input.selection ? singleSelection(input.selection) : null })
    if (input.type === 'selection') return { ...state, present: { ...state.present, selection: input.selection, selected: input.selection ? pickSelection(state.present.project, null, input.selection) : null }, notice: '' }
    if (input.type === 'pick') {
      const selected = pickSelection(state.present.project, state.present.selected, input.selection, input.extend, input.additive)
      return { ...state, present: { ...state.present, selected, selection: selected?.focus ?? null }, notice: '' }
    }
    if (input.type === 'navigate') {
      const all = navigationTargets(state.present.project)
      const from = input.extend ? state.present.selected?.focus ?? state.present.selection : state.present.selection
      const current = all.findIndex(item => item.eventId === from?.eventId)
      const index = current < 0 ? (input.direction === 1 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, current + input.direction))
      const point = { ...all[index], pitchIndex: 0 }
      const selected = pickSelection(state.present.project, state.present.selected, point, input.extend)
      return { ...state, present: { ...state.present, selection: point, selected }, notice: '' }
    }
    if (input.type !== 'canvas') return state
    if (action.type === 'begin' || action.type === 'select') {
      const selection = { ...action.selection, partId: input.partId, staffId: input.staffId,
        pitchIndex: action.selection.pitchIndex ?? (action.selection.eventId === state.present.selection?.eventId ? state.present.selection.pitchIndex : 0) }
      const keepGroup = action.type === 'begin' && state.present.selected?.targets.some(item => targetKey(item) === targetKey(selection))
      const selected = keepGroup ? state.present.selected : singleSelection(selection)
      return { ...state, present: { ...state.present, selection, selected }, gesture: action.type === 'begin' ? { before: state.present, target: selection, selected: selected! } : null, notice: '' }
    }
    if (action.type === 'commit') return state.gesture ? commit(state, state.present, { ...state.gesture.before, selection: state.gesture.target, selected: state.gesture.selected }) : state
    if (action.type === 'cursor') {
      const all = allSelections(state.present.project)
      const current = all.findIndex(item => item.eventId === state.present.selection?.eventId)
      const index = current < 0 ? (action.direction === 1 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, current + action.direction))
      return { ...state, present: { ...state.present, selection: all[index], selected: singleSelection(all[index]) }, notice: '' }
    }
    const preview = action.type === 'previewPitch' || action.type === 'previewDuration'
    if (preview && !state.gesture) return state
    const before = preview && state.gesture ? { ...state.gesture.before, selection: state.gesture.target, selected: state.gesture.selected } : state.present
    if (action.type === 'keySignature' || action.type === 'timeSignature') {
      const project = { ...before.project, parts: before.project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff,
        score: action.type === 'keySignature' ? setKeySignature(staff.score, action.key) : freshScoreEvents(staff.score, setTimeSignature(staff.score, action.time)),
      })) })) }
      return commit(state, { ...before, project })
    }
    const selection = before.selection
    if (!selection) throw new Error('먼저 음표나 쉼표를 선택하세요.')
    if (isGroupSelection(before.selected)) {
      if (action.type === 'duration' || action.type === 'previewDuration') throw new Error('그룹 선택에서는 음표 길이를 변경할 수 없습니다.')
      if (action.type === 'pitch' || action.type === 'previewPitch') {
        const project = transposeSelection(before.project, before.selected!, action.amount, action.type === 'pitch' ? action.chromatic !== false : false, before.selection ?? undefined)
        if (preview) return { ...state, present: { ...before, project }, notice: '' }
        return commit(state, { ...before, project })
      }
      if (action.type === 'accidental') throw new Error('임시표는 구성음을 하나 선택한 뒤 지정하세요.')
    }
    const { part, staff } = staffAt(before.project, selection)
    if (part.instrument === 'drums' && ['pitch', 'previewPitch', 'accidental'].includes(action.type)) throw new Error('드럼 음은 속성에서 킥·스네어·하이햇으로 지정하세요.')
    const score = action.type === 'pitch' || action.type === 'previewPitch'
      ? transposeEvent(staff.score, selection, action.amount, action.type === 'pitch' && action.chromatic)
      : action.type === 'duration' || action.type === 'previewDuration' ? resizeEvent(staff.score, selection, action.duration)
      : action.type === 'accidental' ? setAccidental(staff.score, selection, action.alter) : staff.score
    if (score === staff.score) return preview ? { ...state, present: before, notice: '' } : state
    const project = updateStaff(before.project, staff.id, item => ({ ...item, score: freshScoreEvents(staff.score, score) }))
    const next = { ...before, project }
    if (preview) {
      const errors = validateProject(project)
      if (errors.length) throw new Error(errors.join(' '))
      return { ...state, present: next, notice: '' }
    }
    return commit(state, next)
  } catch (error) {
    return { ...state, present: state.gesture ? { ...state.gesture.before, selection: state.gesture.target, selected: state.gesture.selected } : state.present, notice: error instanceof Error ? error.message : '편집할 수 없습니다.' }
  }
}
