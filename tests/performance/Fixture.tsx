import { useLayoutEffect, useReducer } from 'react'
import ScoreCanvas from '../../src/editor/ScoreCanvas'
import { createEditor, editorReducer } from '../../src/editor/state'
import type { Action, EditorState } from '../../src/editor/state'
import { validateScore } from '../../src/music/score'
import type { Score } from '../../src/music/score'
import { longScore } from '../fixtures/scores'

type Props = { count: number; score?: Score; publish: (state: EditorState, send: (action: Action) => void) => void }
export function Fixture({ count, score, publish }: Props) {
  const [state, send] = useReducer(editorReducer, count, n => ({ ...createEditor(), present: {
    score: score ?? longScore(n), selection: { measureId: 'm1', voiceId: 'v1', eventId: 'm1-e1' },
  } }))
  useLayoutEffect(() => publish(state, send), [state, send, publish])
  const errors = validateScore(state.present.score)
  if (errors.length) throw new Error(errors.join(' '))
  return <ScoreCanvas {...state.present} editing dispatch={send} />
}
