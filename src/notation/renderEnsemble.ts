import { Accidental, BarlineType, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura'
import { durationName, eventName, eventPitches } from '../music/score'
import type { Measure } from '../music/score'
import { measureAccidentals } from '../music/accidentals'
import { KEY_NAMES, meterParts } from '../music/settings'
import { midi, pitchName, STEPS } from '../music/pitch'
import type { Part, Project, ProjectSelection, Staff } from '../project/model'
import { targetKey } from '../project/selection'
import type { ScoreSelection } from '../project/selection'

export type EnsembleHit = { target: ProjectSelection; svg: SVGSVGElement; x: number; y: number; hit: SVGRectElement; glyph?: SVGElement }
export type EnsembleBar = { target: ProjectSelection; svg: SVGSVGElement; group: SVGGElement; background: SVGRectElement; x: number; y: number; width: number; height: number; bottom: number; index: number }
export type EnsembleScene = { hits: EnsembleHit[]; bars: EnsembleBar[]; columns: number; width: number; height: number }
type StaffRow = { part: Part; staff: Staff; y: number }
type CachedBar = { models: readonly Measure[]; groups: SVGGElement[]; hits: EnsembleHit[]; bars: EnsembleBar[] }
type Cache = { layout: string; scene: EnsembleScene; renderers: Renderer[]; bars: CachedBar[] }
const cache = new WeakMap<HTMLDivElement, Cache>()
const svgElement = <K extends keyof SVGElementTagNameMap>(name: K) => document.createElementNS('http://www.w3.org/2000/svg', name)

export function disposeEnsemble(container: HTMLDivElement) { cache.delete(container); container.replaceChildren() }
function rowsOf(project: Project): { rows: StaffRow[]; height: number } {
  let top = 20
  const rows = project.parts.flatMap(part => part.staves.map(staff => {
    const bottom = staff.clef === 'bass' ? 18 : 30
    const ys = staff.clef === 'percussion' ? [60, 80] : staff.score.measures.flatMap(bar => bar.voices.flatMap(voice => voice.events.flatMap(event => eventPitches(event).map(p => 80 - (p.octave * 7 + STEPS.indexOf(p.step) - bottom) * 5))))
    const low = Math.min(40, ...ys), high = Math.max(100, ...ys)
    const y = top + Math.max(12, 28 - low)
    top = y + Math.max(116, high + 30) + 14
    return { part, staff, y }
  }))
  return { rows, height: top + 12 }
}
function staveNotes(row: StaffRow, measure: Measure, stave: Stave) {
  const accidentals = measureAccidentals(measure, row.staff.score.keySignature)
  const meter = meterParts(row.staff.score.timeSignature)
  return measure.voices.map((model, voiceIndex) => {
    const notes = model.events.map(event => {
      const dotted = event.duration.n === 3
      const denominator = event.duration.d / (dotted ? 2 : 1)
      const duration = ({ 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16' } as Record<number, string>)[denominator]
      const keys = eventPitches(event).map(p => row.staff.clef === 'percussion' ? ({ 36: 'f/4', 38: 'c/5', 42: 'g/5' }[midi(p)] ?? 'b/4') : `${p.step.toLowerCase()}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}/${p.octave}`)
      const note = new StaveNote({ clef: row.staff.clef, keys: keys.length ? keys : [row.staff.clef === 'bass' ? 'd/3' : 'b/4'], duration, dots: dotted ? 1 : 0, type: event.kind === 'rest' ? 'r' : 'n', autoStem: true, stemDirection: measure.voices.length > 1 ? voiceIndex % 2 === 0 ? 1 : -1 : undefined }).setStave(stave)
      if (dotted) Dot.buildAndAttach([note], { all: true })
      if (row.staff.clef !== 'percussion') keys.forEach((_, index) => {
        const alter = accidentals.get(index ? `${event.id}:${index}` : event.id)
        if (alter !== undefined) note.addModifier(new Accidental(alter === 1 ? '#' : alter === -1 ? 'b' : 'n'), index)
      })
      return note
    })
    return { model, notes, voice: new Voice({ numBeats: meter.beats, beatValue: meter.beatValue }).addTickables(notes).setStave(stave) }
  })
}

export function renderEnsemble(container: HTMLDivElement, project: Project, availableWidth: number, zoom: number, continuous: boolean): EnsembleScene {
  const { rows, height } = rowsOf(project)
  const score = rows[0].staff.score, count = score.measures.length
  const density = Math.max(...rows.flatMap(row => row.staff.score.measures.flatMap(bar => bar.voices.map(voice => voice.events.length))))
  const minimum = Math.max(310, density * 46 + 120 + Math.abs(score.keySignature) * 12)
  const label = 110
  const columns = continuous ? count : availableWidth - label >= minimum * 2 ? 2 : 1
  const width = Math.max(availableWidth, label + minimum * columns)
  const measureWidth = (width - label - 8) / columns
  const layout = JSON.stringify([width, height, columns, count, zoom, score.keySignature, score.timeSignature, rows.map(row => [row.part.id, row.part.name, row.staff.id, row.staff.name, row.staff.clef, row.y])])
  let current = cache.get(container)
  if (!current || current.layout !== layout) {
    disposeEnsemble(container)
    const renderers = Array.from({ length: Math.ceil(count / columns) }, (_, i) => {
      const section = document.createElement('div')
      section.className = 'ensemble-system'
      container.append(section)
      const renderer = new Renderer(section, Renderer.Backends.SVG)
      renderer.resize(width, height)
      const svg = section.querySelector('svg')!
      svg.dataset.scoreSystem = String(i)
      svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', `총보 ${i + 1}번째 시스템`)
      return renderer
    })
    current = { layout, renderers, bars: [], scene: { hits: [], bars: [], columns, width, height } }
    cache.set(container, current)
  }
  const result = current
  for (let index = 0; index < count; index++) {
    const models = rows.map(row => row.staff.score.measures[index])
    const previous = result.bars[index]
    if (previous && previous.models.every((bar, i) => bar === models[i])) continue
    const renderer = result.renderers[Math.floor(index / columns)], context = renderer.getContext()
    const svg = container.querySelectorAll<SVGSVGElement>('svg')[Math.floor(index / columns)]
    const x = label + index % columns * measureWidth
    const staves = rows.map(row => {
      const stave = new Stave(x, row.y, measureWidth)
      if (index % columns === 0) {
        stave.addClef(row.staff.clef)
        if (row.staff.clef !== 'percussion') stave.addKeySignature(KEY_NAMES[score.keySignature + 7])
      }
      if (index === 0) stave.addTimeSignature(score.timeSignature)
      if (index === count - 1) stave.setEndBarType(BarlineType.END)
      return stave.setContext(context)
    })
    // One formatter per measure across all voices/staves: shared musical onsets
    // and barlines remain aligned even when one instrument contains only rests.
    const start = Math.max(...staves.map(stave => stave.getNoteStartX()))
    staves.forEach(stave => stave.setNoteStartX(start))
    const rendered = rows.map((row, i) => staveNotes(row, models[i], staves[i]))
    const formatter = new Formatter()
    rendered.forEach(voices => formatter.joinVoices(voices.map(voice => voice.voice)))
    formatter.formatToStave(rendered.flatMap(voices => voices.map(voice => voice.voice)), staves[0])
    const entry: CachedBar = { models, groups: [], hits: [], bars: [] }
    rows.forEach((row, rowIndex) => {
      const stave = staves[rowIndex], measure = models[rowIndex]
      const group: SVGGElement = context.openGroup('ensemble-measure')
      group.dataset.renderedMeasure = measure.id; group.dataset.staffId = row.staff.id; group.dataset.partId = row.part.id
      group.dataset.measureIndex = String(index)
      if (index === 0) group.classList.add('staff-card')
      const background = svgElement('rect')
      background.setAttribute('x', String(x)); background.setAttribute('y', String(row.y + 5))
      background.setAttribute('width', String(measureWidth)); background.setAttribute('height', '122')
      background.setAttribute('class', 'measure-selection')
      group.append(background)
      if (index % columns === 0) {
        context.setFont('system-ui', 11)
        context.fillText(row.staff.name === row.part.name ? row.part.name : row.staff.name, 3, row.y + 65)
      }
      if (rowIndex === 0) { context.setFont('system-ui', 11); context.fillText(String(index + 1), x + 5, row.y + 6) }
      stave.draw()
      stave.getSVGElement()?.setAttribute('data-system-start', String(index % columns === 0))
      stave.getSVGElement()?.setAttribute('data-stave-measure', measure.id)
      const target: ProjectSelection = { partId: row.part.id, staffId: row.staff.id, measureId: measure.id, voiceId: measure.voices[0].id, eventId: measure.voices[0].events[0].id, scope: 'measure' }
      const bar = { target, svg, group, background, x: start, y: row.y + 5, width: stave.getNoteEndX() - start, height: 122, bottom: stave.getYForLine(4), index }
      const hitBar = svgElement('rect')
      hitBar.setAttribute('x', String(x)); hitBar.setAttribute('y', String(bar.y)); hitBar.setAttribute('width', String(measureWidth)); hitBar.setAttribute('height', String(bar.height))
      hitBar.setAttribute('class', 'entry-target measure-target'); hitBar.dataset.entryMeasure = measure.id
      hitBar.dataset.partId = row.part.id; hitBar.dataset.staffId = row.staff.id
      hitBar.setAttribute('role', 'button'); hitBar.setAttribute('aria-label', `${row.staff.name} ${index + 1}마디 선택`)
      group.append(hitBar); entry.bars.push(bar)
      rendered[rowIndex].forEach(({ model, notes, voice }, voiceIndex) => {
        voice.draw(context, stave)
        notes.forEach((note, eventIndex) => {
          const event = model.events[eventIndex]
          note.getSVGElement()?.setAttribute('data-note-event', event.id)
          const tones = Math.max(1, eventPitches(event).length)
          for (let pitchIndex = 0; pitchIndex < tones; pitchIndex++) {
            const head = note.noteHeads[pitchIndex]
            const cx = head.getAbsoluteX() + head.getWidth() / 2, cy = note.getYs()[pitchIndex]
            const hit = svgElement('rect'), size = 44 / zoom
            hit.setAttribute('x', String(Math.max(0, Math.min(width - size, cx - size / 2))))
            hit.setAttribute('y', String(Math.max(0, Math.min(height - size, cy - size / 2))))
            hit.setAttribute('width', String(size)); hit.setAttribute('height', String(size))
            hit.setAttribute('class', 'event-target'); hit.setAttribute('role', 'button'); hit.setAttribute('tabindex', '-1'); hit.setAttribute('aria-pressed', 'false')
            const name = event.kind === 'note' ? `${pitchName(eventPitches(event)[pitchIndex])} ${durationName(event.duration)}음표` : eventName(event)
            hit.setAttribute('aria-label', `${row.staff.name} ${index + 1}마디 ${voiceIndex + 1}성부 ${name} 구성음 ${pitchIndex + 1}`)
            Object.assign(hit.dataset, { partId: row.part.id, staffId: row.staff.id, measureId: measure.id, voiceId: model.id, eventId: event.id, pitchIndex: String(pitchIndex) })
            group.append(hit)
            entry.hits.push({ target: { partId: row.part.id, staffId: row.staff.id, measureId: measure.id, voiceId: model.id, eventId: event.id, pitchIndex }, svg, x: cx, y: cy, hit, glyph: head.getSVGElement() })
          }
        })
      })
      context.closeGroup(); entry.groups.push(group)
    })
    // Split nearby targets at the midpoints between noteheads. The controller
    // still offers a 44px nearest-head area for touch, while chord components
    // remain individually hit-testable instead of obscuring each other.
    entry.hits.forEach(item => {
      const radius = 22 / zoom
      const nearby = entry.hits.filter(other => other !== item && other.target.staffId === item.target.staffId && Math.abs(other.x - item.x) < radius * 2)
      const above = nearby.filter(other => other.y < item.y - 0.5).map(other => (other.y + item.y) / 2)
      const below = nearby.filter(other => other.y > item.y + 0.5).map(other => (other.y + item.y) / 2)
      const top = Math.max(0, item.y - radius, ...above), bottom = Math.min(height, item.y + radius, ...below)
      item.hit.setAttribute('y', String(top)); item.hit.setAttribute('height', String(bottom - top))
    })
    previous?.groups.forEach((group, i) => group.replaceWith(entry.groups[i]))
    result.bars[index] = entry
  }
  result.scene.hits = result.bars.flatMap(bar => bar.hits)
  result.scene.bars = result.bars.flatMap(bar => bar.bars)
  return result.scene
}

export function paintEnsembleSelection(scene: EnsembleScene, selected: ScoreSelection | null, focus: ProjectSelection | null) {
  const keys = new Set(selected?.targets.map(targetKey) ?? [])
  const measures = new Set(selected?.targets.map(target => JSON.stringify([target.staffId, target.measureId])) ?? [])
  scene.hits.forEach(item => {
    const active = keys.has(targetKey(item.target))
    item.hit.classList.toggle('selected', active)
    item.hit.setAttribute('aria-pressed', String(active))
    item.hit.toggleAttribute('data-focus', !!focus && targetKey(item.target) === targetKey(focus))
    item.glyph?.classList.toggle('selected-tone', active)
  })
  scene.bars.forEach(bar => bar.background.classList.toggle('selected-measure', measures.has(JSON.stringify([bar.target.staffId, bar.target.measureId]))))
}
export function paintEnsemblePlayback(scene: EnsembleScene, measure: number | null, progress: number) {
  scene.bars.forEach(bar => {
    bar.group.querySelector('[data-playback-cursor]')?.remove()
    bar.group.removeAttribute('data-playing-measure')
    if (bar.index !== measure) return
    bar.group.dataset.playingMeasure = String(measure)
    const line = svgElement('line'), x = bar.x + bar.width * progress
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x)); line.setAttribute('y1', String(bar.y)); line.setAttribute('y2', String(bar.y + bar.height))
    line.setAttribute('data-playback-cursor', 'true'); line.setAttribute('stroke', '#d67416'); line.setAttribute('stroke-width', '2')
    bar.group.append(line)
  })
}
