import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export default function ScoreContextMenu({ x, y, dismiss, children }: {
  x: number; y: number; dismiss: (restoreFocus?: boolean) => void; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(new Map<Element, { x: number; y: number }>())
  useLayoutEffect(() => {
    const element = root.current!, rect = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`
    scrollPositions.current = new Map([...document.querySelectorAll<HTMLElement>('.score-desk, .notation-tools, .transport, .dock-content, .mixer-content')]
      .map(item => [item, { x: item.scrollLeft, y: item.scrollTop }]))
    element.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y])
  useEffect(() => {
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) dismiss(false) }
    const scrolled = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return
      const element = event.target as HTMLElement, before = scrollPositions.current.get(element)
      // scrollIntoView can deliver its queued event after the menu has opened.
      // Dismiss only when the scroll position actually changed since opening.
      if (before && (before.x !== element.scrollLeft || before.y !== element.scrollTop)) dismiss(false)
    }
    const close = () => dismiss(false)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', close); window.addEventListener('blur', close)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close) }
  }, [dismiss])
  return <div ref={root} className="score-context-menu" role="menu" aria-label="악보 작업" style={{ left: x, top: y }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return }
      if (event.key === 'Tab') { dismiss(false); return }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
    {children}
  </div>
}
