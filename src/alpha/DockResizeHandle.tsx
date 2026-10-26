import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'

type Props = { side: 'left' | 'right'; width: number; change: (width: number) => void }
const MIN = 220, MAX = 380
const clamp = (value: number) => Math.max(MIN, Math.min(MAX, value))

export default function DockResizeHandle({ side, width, change }: Props) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null)
  const handle = useRef<HTMLDivElement>(null)
  const latestChange = useRef(change)
  useEffect(() => { latestChange.current = change }, [change])
  const end = (event: PointerEvent<HTMLDivElement>, rollback = false) => {
    const before = drag.current
    if (!before || before.id !== event.pointerId) return
    drag.current = null
    if (rollback) change(before.width)
    if (event.currentTarget.hasPointerCapture(before.id)) event.currentTarget.releasePointerCapture(before.id)
  }
  useEffect(() => {
    const blur = () => {
      const before = drag.current
      if (!before) return
      drag.current = null; latestChange.current(before.width)
      if (handle.current?.hasPointerCapture(before.id)) handle.current.releasePointerCapture(before.id)
    }
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [])
  return <div ref={handle} className={`dock-resizer dock-resizer-${side}`} role="separator" tabIndex={0}
    aria-label={side === 'left' ? '팔레트 패널 너비' : '속성 패널 너비'} aria-orientation="vertical"
    aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width}
    onPointerDown={event => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); drag.current = { id: event.pointerId, x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={event => { const before = drag.current; if (before?.id === event.pointerId) change(clamp(before.width + (event.clientX - before.x) * (side === 'left' ? 1 : -1))) }}
    onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      change(event.key === 'Home' ? MIN : event.key === 'End' ? MAX : clamp(width + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1)))
    }}/>
}
