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
function combine(a: Rational, b: Rational, sign: 1 | -1): Rational {
  const left = a.n * b.d
  const right = b.n * a.d
  const n = left + sign * right
  const d = a.d * b.d
  // Keep ordinary musical durations on the inexpensive safe-number path.
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right) && Number.isSafeInteger(n) && Number.isSafeInteger(d)) return fraction(n, d)
  let numerator = BigInt(a.n) * BigInt(b.d) + BigInt(sign) * BigInt(b.n) * BigInt(a.d)
  let denominator = BigInt(a.d) * BigInt(b.d)
  let x = numerator < 0n ? -numerator : numerator
  let y = denominator < 0n ? -denominator : denominator
  while (y !== 0n) [x, y] = [y, x % y]
  const divisor = (x || 1n) * (denominator < 0n ? -1n : 1n)
  numerator /= divisor
  denominator /= divisor
  // fraction rejects results that cannot be represented exactly in this model.
  return fraction(Number(numerator), Number(denominator))
}
export const add = (a: Rational, b: Rational) => combine(a, b, 1)
export const subtract = (a: Rational, b: Rational) => combine(a, b, -1)
export const compare = (a: Rational, b: Rational) => {
  const left = a.n * b.d
  const right = b.n * a.d
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) return Math.sign(left - right)
  const difference = BigInt(a.n) * BigInt(b.d) - BigInt(b.n) * BigInt(a.d)
  return difference > 0n ? 1 : difference < 0n ? -1 : 0
}
export const equal = (a: Rational, b: Rational) => compare(a, b) === 0
export const formatFraction = (value: Rational) => `${value.n}/${value.d}`
