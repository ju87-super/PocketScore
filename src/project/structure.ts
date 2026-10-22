import { blankScore, primaryScore, rests, uid, updateStaff } from './model'
import type { Project } from './model'
import { measureDuration } from '../music/settings'

export function addStaff(project: Project, partId: string): Project {
  return { ...project, parts: project.parts.map(part => part.id !== partId ? part : { ...part,
    staves: [...part.staves, { ...part.staves[0], id: uid(), name: `${part.name} ${part.staves.length + 1}`, score: blankScore(primaryScore(project)) }],
  }) }
}
export function addVoice(project: Project, staffId: string): Project {
  const voiceId = uid()
  return updateStaff(project, staffId, staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map(measure => ({ ...measure,
    voices: [...measure.voices, { id: voiceId, events: rests(measureDuration(staff.score.timeSignature)) }],
  })) } }))
}
export function removeVoice(project: Project, staffId: string, voiceId: string): Project {
  return updateStaff(project, staffId, staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map(measure => ({ ...measure, voices: measure.voices.filter(voice => voice.id !== voiceId) })) } }))
}
export function addMeasure(project: Project): Project {
  return { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
    measures: [...staff.score.measures, { id: uid(), voices: staff.score.measures[0].voices.map(voice => ({ id: voice.id, events: rests(measureDuration(staff.score.timeSignature)) })) }],
  } })) })) }
}
export function removeMeasure(project: Project, index: number): Project {
  if (primaryScore(project).measures.length === 1) throw new Error('마지막 마디는 삭제할 수 없습니다.')
  if (index < 0 || index >= primaryScore(project).measures.length) throw new Error('삭제할 마디를 선택하세요.')
  // Keep the effective tempo at the surviving measure that follows deletion.
  const oldTempos = project.tempos
  const effective = [...oldTempos].reverse().find(tempo => tempo.measure <= index + 1)?.bpm ?? oldTempos[0].bpm
  const tempos = oldTempos.filter(tempo => tempo.measure !== index).map(tempo => ({ ...tempo, measure: tempo.measure > index ? tempo.measure - 1 : tempo.measure }))
  if (!tempos.some(tempo => tempo.measure === index) && index < primaryScore(project).measures.length - 1) tempos.push({ measure: index, bpm: effective })
  return { ...project, tempos: tempos.sort((a, b) => a.measure - b.measure), parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.filter((_, i) => i !== index) } })) })) }
}
