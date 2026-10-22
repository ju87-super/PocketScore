import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { Dispatch } from 'react'
import ScoreCanvas from '../editor/ScoreCanvas'
import type { Action } from '../editor/state'
import type { Pitch } from '../music/pitch'
import type { Rational } from '../music/rational'
import type { ProjectAction } from '../project/state'
import type { Part, ProjectSelection, Staff } from '../project/model'

type Props = {
  part: Part; staff: Staff; selection: ProjectSelection | null; dispatch: Dispatch<ProjectAction>
  fingerEdit: boolean; zoom: number; sensitivity: number; continuous: boolean; active: boolean
  activate: (partId: string, staffId: string) => void
  insert: (partId: string, staffId: string, measureId: string, start: Rational, pitch: Pitch) => void
  input: boolean; playingMeasure: number | null; playingProgress: number
}
export default memo(function StaffView({ part, staff, selection, dispatch, fingerEdit, zoom, sensitivity, continuous, active, activate, insert, input, playingMeasure, playingProgress }: Props) {
  const element = useRef<HTMLElement>(null)
  const adapter = useCallback((action: Action) => dispatch({ type: 'canvas', partId: part.id, staffId: staff.id, action }), [dispatch, part.id, staff.id])
  const onInsert = useCallback((measureId: string, start: Rational, pitch: Pitch) => insert(part.id, staff.id, measureId, start, pitch), [insert, part.id, staff.id])
  const options = useMemo(() => ({ clef: staff.clef, continuous, targetScale: zoom }), [staff.clef, continuous, zoom])
  useLayoutEffect(() => {
    const root = element.current!
    root.querySelector('[data-playback-cursor]')?.remove()
    if (playingMeasure === null) return
    const measure = staff.score.measures[playingMeasure]
    if (!measure) return
    const group = root.querySelector(`[data-rendered-measure="${CSS.escape(measure.id)}"]`)
    const entry = group?.querySelector<SVGRectElement>('.entry-target')
    if (!entry) return
    const box = entry.getBBox()
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    const x = box.x + box.width * playingProgress
    cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x))
    cursor.setAttribute('y1', String(box.y)); cursor.setAttribute('y2', String(box.y + box.height))
    cursor.setAttribute('data-playback-cursor', 'true')
    cursor.setAttribute('stroke', '#d67416'); cursor.setAttribute('stroke-width', '2')
    group!.append(cursor)
  }, [playingMeasure, playingProgress, staff.score, zoom, continuous])
  return <article ref={element} className="staff-card" data-staff-id={staff.id} data-active={active} data-playing-measure={playingMeasure ?? ''}>
    <header><button className="staff-name" aria-pressed={active} onClick={() => activate(part.id, staff.id)}>{part.name} · {staff.name === part.name ? '오선지 1' : staff.name}</button><span>{staff.score.measures.length}마디 · {staff.score.measures[0].voices.length}성부 {playingMeasure !== null ? ` · ▶ ${playingMeasure + 1}마디` : ''}</span></header>
    <ScoreCanvas score={staff.score} selection={selection?.staffId === staff.id ? selection : null} editing dispatch={adapter} options={options} zoom={zoom} sensitivity={sensitivity} fingerEdit={fingerEdit} onInsert={input ? onInsert : undefined}/>
  </article>
})
