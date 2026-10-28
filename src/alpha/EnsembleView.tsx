import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Dispatch, KeyboardEvent, PointerEvent } from 'react'
import type { Project, ProjectSelection } from '../project/model'
import { DRUMS, staffAt } from '../project/model'
import type { ProjectAction } from '../project/state'
import type { ScoreSelection } from '../project/selection'
import { isGroupSelection, targetKey } from '../project/selection'
import { durationName, locate } from '../music/score'
import type { NoteEntry, EntryPosition } from '../project/noteEntry'
import { activeAlter } from '../project/noteEntry'
import { midi, pitchName, STEPS } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { add, compare, equal } from '../music/rational'
import { measureDuration } from '../music/settings'
import { gestureAxis, pitchSteps } from '../editor/gesture'
import type { Axis } from '../editor/gesture'
import { disposeEnsemble, paintEnsembleEntry, paintEnsemblePlayback, paintEnsembleSelection, paintNoteGhost, renderEnsemble } from '../notation/renderEnsemble'
import type { EnsembleBar, EnsembleHit, EnsembleScene, NoteGhost } from '../notation/renderEnsemble'

type Props = {
  project: Project; selection: ProjectSelection | null; selected: ScoreSelection | null
  dispatch: Dispatch<ProjectAction>; zoom: number; sensitivity: number; fingerEdit: boolean; continuous: boolean
  entry: NoteEntry; inputVoice: number; playingMeasure: number | null; playingProgress: number
  onLayout?: (minimumWidth: number) => void
  contextMenu: (target: ProjectSelection, position: { x: number; y: number }) => void
}
type Drag = { pointerId: number; pointerType: string; x: number; y: number; target: ProjectSelection; axis: Axis | null; token: string; group: boolean }
type Pending = { pointerId: number; pointerType: string; x: number; y: number; position: EntryPosition; pitch: Pitch; chordTarget?: ProjectSelection }
type ScorePointer = Pick<PointerEvent<HTMLElement>, 'target' | 'clientX' | 'clientY' | 'ctrlKey' | 'metaKey'>
function viewportWidth(root: HTMLElement, zoom: number) {
  const desk = root.closest<HTMLElement>('.score-desk'), page = root.closest<HTMLElement>('.score-page')
  if (!desk || !page) return (root.clientWidth || 800) / zoom
  const horizontal = (element: Element) => {
    const style = getComputedStyle(element)
    return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  }
  // Dense bars may widen the paper. Line breaks still use the visible viewport,
  // so a single dense bar cannot force every sparse system onto a wider line.
  const maximum = parseFloat(getComputedStyle(page).maxWidth) || Infinity
  return Math.max(180, Math.min(desk.clientWidth - horizontal(desk), maximum) - horizontal(page) - 2) / zoom
}
export default function EnsembleView(props: Props) {
  const { project, selection, selected, entry, dispatch, zoom, sensitivity, fingerEdit, continuous, playingMeasure, playingProgress } = props
  const root = useRef<HTMLElement>(null), notation = useRef<HTMLDivElement>(null)
  const scene = useRef<EnsembleScene | null>(null), drag = useRef<Drag | null>(null), pending = useRef<Pending | null>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const width = useRef(0)
  const cancel = useCallback((event?: PointerEvent<HTMLElement>) => {
    const current = drag.current ?? pending.current
    if (current && event && event.pointerId !== current.pointerId) return
    if (scene.current) paintNoteGhost(scene.current, null)
    if (!current) return
    drag.current = null; pending.current = null
    if (root.current?.hasPointerCapture(current.pointerId)) root.current.releasePointerCapture(current.pointerId)
    dispatch({ type: 'cancel' })
  }, [dispatch])
  const draw = useCallback(() => {
    const p = latest.current
    width.current = viewportWidth(root.current!, p.zoom)
    scene.current = renderEnsemble(notation.current!, p.project, width.current, p.zoom, p.continuous)
    paintEnsembleSelection(scene.current, p.selected, p.selection)
    paintEnsemblePlayback(scene.current, p.playingMeasure, p.playingProgress)
    paintEnsembleEntry(scene.current, p.project, p.entry)
    p.onLayout?.(scene.current.minimumWidth * p.zoom)
  }, [])
  useLayoutEffect(draw, [draw, project, zoom, continuous])
  useLayoutEffect(() => { if (scene.current) paintEnsembleSelection(scene.current, selected, selection) }, [selected, selection, project])
  useLayoutEffect(() => { if (scene.current) paintEnsemblePlayback(scene.current, playingMeasure, playingProgress) }, [playingMeasure, playingProgress, project, zoom, continuous])
  useLayoutEffect(() => { if (scene.current) { paintNoteGhost(scene.current, null); paintEnsembleEntry(scene.current, project, entry) } }, [entry, project, zoom, continuous])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (viewportWidth(root.current!, latest.current.zoom) === width.current) return
      cancel(); draw()
    })
    observer.observe(root.current!)
    const desk = root.current!.closest('.score-desk')
    if (desk) observer.observe(desk)
    return () => observer.disconnect()
  }, [cancel, draw])
  useEffect(() => {
    const element = notation.current!
    const desk = root.current?.closest('.score-desk')
    const blur = () => cancel()
    const hidden = () => { if (document.hidden) cancel() }
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden)
    desk?.addEventListener('scroll', blur, { passive: true })
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); desk?.removeEventListener('scroll', blur); cancel(); disposeEnsemble(element) }
  }, [cancel])

  function point(event: ScorePointer) {
    const svg = (event.target as Element).closest('svg') as SVGSVGElement | null
    if (!svg?.getScreenCTM()) return null
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    return { svg, x: position.x, y: position.y }
  }
  function hitAt(event: ScorePointer): EnsembleHit | null {
    const p = point(event)
    if (!p) return null
    const candidates = scene.current!.hits.filter(item => item.svg === p.svg).map(item => ({ item, distance: Math.hypot(item.x - p.x, item.y - p.y) }))
    const best = Math.min(...candidates.map(item => item.distance))
    if (!(event.target as Element).closest('.event-target') && best > 22 / zoom) return null
    const closest = candidates.filter(item => item.distance <= best + 1)
    if (event.ctrlKey || event.metaKey) {
      const keys = new Set(selected?.targets.map(targetKey))
      const unselected = closest.find(item => !keys.has(targetKey(item.item.target)))
      if (unselected) return unselected.item
    }
    // Exactly overlapping unisons are addressable via the existing voice selector.
    const preferred = closest.find(({ item }) => {
      const staff = staffAt(project, item.target).staff
      return staff.score.measures[0].voices.indexOf(staff.score.measures[0].voices.find(voice => voice.id === item.target.voiceId)!) === props.inputVoice
    })
    return (preferred ?? closest[0])?.item ?? null
  }
  function insertion(bar: EnsembleBar, x: number, y: number) {
    const { part, staff } = staffAt(project, bar.target)
    const measure = staff.score.measures.find(item => item.id === bar.target.measureId)!
    const voice = measure.voices[Math.min(props.inputVoice, measure.voices.length - 1)]
    const hits = scene.current!.hits.filter(item => item.target.staffId === staff.id && item.target.measureId === measure.id && item.target.voiceId === voice.id)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0]
    const anchor = entry.chord && entry.last?.staffId === staff.id && entry.last.measureId === measure.id
      ? scene.current!.hits.find(item => item.target.eventId === entry.last!.eventId) : undefined
    const hit = anchor ?? hits
    const target = hit.target, model = locate(staff.score, target).event
    const position = { partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, start: model.start }
    const bottom = staff.clef === 'bass' ? 18 : 30
    const value = bottom + Math.round((bar.bottom - y) / 5), step = STEPS[((value % 7) + 7) % 7]
    let pitch: Pitch = { step, octave: Math.floor(value / 7), alter: entry.accidental ?? activeAlter(project, position, step, Math.floor(value / 7)) }
    let previewY = bar.bottom - (value - bottom) * 5
    if (part.instrument === 'drums') {
      const written = (key: string) => Number(key.at(-1)) * 7 + STEPS.indexOf(key[0].toUpperCase() as Pitch['step'])
      const drum = [...DRUMS].sort((a, b) => Math.abs(written(a.key) - value) - Math.abs(written(b.key) - value))[0]
      pitch = drum.pitch; previewY = bar.bottom - (written(drum.key) - bottom) * 5
    }
    const chordTarget = model.kind === 'note' && !entry.rest && part.instrument !== 'drums' ? target : undefined
    const duration = chordTarget ? model.duration : entry.duration
    const capacity = measureDuration(staff.score.timeSignature)
    const measureIndex = staff.score.measures.indexOf(measure)
    const absoluteEnd = add({ n: capacity.n * measureIndex, d: capacity.d }, add(position.start, duration))
    const preview: NoteGhost = { svg: hit.svg, x: model.kind === 'rest' && equal(model.duration, capacity) ? bar.x + 10 : hit.x, y: previewY, bottom: bar.bottom, duration, rest: entry.rest,
      accidental: entry.accidental !== null && entry.accidental !== activeAlter(project, position, pitch.step, pitch.octave) ? entry.accidental : null,
      voice: measure.voices.findIndex(item => item.id === target.voiceId), label: entry.rest ? `${durationName(duration)}쉼표` : `${pitchName(pitch)} ${durationName(duration)}음표`,
      valid: (entry.rest || midi(pitch) >= 36 && midi(pitch) <= 96) && compare(absoluteEnd, { n: capacity.n * 128, d: capacity.d }) <= 0
        && (entry.rest || part.instrument !== 'drums' || compare(add(position.start, duration), capacity) <= 0) }
    return { position: { ...position, voiceId: target.voiceId }, pitch, chordTarget, preview }
  }
  function barAt(event: ScorePointer, hit = hitAt(event)) {
    const element = (event.target as Element).closest<SVGElement>('[data-entry-measure]')
    return scene.current!.bars.find(item => hit ? item.target.measureId === hit.target.measureId && item.target.staffId === hit.target.staffId
      : item.target.measureId === element?.dataset.entryMeasure && item.target.staffId === element?.dataset.staffId)
  }
  function start(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch' && event.isPrimary === false) {
      if (drag.current?.pointerType === 'touch' || pending.current?.pointerType === 'touch') cancel()
      return
    }
    if (drag.current || pending.current || event.button !== 0 || event.isPrimary === false || (event.pointerType === 'touch' && !fingerEdit)) return
    const p = point(event)
    if (!p) return
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true })
    const hit = hitAt(event)
    const bar = barAt(event, hit)
    if (entry.enabled && !event.ctrlKey && !event.metaKey && bar) {
      const value = insertion(bar, p.x, p.y)
      pending.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, ...value,
        chordTarget: event.shiftKey ? undefined : value.chordTarget }
      paintNoteGhost(scene.current!, value.preview)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (hit) {
      const target = hit.target
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        dispatch({ type: 'pick', selection: target, extend: event.shiftKey, additive: event.ctrlKey || event.metaKey })
        return
      }
      drag.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, target, axis: null, token: '',
        group: isGroupSelection(selected) && !!selected?.targets.some(item => targetKey(item) === targetKey(target)) }
      event.currentTarget.setPointerCapture(event.pointerId)
      dispatch({ type: 'canvas', ...target, action: { type: 'begin', selection: target } })
      return
    }
    if (!bar) return
    dispatch({ type: 'pick', selection: bar.target, extend: event.shiftKey, additive: event.ctrlKey || event.metaKey })
  }
  function preview(event: PointerEvent<HTMLElement>) {
    const item = drag.current
    if (pending.current?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - pending.current.x, event.clientY - pending.current.y) >= 8 * zoom * sensitivity) cancel(event)
      return
    }
    if (!item) {
      if (!entry.enabled || event.ctrlKey || event.metaKey || event.pointerType === 'touch' && !fingerEdit) { paintNoteGhost(scene.current!, null); return }
      const p = point(event), bar = p && barAt(event)
      paintNoteGhost(scene.current!, p && bar ? insertion(bar, p.x, p.y).preview : null)
      return
    }
    if (item.pointerId !== event.pointerId) return
    const dx = (event.clientX - item.x) / zoom / sensitivity, dy = (event.clientY - item.y) / zoom / sensitivity
    item.axis ??= gestureAxis(dx, dy)
    if (item.axis !== 'vertical') return
    const action = { type: 'previewPitch' as const, amount: pitchSteps(dy) }
    const token = `p${action.amount}`
    if (item.token === token) return
    item.token = token
    dispatch({ type: 'canvas', ...item.target, action })
  }
  function finish(event: PointerEvent<HTMLElement>) {
    if (pending.current?.pointerId === event.pointerId) {
      const p = pending.current; pending.current = null
      paintNoteGhost(scene.current!, null)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      dispatch({ type: 'entryWrite', position: p.position, pitch: p.pitch, rest: entry.rest, chordTarget: p.chordTarget })
      return
    }
    if (drag.current?.pointerId !== event.pointerId) return
    preview(event)
    const item = drag.current; drag.current = null
    dispatch({ type: 'canvas', ...item.target, action: { type: 'commit' } })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (item.axis === null) {
      if (item.group) dispatch({ type: 'pick', selection: item.target })
    }
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest('input, textarea, select, button, [contenteditable="true"]')) return
    if (event.key === 'Escape') { cancel(); return }
    if (drag.current || pending.current) { event.preventDefault(); return }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); dispatch({ type: 'navigate', direction: event.key === 'ArrowLeft' ? -1 : 1, extend: event.shiftKey })
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (!event.shiftKey && selection) dispatch({ type: 'canvas', ...selection, action: { type: 'pitch', amount: event.key === 'ArrowUp' ? 1 : -1, chromatic: true } })
    }
  }
  return <section ref={root} className="score-surface ensemble-surface" tabIndex={0} aria-label="악보 편집 영역" aria-describedby="editing-help" data-editing="true" data-input-mode={entry.enabled} data-finger-edit={fingerEdit} data-selected-count={selected?.targets.length ?? 0}
    onKeyDown={keyDown} onPointerDown={start} onPointerMove={preview} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={() => cancel()}
    onPointerLeave={() => { if (!drag.current && !pending.current && scene.current) paintNoteGhost(scene.current, null) }}
    onDragStart={event => event.preventDefault()} onContextMenu={event => {
      const hit = hitAt(event), bar = barAt(event, hit), target = hit?.target ?? bar?.target
      if (!target) return
      event.preventDefault(); cancel(); event.currentTarget.focus({ preventScroll: true })
      props.contextMenu(target, { x: event.clientX, y: event.clientY })
    }}>
    <div ref={notation} className="notation ensemble-notation" style={{ zoom }}/>
  </section>
}
