import type { Pitch } from './pitch'
import { compare, equal } from './rational'
import { eventPitches } from './score'
import type { Measure } from './score'
import { keyAlter } from './settings'

// Local to a measure and written step/octave, shared by voices. Conflicting
// simultaneous alterations are explicit; the next use must disambiguate too.
export function measureAccidentals(measure: Measure, key: number, continuations: ReadonlySet<string> = new Set()): Map<string, Pitch['alter']> {
  const result = new Map<string, Pitch['alter']>()
  const active = new Map<string, Pitch['alter'] | null>()
  const notes = measure.voices.flatMap(voice => voice.events.flatMap(event => eventPitches(event).map((pitch, index) => ({
    id: index === 0 ? event.id : `${event.id}:${index}`, start: event.start, pitch,
  })))).sort((a, b) => compare(a.start, b.start))
  for (let index = 0; index < notes.length;) {
    let end = index + 1
    while (end < notes.length && equal(notes[index].start, notes[end].start)) end++
    const simultaneous = notes.slice(index, end)
    for (const event of simultaneous) {
      if (continuations.has(event.id)) continue
      const { step, octave, alter } = event.pitch
      const identity = `${step}/${octave}`
      const previous = active.has(identity) ? active.get(identity) : keyAlter(key, step)
      const conflict = simultaneous.some(other => other.pitch.step === step && other.pitch.octave === octave && other.pitch.alter !== alter)
      if (conflict || previous !== alter) result.set(event.id, alter)
    }
    for (const event of simultaneous) {
      if (continuations.has(event.id)) continue
      const { step, octave, alter } = event.pitch
      const conflict = simultaneous.some(other => other.pitch.step === step && other.pitch.octave === octave && other.pitch.alter !== alter)
      active.set(`${step}/${octave}`, conflict ? null : alter)
    }
    index = end
  }
  return result
}
