import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Dispatch, KeyboardEvent, PointerEvent } from 'react'
import type { Project, ProjectSelection } from '../project/model'
import { DRUMS, staffAt } from '../project/model'
import type { ProjectAction } from '../project/state'
import type { ScoreSelection } from '../project/selection'
import { isGroupSelection, targetKey } from '../project/selection'
import { locate } from '../music/score'
import type { NoteEntry, EntryPosition } from '../project/noteEntry'
import { activeAlter } from '../project/noteEntry'
import { STEPS } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { gestureAxis, pitchSteps } from '../editor/gesture'
import type { Axis } from '../editor/gesture'
import { disposeEnsemble, paintEnsembleEntry, paintEnsemblePlayback, paintEnsembleSelection, renderEnsemble } from '../notation/renderEnsemble'
import type { EnsembleBar, EnsembleHit, EnsembleScene } from '../notation/renderEnsemble'

type Props = {
  project: Project; selection: ProjectSelection | null; selected: ScoreSelection | null
  dispatch: Dispatch<ProjectAction>; zoom: number; sensitivity: number; fingerEdit: boolean; continuous: boolean
  entry: NoteEntry; inputVoice: number; playingMeasure: number | null; playingProgress: number
}
type Drag = { pointerId: number; pointerType: string; x: number; y: number; target: ProjectSelection; axis: Axis | null; token: string; group: boolean }
type Pending = { pointerId: number; pointerType: string; x: number; y: number; position: EntryPosition; pitch: Pitch; chordTarget?: ProjectSelection }
export default function EnsembleView(props: Props) {
  const { project, selection, selected, entry, dispatch, zoom, sensitivity, fingerEdit, continuous, playingMeasure, playingProgress } = props
  const root = useRef<HTMLElement>(null), notation = useRef<HTMLDivElement>(null)
  const scene = useRef<EnsembleScene | null>(null), drag = useRef<Drag | null>(null), pending = useRef<Pending | null>(null)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const width = useRef(0)
  const cancel = useCallback((event?: PointerEvent<HTMLElement>) => {
    const current = drag.current ?? pending.current
    if (!current || (event && event.pointerId !== current.pointerId)) return
    drag.current = null; pending.current = null
    if (root.current?.hasPointerCapture(current.pointerId)) root.current.releasePointerCapture(current.pointerId)
    dispatch({ type: 'cancel' })
  }, [dispatch])
  const draw = useCallback(() => {
    const p = latest.current
    width.current = (root.current!.clientWidth || 800) / p.zoom
    scene.current = renderEnsemble(notation.current!, p.project, width.current, p.zoom, p.continuous)
    paintEnsembleSelection(scene.current, p.selected, p.selection)
    paintEnsemblePlayback(scene.current, p.playingMeasure, p.playingProgress)
    paintEnsembleEntry(scene.current, p.project, p.entry)
  }, [])
  useLayoutEffect(draw, [draw, project, zoom, continuous])
  useLayoutEffect(() => { if (scene.current) paintEnsembleSelection(scene.current, selected, selection) }, [selected, selection, project])
  useLayoutEffect(() => { if (scene.current) paintEnsemblePlayback(scene.current, playingMeasure, playingProgress) }, [playingMeasure, playingProgress, project, zoom, continuous])
  useLayoutEffect(() => { if (scene.current) paintEnsembleEntry(scene.current, project, entry) }, [entry, project, zoom, continuous])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if ((root.current!.clientWidth || 800) / latest.current.zoom === width.current) return
      cancel(); draw()
    })
    observer.observe(root.current!)
    return () => observer.disconnect()
  }, [cancel, draw])
  useEffect(() => {
    const element = notation.current!
    const blur = () => cancel()
    const hidden = () => { if (document.hidden) cancel() }
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); cancel(); disposeEnsemble(element) }
  }, [cancel])

  function point(event: PointerEvent<HTMLElement>) {
    const svg = (event.target as Element).closest('svg') as SVGSVGElement | null
    if (!svg?.getScreenCTM()) return null
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    return { svg, x: position.x, y: position.y }
  }
  function hitAt(event: PointerEvent<HTMLElement>): EnsembleHit | null {
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
    const hit = scene.current!.hits.filter(item => item.target.staffId === staff.id && item.target.measureId === measure.id && item.target.voiceId === voice.id)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0]
    const target = hit.target, model = locate(staff.score, target).event
    const position = { partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, start: model.start }
    const bottom = staff.clef === 'bass' ? 18 : 30
    const value = bottom + Math.round((bar.bottom - y) / 5), step = STEPS[((value % 7) + 7) % 7]
    let pitch: Pitch = { step, octave: Math.floor(value / 7), alter: entry.accidental ?? activeAlter(project, position, step, Math.floor(value / 7)) }
    if (part.instrument === 'drums') pitch = [...DRUMS].sort((a, b) => {
      const position = (key: string) => Number(key.at(-1)) * 7 + STEPS.indexOf(key[0].toUpperCase() as Pitch['step'])
      return Math.abs(position(a.key) - value) - Math.abs(position(b.key) - value)
    })[0].pitch
    return { position, pitch,
      chordTarget: model.kind === 'note' && !entry.rest ? target : undefined }
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
    const element = (event.target as Element).closest<SVGElement>('[data-entry-measure]')
    const bar = scene.current!.bars.find(item => hit ? item.target.measureId === hit.target.measureId && item.target.staffId === hit.target.staffId
      : item.target.measureId === element?.dataset.entryMeasure && item.target.staffId === element?.dataset.staffId)
    if (entry.enabled && !event.ctrlKey && !event.metaKey && bar) {
      pending.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, ...insertion(bar, p.x, p.y) }
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
    if (!item || item.pointerId !== event.pointerId) return
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
    onDragStart={event => event.preventDefault()} onContextMenu={event => { if (drag.current) event.preventDefault() }}>
    <div ref={notation} className="notation ensemble-notation" style={{ zoom }}/>
  </section>
}
