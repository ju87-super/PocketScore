import type { Action, EditorState } from '../../src/editor/state'
import type { Score } from '../../src/music/score'

declare global {
  interface Window {
    fixture: {
      mount(count: number, score?: Score): void
      act(action: Action): void
      state(): EditorState
      freshSVG(): string
    }
  }
}
export {}
