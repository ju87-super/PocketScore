import { createInitialScore, DURATIONS, eventPitches, locate, retime, validateScore } from '../music/score'
import type { RhythmEvent, Score, Selection } from '../music/score'
import { add, compare, equal, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { midi } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { measureDuration } from '../music/settings'
import { reconcileTieEdits } from '../music/ties'

export const INSTRUMENTS = {
  piano: { name: '피아노', program: 0, clef: 'treble' },
  guitar: { name: '일렉트릭 기타', program: 27, clef: 'treble' },
  bass: { name: '일렉트릭 베이스', program: 33, clef: 'bass' },
  drums: { name: '드럼', program: 0, clef: 'percussion' },
} as const
export type Instrument = keyof typeof INSTRUMENTS
export type Clef = 'treble' | 'bass' | 'percussion'
export type Mixer = Readonly<{ program: number; volume: number; pan: number; mute: boolean; solo: boolean }>
export type Staff = Readonly<{ id: string; name: string; clef: Clef; score: Score }>
export type Part = Readonly<{ id: string; name: string; instrument: Instrument; staves: readonly Staff[]; mixer: Mixer }>
export type Project = Readonly<{
  version: 2; title: string; parts: readonly Part[]
  tempos: readonly Readonly<{ measure: number; bpm: number }>[]
  masterVolume: number
}>
export type ProjectSelection = Selection & Readonly<{ partId: string; staffId: string; scope?: 'measure' }>
export const uid = () => crypto.randomUUID()
export const primaryScore = (project: Project) => project.parts[0].staves[0].score

// Legacy single-score edits allocate local rest IDs. Promote new events into
// the project-wide identity space while retaining every surviving event ID.
export function freshScoreEvents(before: Score, after: Score): Score {
  if (before === after) return before
  const existing = new Set(before.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => event.id))))
  return { ...after, measures: after.measures.map(measure => before.measures.includes(measure) ? measure : { ...measure,
    voices: measure.voices.map(voice => ({ ...voice, events: voice.events.map(event => existing.has(event.id) ? event : { ...event, id: uid() }) })),
  }) }
}

export function rests(amount: Rational): RhythmEvent[] {
  let remaining = amount
  const result: RhythmEvent[] = []
  for (const duration of [...DURATIONS].reverse()) while (compare(remaining, duration) >= 0) {
    result.push({ id: uid(), kind: 'rest', start: ZERO, duration })
    remaining = subtract(remaining, duration)
  }
  if (!equal(remaining, ZERO)) throw new Error('64분음표 격자로 표현할 수 없는 길이입니다.')
  return retime(result)
}

export function blankScore(template: Score, voices = 1): Score {
  const voiceIds = Array.from({ length: voices }, () => uid())
  return { ...template, measures: template.measures.map(() => ({ id: uid(), voices: voiceIds.map(id => ({ id, events: rests(measureDuration(template.timeSignature)) })) })) }
}

export function makePart(instrument: Instrument, template: Score): Part {
  const spec = INSTRUMENTS[instrument]
  return { id: uid(), name: spec.name, instrument, mixer: { program: spec.program, volume: 0.8, pan: 0, mute: false, solo: false },
    staves: [{ id: uid(), name: spec.name, clef: spec.clef, score: blankScore(template) }] }
}

export function createProject(demo = true): Project {
  const score = createInitialScore()
  const piano = makePart('piano', score)
  const parts: Part[] = [demo ? { ...piano, staves: [{ ...piano.staves[0], score }] } : piano]
  if (demo) for (const instrument of ['guitar', 'bass', 'drums'] as const) {
    const part = makePart(instrument, score)
    const pitch: Pitch = instrument === 'bass' ? { step: 'E', octave: 2, alter: 0 }
      : instrument === 'drums' ? { step: 'C', octave: 2, alter: 0 } : { step: 'C', octave: 4, alter: 0 }
    const staff = part.staves[0]
    parts.push({ ...part, staves: [{ ...staff, score: { ...staff.score, measures: staff.score.measures.map(measure => ({ ...measure,
      voices: measure.voices.map(voice => ({ ...voice, events: retime([
        { id: uid(), kind: 'note', pitch, start: ZERO, duration: { n: 1, d: 4 } }, ...rests({ n: 3, d: 4 }),
      ]) })),
    })) } }] })
  }
  return { version: 2, title: demo ? 'PocketScore 앙상블' : '새 악보', parts, tempos: [{ measure: 0, bpm: 100 }], masterVolume: 0.7 }
}

export function staffAt(project: Project, selection: Pick<ProjectSelection, 'partId' | 'staffId'>) {
  const part = project.parts.find(item => item.id === selection.partId)
  const staff = part?.staves.find(item => item.id === selection.staffId)
  if (!part || !staff) throw new Error('악기 또는 오선지를 찾을 수 없습니다.')
  return { part, staff }
}
export function updateStaff(project: Project, staffId: string, transform: (staff: Staff) => Staff): Project {
  return { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => {
    if (staff.id !== staffId) return staff
    const next = transform(staff)
    return { ...next, score: reconcileTieEdits(staff.score, next.score) }
  }) })) }
}
export function reconcileProjectTies(before: Project, after: Project): Project {
  if (before === after) return after
  let changed = false
  const parts = after.parts.map(part => {
    let touched = false
    const staves = part.staves.map(staff => {
      const previous = before.parts.find(item => item.id === part.id)?.staves.find(item => item.id === staff.id)
      const score = previous ? reconcileTieEdits(previous.score, staff.score) : staff.score
      if (score === staff.score) return staff
      changed = true; touched = true; return { ...staff, score }
    })
    return touched ? { ...part, staves } : part
  })
  return changed ? { ...after, parts } : after
}
export function allSelections(project: Project): ProjectSelection[] {
  return project.parts.flatMap(part => part.staves.flatMap(staff => staff.score.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => ({ partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventId: event.id }))))))
}

export function validateProject(project: Project): string[] {
  const errors: string[] = []
  if (project.version !== 2) errors.push('지원하지 않는 프로젝트 버전')
  if (!project.title.trim() || project.title.length > 200) errors.push('제목은 1–200자여야 합니다.')
  if (project.parts.length < 1 || project.parts.length > 15) errors.push('악기는 1–15개까지 지원합니다.')
  if (project.parts.filter(part => part.instrument === 'drums').length > 1) errors.push('Alpha는 드럼 악기 1개를 지원합니다. 추가 타악기는 같은 악기의 오선지·성부로 작성하세요.')
  if (!Number.isFinite(project.masterVolume) || project.masterVolume < 0 || project.masterVolume > 1) errors.push('잘못된 마스터 볼륨')
  const template = project.parts[0]?.staves[0]?.score
  if (!template) return [...errors, '오선지가 없습니다.']
  const ids = new Set<string>()
  const identity = (id: string) => { if (!id || ids.has(id)) errors.push('중복 또는 빈 구조 ID'); ids.add(id) }
  let totalEvents = 0
  for (const part of project.parts) {
    identity(part.id)
    if (!(part.instrument in INSTRUMENTS)) errors.push('지원하지 않는 악기')
    if (!part.name.trim() || part.name.length > 100) errors.push('잘못된 악기 이름')
    if (part.staves.length < 1 || part.staves.length > 4) errors.push('악기당 오선지는 1–4개까지 지원합니다.')
    const mix = part.mixer
    if (part.instrument === 'drums' && mix.program !== 0) errors.push('Alpha 드럼은 GM Standard Kit (1번)을 사용합니다.')
    if (!Number.isInteger(mix.program) || mix.program < 0 || mix.program > 127 || !Number.isFinite(mix.volume) || mix.volume < 0 || mix.volume > 1
      || !Number.isFinite(mix.pan) || Math.abs(mix.pan) > 1) errors.push('잘못된 믹서 설정')
    for (const staff of part.staves) {
      identity(staff.id)
      if (!['treble', 'bass', 'percussion'].includes(staff.clef)) errors.push('지원하지 않는 음자리표')
      if ((part.instrument === 'drums') !== (staff.clef === 'percussion')) errors.push('드럼은 타악기 음자리표를 사용해야 합니다.')
      const score = staff.score
      if (score.measures.length > 128) errors.push('Alpha는 128마디까지 지원합니다.')
      if (score.keySignature !== template.keySignature || score.timeSignature !== template.timeSignature || score.measures.length !== template.measures.length) errors.push('모든 오선지의 조표·박자·마디 수가 같아야 합니다.')
      errors.push(...validateScore(score))
      const voiceIds = score.measures[0]?.voices.map(voice => voice.id) ?? []
      for (const measure of score.measures) {
        identity(measure.id)
        if (measure.voices.length < 1 || measure.voices.length > 4 || measure.voices.some((voice, i) => voice.id !== voiceIds[i]) || measure.voices.length !== voiceIds.length) errors.push('성부 구조가 마디 사이에서 일치하지 않습니다.')
        for (const voice of measure.voices) for (const event of voice.events) {
          identity(event.id)
          totalEvents++
          const pitches = eventPitches(event)
          if (part.instrument === 'drums' && event.kind === 'note' && event.tieTo?.length) errors.push('타악기 붙임줄은 현재 지원하지 않습니다.')
          if (pitches.length > 8 || new Set(pitches.map(midi)).size !== pitches.length) errors.push('화음은 서로 다른 1–8개의 음이어야 합니다.')
          if (part.instrument === 'drums' && pitches.some(pitch => !DRUMS.some(drum => drum.midi === midi(pitch)))) errors.push('지원하지 않는 드럼 음입니다. 킥·스네어·하이햇을 선택하세요.')
        }
      }
    }
  }
  if (totalEvents > 16000) errors.push('Alpha 프로젝트는 16,000개 이벤트까지 지원합니다.')
  let previous = -1
  for (const tempo of project.tempos) {
    if (!Number.isInteger(tempo.measure) || tempo.measure <= previous || tempo.measure >= template.measures.length || !Number.isInteger(tempo.bpm) || tempo.bpm < 30 || tempo.bpm > 240) errors.push('템포는 마디 순서대로 30–240 BPM을 지정해야 합니다.')
    previous = tempo.measure
  }
  if (project.tempos[0]?.measure !== 0) errors.push('첫 마디의 템포가 필요합니다.')
  return [...new Set(errors)]
}

export const DRUMS = [
  { name: '킥', midi: 36, pitch: { step: 'C', octave: 2, alter: 0 } as Pitch, key: 'f/4' },
  { name: '스네어', midi: 38, pitch: { step: 'D', octave: 2, alter: 0 } as Pitch, key: 'c/5' },
  { name: '닫힌 하이햇', midi: 42, pitch: { step: 'F', octave: 2, alter: 1 } as Pitch, key: 'g/5' },
] as const

export function replaceEvent(project: Project, selection: ProjectSelection, transform: (event: RhythmEvent) => RhythmEvent): Project {
  const { staff } = staffAt(project, selection)
  locate(staff.score, selection)
  return updateStaff(project, staff.id, current => ({ ...current, score: { ...current.score, measures: current.score.measures.map(measure => measure.id !== selection.measureId ? measure : { ...measure,
    voices: measure.voices.map(voice => voice.id !== selection.voiceId ? voice : { ...voice, events: voice.events.map(event => event.id === selection.eventId ? transform(event) : event) }),
  }) } }))
}

// Inserts into a contiguous rest region only. Notes/barlines are never consumed.
export function insertAt(project: Project, target: ProjectSelection, start: Rational, duration: Rational, pitch: Pitch | null): Project {
  const { staff } = staffAt(project, target)
  const measure = staff.score.measures.find(item => item.id === target.measureId)
  const voice = measure?.voices.find(item => item.id === target.voiceId)
  if (!voice) throw new Error('입력할 성부를 선택하세요.')
  const index = voice.events.findIndex(event => compare(event.start, start) <= 0 && compare(add(event.start, event.duration), start) > 0)
  const event = voice.events[index]
  if (!event || event.kind !== 'rest') throw new Error('음표 입력은 빈 쉼표 영역에서 시작해야 합니다.')
  let endIndex = index + 1
  let end = add(event.start, event.duration)
  while (endIndex < voice.events.length && voice.events[endIndex].kind === 'rest') end = add(end, voice.events[endIndex++].duration)
  const noteEnd = add(start, duration)
  if (compare(noteEnd, end) > 0) throw new Error('입력 길이가 다음 음표 또는 마디선을 넘습니다.')
  const replacement: RhythmEvent = { id: uid(), start, duration, ...(pitch ? { kind: 'note', pitch } : { kind: 'rest' }) }
  const events = retime([...voice.events.slice(0, index), ...rests(subtract(start, event.start)), replacement, ...rests(subtract(end, noteEnd)), ...voice.events.slice(endIndex)])
  return updateStaff(project, staff.id, item => ({ ...item, score: { ...item.score, measures: item.score.measures.map(bar => bar.id !== target.measureId ? bar : { ...bar, voices: bar.voices.map(v => v.id === voice.id ? { ...v, events } : v) }) } }))
}
