export type Rational = Readonly<{ n: number; d: number }>

export function fraction(n: number, d = 1): Rational {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) {
    throw new Error('Invalid rational number')
  }
  let a = Math.abs(n)
  let b = Math.abs(d)
  while (b !== 0) [a, b] = [b, a % b]
  const divisor = (a || 1) * Math.sign(d)
  return { n: n / divisor, d: d / divisor }
}

export const ZERO = fraction(0)
export const WHOLE = fraction(1)
export const add = (a: Rational, b: Rational) => fraction(a.n * b.d + b.n * a.d, a.d * b.d)
export const subtract = (a: Rational, b: Rational) => fraction(a.n * b.d - b.n * a.d, a.d * b.d)
export const compare = (a: Rational, b: Rational) => Math.sign(a.n * b.d - b.n * a.d)
export const equal = (a: Rational, b: Rational) => compare(a, b) === 0
export const formatFraction = (value: Rational) => `${value.n}/${value.d}`
