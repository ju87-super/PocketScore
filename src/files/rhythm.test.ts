import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importMusicXML, exportMusicXML } from './musicxml'
import { parseProject, serializeProject } from './project'
import { validateProject } from '../project/model'
import type { Project } from '../project/model'
import { eventPitches } from '../music/score'
import { midi } from '../music/pitch'
import { tieLinks } from '../music/ties'
import { compileTimeline } from '../playback/timeline'

const fixture = readFileSync('tests/fixtures/musicxml/rhythm-ties.musicxml', 'utf8')
const music = (project: Project) => project.parts.map(part => part.staves.map(staff => staff.score.measures.map(bar => bar.voices.map(voice => voice.events.map(event => ({ start: event.start, duration: event.duration, pitches: eventPitches(event).map(midi), ties: event.kind === 'note' ? event.tieTo ?? [] : [] }))))))
const altered = (change: (xml: Document) => void) => {
  const xml = new DOMParser().parseFromString(fixture, 'application/xml'); change(xml)
  return new XMLSerializer().serializeToString(xml)
}
describe('fixed short-rhythm and tie MusicXML compatibility', () => {
  it('reads independent golden durations, chord ties, voice independence and a barline continuation', () => {
    const project = importMusicXML(fixture), score = project.parts[0].staves[0].score
    expect(validateProject(project)).toEqual([])
    expect(score.measures[0].voices).toHaveLength(2)
    expect(tieLinks(score).map(link => [link.midi, link.from.measure, link.to.measure])).toEqual([[60, 0, 0], [66, 0, 1]])
    expect(score.measures[1].voices[0].events.slice(0, 4).map(event => event.duration)).toEqual([{ n: 1, d: 4 }, { n: 1, d: 32 }, { n: 1, d: 64 }, { n: 3, d: 64 }])
    expect(compileTimeline(project).notes.filter(note => note.midi === 60)).toMatchObject([{ startTick: 0, endTick: 960 }])
    expect(compileTimeline(project).notes.filter(note => note.midi === 66).map(note => [note.startTick, note.endTick])).toEqual([[1440, 2400], [2400, 2460]])
  })
  it('round-trips all musical tie/rhythm data and every JSON field without integer rounding', () => {
    const source = importMusicXML(fixture), xml = exportMusicXML(source)
    expect(xml).toContain('<divisions>16</divisions>')
    expect(xml).toContain('<type>64th</type>')
    expect(xml).toContain('<type>32nd</type><dot/>')
    expect(xml.match(/<tie type="start"\/>/g)).toHaveLength(2)
    expect(xml.match(/<tied type="stop"\/>/g)).toHaveLength(2)
    expect(music(importMusicXML(xml))).toEqual(music(source))
    expect(parseProject(serializeProject(source))).toEqual(source)
  })
  it.each(['tie', 'notations'])('accepts the standard %s-only representation without duplicate connections', element => {
    const xml = altered(xml => xml.querySelectorAll(element === 'tie' ? 'notations' : 'tie').forEach(item => item.remove()))
    expect(music(importMusicXML(xml))).toEqual(music(importMusicXML(fixture)))
  })
  it.each([
    ['orphan stop', (xml: Document) => xml.querySelectorAll('note')[0].querySelectorAll('tie, tied').forEach(item => item.remove())],
    ['missing stop', (xml: Document) => xml.querySelector('tie[type="stop"]')!.closest('note')!.querySelectorAll('tie, tied').forEach(item => item.remove())],
    ['pitch mismatch', (xml: Document) => { xml.querySelector('tie[type="stop"]')!.closest('note')!.querySelector('step')!.textContent = 'D' }],
    ['voice mismatch', (xml: Document) => { xml.querySelector('tie[type="stop"]')!.closest('note')!.querySelector('voice')!.textContent = '2' }],
    ['sound/notation mismatch', (xml: Document) => xml.querySelector('tied[type="stop"]')!.setAttribute('type', 'start')],
    ['duplicate start', (xml: Document) => { const tie = xml.querySelector('tie')!; tie.parentElement!.append(tie.cloneNode(true)) }],
    ['unsupported continue', (xml: Document) => xml.querySelector('tie')!.setAttribute('type', 'continue')],
    ['rest tie', (xml: Document) => xml.querySelector('rest')!.parentElement!.append(xml.querySelector('tie')!.cloneNode(true))],
  ] as const)('diagnoses %s atomically without changing the open score', (_, change) => {
    const before = importMusicXML(fixture), snapshot = serializeProject(before)
    expect(() => importMusicXML(altered(change))).toThrow('붙임줄')
    expect(serializeProject(before)).toBe(snapshot)
  })
})
