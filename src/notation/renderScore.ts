import { Accidental, BarlineType, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura'
import { eventName } from '../music/score'
import type { Measure, Score, Selection } from '../music/score'
import { measureAccidentals } from '../music/accidentals'
import { KEY_LABELS, KEY_NAMES, meterParts } from '../music/settings'

type Target = { note: SVGElement | undefined; hit: SVGRectElement }
type RenderedMeasure = { model: Measure; group: SVGGElement; targets: Map<string, Target> }
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

export function renderScore(container: HTMLDivElement, score: Score, selection: Selection | null, availableWidth: number) {
  const mostEvents = Math.max(...score.measures.flatMap(measure => measure.voices.map(voice => voice.events.length)))
  const minimum = Math.max(310, mostEvents * 46 + 120 + Math.abs(score.keySignature) * 12)
  const columns = availableWidth >= Math.max(1000, minimum * 2) ? 2 : 1
  const width = Math.max(availableWidth, minimum)
  const measureWidth = (width - 16) / columns
  const height = Math.ceil(score.measures.length / columns) * 220
  const layout = `${width}/${columns}/${height}/${score.keySignature}/${score.timeSignature}`
  let cache = renderedScores.get(container)
  if (!cache || cache.layout !== layout || cache.measures.length !== score.measures.length
    || cache.measures.some((item, i) => item.model.id !== score.measures[i].id)) {
    disposeScoreRenderer(container)
    const renderer = new Renderer(container, Renderer.Backends.SVG)
    renderer.resize(width, height)
    const svg = container.querySelector('svg')!
    svg.setAttribute('role', 'group')
    svg.setAttribute('aria-label', `높은음자리표 ${KEY_LABELS[score.keySignature + 7]} ${score.timeSignature}박자 악보 ${score.measures.length}마디`)
    cache = { renderer, svg, layout, score, measures: [], targets: new Map(), selected: null }
    renderedScores.set(container, cache)
  } else if (cache.score === score && cache.selected === (selection?.eventId ?? null)) return

  const context = cache.renderer.getContext()
  const { beats, beatValue } = meterParts(score.timeSignature)
  score.measures.forEach((measure, measureIndex) => {
    const previous = cache.measures[measureIndex]
    if (previous?.model === measure) return
    context.setFont('system-ui', 12)
    const group: SVGGElement = context.openGroup('measure')
    group.setAttribute('data-rendered-measure', measure.id)
    const x = 8 + (measureIndex % columns) * measureWidth
    const y = 32 + Math.floor(measureIndex / columns) * 220
    context.fillText(`${measureIndex + 1}`, x + 8, y + 5)
    const stave = new Stave(x, y, measureWidth)
    const systemStart = measureIndex % columns === 0
    if (systemStart) stave.addClef('treble').addKeySignature(KEY_NAMES[score.keySignature + 7])
    if (measureIndex === 0) stave.addTimeSignature(score.timeSignature)
    if (measureIndex === score.measures.length - 1) stave.setEndBarType(BarlineType.END)
    stave.setContext(context).draw()
    const staveElement = stave.getSVGElement()
    staveElement?.setAttribute('data-stave-measure', measure.id)
    staveElement?.setAttribute('data-system-start', String(systemStart))
    const accidentals = measureAccidentals(measure, score.keySignature)
    const rendered = measure.voices.map(voice => {
      const notes = voice.events.map(event => {
        const dotted = event.duration.n === 3
        const denominator = event.duration.d / (dotted ? 2 : 1)
        const durations: Record<number, string> = { 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16' }
        const key = event.kind === 'note'
          ? `${event.pitch.step.toLowerCase()}${event.pitch.alter === 1 ? '#' : event.pitch.alter === -1 ? 'b' : ''}/${event.pitch.octave}`
          : 'b/4'
        const note = new StaveNote({ keys: [key], duration: durations[denominator], dots: dotted ? 1 : 0, type: event.kind === 'rest' ? 'r' : 'n', autoStem: true })
        if (dotted) Dot.buildAndAttach([note], { all: true })
        const alter = accidentals.get(event.id)
        if (alter !== undefined) note.addModifier(new Accidental(alter === 1 ? '#' : alter === -1 ? 'b' : 'n'), 0)
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
        hit.setAttribute('x', `${note.getAbsoluteX() - 14}`)
        // Ledger-line notes near the first/last SVG edge still need a fully
        // visible touch target. Clamping never moves the musical glyph.
        hit.setAttribute('y', `${Math.max(0, Math.min(height - 48, note.getYs()[0] - 24))}`)
        hit.setAttribute('width', '44')
        hit.setAttribute('height', '48')
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
        targets.set(event.id, { note: element, hit })
      })
    })
    context.closeGroup()
    // Keep reading/hit-test order identical to score order when replacing a bar.
    if (previous) {
      previous.group.replaceWith(group)
      previous.targets.forEach((_, id) => cache.targets.delete(id))
    }
    targets.forEach((target, id) => cache.targets.set(id, target))
    cache.measures[measureIndex] = { model: measure, group, targets }
  })
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
