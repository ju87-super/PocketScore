import { DURATIONS } from '../music/score'
import { equal } from '../music/rational'
import type { Rational } from '../music/rational'

export type Axis = 'horizontal' | 'vertical'
export function gestureAxis(dx: number, dy: number): Axis | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return null
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return 'horizontal'
  if (Math.abs(dy) > Math.abs(dx) * 1.2) return 'vertical'
  return null
}
export const pitchSteps = (dy: number) => Math.round(-dy / 10)
export function draggedDuration(initial: Rational, dx: number): Rational {
  const index = DURATIONS.findIndex(item => equal(item, initial))
  return DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, index + Math.round(dx / 32)))]
}
