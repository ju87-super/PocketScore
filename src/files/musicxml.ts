import { eventPitches, DURATIONS, retime } from '../music/score'
import type { RhythmEvent, Score } from '../music/score'
import { add, compare, equal, fraction, subtract, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import { midi } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { measureDuration, meterParts, TIME_SIGNATURES } from '../music/settings'
import type { TimeSignature } from '../music/settings'
import { DRUMS, primaryScore, rests, uid, validateProject } from '../project/model'
import type { Clef, Instrument, Part, Project, Staff } from '../project/model'
import { tieLinks } from '../music/ties'

const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!)
const units = (value: Rational) => value.n * 64 / value.d
const typeNames: Record<number, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' }

export function exportMusicXML(project: Project): string {
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  const score = primaryScore(project)
  const meter = meterParts(score.timeSignature)
  const stops = new Set(project.parts.flatMap(part => part.staves.flatMap(staff => tieLinks(staff.score).map(link => JSON.stringify([link.to.event.id, link.midi])))))
  const partList = project.parts.map((part, index) => {
    const id = `P${index + 1}`
    const instruments = part.instrument === 'drums' ? DRUMS.map(drum => `<score-instrument id="${id}-D${drum.midi}"><instrument-name>${escape(drum.name)}</instrument-name></score-instrument>`).join('')
      : `<score-instrument id="${id}-I"><instrument-name>${escape(part.name)}</instrument-name></score-instrument>`
    const midi = (instrumentId: string, unpitched?: number) => `<midi-instrument id="${instrumentId}"><midi-channel>${part.instrument === 'drums' ? 10 : index < 9 ? index + 1 : index + 2}</midi-channel><midi-program>${part.mixer.program + 1}</midi-program>${unpitched ? `<midi-unpitched>${unpitched + 1}</midi-unpitched>` : ''}<volume>${part.mixer.volume * 100}</volume><pan>${part.mixer.pan * 180}</pan></midi-instrument>`
    return `<score-part id="${id}"><part-name>${escape(part.name)}</part-name>${instruments}${part.instrument === 'drums' ? DRUMS.map(drum => midi(`${id}-D${drum.midi}`, drum.midi)).join('') : midi(`${id}-I`)}</score-part>`
  }).join('')
  const parts = project.parts.map((part, partIndex) => `<part id="P${partIndex + 1}">${score.measures.map((_, measureIndex) => {
    let body = ''
    if (measureIndex === 0) body += `<attributes><divisions>16</divisions><key><fifths>${score.keySignature}</fifths></key><time><beats>${meter.beats}</beats><beat-type>${meter.beatValue}</beat-type></time><staves>${part.staves.length}</staves>${part.staves.map((staff, i) => `<clef number="${i + 1}"><sign>${staff.clef === 'bass' ? 'F' : staff.clef === 'percussion' ? 'percussion' : 'G'}</sign>${staff.clef === 'percussion' ? '' : `<line>${staff.clef === 'bass' ? 4 : 2}</line>`}</clef>`).join('')}</attributes>`
    const tempo = project.tempos.find(item => item.measure === measureIndex)
    if (tempo) body += `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo.bpm}</per-minute></metronome></direction-type><sound tempo="${tempo.bpm}"/></direction>`
    let stream = 0
    part.staves.forEach((staff, staffIndex) => staff.score.measures[measureIndex].voices.forEach((voice, voiceIndex) => {
      if (stream++) body += `<backup><duration>${units(measureDuration(score.timeSignature))}</duration></backup>`
      voice.events.forEach(event => {
        const pitches = eventPitches(event)
        const tones: (Pitch | null)[] = pitches.length ? [...pitches] : [null]
        tones.forEach((pitch, toneIndex) => {
          const dotted = event.duration.n === 3
          const type = typeNames[event.duration.d / (dotted ? 2 : 1)]
          const drum = pitch && part.instrument === 'drums' ? DRUMS.find(item => item.midi === midi(pitch)) : undefined
          const display = drum?.key.split('/')
          const tieTypes = pitch ? [...(stops.has(JSON.stringify([event.id, midi(pitch)])) ? ['stop'] : []), ...(event.kind === 'note' && event.tieTo?.includes(midi(pitch)) ? ['start'] : [])] : []
          const ties = tieTypes.map(type => `<tie type="${type}"/>`).join('')
          const notations = tieTypes.length ? `<notations>${tieTypes.map(type => `<tied type="${type}"/>`).join('')}</notations>` : ''
          body += `<note>${toneIndex ? '<chord/>' : ''}${!pitch ? '<rest/>' : drum ? `<unpitched><display-step>${display![0].toUpperCase()}</display-step><display-octave>${display![1]}</display-octave></unpitched>` : `<pitch><step>${pitch.step}</step><alter>${pitch.alter}</alter><octave>${pitch.octave}</octave></pitch>`}<duration>${units(event.duration)}</duration>${ties}${pitch ? `<instrument id="P${partIndex + 1}-${drum ? `D${drum.midi}` : 'I'}"/>` : ''}<voice>${staffIndex * 4 + voiceIndex + 1}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staffIndex + 1}</staff>${notations}</note>`
        })
      })
    }))
    return `<measure number="${measureIndex + 1}">${body}</measure>`
  }).join('')}</part>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${escape(project.title)}</work-title></work><part-list>${partList}</part-list>${parts}</score-partwise>`
}

const children = (element: Element, name: string) => [...element.children].filter(child => child.tagName === name)
const child = (element: Element, name: string) => children(element, name)[0]
const value = (element: Element, name: string) => child(element, name)?.textContent?.trim()
const numeric = (element: Element, name: string, fallback?: number) => {
  const source = value(element, name)
  const number = source === undefined ? fallback : Number(source)
  if (number === undefined || !Number.isFinite(number) || source === '') throw new Error(`MusicXML ${name} 숫자가 올바르지 않습니다.`)
  return number
}

// Deliberately strict Alpha subset: anything outside this vocabulary is rejected
// before constructing a project, including tuplets and ornamental notation.
export function importMusicXML(source: string): Project {
  if (source.length > 5_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('외부 엔티티·DOCTYPE 또는 5 MB가 넘는 MusicXML은 지원하지 않습니다.')
  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'score-partwise') throw new Error('올바른 partwise MusicXML이 아닙니다.')
  const allowed = new Set('score-partwise work work-title part-list score-part part-name score-instrument instrument-name midi-instrument midi-channel midi-program midi-unpitched volume pan part measure attributes divisions key fifths time beats beat-type staves clef sign line direction direction-type metronome beat-unit per-minute sound note chord rest pitch step alter octave unpitched display-step display-octave duration instrument voice type dot staff backup forward tie notations tied'.split(' '))
  const hierarchy: Record<string, string[]> = {
    'score-partwise': ['work', 'part-list', 'part'], work: ['work-title'], 'part-list': ['score-part'],
    'score-part': ['part-name', 'score-instrument', 'midi-instrument'], 'score-instrument': ['instrument-name'],
    'midi-instrument': ['midi-channel', 'midi-program', 'midi-unpitched', 'volume', 'pan'],
    part: ['measure'], measure: ['attributes', 'direction', 'note', 'backup', 'forward'],
    attributes: ['divisions', 'key', 'time', 'staves', 'clef'], key: ['fifths'], time: ['beats', 'beat-type'], clef: ['sign', 'line'],
    direction: ['direction-type', 'sound'], 'direction-type': ['metronome'], metronome: ['beat-unit', 'per-minute'],
    note: ['chord', 'rest', 'pitch', 'unpitched', 'duration', 'tie', 'instrument', 'voice', 'type', 'dot', 'staff', 'notations'], notations: ['tied'],
    pitch: ['step', 'alter', 'octave'], unpitched: ['display-step', 'display-octave'], backup: ['duration'], forward: ['duration'],
  }
  const multiple = new Set(['score-partwise:part', 'part-list:score-part', 'score-part:score-instrument', 'score-part:midi-instrument', 'part:measure', 'measure:attributes', 'measure:direction', 'measure:note', 'measure:backup', 'measure:forward', 'attributes:clef', 'note:tie', 'notations:tied'])
  for (const element of [...xml.querySelectorAll('*')]) {
    if (!allowed.has(element.tagName)) throw new Error(`Alpha에서 지원하지 않는 MusicXML 요소: ${element.tagName}. 파일을 변경하지 않았습니다.`)
    const seen = new Set<string>()
    for (const item of [...element.children]) {
      if (!(hierarchy[element.tagName] ?? []).includes(item.tagName) || (seen.has(item.tagName) && !multiple.has(`${element.tagName}:${item.tagName}`))) throw new Error(`지원하지 않는 MusicXML 구조: ${element.tagName}/${item.tagName}`)
      seen.add(item.tagName)
    }
    const attributes = element.tagName === 'score-partwise' ? ['version'] : ['part', 'score-part', 'score-instrument', 'midi-instrument', 'instrument'].includes(element.tagName) ? ['id'] : ['measure', 'clef'].includes(element.tagName) ? ['number'] : element.tagName === 'sound' ? ['tempo'] : ['tie', 'tied'].includes(element.tagName) ? ['type'] : []
    for (const attribute of [...element.attributes]) if (!attributes.includes(attribute.name)) throw new Error(`지원하지 않는 MusicXML 속성: ${attribute.name}`)
  }
  const root = xml.documentElement
  const list = child(root, 'part-list')
  const partElements = children(root, 'part')
  if (!list || !partElements.length || partElements.length > 15 || children(list, 'score-part').length !== partElements.length) throw new Error('MusicXML 악기 목록이 올바르지 않습니다.')
  if (new Set(partElements.map(part => part.id)).size !== partElements.length || new Set(children(list, 'score-part').map(part => part.id)).size !== partElements.length) throw new Error('MusicXML 악기 ID가 중복되었습니다.')
  let globalKey: number | undefined
  let globalTime: TimeSignature | undefined
  let globalMeasures = 0
  const tempos = new Map<number, number>()
  const parts: Part[] = partElements.map(partElement => {
    const description = children(list, 'score-part').find(item => item.id === partElement.id)
    if (!description) throw new Error('MusicXML 악기 ID가 일치하지 않습니다.')
    const midiInstrument = child(description, 'midi-instrument')
    const program = midiInstrument ? numeric(midiInstrument, 'midi-program', 1) - 1 : 0
    const isDrums = children(description, 'midi-instrument').some(item => child(item, 'midi-unpitched'))
    const instrument: Instrument = isDrums ? 'drums' : program === 27 ? 'guitar' : program === 33 ? 'bass' : 'piano'
    const measures = children(partElement, 'measure')
    if (!measures.length || measures.length > 128) throw new Error('Alpha는 1–128마디를 지원합니다.')
    const attributes = measures[0] && child(measures[0], 'attributes')
    if (!attributes || !child(attributes, 'time') || !child(attributes, 'key')) throw new Error('첫 마디에 조표·박자표가 필요합니다.')
    const key = numeric(child(attributes, 'key')!, 'fifths')
    const time = `${numeric(child(attributes, 'time')!, 'beats')}/${numeric(child(attributes, 'time')!, 'beat-type')}` as TimeSignature
    if (!TIME_SIGNATURES.includes(time)) throw new Error('지원하지 않는 MusicXML 박자표입니다.')
    if (globalKey !== undefined && (globalKey !== key || globalTime !== time || globalMeasures !== measures.length)) throw new Error('악기 사이의 조표·박자·마디 수가 일치하지 않습니다.')
    globalKey = key; globalTime = time; globalMeasures = measures.length
    const count = numeric(attributes, 'staves', 1)
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('악기당 1–4개 오선지만 지원합니다.')
    const clefs: Clef[] = Array.from({ length: count }, (_, i) => {
      const clef = children(attributes, 'clef').find(item => Number(item.getAttribute('number') ?? 1) === i + 1)
      const sign = clef && value(clef, 'sign')
      if (sign === 'percussion') return 'percussion'
      if (sign === 'G' && numeric(clef!, 'line') === 2) return 'treble'
      if (sign === 'F' && numeric(clef!, 'line') === 4) return 'bass'
      throw new Error('Alpha는 높은·낮은·타악기 음자리표를 지원합니다.')
    })
    let divisions = numeric(attributes, 'divisions')
    if (!Number.isSafeInteger(divisions) || divisions <= 0 || divisions > 10080) throw new Error('잘못된 MusicXML divisions')
    const voiceIds = new Map<string, string>()
    const streams: Map<string, RhythmEvent[]>[] = []
    const openTies = new Map<string, Rational>()
    const duration = measureDuration(time)
    measures.forEach((measure, measureIndex) => {
      const current = new Map<string, RhythmEvent[]>()
      let cursor: Rational = ZERO
      for (const element of [...measure.children]) {
        if (element.tagName === 'attributes') {
          if (measureIndex > 0 && (child(element, 'key') || child(element, 'time') || child(element, 'clef') || child(element, 'staves'))) throw new Error('마디 중간의 조표·박자·음자리표 변경은 Alpha에서 지원하지 않습니다.')
          divisions = numeric(element, 'divisions', divisions)
          if (!Number.isSafeInteger(divisions) || divisions <= 0 || divisions > 10080) throw new Error('잘못된 MusicXML divisions')
        } else if (element.tagName === 'direction') {
          const sound = child(element, 'sound')
          const beatUnit = element.querySelector('beat-unit')?.textContent
          const bpm = Number(sound?.getAttribute('tempo') ?? element.querySelector('per-minute')?.textContent)
          if ((beatUnit && beatUnit !== 'quarter') || !Number.isInteger(bpm) || !equal(cursor, ZERO)) throw new Error('템포는 마디 시작의 4분음표 BPM만 지원합니다.')
          if (tempos.has(measureIndex) && tempos.get(measureIndex) !== bpm) throw new Error('악기 사이 템포가 일치하지 않습니다.')
          tempos.set(measureIndex, bpm)
        } else if (element.tagName === 'backup' || element.tagName === 'forward') {
          const amount = fraction(numeric(element, 'duration'), divisions * 4)
          cursor = element.tagName === 'backup' ? subtract(cursor, amount) : add(cursor, amount)
          if (compare(cursor, ZERO) < 0 || compare(cursor, duration) > 0) throw new Error('MusicXML 시간 이동이 마디를 넘습니다.')
        } else if (element.tagName === 'note') {
          const length = fraction(numeric(element, 'duration'), divisions * 4)
          if (!DURATIONS.some(item => equal(item, length))) throw new Error('연음표 또는 지원하지 않는 음표 길이가 있습니다.')
          const type = value(element, 'type')
          const dotted = length.n === 3
          if (type && (type !== typeNames[length.d / (dotted ? 2 : 1)] || children(element, 'dot').length !== Number(dotted))) throw new Error('MusicXML 음표 모양과 실제 길이가 일치하지 않습니다.')
          const staffIndex = numeric(element, 'staff', 1) - 1
          if (!Number.isInteger(staffIndex) || staffIndex < 0 || staffIndex >= count) throw new Error('잘못된 MusicXML 오선지')
          const streamKey = `${staffIndex}:${value(element, 'voice') ?? '1'}`
          const events = current.get(streamKey) ?? []
          const pitched = child(element, 'pitch')
          const unpitched = child(element, 'unpitched')
          const rest = child(element, 'rest')
          if (Number(!!pitched) + Number(!!unpitched) + Number(!!rest) !== 1) throw new Error('MusicXML 음표 종류가 올바르지 않습니다.')
          let pitch: Pitch | null = null
          if (pitched) pitch = { step: value(pitched, 'step') as Pitch['step'], octave: numeric(pitched, 'octave'), alter: numeric(pitched, 'alter', 0) as Pitch['alter'] }
          if (unpitched) {
            const sourceId = child(element, 'instrument')?.id
            const sourceMidi = children(description, 'midi-instrument').find(item => item.id === sourceId)
            const drum = sourceMidi && DRUMS.find(item => item.midi === numeric(sourceMidi, 'midi-unpitched') - 1)
            if (!drum) throw new Error('지원하지 않는 타악기 음입니다.')
            pitch = drum.pitch
          }
          const sounding = children(element, 'tie').map(tie => tie.getAttribute('type'))
          const visible = child(element, 'notations') ? children(child(element, 'notations')!, 'tied').map(tie => tie.getAttribute('type')) : []
          for (const types of [sounding, visible]) if (types.some(type => type !== 'start' && type !== 'stop') || new Set(types).size !== types.length) throw new Error('지원하지 않거나 중복된 MusicXML 붙임줄입니다.')
          if (sounding.length && visible.length && (sounding.length !== visible.length || sounding.some(type => !visible.includes(type)))) throw new Error('MusicXML 재생 붙임줄과 표시 붙임줄이 일치하지 않습니다.')
          const types = sounding.length ? sounding : visible
          if (types.length && (!pitch || isDrums)) throw new Error('쉼표·타악기 붙임줄은 지원하지 않습니다.')
          const start = child(element, 'chord') ? events.at(-1)?.start : cursor
          if (!start) throw new Error('붙임줄의 선행 화음이 없습니다.')
          const absolute = add(fraction(duration.n * measureIndex, duration.d), start)
          const tieKey = JSON.stringify([streamKey, pitch ? midi(pitch) : null])
          if (types.includes('stop')) {
            const end = openTies.get(tieKey)
            if (!end || !equal(end, absolute)) throw new Error('MusicXML 붙임줄의 시작·끝 또는 음높이·성부가 일치하지 않습니다.')
            openTies.delete(tieKey)
          } else if (openTies.has(tieKey)) throw new Error('MusicXML 붙임줄의 끝 표시가 누락되었습니다.')
          if (types.includes('start')) openTies.set(tieKey, add(absolute, length))
          if (child(element, 'chord')) {
            const previous = events.at(-1)
            if (!pitch || previous?.kind !== 'note' || !equal(previous.duration, length) || !equal(add(previous.start, previous.duration), cursor) || element.previousElementSibling?.tagName !== 'note') throw new Error('화음의 길이 또는 선행 음표가 올바르지 않습니다.')
            events[events.length - 1] = { ...previous, chord: [...(previous.chord ?? []), pitch], ...(types.includes('start') ? { tieTo: [...(previous.tieTo ?? []), midi(pitch)] } : {}) }
          } else {
            events.push({ id: uid(), start: cursor, duration: length, ...(pitch ? { kind: 'note', pitch, ...(types.includes('start') ? { tieTo: [midi(pitch)] } : {}) } : { kind: 'rest' }) })
            cursor = add(cursor, length)
          }
          current.set(streamKey, events)
          if (!voiceIds.has(streamKey)) voiceIds.set(streamKey, uid())
        } else throw new Error(`지원하지 않는 마디 요소: ${element.tagName}`)
      }
      streams.push(current)
    })
    if (openTies.size) throw new Error('MusicXML 붙임줄의 끝 표시가 누락되었습니다.')
    const staves: Staff[] = clefs.map((clef, index) => {
      const keys = [...voiceIds.keys()].filter(key => key.startsWith(`${index}:`))
      if (!keys.length || keys.length > 4) throw new Error('오선지당 1–4개 성부가 필요합니다.')
      const score: Score = { keySignature: key, timeSignature: time, measures: streams.map(current => ({ id: uid(), voices: keys.map(key => {
        let end = ZERO
        const filled: RhythmEvent[] = []
        for (const event of current.get(key) ?? []) {
          if (compare(event.start, end) < 0) throw new Error('같은 성부의 음표가 겹칩니다.')
          filled.push(...rests(subtract(event.start, end)), event)
          end = add(event.start, event.duration)
        }
        if (compare(end, duration) > 0) throw new Error('음표가 마디 길이를 넘습니다.')
        filled.push(...rests(subtract(duration, end)))
        return { id: voiceIds.get(key)!, events: retime(filled) }
      }) })) }
      return { id: uid(), name: `${value(description, 'part-name') ?? '악기'} ${index + 1}`, clef, score }
    })
    return { id: uid(), name: value(description, 'part-name') ?? '악기', instrument, staves, mixer: { program, volume: midiInstrument ? numeric(midiInstrument, 'volume', 80) / 100 : 0.8, pan: midiInstrument ? numeric(midiInstrument, 'pan', 0) / 180 : 0, mute: false, solo: false } }
  })
  if (!tempos.has(0)) tempos.set(0, 100)
  const project: Project = { version: 2, title: root.querySelector('work-title')?.textContent ?? '가져온 악보', parts, tempos: [...tempos].sort((a, b) => a[0] - b[0]).map(([measure, bpm]) => ({ measure, bpm })), masterVolume: 0.7 }
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  return project
}
