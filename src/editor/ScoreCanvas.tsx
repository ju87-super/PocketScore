import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Dispatch, KeyboardEvent, PointerEvent } from 'react'
import { locate } from '../music/score'
import type { Score, Selection } from '../music/score'
import type { Rational } from '../music/rational'
import { disposeScoreRenderer, renderScore } from '../notation/renderScore'
import { draggedDuration, gestureAxis, pitchSteps } from './gesture'
import type { Axis } from './gesture'
import type { Action } from './state'

type Drag = { pointerId: number; x: number; y: number; axis: Axis | null; duration: Rational; lastPreview: string }
type Props = { score: Score; selection: Selection | null; editing: boolean; dispatch: Dispatch<Action> }

export default function ScoreCanvas({ score, selection, editing, dispatch }: Props) {
  const surface = useRef<HTMLElement>(null)
  const notation = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  const cancel = useCallback((event?: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || (event && event.pointerId !== current.pointerId)) return
    drag.current = null
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

  const rendered = useRef({ score, selection, width: 0 })
  useLayoutEffect(() => {
    const width = surface.current!.clientWidth || 800
    rendered.current = { score, selection, width }
    renderScore(notation.current!, score, selection, width)
  }, [score, selection])

  useLayoutEffect(() => {
    const parent = surface.current!
    const observer = new ResizeObserver(() => {
      const nextWidth = parent.clientWidth || 800
      const previous = rendered.current
      if (previous.width === nextWidth) return
      // Reflow invalidates the coordinates of an in-progress gesture.
      cancel()
      rendered.current = { ...previous, width: nextWidth }
      renderScore(notation.current!, previous.score, previous.selection, nextWidth)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [cancel])

  function start(event: PointerEvent<HTMLElement>) {
    if (!editing || drag.current || event.button !== 0 || event.isPrimary === false) return
    const target = (event.target as Element).closest<SVGElement>('[data-event-id]')
    if (!target) return
    const chosen = { measureId: target.dataset.measureId!, voiceId: target.dataset.voiceId!, eventId: target.dataset.eventId! }
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, axis: null, duration: locate(score, chosen).event.duration, lastPreview: '' }
    event.currentTarget.setPointerCapture(event.pointerId)
    dispatch({ type: 'begin', selection: chosen })
  }

  function preview(event: PointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
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
    if (drag.current?.pointerId !== event.pointerId) return
    preview(event)
    drag.current = null
    dispatch({ type: 'commit' })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
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
      <div ref={notation} className="notation" />
    </section>
  )
}
