import { Accidental, BarlineType, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura'
import { eventName, eventPitches } from '../music/score'
import type { Measure, Score, Selection } from '../music/score'
import { measureAccidentals } from '../music/accidentals'
import { KEY_LABELS, KEY_NAMES, meterParts } from '../music/settings'
import { midi } from '../music/pitch'
import { tiedContinuations, tieLinks } from '../music/ties'
import { drawTies } from './ties'

type Target = { note: SVGElement | undefined; hit: SVGRectElement; staveNote: StaveNote }
type RenderedMeasure = { model: Measure; incoming: string; group: SVGGElement; targets: Map<string, Target> }
type RenderedScore = {
  renderer: Renderer; svg: SVGSVGElement; layout: string; score: Score
  measures: RenderedMeasure[]; targets: Map<string, Target>; selected: string | null
}
// Exactly one current rendering per live container. No score/history snapshots
// are retained here; immutable measure references determine invalidation.
const renderedScores = new WeakMap<HTMLDivElement, RenderedScore>()

export function disposeScoreRenderer(container: HTMLDivElement) {
  renderedScores.delete(container)
  container.replaceChildren()
}

export type RenderOptions = { clef?: 'treble' | 'bass' | 'percussion'; continuous?: boolean; targetScale?: number }
export function renderScore(container: HTMLDivElement, score: Score, selection: Selection | null, availableWidth: number, options: RenderOptions = {}) {
  const clef = options.clef ?? 'treble'
  const targetScale = options.targetScale ?? 1
  const targetWidth = 44 / targetScale
  const targetHeight = 48 / targetScale
  const mostEvents = Math.max(...score.measures.flatMap(measure => measure.voices.map(voice => voice.events.length)))
  const minimum = Math.max(310, mostEvents * 46 + 120 + Math.abs(score.keySignature) * 12)
  const columns = options.continuous ? score.measures.length : availableWidth >= Math.max(1000, minimum * 2) ? 2 : 1
  const width = options.continuous ? Math.max(availableWidth, minimum * columns) : Math.max(availableWidth, minimum)
  const measureWidth = (width - 16) / columns
  const height = Math.ceil(score.measures.length / columns) * 220
  const layout = `${width}/${columns}/${height}/${score.keySignature}/${score.timeSignature}/${clef}/${targetScale}`
  let cache = renderedScores.get(container)
  if (!cache || cache.layout !== layout || cache.measures.length !== score.measures.length
    || cache.measures.some((item, i) => item.model.id !== score.measures[i].id)) {
    disposeScoreRenderer(container)
    const renderer = new Renderer(container, Renderer.Backends.SVG)
    renderer.resize(width, height)
    const svg = container.querySelector('svg')!
    svg.setAttribute('role', 'group')
    svg.setAttribute('aria-label', `${clef === 'bass' ? '낮은음자리표' : clef === 'percussion' ? '타악기 음자리표' : '높은음자리표'} ${KEY_LABELS[score.keySignature + 7]} ${score.timeSignature}박자 악보 ${score.measures.length}마디`)
    cache = { renderer, svg, layout, score, measures: [], targets: new Map(), selected: null }
    renderedScores.set(container, cache)
  } else if (cache.score === score && cache.selected === (selection?.eventId ?? null)) return

  const context = cache.renderer.getContext()
  const { beats, beatValue } = meterParts(score.timeSignature)
  const continuations = tiedContinuations(score)
  let repainted = false
  score.measures.forEach((measure, measureIndex) => {
    const previous = cache.measures[measureIndex]
    const incoming = JSON.stringify(measure.voices.flatMap(voice => voice.events.flatMap(event => eventPitches(event).flatMap((_, i) => {
      const key = i ? `${event.id}:${i}` : event.id; return continuations.has(key) ? [key] : []
    }))))
    if (previous?.model === measure && previous.incoming === incoming) return
    repainted = true
    context.setFont('system-ui', 12)
    const group: SVGGElement = context.openGroup('measure')
    group.setAttribute('data-rendered-measure', measure.id)
    const x = 8 + (measureIndex % columns) * measureWidth
    const y = 32 + Math.floor(measureIndex / columns) * 220
    context.fillText(`${measureIndex + 1}`, x + 8, y + 5)
    const stave = new Stave(x, y, measureWidth)
    const systemStart = measureIndex % columns === 0
    if (systemStart) {
      stave.addClef(clef)
      if (clef !== 'percussion') stave.addKeySignature(KEY_NAMES[score.keySignature + 7])
    }
    if (measureIndex === 0) stave.addTimeSignature(score.timeSignature)
    if (measureIndex === score.measures.length - 1) stave.setEndBarType(BarlineType.END)
    stave.setContext(context).draw()
    const entry = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    entry.setAttribute('x', String(stave.getNoteStartX()))
    entry.setAttribute('y', String(y + 12))
    entry.setAttribute('width', String(stave.getNoteEndX() - stave.getNoteStartX()))
    entry.setAttribute('height', '100')
    entry.setAttribute('class', 'entry-target')
    entry.dataset.entryMeasure = measure.id
    entry.dataset.staffY = String(stave.getYForLine(4))
    group.append(entry)
    const staveElement = stave.getSVGElement()
    staveElement?.setAttribute('data-stave-measure', measure.id)
    staveElement?.setAttribute('data-system-start', String(systemStart))
    const accidentals = measureAccidentals(measure, score.keySignature, continuations)
    const rendered = measure.voices.map(voice => {
      const notes = voice.events.map(event => {
        const dotted = event.duration.n === 3
        const denominator = event.duration.d / (dotted ? 2 : 1)
        const durations: Record<number, string> = { 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16', 32: '32', 64: '64' }
        const keys = eventPitches(event).map(pitch => clef === 'percussion'
          ? ({ 36: 'f/4', 38: 'c/5', 42: 'g/5' }[midi(pitch)] ?? 'b/4')
          : `${pitch.step.toLowerCase()}${pitch.alter === 1 ? '#' : pitch.alter === -1 ? 'b' : ''}/${pitch.octave}`)
        const note = new StaveNote({ clef, keys: keys.length ? keys : [clef === 'bass' ? 'd/3' : 'b/4'], duration: durations[denominator], dots: dotted ? 1 : 0, type: event.kind === 'rest' ? 'r' : 'n', autoStem: true, stemDirection: measure.voices.length > 1 ? (measure.voices.indexOf(voice) % 2 === 0 ? 1 : -1) : undefined })
        if (dotted) Dot.buildAndAttach([note], { all: true })
        if (clef !== 'percussion') keys.forEach((_, tone) => {
          const alter = accidentals.get(tone === 0 ? event.id : `${event.id}:${tone}`)
          if (alter !== undefined) note.addModifier(new Accidental(alter === 1 ? '#' : alter === -1 ? 'b' : 'n'), tone)
        })
        return note
      })
      return { model: voice, notes, voice: new Voice({ numBeats: beats, beatValue }).addTickables(notes) }
    })
    const voices = rendered.map(item => item.voice)
    new Formatter().joinVoices(voices).formatToStave(voices, stave)
    const targets = new Map<string, Target>()
    rendered.forEach(({ voice, notes, model }) => {
      voice.draw(context, stave)
      notes.forEach((note, index) => {
        const event = model.events[index]
        const element = note.getSVGElement()
        element?.setAttribute('data-note-event', event.id)
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        hit.setAttribute('x', `${Math.max(0, Math.min(width - targetWidth, note.getAbsoluteX() - 14 / targetScale))}`)
        // Ledger-line notes near the first/last SVG edge still need a fully
        // visible touch target. Clamping never moves the musical glyph.
        hit.setAttribute('y', `${Math.max(0, Math.min(height - targetHeight, note.getYs()[0] - targetHeight / 2))}`)
        hit.setAttribute('width', String(targetWidth))
        hit.setAttribute('height', String(targetHeight))
        hit.setAttribute('rx', '7')
        hit.setAttribute('class', 'event-target')
        hit.setAttribute('role', 'button')
        hit.setAttribute('tabindex', '-1')
        hit.setAttribute('aria-label', `${measureIndex + 1}마디 ${index + 1}번째 ${eventName(event)}`)
        hit.setAttribute('aria-pressed', 'false')
        hit.dataset.measureId = measure.id
        hit.dataset.voiceId = model.id
        hit.dataset.eventId = event.id
        group.append(hit)
        targets.set(event.id, { note: element, hit, staveNote: note })
      })
    })
    context.closeGroup()
    // Keep reading/hit-test order identical to score order when replacing a bar.
    if (previous) {
      previous.group.replaceWith(group)
      previous.targets.forEach((_, id) => cache.targets.delete(id))
    }
    targets.forEach((target, id) => cache.targets.set(id, target))
    cache.measures[measureIndex] = { model: measure, incoming, group, targets }
  })
  if (repainted || cache.score !== score) drawTies(tieLinks(score), new Map(cache.measures.flatMap((bar, i) => [...bar.targets].map(([id, target]) => [id, { note: target.staveNote, renderer: cache.renderer, system: Math.floor(i / columns), voiceCount: bar.model.voices.length }]))))
  const old = cache.targets.get(cache.selected ?? '')
  old?.hit.classList.remove('selected')
  old?.hit.setAttribute('aria-pressed', 'false')
  old?.note?.classList.remove('selected-note')
  const next = cache.targets.get(selection?.eventId ?? '')
  next?.hit.classList.add('selected')
  next?.hit.setAttribute('aria-pressed', 'true')
  next?.note?.classList.add('selected-note')
  cache.selected = selection?.eventId ?? null
  cache.score = score
}
