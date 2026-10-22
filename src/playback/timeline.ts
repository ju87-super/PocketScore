import { eventPitches } from '../music/score'
import { midi } from '../music/pitch'
import { measureDuration, meterParts } from '../music/settings'
import { add, ZERO } from '../music/rational'
import type { Rational } from '../music/rational'
import type { Project, ProjectSelection } from '../project/model'
import { primaryScore, validateProject } from '../project/model'

export type PlayedEvent = { selection: ProjectSelection; start: number; end: number; measure: number }
export type PlayedNote = { partId: string; channel: number; midi: number; startTick: number; endTick: number; start: number; end: number; velocity: number }
export type Timeline = { notes: PlayedNote[]; events: PlayedEvent[]; measureTimes: number[]; duration: number; totalTicks: number; channels: Map<string, number> }
export const ticks = (value: Rational) => {
  const result = value.n * 1920 / value.d
  if (!Number.isSafeInteger(result)) throw new Error('MIDI 격자로 정확하게 표현할 수 없는 리듬입니다.')
  return result
}

export function compileTimeline(project: Project): Timeline {
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  const length = measureDuration(primaryScore(project).timeSignature)
  const measureTimes: number[] = []
  const bpms: number[] = []
  let duration = 0
  let bpm = project.tempos[0].bpm
  for (let i = 0; i < primaryScore(project).measures.length; i++) {
    bpm = project.tempos.find(tempo => tempo.measure === i)?.bpm ?? bpm
    bpms.push(bpm)
    measureTimes.push(duration)
    duration += length.n / length.d * 4 * 60 / bpm
  }
  let melodic = 0
  const channels = new Map<string, number>()
  const events: PlayedEvent[] = []
  const notes: PlayedNote[] = []
  const solo = project.parts.some(part => part.mixer.solo)
  for (const part of project.parts) {
    const channel = part.instrument === 'drums' ? 9 : melodic < 9 ? melodic++ : ++melodic
    channels.set(part.id, channel)
    for (const staff of part.staves) {
      let measureStart = ZERO
      staff.score.measures.forEach((measure, index) => {
        const seconds = (value: Rational) => measureTimes[index] + value.n / value.d * 4 * 60 / bpms[index]
        for (const voice of measure.voices) for (const event of voice.events) {
          const selection = { partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventId: event.id }
          events.push({ selection, start: seconds(event.start), end: seconds(add(event.start, event.duration)), measure: index })
          if (!part.mixer.mute && (!solo || part.mixer.solo)) for (const pitch of eventPitches(event)) notes.push({
            partId: part.id, channel, midi: midi(pitch), velocity: 90,
            start: seconds(event.start), end: seconds(add(event.start, event.duration)),
            startTick: ticks(add(measureStart, event.start)), endTick: ticks(add(measureStart, add(event.start, event.duration))),
          })
        }
        measureStart = add(measureStart, length)
      })
    }
  }
  return { notes: notes.sort((a, b) => a.start - b.start), events, measureTimes, duration, totalTicks: ticks(length) * measureTimes.length, channels }
}

const variable = (value: number): number[] => {
  const result = [value & 127]
  while ((value = Math.floor(value / 128)) > 0) result.unshift((value & 127) | 128)
  return result
}
const big = (value: number, bytes: number) => Array.from({ length: bytes }, (_, i) => Math.floor(value / 256 ** (bytes - i - 1)) & 255)

// Standard MIDI is an adapter into the worklet sequencer, never canonical data.
// The sequencer runs on the audio thread; pause/seek cancel its future traversal.
export function timelineMIDI(project: Project, timeline: Timeline, metronome = false): ArrayBuffer {
  type Message = { tick: number; order: number; bytes: number[] }
  const messages: Message[] = []
  for (const part of project.parts) {
    const channel = timeline.channels.get(part.id)!
    messages.push({ tick: 0, order: -3, bytes: [0xc0 | channel, part.mixer.program] },
      { tick: 0, order: -3, bytes: [0xb0 | channel, 7, Math.round(part.mixer.volume * 127)] },
      { tick: 0, order: -3, bytes: [0xb0 | channel, 10, Math.round((part.mixer.pan + 1) * 63.5)] })
  }
  const length = ticks(measureDuration(primaryScore(project).timeSignature))
  project.tempos.forEach(tempo => messages.push({ tick: tempo.measure * length, order: -2, bytes: [255, 81, 3, ...big(Math.round(60000000 / tempo.bpm), 3)] }))
  // Merge simultaneous/overlapping unisons in the same part so one voice's
  // note-off cannot cut off another voice holding the same MIDI key.
  const merged: PlayedNote[] = []
  for (const note of [...timeline.notes].sort((a, b) => a.channel - b.channel || a.midi - b.midi || a.startTick - b.startTick)) {
    const last = merged.at(-1)
    if (last && last.channel === note.channel && last.midi === note.midi && note.startTick < last.endTick) last.endTick = Math.max(last.endTick, note.endTick)
    else merged.push({ ...note })
  }
  for (const note of merged) {
    messages.push({ tick: note.startTick, order: 1, bytes: [0x90 | note.channel, note.midi, note.velocity] },
      { tick: note.endTick, order: 0, bytes: [0x80 | note.channel, note.midi, 0] })
  }
  if (metronome) {
    const meter = meterParts(primaryScore(project).timeSignature)
    const beatTicks = 1920 / meter.beatValue
    for (let tick = 0; tick < timeline.totalTicks; tick += beatTicks) {
      const key = tick % length === 0 ? 76 : 77
      messages.push({ tick, order: 1, bytes: [0x99, key, 70] }, { tick: tick + 30, order: 0, bytes: [0x89, key, 0] })
    }
  }
  // SpessaSynth measures duration through the last MIDI channel message, not
  // End-of-Track. A real all-notes-off at the score boundary preserves trailing
  // rests, fully silent scores and full-bar loop lengths without a dummy note.
  messages.push({ tick: timeline.totalTicks, order: 2, bytes: [0xb0, 123, 0] })
  messages.push({ tick: timeline.totalTicks, order: 3, bytes: [255, 47, 0] })
  messages.sort((a, b) => a.tick - b.tick || a.order - b.order)
  let previous = 0
  const track: number[] = []
  for (const message of messages) {
    track.push(...variable(message.tick - previous), ...message.bytes)
    previous = message.tick
  }
  return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, ...big(track.length, 4), ...track]).buffer
}
