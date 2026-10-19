import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Dispatch, KeyboardEvent, PointerEvent } from 'react'
import { locate } from '../music/score'
import type { Score, Selection } from '../music/score'
import type { Rational } from '../music/rational'
import { fraction } from '../music/rational'
import { STEPS } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import { keyAlter, measureDuration } from '../music/settings'
import { disposeScoreRenderer, renderScore } from '../notation/renderScore'
import type { RenderOptions } from '../notation/renderScore'
import { draggedDuration, gestureAxis, pitchSteps } from './gesture'
import type { Axis } from './gesture'
import type { Action } from './state'

type Drag = { pointerId: number; x: number; y: number; axis: Axis | null; duration: Rational; lastPreview: string; insertion?: { measureId: string; start: Rational; pitch: Pitch } }
type Props = { score: Score; selection: Selection | null; editing: boolean; dispatch: Dispatch<Action>
  options?: RenderOptions; zoom?: number; sensitivity?: number; fingerEdit?: boolean
  onInsert?: (measureId: string, start: Rational, pitch: Pitch) => void
}

export default function ScoreCanvas({ score, selection, editing, dispatch, options, zoom = 1, sensitivity = 1, fingerEdit = true, onInsert }: Props) {
  const surface = useRef<HTMLElement>(null)
  const notation = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const pending = useRef<{ pointerId: number; x: number; y: number; measureId: string; start: Rational; pitch: Pitch } | null>(null)

  const cancel = useCallback((event?: PointerEvent<HTMLElement>) => {
    const current = drag.current ?? pending.current
    if (!current || (event && event.pointerId !== current.pointerId)) return
    drag.current = null
    pending.current = null
    // Clear our transaction before releasing capture: lostpointercapture can
    // arrive synchronously and must not cancel a later gesture.
    if (surface.current?.hasPointerCapture(current.pointerId)) surface.current.releasePointerCapture(current.pointerId)
    dispatch({ type: 'cancel' })
  }, [dispatch])

  useEffect(() => {
    const container = notation.current!
    const loseFocus = () => cancel()
    const visibility = () => { if (document.hidden) cancel() }
    window.addEventListener('blur', loseFocus)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', loseFocus)
      document.removeEventListener('visibilitychange', visibility)
      cancel()
      disposeScoreRenderer(container)
    }
  }, [cancel])

  const rendered = useRef({ score, selection, width: 0, options, zoom })
  useLayoutEffect(() => {
    const width = (surface.current!.clientWidth || 800) / zoom
    rendered.current = { score, selection, width, options, zoom }
    renderScore(notation.current!, score, selection, width, options)
  }, [score, selection, options, zoom])

  useLayoutEffect(() => {
    const parent = surface.current!
    const observer = new ResizeObserver(() => {
      const previous = rendered.current
      const nextWidth = (parent.clientWidth || 800) / previous.zoom
      if (previous.width === nextWidth) return
      // Reflow invalidates the coordinates of an in-progress gesture.
      cancel()
      rendered.current = { ...previous, width: nextWidth }
      renderScore(notation.current!, previous.score, previous.selection, nextWidth, previous.options)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [cancel])

  function start(event: PointerEvent<HTMLElement>) {
    if (!editing || drag.current || pending.current || event.button !== 0 || event.isPrimary === false || (event.pointerType === 'touch' && !fingerEdit)) return
    const target = (event.target as Element).closest<SVGElement>('[data-event-id]')
    if (!target) {
      const entry = (event.target as Element).closest<SVGRectElement>('[data-entry-measure]')
      if (entry && onInsert) {
        event.preventDefault()
        const svg = entry.ownerSVGElement!
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
        const box = entry.getBBox()
        const length = measureDuration(score.timeSignature)
        const ticks = Math.min(length.n * 16 / length.d - 1, Math.max(0, Math.round((point.x - box.x) / box.width * length.n * 16 / length.d)))
        const bottom = options?.clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2
        const value = bottom + Math.round((Number(entry.dataset.staffY) - point.y) / 5)
        const step = STEPS[((value % 7) + 7) % 7]
        pending.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          measureId: entry.dataset.entryMeasure!, start: fraction(ticks, 16), pitch: { step, octave: Math.floor(value / 7), alter: keyAlter(score.keySignature, step) } }
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      return
    }
    const chosen = { measureId: target.dataset.measureId!, voiceId: target.dataset.voiceId!, eventId: target.dataset.eventId! }
    const model = locate(score, chosen).event
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    const entry = target.closest('[data-rendered-measure]')?.querySelector<SVGRectElement>('.entry-target')
    const point = target.ownerSVGElement && new DOMPoint(event.clientX, event.clientY).matrixTransform(target.ownerSVGElement.getScreenCTM()!.inverse())
    const bottom = options?.clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2
    const value = bottom + (entry && point ? Math.round((Number(entry.dataset.staffY) - point.y) / 5) : 0)
    const step = STEPS[((value % 7) + 7) % 7]
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, axis: null, duration: model.duration, lastPreview: '',
      insertion: onInsert && model.kind === 'rest' ? { measureId: chosen.measureId, start: model.start, pitch: { step, octave: Math.floor(value / 7), alter: keyAlter(score.keySignature, step) } } : undefined }
    event.currentTarget.setPointerCapture(event.pointerId)
    dispatch({ type: 'begin', selection: chosen })
  }

  function preview(event: PointerEvent<HTMLElement>) {
    if (pending.current?.pointerId === event.pointerId) {
      if (Math.max(Math.abs(event.clientX - pending.current.x), Math.abs(event.clientY - pending.current.y)) >= 8 * zoom * sensitivity) cancel(event)
      return
    }
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = (event.clientX - current.x) / zoom / sensitivity
    const dy = (event.clientY - current.y) / zoom / sensitivity
    current.axis ??= gestureAxis(dx, dy)
    if (!current.axis) return
    const action = current.axis === 'vertical'
      ? { type: 'previewPitch' as const, amount: pitchSteps(dy) }
      : { type: 'previewDuration' as const, duration: draggedDuration(current.duration, dx) }
    const token = action.type === 'previewPitch' ? `p${action.amount}` : `d${action.duration.n}/${action.duration.d}`
    if (token === current.lastPreview) return
    current.lastPreview = token
    dispatch(action)
  }

  function finish(event: PointerEvent<HTMLElement>) {
    if (pending.current?.pointerId === event.pointerId) {
      const insertion = pending.current
      const tap = Math.max(Math.abs(event.clientX - insertion.x), Math.abs(event.clientY - insertion.y)) < 8 * zoom * sensitivity
      pending.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      if (tap) onInsert?.(insertion.measureId, insertion.start, insertion.pitch)
      return
    }
    if (drag.current?.pointerId !== event.pointerId) return
    preview(event)
    const insertion = drag.current?.axis === null ? drag.current.insertion : undefined
    drag.current = null
    dispatch({ type: 'commit' })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (insertion) onInsert?.(insertion.measureId, insertion.start, insertion.pitch)
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest('input, textarea, select, button, [contenteditable="true"]')) return
    if (event.key === 'Escape') {
      cancel()
      return
    }
    if (!editing || drag.current || event.altKey) return
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
    } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault()
      dispatch({ type: 'redo' })
    } else if (!event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        dispatch({ type: 'cursor', direction: event.key === 'ArrowLeft' ? -1 : 1 })
        requestAnimationFrame(() => notation.current?.querySelector('.selected')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }))
      } else {
        dispatch({ type: 'pitch', amount: event.key === 'ArrowUp' ? 1 : -1, chromatic: event.shiftKey })
      }
    }
  }

  return (
    <section
      ref={surface}
      className="score-surface"
      data-editing={editing}
      data-finger-edit={fingerEdit}
      aria-label="악보 편집 영역"
      aria-describedby="editing-help"
      tabIndex={0}
      onKeyDown={keyDown}
      onPointerDown={start}
      onPointerMove={preview}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onBlur={() => cancel()}
      onContextMenu={event => { if (drag.current) event.preventDefault() }}
    >
      <div ref={notation} className="notation" style={{ zoom }} />
    </section>
  )
}
