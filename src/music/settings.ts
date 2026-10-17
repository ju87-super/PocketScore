import type { Pitch } from './pitch'
import { fraction } from './rational'

// Signed fifths describe written pitches, not transposition instructions.
export const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'] as const
export const KEY_LABELS = ['C♭장조 · ♭7개', 'G♭장조 · ♭6개', 'D♭장조 · ♭5개', 'A♭장조 · ♭4개', 'E♭장조 · ♭3개', 'B♭장조 · ♭2개', 'F장조 · ♭1개', 'C장조 · 조표 없음', 'G장조 · ♯1개', 'D장조 · ♯2개', 'A장조 · ♯3개', 'E장조 · ♯4개', 'B장조 · ♯5개', 'F♯장조 · ♯6개', 'C♯장조 · ♯7개'] as const
export const validKey = (key: number) => Number.isInteger(key) && key >= -7 && key <= 7
export const keyAlter = (key: number, step: Pitch['step']): Pitch['alter'] => {
  const order = key > 0 ? 'FCGDAEB' : 'BEADGCF'
  return order.slice(0, Math.abs(key)).includes(step) ? (key > 0 ? 1 : -1) : 0
}
export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '3/8', '6/8', '9/8', '12/8'] as const
export type TimeSignature = typeof TIME_SIGNATURES[number]
export function meterParts(time: TimeSignature) {
  const [beats, beatValue] = time.split('/').map(Number)
  return { beats, beatValue }
}
export function measureDuration(time: TimeSignature) {
  const { beats, beatValue } = meterParts(time)
  return fraction(beats, beatValue)
}
