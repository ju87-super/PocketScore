import { Accidental, BarlineType, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura'
import { eventName } from '../music/score'
import type { Score, Selection } from '../music/score'

export function renderScore(container: HTMLDivElement, score: Score, selection: Selection | null, availableWidth: number) {
  container.replaceChildren()
  const mostEvents = Math.max(...score.measures.flatMap(measure => measure.voices.map(voice => voice.events.length)))
  const minimum = Math.max(310, mostEvents * 46 + 120)
  const columns = availableWidth >= Math.max(1000, minimum * 2) ? 2 : 1
  const width = Math.max(availableWidth, minimum)
  const measureWidth = (width - 16) / columns
  const height = Math.ceil(score.measures.length / columns) * 220
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const context = renderer.getContext()
  const svg = container.querySelector('svg')!
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', '높은음자리표 4/4박자 악보 4마디')

  score.measures.forEach((measure, measureIndex) => {
    const x = 8 + (measureIndex % columns) * measureWidth
    const y = 32 + Math.floor(measureIndex / columns) * 220
    context.setFont('system-ui', 12).fillText(`${measureIndex + 1}`, x + 8, y + 5)
    const stave = new Stave(x, y, measureWidth)
    stave.addClef('treble').addTimeSignature('4/4')
    if (measureIndex === score.measures.length - 1) stave.setEndBarType(BarlineType.END)
    stave.setContext(context).draw()
    const rendered = measure.voices.map(voice => {
      const notes = voice.events.map(event => {
        const dotted = event.duration.n === 3
        const denominator = event.duration.d / (dotted ? 2 : 1)
        const durations: Record<number, string> = { 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16' }
        const key = event.kind === 'note'
          ? `${event.pitch.step.toLowerCase()}${event.pitch.alter === 1 ? '#' : event.pitch.alter === -1 ? 'b' : ''}/${event.pitch.octave}`
          : 'b/4'
        const note = new StaveNote({ keys: [key], duration: durations[denominator], dots: dotted ? 1 : 0, type: event.kind === 'rest' ? 'r' : 'n', autoStem: true })
        if (dotted) Dot.buildAndAttach([note], { all: true })
        if (event.id === selection?.eventId) note.setStyle({ fillStyle: '#185e99', strokeStyle: '#185e99' })
        return note
      })
      return { model: voice, notes, voice: new Voice({ numBeats: 4, beatValue: 4 }).addTickables(notes) }
    })
    const voices = rendered.map(item => item.voice)
    Accidental.applyAccidentals(voices, 'C')
    new Formatter().joinVoices(voices).formatToStave(voices, stave)
    rendered.forEach(({ voice, notes, model }) => {
      voice.draw(context, stave)
      notes.forEach((note, index) => {
        const event = model.events[index]
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        hit.setAttribute('x', `${note.getAbsoluteX() - 14}`)
        hit.setAttribute('y', `${note.getYs()[0] - 24}`)
        hit.setAttribute('width', '44')
        hit.setAttribute('height', '48')
        hit.setAttribute('rx', '7')
        hit.setAttribute('class', `event-target${selection?.eventId === event.id ? ' selected' : ''}`)
        hit.setAttribute('role', 'button')
        hit.setAttribute('tabindex', '-1')
        hit.setAttribute('aria-label', `${measureIndex + 1}마디 ${index + 1}번째 ${eventName(event)}`)
        hit.setAttribute('aria-pressed', String(selection?.eventId === event.id))
        hit.dataset.measureId = measure.id
        hit.dataset.voiceId = model.id
        hit.dataset.eventId = event.id
        svg.append(hit)
      })
    })
  })
}
