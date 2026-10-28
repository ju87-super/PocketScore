import { Accidental, BarlineType, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura'
import { durationName, eventName, eventPitches } from '../music/score'
import type { Measure, Score } from '../music/score'
import { measureAccidentals } from '../music/accidentals'
import { KEY_NAMES, meterParts } from '../music/settings'
import { midi, pitchName, STEPS } from '../music/pitch'
import type { Part, Project, ProjectSelection, Staff } from '../project/model'
import { targetKey } from '../project/selection'
import type { ScoreSelection } from '../project/selection'
import type { NoteEntry } from '../project/noteEntry'
import { staffAt } from '../project/model'
import { locate } from '../music/score'
import { equal } from '../music/rational'
import { measureDuration } from '../music/settings'
import type { Rational } from '../music/rational'
import { rhythmSymbol, VOICE_COLORS } from './symbols'
import { beamGroups, layoutSystems } from './engraving'
import type { MeasureMetrics } from './engraving'
import { tiedContinuations, tieLinks } from '../music/ties'
import { drawTies } from './ties'
import type { TieAnchor } from './ties'

export type EnsembleHit = { target: ProjectSelection; svg: SVGSVGElement; x: number; y: number; hit: SVGRectElement; glyph?: SVGElement }
export type EnsembleBar = { target: ProjectSelection; svg: SVGSVGElement; group: SVGGElement; background: SVGRectElement; x: number; y: number; width: number; height: number; bottom: number; index: number }
export type EnsembleScene = { hits: EnsembleHit[]; bars: EnsembleBar[]; columns: number; width: number; height: number; minimumWidth: number }
export type NoteGhost = { svg: SVGSVGElement; x: number; y: number; bottom: number; duration: Rational; rest: boolean; accidental: -1 | 0 | 1 | null; voice: number; label: string; valid: boolean }
type StaffRow = { part: Part; staff: Staff; y: number; continuations: ReadonlySet<string> }
type CachedBar = { models: readonly Measure[]; incoming: string; groups: SVGGElement[]; hits: EnsembleHit[]; bars: EnsembleBar[]; notes: Map<string, TieAnchor> }
type MeasuredBar = { models: readonly Measure[]; incoming: string; metrics: MeasureMetrics }
type Cache = { layout: string; scene: EnsembleScene; renderers: Renderer[]; bars: CachedBar[]; metricsKey: string; measured: MeasuredBar[]; tiedScores?: readonly Score[] }
const cache = new WeakMap<HTMLDivElement, Cache>()
const ghosts = new WeakMap<EnsembleScene, { group: SVGGElement; key: string }>()
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
    return { part, staff, y, continuations: tiedContinuations(staff.score) }
  }))
  return { rows, height: top + 12 }
}
function staveNotes(row: StaffRow, measure: Measure, stave: Stave) {
  const accidentals = measureAccidentals(measure, row.staff.score.keySignature, row.continuations)
  const meter = meterParts(row.staff.score.timeSignature)
  return measure.voices.map((model, voiceIndex) => {
    const notes = model.events.map(event => {
      const dotted = event.duration.n === 3
      const denominator = event.duration.d / (dotted ? 2 : 1)
      const fullRest = model.events.length === 1 && event.kind === 'rest' && equal(event.duration, measureDuration(row.staff.score.timeSignature))
      const duration = fullRest ? 'w' : ({ 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16', 32: '32', 64: '64' } as Record<number, string>)[denominator]
      const keys = eventPitches(event).map(p => row.staff.clef === 'percussion' ? ({ 36: 'f/4', 38: 'c/5', 42: 'g/5' }[midi(p)] ?? 'b/4') : `${p.step.toLowerCase()}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}/${p.octave}`)
      const note = new StaveNote({ clef: row.staff.clef, keys: keys.length ? keys : [row.staff.clef === 'bass' ? 'd/3' : 'b/4'], duration, durationOverride: fullRest ? new Fraction(event.duration.n, event.duration.d) : undefined, dots: dotted && !fullRest ? 1 : 0, type: event.kind === 'rest' ? 'r' : 'n', autoStem: measure.voices.length === 1, stemDirection: measure.voices.length > 1 ? voiceIndex % 2 === 0 ? 1 : -1 : undefined }).setStave(stave)
      if (dotted && !fullRest) Dot.buildAndAttach([note], { all: true })
      if (fullRest) note.setCenterAlignment(true)
      if (row.staff.clef !== 'percussion') keys.forEach((_, index) => {
        const alter = accidentals.get(index ? `${event.id}:${index}` : event.id)
        if (alter !== undefined) note.addModifier(new Accidental(alter === 1 ? '#' : alter === -1 ? 'b' : 'n'), index)
      })
      return note
    })
    const beams = beamGroups(model.events, row.staff.score.timeSignature).map(indices => ({ indices, beam: new Beam(indices.map(index => notes[index]), measure.voices.length === 1) }))
    return { model, notes, beams, voice: new Voice({ numBeats: meter.beats, beatValue: meter.beatValue }).addTickables(notes).setStave(stave) }
  })
}

function stavesFor(rows: StaffRow[], index: number, systemStart: boolean, x: number, width: number) {
  const staves = rows.map(row => {
    const stave = new Stave(x, row.y, width)
    if (systemStart) {
      stave.addClef(row.staff.clef)
      if (row.staff.clef !== 'percussion') stave.addKeySignature(KEY_NAMES[row.staff.score.keySignature + 7])
    }
    if (index === 0) stave.addTimeSignature(row.staff.score.timeSignature)
    if (index === row.staff.score.measures.length - 1) stave.setEndBarType(BarlineType.END)
    return stave
  })
  const start = Math.max(...staves.map(stave => stave.getNoteStartX()))
  staves.forEach(stave => stave.setNoteStartX(start))
  return staves
}
function measureMetrics(rows: StaffRow[], index: number): MeasureMetrics {
  const staves = stavesFor(rows, index, true, 0, 2000)
  const rendered = rows.map((row, i) => staveNotes(row, row.staff.score.measures[index], staves[i]))
  const formatter = new Formatter()
  rendered.forEach(voices => formatter.joinVoices(voices.map(item => item.voice)))
  const minimum = formatter.preCalculateMinTotalWidth(rendered.flatMap(voices => voices.map(item => item.voice)))
  const onsets = new Set(rows.flatMap(row => row.staff.score.measures[index].voices.flatMap(voice => voice.events.map(event => `${event.start.n}/${event.start.d}`))))
  return { body: Math.max(110, minimum * 1.12 + 18, onsets.size * 28), opening: staves[0].getNoteStartX(),
    continuation: stavesFor(rows, index, false, 0, 2000)[0].getNoteStartX() }
}

export function renderEnsemble(container: HTMLDivElement, project: Project, availableWidth: number, zoom: number, continuous: boolean): EnsembleScene {
  const { rows, height } = rowsOf(project)
  const score = rows[0].staff.score, count = score.measures.length
  let current = cache.get(container)
  const metricsKey = JSON.stringify([score.keySignature, score.timeSignature, count, rows.map(row => [row.staff.id, row.staff.clef])])
  const measured = Array.from({ length: count }, (_, index): MeasuredBar => {
    const models = rows.map(row => row.staff.score.measures[index])
    const incoming = JSON.stringify(models.map((bar, i) => bar.voices.flatMap(voice => voice.events.flatMap(event => eventPitches(event).flatMap((_, tone) => {
      const key = tone ? `${event.id}:${tone}` : event.id
      return rows[i].continuations.has(key) ? [key] : []
    })))))
    const previous = current?.metricsKey === metricsKey ? current.measured[index] : undefined
    return previous && previous.incoming === incoming && models.every((model, i) => model === previous.models[i]) ? previous : { models, incoming, metrics: measureMetrics(rows, index) }
  })
  const systems = layoutSystems(measured.map(bar => bar.metrics), availableWidth, continuous)
  const width = Math.max(...systems.map(system => system.width))
  const columns = Math.max(...systems.map(system => system.measures.length))
  const layout = JSON.stringify([systems, height, zoom, score.keySignature, score.timeSignature, rows.map(row => [row.part.id, row.part.name, row.staff.id, row.staff.name, row.staff.clef, row.y])])
  if (!current || current.layout !== layout) {
    disposeEnsemble(container)
    const renderers = systems.map((system, i) => {
      const section = document.createElement('div')
      section.className = 'ensemble-system'
      container.append(section)
      const renderer = new Renderer(section, Renderer.Backends.SVG)
      renderer.resize(system.width, height)
      const svg = section.querySelector('svg')!
      svg.dataset.scoreSystem = String(i)
      svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', `총보 ${i + 1}번째 시스템`)
      return renderer
    })
    current = { layout, renderers, bars: [], metricsKey, measured, scene: { hits: [], bars: [], columns, width, height, minimumWidth: width } }
    cache.set(container, current)
  }
  const result = current
  result.measured = measured
  for (const [systemIndex, system] of systems.entries()) for (const [column, placement] of system.measures.entries()) {
    const index = placement.index, x = placement.x, measureWidth = placement.width, systemStart = column === 0
    const models = measured[index].models
    const previous = result.bars[index]
    if (previous && previous.incoming === measured[index].incoming && previous.models.every((bar, i) => bar === models[i])) continue
    const renderer = result.renderers[systemIndex], context = renderer.getContext()
    const svg = container.querySelectorAll<SVGSVGElement>('svg')[systemIndex]
    const staves = stavesFor(rows, index, systemStart, x, measureWidth)
    staves.forEach(stave => stave.setContext(context))
    const start = staves[0].getNoteStartX()
    const rendered = rows.map((row, i) => staveNotes(row, models[i], staves[i]))
    const formatter = new Formatter()
    rendered.forEach(voices => formatter.joinVoices(voices.map(voice => voice.voice)))
    formatter.formatToStave(rendered.flatMap(voices => voices.map(voice => voice.voice)), staves[0])
    rendered.forEach(voices => voices.forEach(({ beams }) => beams.forEach(({ beam }) => {
      // Limit visual rise to one staff space, including long/wide beams. A
      // slope-only limit can push beams outside a system on large pitch leaps.
      const notes = beam.getNotes(), span = Math.abs(notes.at(-1)!.getStemX() - notes[0].getStemX())
      const slope = Math.min(0.25, 10 / Math.max(1, span))
      beam.renderOptions.maxSlope = slope; beam.renderOptions.minSlope = -slope
    })))
    const entry: CachedBar = { models, incoming: measured[index].incoming, groups: [], hits: [], bars: [], notes: new Map() }
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
      if (systemStart) {
        context.setFont('system-ui', 11)
        context.fillText(row.staff.name === row.part.name ? row.part.name : row.staff.name, 3, row.y + 65)
      }
      if (rowIndex === 0) { context.setFont('system-ui', 11); context.fillText(String(index + 1), x + 5, row.y + 6) }
      stave.draw()
      stave.getSVGElement()?.setAttribute('data-system-start', String(systemStart))
      stave.getSVGElement()?.setAttribute('data-stave-measure', measure.id)
      const target: ProjectSelection = { partId: row.part.id, staffId: row.staff.id, measureId: measure.id, voiceId: measure.voices[0].id, eventId: measure.voices[0].events[0].id, scope: 'measure' }
      const bar = { target, svg, group, background, x: start, y: row.y + 5, width: stave.getNoteEndX() - start, height: 122, bottom: stave.getYForLine(4), index }
      const hitBar = svgElement('rect')
      hitBar.setAttribute('x', String(x)); hitBar.setAttribute('y', String(bar.y)); hitBar.setAttribute('width', String(measureWidth)); hitBar.setAttribute('height', String(bar.height))
      hitBar.setAttribute('class', 'entry-target measure-target'); hitBar.dataset.entryMeasure = measure.id
      hitBar.dataset.partId = row.part.id; hitBar.dataset.staffId = row.staff.id
      hitBar.dataset.staffBottomY = String(bar.bottom); hitBar.dataset.noteStartX = String(bar.x + 10)
      hitBar.setAttribute('role', 'button'); hitBar.setAttribute('aria-label', `${row.staff.name} ${index + 1}마디 선택`)
      group.append(hitBar); entry.bars.push(bar)
      rendered[rowIndex].forEach(({ model, notes, voice }, voiceIndex) => {
        voice.draw(context, stave)
        notes.forEach((note, eventIndex) => {
          const event = model.events[eventIndex]
          entry.notes.set(event.id, { note, renderer, system: systemIndex, voiceCount: measure.voices.length })
          note.getSVGElement()?.setAttribute('data-note-event', event.id)
          note.getSVGElement()?.setAttribute('data-stem-direction', String(note.getStemDirection()))
          const tones = Math.max(1, eventPitches(event).length)
          for (let pitchIndex = 0; pitchIndex < tones; pitchIndex++) {
            const head = note.noteHeads[pitchIndex]
            const cx = head.getAbsoluteX() + head.getWidth() / 2, cy = note.getYs()[pitchIndex]
            const hit = svgElement('rect'), size = 44 / zoom
            hit.setAttribute('x', String(Math.max(0, Math.min(system.width - size, cx - size / 2))))
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
      rendered[rowIndex].forEach(({ model, beams }) => beams.forEach(({ beam, indices }) => {
        beam.setContext(context).draw()
        const element = beam.getSVGElement()
        if (element) {
          element.dataset.beamVoice = model.id
          element.dataset.beamStem = String(beam.getStemDirection())
          element.dataset.beamEvents = JSON.stringify(indices.map(i => model.events[i].id))
        }
      }))
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
  if (!result.tiedScores || rows.some((row, i) => row.staff.score !== result.tiedScores![i])) {
    drawTies(rows.flatMap(row => tieLinks(row.staff.score)), new Map(result.bars.flatMap(bar => [...bar.notes])))
    result.tiedScores = rows.map(row => row.staff.score)
  }
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
export function paintEnsembleEntry(scene: EnsembleScene, project: Project, entry: NoteEntry) {
  scene.bars.forEach(bar => bar.group.querySelector('[data-note-input-cursor]')?.remove())
  if (!entry.enabled || !entry.cursor) return
  const cursor = entry.cursor
  const bar = scene.bars.find(item => item.target.staffId === cursor.staffId && item.target.measureId === cursor.measureId)
  if (!bar) return
  const score = staffAt(project, cursor).staff.score
  const hit = scene.hits.find(item => item.target.staffId === cursor.staffId && item.target.measureId === cursor.measureId && item.target.voiceId === cursor.voiceId && equal(locate(score, item.target).event.start, cursor.start))
  const capacity = measureDuration(score.timeSignature)
  const model = hit ? locate(score, hit.target).event : null
  const x = hit ? model?.kind === 'rest' && equal(model.duration, capacity) ? bar.x : hit.x - 10 : bar.x + bar.width * (cursor.start.n * capacity.d / cursor.start.d / capacity.n)
  const line = svgElement('line')
  line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x))
  line.setAttribute('y1', String(bar.bottom - 48)); line.setAttribute('y2', String(bar.bottom + 12))
  line.setAttribute('stroke', '#287ac9'); line.setAttribute('stroke-width', '2'); line.setAttribute('pointer-events', 'none')
  line.dataset.noteInputCursor = 'true'; line.setAttribute('aria-label', '다음 음표 입력 위치')
  bar.group.append(line)
}
export function paintNoteGhost(scene: EnsembleScene, preview: NoteGhost | null) {
  const previous = ghosts.get(scene)
  const key = preview ? JSON.stringify([preview.x, preview.y, preview.duration, preview.rest, preview.accidental, preview.voice, preview.label, preview.valid]) : ''
  if (preview && previous?.group.parentNode === preview.svg && previous.key === key) return
  previous?.group.remove(); ghosts.delete(scene)
  if (!preview) return
  const group = svgElement('g')
  group.dataset.noteInputPreview = 'true'; group.dataset.previewPitch = preview.label
  group.setAttribute('aria-label', `입력 미리보기 ${preview.label}`)
  group.setAttribute('pointer-events', 'none'); group.setAttribute('opacity', '.52')
  const color = preview.valid ? VOICE_COLORS[preview.voice] : '#c33636'
  group.setAttribute('fill', color); group.setAttribute('stroke', 'none')
  const text = (value: string, x: number, y: number, size = 40) => {
    const node = svgElement('text'); node.textContent = value
    node.setAttribute('x', String(x)); node.setAttribute('y', String(y))
    node.setAttribute('font-family', 'Bravura'); node.setAttribute('font-size', String(size)); group.append(node)
  }
  if (!preview.rest) {
    const ledger = (y: number) => {
      const line = svgElement('line'); line.setAttribute('x1', String(preview.x - 10)); line.setAttribute('x2', String(preview.x + 10))
      line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y)); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1'); group.append(line)
    }
    for (let y = preview.bottom + 10; y <= preview.y; y += 10) ledger(y)
    for (let y = preview.bottom - 50; y >= preview.y; y -= 10) ledger(y)
  }
  const y = preview.rest ? preview.bottom - 20 : preview.y
  text(rhythmSymbol(preview.duration, preview.rest), preview.x - 5, y)
  if (preview.duration.n === 3) text('\ue1e7', preview.x + 10, y - 5)
  if (!preview.rest && preview.accidental !== null) text(preview.accidental === 1 ? '\ue262' : preview.accidental === -1 ? '\ue260' : '\ue261', preview.x - 20, y)
  preview.svg.append(group)
  ghosts.set(scene, { group, key })
}
