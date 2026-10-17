import { createInitialScore } from '../../src/music/score'
import type { Score } from '../../src/music/score'

// Test data only. Never changes the product's four-measure starting score.
export function longScore(count: number): Score {
  const original = createInitialScore()
  return { ...original, measures: Array.from({ length: count }, (_, index) => {
    const source = original.measures[index % original.measures.length]
    const id = `m${index + 1}`
    return { ...source, id, voices: source.voices.map(voice => ({ ...voice,
      events: voice.events.map((event, e) => ({ ...event, id: `${id}-e${e + 1}` })),
    })) }
  }) }
}
