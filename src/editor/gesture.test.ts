// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { draggedDuration, gestureAxis, pitchSteps } from './gesture'
import { fraction } from '../music/rational'

describe('gesture intent and snapping', () => {
  it('ignores jitter and ambiguous diagonals until one direction dominates', () => {
    expect(gestureAxis(3, 5)).toBeNull()
    expect(gestureAxis(20, 20)).toBeNull()
    expect(gestureAxis(-30, 10)).toBe('horizontal')
    expect(gestureAxis(10, -30)).toBe('vertical')
  })
  it('maps vertical movement to diatonic steps and horizontal movement to valid durations', () => {
    expect(pitchSteps(-20)).toBe(2)
    expect(pitchSteps(20)).toBe(-2)
    expect(draggedDuration(fraction(1, 4), -64)).toEqual(fraction(1, 8))
    expect(draggedDuration(fraction(1, 4), 32)).toEqual(fraction(3, 8))
    expect(draggedDuration(fraction(1, 4), 1000)).toEqual(fraction(1))
    expect(draggedDuration(fraction(1, 4), -1000)).toEqual(fraction(1, 64))
  })
})
