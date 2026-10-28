import type { Rational } from '../music/rational'

// SMuFL characters rendered by the existing VexFlow Bravura font.
// These are musical symbols, not MuseScore's application icon assets.
export function rhythmSymbol(duration: Rational, rest = false): string {
  const denominator = duration.d / (duration.n === 3 ? 2 : 1)
  return (rest ? { 1: '\ue4e3', 2: '\ue4e4', 4: '\ue4e5', 8: '\ue4e6', 16: '\ue4e7', 32: '\ue4e8', 64: '\ue4e9' }
    : { 1: '\ue1d2', 2: '\ue1d3', 4: '\ue1d5', 8: '\ue1d7', 16: '\ue1d9', 32: '\ue1db', 64: '\ue1dd' })[denominator as 1 | 2 | 4 | 8 | 16 | 32 | 64] ?? ''
}
export const VOICE_COLORS = ['#246dcc', '#27824b', '#b46b13', '#8b43a8'] as const
