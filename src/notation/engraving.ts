import { add, compare, equal, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import type { RhythmEvent } from '../music/score'
import { measureDuration } from '../music/settings'
import type { TimeSignature } from '../music/settings'

const quarter = fraction(1, 4)
const baseDenominator = (event: RhythmEvent) => event.duration.d / (event.duration.n === 3 ? 2 : 1)

// Derive visual beams from immutable rhythm events. No renderer ticks or float time.
// In 4/4, eighths join across each half-bar; subdivisions split at quarter beats.
// Compound /8 meters use dotted-quarter beats. Automatic beams stop at rests.
export function beamGroups(events: readonly RhythmEvent[], time: TimeSignature): number[][] {
  const end = measureDuration(time), boundaries: Rational[] = [ZERO]
  const compound = time.endsWith('/8')
  const unit = compound ? fraction(3, 8) : quarter
  for (let at = unit; compare(at, end) < 0; at = add(at, unit)) {
    const isHalf = equal(at, fraction(1, 2))
    const subdivided = events.some(event => baseDenominator(event) >= 16
      && compare(event.start, add(at, quarter)) < 0 && compare(add(event.start, event.duration), subtract(at, quarter)) > 0)
    if (time !== '4/4' || isHalf || subdivided) boundaries.push(at)
  }
  boundaries.push(end)
  const groups: number[][] = []
  let current: number[] = [], bucket = -1
  const flush = () => { if (current.length > 1) groups.push(current); current = [] }
  events.forEach((event, index) => {
    const nextBucket = boundaries.findIndex((right, i) => i > 0 && compare(event.start, right) < 0) - 1
    const eligible = event.kind === 'note' && compare(event.duration, quarter) < 0
      && baseDenominator(event) >= 8 && nextBucket >= 0
      && compare(add(event.start, event.duration), boundaries[nextBucket + 1]) <= 0
    const previous = events[index - 1]
    if (!eligible || nextBucket !== bucket || previous && !equal(add(previous.start, previous.duration), event.start)) flush()
    if (eligible) current.push(index)
    bucket = nextBucket
  })
  flush()
  return groups
}

export type MeasureMetrics = Readonly<{ body: number; opening: number; continuation: number }>
export type PlacedMeasure = Readonly<{ index: number; x: number; width: number }>
export type ScoreSystem = Readonly<{ width: number; measures: readonly PlacedMeasure[] }>
export const SYSTEM_LABEL_WIDTH = 110
const END_PADDING = 22

// Pack indivisible bars by measured glyph widths, then justify their rhythmic
// bodies. Each staff uses this same plan, so barlines/onsets remain aligned.
export function layoutSystems(metrics: readonly MeasureMetrics[], available: number, continuous = false): ScoreSystem[] {
  const usable = Math.max(120, available - SYSTEM_LABEL_WIDTH - 8)
  const lines: number[][] = []
  let line: number[] = [], used = 0
  const minimum = (index: number, start: boolean) => metrics[index].body + (start ? metrics[index].opening : metrics[index].continuation) + END_PADDING
  metrics.forEach((_, index) => {
    let width = minimum(index, !line.length)
    if (!continuous && line.length && used + width > usable) {
      lines.push(line); line = []; used = 0; width = minimum(index, true)
    }
    line.push(index); used += width
  })
  if (line.length) lines.push(line)
  return lines.map((indices, systemIndex) => {
    const widths = indices.map((index, i) => minimum(index, i === 0))
    const total = widths.reduce((sum, width) => sum + width, 0)
    const shortFinal = systemIndex === lines.length - 1 && systemIndex > 0 && total < usable / 2
    const target = continuous ? Math.max(usable, total) : shortFinal ? Math.min(usable, total * 1.35) : Math.max(usable, total)
    const weight = indices.reduce((sum, index) => sum + metrics[index].body, 0)
    let x = SYSTEM_LABEL_WIDTH
    const measures = indices.map((index, i) => {
      const width = widths[i] + (target - total) * metrics[index].body / weight
      const bar = { index, x, width }; x += width; return bar
    })
    return { width: x + 8, measures }
  })
}
