import { createProject } from '../../src/project/model'
import type { Project, ProjectSelection } from '../../src/project/model'
import { fraction } from '../../src/music/rational'

export function clipboardProject(): Project {
  const base = createProject(false), template = base.parts[0]
  return { ...base, title: '성부 복사 검증', parts: (['piano', 'guitar', 'bass'] as const).map((instrument, p) => ({
    ...template, id: `part-${p}`, name: ['피아노', '기타', '베이스'][p], instrument,
    mixer: { ...template.mixer, program: [0, 27, 33][p] },
    staves: [{ ...template.staves[0], id: `staff-${p}`, clef: p === 2 ? 'bass' : 'treble', score: { keySignature: 0, timeSignature: '4/4',
      measures: Array.from({ length: 4 }, (_, m) => ({ id: `bar-${p}-${m}`, voices: Array.from({ length: p === 0 ? 2 : 1 }, (_, v) => ({
        id: `voice-${p}-${v}`, events: Array.from({ length: 4 }, (_, i) => ({ id: `event-${p}-${v}-${m}-${i}`, kind: 'note' as const,
          start: fraction(i, 4), duration: fraction(1, 4), pitch: { step: (['C', 'D', 'E', 'G'] as const)[i], octave: p === 2 ? 2 : p === 1 ? 5 : v ? 3 : 4, alter: 0 as const },
          ...(p === 0 && v === 0 && i === 0 ? { chord: [{ step: 'E' as const, octave: 4, alter: 0 as const }, { step: 'G' as const, octave: 4, alter: 0 as const }] } : {}),
        })),
      })) })),
    } }],
  })) }
}
export const clipboardTarget = (p = 0, v = 0, m = 0, i = 0, pitchIndex = 0): ProjectSelection => ({
  partId: `part-${p}`, staffId: `staff-${p}`, voiceId: `voice-${p}-${v}`, measureId: `bar-${p}-${m}`, eventId: `event-${p}-${v}-${m}-${i}`, pitchIndex,
})
