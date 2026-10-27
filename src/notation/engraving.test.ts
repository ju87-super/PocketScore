// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { beamGroups, layoutSystems, SYSTEM_LABEL_WIDTH } from './engraving'
import type { MeasureMetrics } from './engraving'
import { fraction, ZERO } from '../music/rational'
import { retime } from '../music/score'
import type { RhythmEvent } from '../music/score'
import type { TimeSignature } from '../music/settings'

const notes = (count: number, denominator = 8) => retime(Array.from({ length: count }, (_, i): RhythmEvent => ({
  id: `n${i}`, kind: 'note', pitch: { step: 'C', octave: 4, alter: 0 }, start: ZERO, duration: fraction(1, denominator),
})))

describe('automatic beam grouping from exact rhythm', () => {
  it.each<[TimeSignature, number, number[]]>([
    ['2/4', 4, [2, 2]], ['3/4', 6, [2, 2, 2]], ['4/4', 8, [4, 4]],
    ['3/8', 3, [3]], ['6/8', 6, [3, 3]], ['9/8', 9, [3, 3, 3]], ['12/8', 12, [3, 3, 3, 3]],
  ])('%s groups eighths by its meter', (time, count, lengths) => {
    const events = notes(count), before = structuredClone(events)
    const result = beamGroups(events, time)
    expect(result.map(group => group.length)).toEqual(lengths)
    expect(result.flat()).toEqual(events.map((_, i) => i))
    expect(events).toEqual(before)
  })
  it('splits sixteenths at quarter beats in 4/4', () => {
    expect(beamGroups(notes(16, 16), '4/4')).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]])
  })
  it('splits mixed subdivisions without separating a dotted eighth/sixteenth pair', () => {
    const source = notes(8)
    const events = retime([{ ...source[0], duration: fraction(3, 16) }, { ...source[1], duration: fraction(1, 16) }, ...source.slice(2)])
    expect(beamGroups(events, '4/4')).toEqual([[0, 1], [2, 3], [4, 5, 6, 7]])
  })
  it('keeps six sixteenths in each compound beat', () => {
    expect(beamGroups(notes(12, 16), '6/8')).toEqual([[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]])
  })
  it('breaks on rests, quarters and gaps, and leaves singleton notes flagged', () => {
    const events = notes(8)
    const withRest = events.map((event, i): RhythmEvent => i === 1 ? { id: event.id, start: event.start, duration: event.duration, kind: 'rest' } : event)
    expect(beamGroups(withRest, '4/4')).toEqual([[2, 3], [4, 5, 6, 7]])
    expect(beamGroups(retime([{ ...events[0], duration: fraction(1, 4) }, ...events.slice(1, 3)]), '2/4')).toEqual([[1, 2]])
    expect(beamGroups([events[0], events[2]], '4/4')).toEqual([])
  })
  it('treats a chord as one rhythmic event, without changing its pitches or timing', () => {
    const events = notes(4).map(event => ({ ...event, chord: [{ step: 'E' as const, octave: 4, alter: 0 as const }] }))
    expect(beamGroups(events, '2/4')).toEqual([[0, 1], [2, 3]])
    expect(events[0].chord).toHaveLength(1)
  })
})

describe('measured system layout', () => {
  const light: MeasureMetrics = { body: 90, opening: 70, continuation: 10 }
  it('fits more than two sparse measures and retains their reading order', () => {
    const systems = layoutSystems(Array(8).fill(light), 1000)
    expect(systems[0].measures.length).toBeGreaterThan(2)
    expect(systems.flatMap(system => system.measures.map(bar => bar.index))).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
  it('gives dense chords/accidentals more width than sparse material', () => {
    const dense = { ...light, body: 320 }, before = [light, dense, light]
    const systems = layoutSystems(before, 1000)
    expect(systems[0].measures[1].width).toBeGreaterThan(systems[0].measures[0].width)
    expect(before).toEqual([light, dense, light])
  })
  it('reflows narrow screens without squeezing an indivisible dense measure', () => {
    const metrics = [light, { ...light, body: 600 }, light]
    const systems = layoutSystems(metrics, 390)
    expect(systems).toHaveLength(3)
    expect(systems[1].width).toBeGreaterThan(390)
    expect(systems[0].width).toBeLessThanOrEqual(390)
    expect(systems[2].width).toBeLessThanOrEqual(390)
  })
  it('keeps adjacent barlines identical, reserves system signatures, and never creates negative space', () => {
    for (const width of [280, 390, 800, 1200]) for (const system of layoutSystems(Array(12).fill(light), width)) {
      expect(system.measures[0].x).toBe(SYSTEM_LABEL_WIDTH)
      system.measures.forEach((bar, i) => {
        expect(bar.width).toBeGreaterThanOrEqual(light.body + (i ? light.continuation : light.opening) + 22)
        if (i) expect(bar.x).toBeCloseTo(system.measures[i - 1].x + system.measures[i - 1].width)
        expect(bar.x + bar.width).toBeLessThanOrEqual(system.width)
      })
    }
  })
  it('keeps continuous mode on a single unsqueezed system and empty input empty', () => {
    expect(layoutSystems([], 800)).toEqual([])
    const result = layoutSystems(Array(12).fill(light), 390, true)
    expect(result).toHaveLength(1)
    expect(result[0].measures).toHaveLength(12)
    expect(result[0].width).toBeGreaterThan(390)
  })
})
