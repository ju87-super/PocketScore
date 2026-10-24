import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Dispatch, KeyboardEvent, PointerEvent } from 'react'
import type { Project, ProjectSelection } from '../project/model'
import { staffAt } from '../project/model'
import type { ProjectAction } from '../project/state'
import type { ScoreSelection } from '../project/selection'
import { isGroupSelection, targetKey } from '../project/selection'
import { locate } from '../music/score'
import type { Rational } from '../music/rational'
import { fraction } from '../music/rational'
import { STEPS } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { keyAlter, measureDuration } from '../music/settings'
import { draggedDuration, gestureAxis, pitchSteps } from '../editor/gesture'
import type { Axis } from '../editor/gesture'
import { disposeEnsemble, paintEnsemblePlayback, paintEnsembleSelection, renderEnsemble } from '../notation/renderEnsemble'
import type { EnsembleBar, EnsembleHit, EnsembleScene } from '../notation/renderEnsemble'

type Props = {
  project: Project; selection: ProjectSelection | null; selected: ScoreSelection | null
  dispatch: Dispatch<ProjectAction>; zoom: number; sensitivity: number; fingerEdit: boolean; continuous: boolean
  input: boolean; inputVoice: number; playingMeasure: number | null; playingProgress: number
  insert: (partId: string, staffId: string, measureId: string, start: Rational, pitch: Pitch) => void
}
type Drag = { pointerId: number; pointerType: string; x: number; y: number; target: ProjectSelection; axis: Axis | null; duration: Rational; token: string; group: boolean; insertion?: { start: Rational; pitch: Pitch } }
type Pending = { pointerId: number; pointerType: string; x: number; y: number; bar: EnsembleBar; start: Rational; pitch: Pitch }
export default function EnsembleView(props: Props) {
  const { project, selection, selected, dispatch, zoom, sensitivity, fingerEdit, continuous, input, insert, playingMeasure, playingProgress } = props
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
  }, [])
  useLayoutEffect(draw, [draw, project, zoom, continuous])
  useLayoutEffect(() => { if (scene.current) paintEnsembleSelection(scene.current, selected, selection) }, [selected, selection, project])
  useLayoutEffect(() => { if (scene.current) paintEnsemblePlayback(scene.current, playingMeasure, playingProgress) }, [playingMeasure, playingProgress, project, zoom, continuous])
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
    const staff = staffAt(project, bar.target).staff
    const length = measureDuration(staff.score.timeSignature)
    const ticks = Math.min(length.n * 16 / length.d - 1, Math.max(0, Math.round((x - bar.x) / bar.width * length.n * 16 / length.d)))
    const bottom = staff.clef === 'bass' ? 18 : 30
    const value = bottom + Math.round((bar.bottom - y) / 5), step = STEPS[((value % 7) + 7) % 7]
    return { start: fraction(ticks, 16), pitch: { step, octave: Math.floor(value / 7), alter: keyAlter(staff.score.keySignature, step) } as Pitch }
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
    if (hit) {
      const target = hit.target
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        dispatch({ type: 'pick', selection: target, extend: event.shiftKey, additive: event.ctrlKey || event.metaKey })
        return
      }
      const model = locate(staffAt(project, target).staff.score, target).event
      const bar = scene.current!.bars.find(item => item.target.measureId === target.measureId && item.target.staffId === target.staffId)!
      drag.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, target, axis: null, duration: model.duration, token: '',
        group: isGroupSelection(selected) && !!selected?.targets.some(item => targetKey(item) === targetKey(target)),
        insertion: input && model.kind === 'rest' ? { ...insertion(bar, p.x, p.y), start: model.start } : undefined }
      event.currentTarget.setPointerCapture(event.pointerId)
      dispatch({ type: 'canvas', ...target, action: { type: 'begin', selection: target } })
      return
    }
    const entry = (event.target as Element).closest<SVGElement>('[data-entry-measure]')
    const bar = entry && scene.current!.bars.find(item => item.target.measureId === entry.dataset.entryMeasure && item.target.staffId === entry.dataset.staffId)
    if (!bar) return
    if (input && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      pending.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, bar, ...insertion(bar, p.x, p.y) }
      event.currentTarget.setPointerCapture(event.pointerId)
    } else dispatch({ type: 'pick', selection: bar.target, extend: event.shiftKey, additive: event.ctrlKey || event.metaKey })
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
    if (!item.axis) return
    const action = item.axis === 'vertical' ? { type: 'previewPitch' as const, amount: pitchSteps(dy) } : { type: 'previewDuration' as const, duration: draggedDuration(item.duration, dx) }
    const token = action.type === 'previewPitch' ? `p${action.amount}` : `d${action.duration.n}/${action.duration.d}`
    if (item.token === token) return
    item.token = token
    dispatch({ type: 'canvas', ...item.target, action })
  }
  function finish(event: PointerEvent<HTMLElement>) {
    if (pending.current?.pointerId === event.pointerId) {
      const p = pending.current; pending.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      insert(p.bar.target.partId, p.bar.target.staffId, p.bar.target.measureId, p.start, p.pitch)
      return
    }
    if (drag.current?.pointerId !== event.pointerId) return
    preview(event)
    const item = drag.current; drag.current = null
    dispatch({ type: 'canvas', ...item.target, action: { type: 'commit' } })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (item.axis === null) {
      if (item.insertion) insert(item.target.partId, item.target.staffId, item.target.measureId, item.insertion.start, item.insertion.pitch)
      else if (item.group) dispatch({ type: 'pick', selection: item.target })
    }
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest('input, textarea, select, button, [contenteditable="true"]')) return
    if (event.key === 'Escape') { cancel(); return }
    if (drag.current || pending.current || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); dispatch({ type: 'navigate', direction: event.key === 'ArrowLeft' ? -1 : 1, extend: event.shiftKey })
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (!event.shiftKey && selection) dispatch({ type: 'canvas', ...selection, action: { type: 'pitch', amount: event.key === 'ArrowUp' ? 1 : -1, chromatic: true } })
    }
  }
  return <section ref={root} className="score-surface ensemble-surface" tabIndex={0} aria-label="악보 편집 영역" aria-describedby="editing-help" data-editing="true" data-finger-edit={fingerEdit} data-selected-count={selected?.targets.length ?? 0}
    onKeyDown={keyDown} onPointerDown={start} onPointerMove={preview} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={() => cancel()}
    onDragStart={event => event.preventDefault()} onContextMenu={event => { if (drag.current) event.preventDefault() }}>
    <div ref={notation} className="notation ensemble-notation" style={{ zoom }}/>
  </section>
}
