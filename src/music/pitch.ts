export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
export type Pitch = Readonly<{
  step: typeof STEPS[number]
  octave: number
  alter: -1 | 0 | 1
}>
const NATURAL = [0, 2, 4, 5, 7, 9, 11]
const SHARPS = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]] as const
const FLATS = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]] as const

export const midi = (pitch: Pitch) => (pitch.octave + 1) * 12 + NATURAL[STEPS.indexOf(pitch.step)] + pitch.alter
export const pitchName = (pitch: Pitch) => `${pitch.step}${pitch.alter === 1 ? '♯' : pitch.alter === -1 ? '♭' : ''}${pitch.octave}`

export function movePitch(pitch: Pitch, amount: number, chromatic = false): Pitch {
  if (amount === 0) return pitch
  let next: Pitch
  if (chromatic) {
    const value = midi(pitch) + amount
    const [step, alter] = (amount > 0 ? SHARPS : FLATS)[((value % 12) + 12) % 12]
    next = { step: STEPS[step], octave: Math.floor(value / 12) - 1, alter }
  } else {
    const index = pitch.octave * 7 + STEPS.indexOf(pitch.step) + amount
    next = { step: STEPS[((index % 7) + 7) % 7], octave: Math.floor(index / 7), alter: 0 }
  }
  if (midi(next) < 36 || midi(next) > 96) throw new Error('프로토타입 음역은 C2–C7입니다.')
  return next
}
