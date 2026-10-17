import { createInitialScore, moveCursor, resizeEvent, transposeEvent } from '../music/score'
import type { Score, Selection } from '../music/score'
import type { Rational } from '../music/rational'

export type Snapshot = Readonly<{ score: Score; selection: Selection | null }>
export type EditorState = Readonly<{
  present: Snapshot
  past: readonly Snapshot[]
  future: readonly Snapshot[]
  gesture: Readonly<{ before: Snapshot; target: Selection }> | null
  notice: string
}>
export type Action =
  | { type: 'select'; selection: Selection }
  | { type: 'cursor'; direction: -1 | 1 }
  | { type: 'pitch'; amount: number; chromatic?: boolean }
  | { type: 'duration'; duration: Rational }
  | { type: 'begin'; selection: Selection }
  | { type: 'previewPitch'; amount: number }
  | { type: 'previewDuration'; duration: Rational }
  | { type: 'commit' }
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'redo' }

export const createEditor = (): EditorState => ({
  present: { score: createInitialScore(), selection: null }, past: [], future: [], gesture: null, notice: '',
})

function commit(state: EditorState, next: Snapshot, before = state.present): EditorState {
  if (next.score === before.score) return { ...state, present: next, gesture: null, notice: state.gesture ? state.notice : '' }
  return { present: next, past: [...state.past, before].slice(-100), future: [], gesture: null, notice: '' }
}

export function editorReducer(state: EditorState, action: Action): EditorState {
  if (action.type === 'cancel') {
    return state.gesture ? { ...state, present: state.gesture.before, gesture: null, notice: '드래그를 취소했습니다.' } : state
  }
  if (action.type === 'begin') {
    return { ...state, present: { ...state.present, selection: action.selection }, gesture: { before: state.present, target: action.selection }, notice: '' }
  }
  if (action.type === 'commit') {
    return state.gesture ? commit(state, state.present, { ...state.gesture.before, selection: state.gesture.target }) : state
  }
  if (action.type === 'select') return { ...state, present: { ...state.present, selection: action.selection }, notice: '' }
  // Keyboard and history commands must never commit a half-finished pointer gesture.
  if (state.gesture && action.type !== 'previewPitch' && action.type !== 'previewDuration') return state
  if (action.type === 'cursor') return { ...state, present: { ...state.present, selection: moveCursor(state.present.score, state.present.selection, action.direction) }, notice: '' }
  if (action.type === 'undo' || action.type === 'redo') {
    const source = action.type === 'undo' ? state.past : state.future
    const snapshot = source.at(-1)
    if (!snapshot) return state
    return action.type === 'undo'
      ? { ...state, present: snapshot, past: state.past.slice(0, -1), future: [...state.future, state.present], notice: '' }
      : { ...state, present: snapshot, past: [...state.past, state.present], future: state.future.slice(0, -1), notice: '' }
  }
  const preview = action.type === 'previewPitch' || action.type === 'previewDuration'
  if (preview && !state.gesture) return state
  const before = preview && state.gesture ? { ...state.gesture.before, selection: state.gesture.target } : state.present
  if (!before.selection) return { ...state, notice: '먼저 음표나 쉼표를 선택하세요.' }
  try {
    const score = action.type === 'pitch' || action.type === 'previewPitch'
      ? transposeEvent(before.score, before.selection, action.amount, action.type === 'pitch' && action.chromatic)
      : resizeEvent(before.score, before.selection, action.duration)
    const next = { ...before, score }
    return preview ? { ...state, present: next, notice: '' } : commit(state, next)
  } catch (error) {
    return { ...state, present: preview ? before : state.present, notice: error instanceof Error ? error.message : '편집할 수 없습니다.' }
  }
}
