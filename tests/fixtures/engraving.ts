import { createProject } from '../../src/project/model'
import type { Project } from '../../src/project/model'
import { fraction, ZERO } from '../../src/music/rational'
import { retime } from '../../src/music/score'
import type { RhythmEvent } from '../../src/music/score'
import type { TimeSignature } from '../../src/music/settings'
import { measureDuration } from '../../src/music/settings'

export function engravingProject(time: TimeSignature = '4/4', count = 8): Project {
  const base = createProject(false), capacity = measureDuration(time)
  const measures = Array.from({ length: count }, (_, bar) => {
    const denominator = bar === 1 ? 16 : 8, length = capacity.n * denominator / capacity.d
    let events = retime(Array.from({ length }, (_, i): RhythmEvent => ({
      id: `bar${bar}-n${i}`, kind: 'note', start: ZERO, duration: fraction(1, denominator),
      pitch: { step: (['C', 'D', 'E', 'G'] as const)[i % 4], octave: 4, alter: bar === 1 && i % 4 === 0 ? 1 : 0 },
      ...(bar === 1 && i % 4 === 0 ? { chord: [{ step: 'D' as const, octave: 4, alter: 0 as const }, { step: 'E' as const, octave: 4, alter: 0 as const }] } : {}),
    })))
    if (bar === 3) {
      const durations = []
      let remaining = capacity.n * 16 / capacity.d
      while (remaining >= 4) { durations.push(fraction(3, 16), fraction(1, 16)); remaining -= 4 }
      if (remaining) durations.push(fraction(remaining, 16))
      events = retime(durations.map((duration, i) => ({ ...events[i], duration })))
    }
    if (bar === 2) events[1] = { id: events[1].id, start: events[1].start, duration: events[1].duration, kind: 'rest' }
    return { id: `bar${bar}`, voices: [{ id: 'voice0', events }] }
  })
  return { ...base, title: '기본 조판 검증', parts: [{ ...base.parts[0], id: 'part0', staves: [{ ...base.parts[0].staves[0], id: 'staff0', score: { keySignature: 0, timeSignature: time, measures } }] }] }
}
