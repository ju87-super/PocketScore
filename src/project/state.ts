import { resizeEvent, setAccidental, setKeySignature, setTimeSignature, transposeEvent } from '../music/score'
import type { Action } from '../editor/state'
import type { Project, ProjectSelection } from './model'
import { allSelections, createProject, freshScoreEvents, staffAt, updateStaff, validateProject } from './model'

export type Snapshot = Readonly<{ project: Project; selection: ProjectSelection | null }>
export type ProjectState = Readonly<{
  present: Snapshot; past: readonly Snapshot[]; future: readonly Snapshot[]
  gesture: Readonly<{ before: Snapshot; target: ProjectSelection }> | null
  notice: string
}>
export type ProjectAction =
  | { type: 'canvas'; partId: string; staffId: string; action: Action }
  | { type: 'change'; change: (project: Project) => Project; selection?: ProjectSelection | null }
  | { type: 'selection'; selection: ProjectSelection | null }
  | { type: 'undo' | 'redo' | 'cancel' }

export const createProjectState = (project = createProject()): ProjectState => ({ present: { project, selection: null }, past: [], future: [], gesture: null, notice: '' })
function commit(state: ProjectState, next: Snapshot, before = state.present): ProjectState {
  if (next.project === before.project) return { ...state, present: next, gesture: null }
  const errors = validateProject(next.project)
  if (errors.length) throw new Error(errors.join(' '))
  const selection = next.selection && allSelections(next.project).some(item => item.eventId === next.selection?.eventId) ? next.selection : null
  return { present: { ...next, selection }, past: [...state.past, before].slice(-100), future: [], gesture: null, notice: '' }
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
      return action.type === 'undo'
        ? { ...state, present: next, past: state.past.slice(0, -1), future: [...state.future, state.present], notice: '' }
        : { ...state, present: next, past: [...state.past, state.present], future: state.future.slice(0, -1), notice: '' }
    }
    if (input.type === 'change') return commit(state, { project: input.change(state.present.project), selection: input.selection === undefined ? state.present.selection : input.selection })
    if (input.type === 'selection') return { ...state, present: { ...state.present, selection: input.selection }, notice: '' }
    if (input.type !== 'canvas') return state
    if (action.type === 'begin' || action.type === 'select') {
      const selection = { ...action.selection, partId: input.partId, staffId: input.staffId,
        pitchIndex: action.selection.eventId === state.present.selection?.eventId ? state.present.selection.pitchIndex : 0 }
      return { ...state, present: { ...state.present, selection }, gesture: action.type === 'begin' ? { before: state.present, target: selection } : null, notice: '' }
    }
    if (action.type === 'commit') return state.gesture ? commit(state, state.present, { ...state.gesture.before, selection: state.gesture.target }) : state
    if (action.type === 'cursor') {
      const all = allSelections(state.present.project)
      const current = all.findIndex(item => item.eventId === state.present.selection?.eventId)
      const index = current < 0 ? (action.direction === 1 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, current + action.direction))
      return { ...state, present: { ...state.present, selection: all[index] }, notice: '' }
    }
    const preview = action.type === 'previewPitch' || action.type === 'previewDuration'
    if (preview && !state.gesture) return state
    const before = preview && state.gesture ? { ...state.gesture.before, selection: state.gesture.target } : state.present
    if (action.type === 'keySignature' || action.type === 'timeSignature') {
      const project = { ...before.project, parts: before.project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff,
        score: action.type === 'keySignature' ? setKeySignature(staff.score, action.key) : freshScoreEvents(staff.score, setTimeSignature(staff.score, action.time)),
      })) })) }
      return commit(state, { ...before, project })
    }
    const selection = before.selection
    if (!selection) throw new Error('먼저 음표나 쉼표를 선택하세요.')
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
    return { ...state, present: state.gesture ? { ...state.gesture.before, selection: state.gesture.target } : state.present, notice: error instanceof Error ? error.message : '편집할 수 없습니다.' }
  }
}
