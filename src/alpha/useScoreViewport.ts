import { useCallback, useLayoutEffect, useRef } from 'react'

type Anchor = { measure: string; staff: string; offset: number; top: number; left: number }

// View coordinates belong to the workspace, never to the canonical music model.
export function useScoreViewport() {
  const desk = useRef<HTMLElement>(null)
  const anchor = useRef<Anchor | null>(null)
  const remember = useCallback(() => {
    const element = desk.current
    if (!element) return
    // A restored scroll event must not replace the musical anchor merely because
    // an earlier bar now shares its row after content-aware line breaking.
    if (anchor.current?.top === element.scrollTop && anchor.current.left === element.scrollLeft) return
    const top = element.getBoundingClientRect().top
    const bars = [...element.querySelectorAll<SVGElement>('[data-entry-measure]')]
    const bar = bars.find(item => item.getBoundingClientRect().bottom > top + 16)
    anchor.current = bar ? { measure: bar.dataset.entryMeasure!, staff: bar.dataset.staffId!,
      offset: bar.getBoundingClientRect().top - top, top: element.scrollTop, left: element.scrollLeft } : null
  }, [])
  const restore = useCallback((minimumWidth?: number) => {
    const element = desk.current, before = anchor.current
    if (element && minimumWidth !== undefined) element.querySelector<HTMLElement>('.score-page')?.style.setProperty('--notation-min-width', `${Math.ceil(minimumWidth)}px`)
    if (!element || !before) { remember(); return }
    const bar = [...element.querySelectorAll<SVGElement>('[data-entry-measure]')]
      .find(item => item.dataset.entryMeasure === before.measure && item.dataset.staffId === before.staff)
    // Keep the document's beginning at zero; otherwise keep the visible staff/measure.
    element.scrollTop = before.top === 0 ? 0 : bar
      ? element.scrollTop + bar.getBoundingClientRect().top - element.getBoundingClientRect().top - before.offset
      : before.top
    element.scrollLeft = before.left
    if (bar) anchor.current = { ...before, offset: bar.getBoundingClientRect().top - element.getBoundingClientRect().top, top: element.scrollTop, left: element.scrollLeft }
    else { anchor.current = null; remember() }
  }, [remember])
  const reveal = useCallback((target: Element | null) => {
    const element = desk.current
    if (!element || !target) return
    const view = element.getBoundingClientRect(), box = target.getBoundingClientRect()
    if (box.top < view.top + 12) element.scrollTop += box.top - view.top - 12
    else if (box.bottom > view.bottom - 12) element.scrollTop += box.bottom - view.bottom + 12
    if (box.left < view.left + 12) element.scrollLeft += box.left - view.left - 12
    else if (box.right > view.right - 12) element.scrollLeft += box.right - view.right + 12
    remember()
  }, [remember])
  const reset = useCallback(() => { anchor.current = null; if (desk.current) desk.current.scrollTo(0, 0) }, [])
  useLayoutEffect(() => {
    const element = desk.current!
    const resize = () => restore()
    element.addEventListener('scroll', remember, { passive: true })
    window.addEventListener('resize', resize)
    remember()
    return () => { element.removeEventListener('scroll', remember); window.removeEventListener('resize', resize) }
  }, [remember, restore])
  return { desk, remember, restore, reveal, reset }
}
