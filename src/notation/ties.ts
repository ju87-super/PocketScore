import { StaveTie } from 'vexflow/bravura'
import type { Renderer, StaveNote } from 'vexflow/bravura'
import type { TieLink } from '../music/ties'

export type TieAnchor = { note: StaveNote; renderer: Renderer; system: number; voiceCount: number }
export function drawTies(links: readonly TieLink[], anchors: ReadonlyMap<string, TieAnchor>) {
  const svgs = new Set([...anchors.values()].map(anchor => anchor.note.getSVGElement()?.ownerSVGElement))
  svgs.forEach(svg => svg?.querySelectorAll('[data-score-tie]').forEach(group => group.remove()))
  for (const link of links) {
    const first = anchors.get(link.from.event.id), last = anchors.get(link.to.event.id)
    if (!first || !last) continue
    const draw = (a: TieAnchor | null, b: TieAnchor | null) => {
      const context = (a ?? b)!.renderer.getContext(), group = context.openGroup('score-tie')
      group.dataset.scoreTie = 'true'; group.dataset.tieFrom = link.from.event.id; group.dataset.tieTo = link.to.event.id; group.dataset.tieMidi = String(link.midi)
      group.setAttribute('pointer-events', 'none')
      new StaveTie({ firstNote: a?.note, lastNote: b?.note,
        firstIndexes: [a ? link.from.pitchIndex : link.to.pitchIndex], lastIndexes: [b ? link.to.pitchIndex : link.from.pitchIndex],
      }).setDirection((first.voiceCount > 1 ? -1 : 1) * first.note.getStemDirection()).setContext(context).draw()
      context.closeGroup()
    }
    if (first.system === last.system && first.renderer === last.renderer) draw(first, last)
    else { draw(first, null); draw(null, last) }
  }
}
