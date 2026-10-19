import type { Project } from '../project/model'
import { validateProject } from '../project/model'
import { fraction } from '../music/rational'

function object(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('프로젝트 객체가 올바르지 않습니다.')
  const keys = Object.keys(value)
  if (required.some(key => !keys.includes(key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) throw new Error(`알 수 없거나 누락된 프로젝트 필드: ${keys.join(', ')}`)
}
function list(value: unknown, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('프로젝트 목록 크기가 올바르지 않습니다.')
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 200) throw new Error('프로젝트 문자열이 올바르지 않습니다.')
}
function number(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('프로젝트 숫자가 올바르지 않습니다.')
}
function rational(value: unknown) {
  object(value, ['n', 'd'])
  if (!Number.isSafeInteger(value.n) || !Number.isSafeInteger(value.d) || Number(value.d) <= 0) throw new Error('정확한 분수만 지원합니다.')
  const reduced = fraction(Number(value.n), Number(value.d))
  if (reduced.n !== value.n || reduced.d !== value.d) throw new Error('프로젝트 분수는 기약분수로 저장해야 합니다.')
}
function pitch(value: unknown) {
  object(value, ['step', 'octave', 'alter'])
  text(value.step); number(value.octave); number(value.alter)
}
export function parseProject(source: string): Project {
  if (source.length > 5_000_000) throw new Error('프로젝트 파일은 5 MB까지 지원합니다.')
  const data: unknown = JSON.parse(source)
  object(data, ['version', 'title', 'parts', 'tempos', 'masterVolume'])
  if (data.version !== 2) throw new Error('PocketScore 2 프로젝트 파일이 필요합니다.')
  text(data.title); number(data.masterVolume); list(data.parts, 15); list(data.tempos, 128)
  for (const tempo of data.tempos) { object(tempo, ['measure', 'bpm']); number(tempo.measure); number(tempo.bpm) }
  for (const part of data.parts) {
    object(part, ['id', 'name', 'instrument', 'mixer', 'staves'])
    text(part.id); text(part.name); text(part.instrument); list(part.staves, 4)
    object(part.mixer, ['program', 'volume', 'pan', 'mute', 'solo'])
    number(part.mixer.program); number(part.mixer.volume); number(part.mixer.pan)
    if (typeof part.mixer.mute !== 'boolean' || typeof part.mixer.solo !== 'boolean') throw new Error('믹서 스위치가 올바르지 않습니다.')
    for (const staff of part.staves) {
      object(staff, ['id', 'name', 'clef', 'score'])
      text(staff.id); text(staff.name); text(staff.clef)
      object(staff.score, ['keySignature', 'timeSignature', 'measures'])
      number(staff.score.keySignature); text(staff.score.timeSignature); list(staff.score.measures, 128)
      for (const measure of staff.score.measures) {
        object(measure, ['id', 'voices']); text(measure.id); list(measure.voices, 4)
        for (const voice of measure.voices) {
          object(voice, ['id', 'events']); text(voice.id); list(voice.events, 24)
          for (const event of voice.events) {
            if (!event || typeof event !== 'object') throw new Error('이벤트가 올바르지 않습니다.')
            const kind = (event as Record<string, unknown>).kind
            object(event, kind === 'note' ? ['id', 'kind', 'start', 'duration', 'pitch'] : ['id', 'kind', 'start', 'duration'], kind === 'note' ? ['chord'] : [])
            if (kind !== 'note' && kind !== 'rest') throw new Error('지원하지 않는 이벤트 형식입니다.')
            text(event.id); rational(event.start); rational(event.duration)
            if (kind === 'note') { pitch(event.pitch); if (event.chord !== undefined) { list(event.chord, 7); event.chord.forEach(pitch) } }
          }
        }
      }
    }
  }
  const project = data as unknown as Project
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  return project
}
export function serializeProject(project: Project): string {
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  return JSON.stringify(project, null, 2)
}
export function download(source: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([source], { type }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
