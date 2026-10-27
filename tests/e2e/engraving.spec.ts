import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { engravingProject } from '../fixtures/engraving'
import { serializeProject } from '../../src/files/project'
import { TIME_SIGNATURES } from '../../src/music/settings'
import type { Project } from '../../src/project/model'
import { fraction, ZERO } from '../../src/music/rational'
import { retime } from '../../src/music/score'

async function open(page: Page, project: Project) {
  await page.locator('input[type=file]').setInputFiles({ name: 'engraving.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(project)) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
}
async function saved(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '악보 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
async function beams(page: Page, measure = 'bar0') {
  return page.locator(`[data-rendered-measure="${measure}"] [data-beam-events]`).evaluateAll(elements => elements.map(element => JSON.parse((element as SVGElement).dataset.beamEvents!) as string[]))
}
async function inkOutsideSVG(page: Page) {
  return page.locator('.ensemble-notation').evaluate(element => {
    const context = document.createElement('canvas').getContext('2d')!, errors: string[] = []
    for (const text of element.querySelectorAll<SVGTextElement>('svg text')) {
      const svg = text.closest('svg')!.getBoundingClientRect(), matrix = text.getScreenCTM()!
      const style = getComputedStyle(text)
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const metrics = context.measureText(text.textContent!), x = Number(text.getAttribute('x')), y = Number(text.getAttribute('y'))
      const a = new DOMPoint(x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent).matrixTransform(matrix)
      const b = new DOMPoint(x + metrics.actualBoundingBoxRight, y + metrics.actualBoundingBoxDescent).matrixTransform(matrix)
      if (a.x < svg.left - 1 || b.x > svg.right + 1 || a.y < svg.top - 1 || b.y > svg.bottom + 1) errors.push(text.textContent!)
      if (text.closest('[data-note-event]')) {
        const bar = text.closest('[data-rendered-measure]')!.querySelector('[data-entry-measure]')!.getBoundingClientRect()
        if (a.x < bar.left - 1 || b.x > bar.right + 1) errors.push(`bar:${text.textContent}`)
      }
    }
    for (const beam of element.querySelectorAll<SVGGraphicsElement>('[data-beam-events]')) {
      const b = beam.getBoundingClientRect(), svg = beam.closest('svg')!.getBoundingClientRect()
      if (b.left < svg.left - 1 || b.right > svg.right + 1 || b.top < svg.top - 1 || b.bottom > svg.bottom + 1) errors.push('beam')
    }
    return errors
  })
}
test.beforeEach(async ({ page }) => {
  await page.goto('/PocketScore/')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
})

for (const time of TIME_SIGNATURES) test(`${time} draws real meter-aware beams, flags and exact unchanged score data`, async ({ page }) => {
  const project = engravingProject(time)
  await open(page, project)
  const groups = await beams(page)
  const length = time.endsWith('/8') ? 3 : time === '4/4' ? 4 : 2
  expect(groups.map(group => group.length)).toEqual(Array(project.parts[0].staves[0].score.measures[0].voices[0].events.length / length).fill(length))
  await expect(page.locator('[data-rendered-measure="bar0"] [data-beam-events] path')).not.toHaveCount(0)
  const rests = await beams(page, 'bar2')
  expect(rests.flat()).not.toContain('bar2-n1')
  expect(rests.flat()).not.toContain('bar2-n0') // singleton before the rest
  const small = await beams(page, 'bar1')
  expect(small.every(group => group.length === (time.endsWith('/8') ? 6 : 4))).toBe(true)
  if (time === '4/4') expect((await beams(page, 'bar3')).map(group => group.length)).toEqual([2, 2, 2, 2])
  expect(await inkOutsideSVG(page)).toEqual([])
  expect(await saved(page)).toEqual(project)
  for (const key of [-7, 7]) {
    const keyed = { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, keySignature: key } })) })) }
    await open(page, keyed)
    expect(await inkOutsideSVG(page)).toEqual([])
    await expect(page.locator('.vf-timesignature')).toHaveCount(1)
    await expect(page.locator('.vf-keysignature text')).toHaveCount((await page.locator('svg[data-score-system]').count()) * 7)
    expect(await saved(page)).toEqual(keyed)
  }
})

test('sparse bars share systems while dense chords reserve space; responsive signatures and paper remain correct', async ({ page }) => {
  const project = engravingProject(), barWidths = () => page.locator('[data-entry-measure]').evaluateAll(elements => elements.map(element => ({ id: (element as SVGElement).dataset.entryMeasure, width: Number(element.getAttribute('width')) })))
  await open(page, project)
  let widths = await barWidths()
  expect(widths.find(bar => bar.id === 'bar1')!.width).toBeGreaterThan(widths.find(bar => bar.id === 'bar0')!.width)
  const sparse = { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.filter((_, i) => i !== 1) } })) })) }
  await open(page, sparse)
  expect(await page.locator('svg[data-score-system="0"] [data-rendered-measure]').count()).toBeGreaterThan(2)
  await open(page, project)
  const wideCount = await page.locator('svg[data-score-system]').count()
  for (const width of [800, 390, 1280]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(async () => (await barWidths()).length).toBe(8)
    const systems = page.locator('svg[data-score-system]')
    if (width === 390) await expect.poll(() => systems.count()).toBeGreaterThan(wideCount)
    await expect(page.locator('[data-system-start=true]')).toHaveCount(await systems.count())
    await expect(page.locator('.vf-timesignature')).toHaveCount(1)
    expect(await inkOutsideSVG(page)).toEqual([])
    widths = await barWidths()
    expect(widths.every(bar => bar.width > 80)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/engraving-${width}.png` })
  }
  expect(await saved(page)).toEqual(project)
})

test('multiple voices/staves align shared onsets and preserve beamed chord editing, group rules and undo', async ({ page }) => {
  const source = engravingProject(), staff = source.parts[0].staves[0]
  const upper = { ...staff, score: { ...staff.score, measures: staff.score.measures.map((measure, m) => ({ ...measure, voices: [...measure.voices, { id: 'voice1', events: retime(Array.from({ length: 4 }, (_, i) => ({ id: `lower-${m}-${i}`, kind: 'note' as const, pitch: { step: 'C' as const, octave: 3, alter: 0 as const }, start: ZERO, duration: fraction(1, 4) }))) }] })) } }
  const guitar = { ...source.parts[0], id: 'part1', instrument: 'guitar' as const, name: '기타', staves: [{ ...staff, id: 'staff1', score: { ...staff.score, measures: staff.score.measures.map((measure, m) => ({ ...measure, id: `gbar${m}`, voices: [{ id: 'gvoice', events: retime(Array.from({ length: 8 }, (_, i) => ({ id: `guitar-${m}-${i}`, kind: 'note' as const, pitch: { step: 'A' as const, octave: 3, alter: 0 as const }, start: ZERO, duration: fraction(1, 8) }))) }] })) } }] }
  const project = { ...source, parts: [{ ...source.parts[0], staves: [upper] }, guitar] }
  await open(page, project)
  const x = async (id: string) => page.locator(`[data-event-id="${id}"]`).first().evaluate(element => Number(element.getAttribute('x')) + Number(element.getAttribute('width')) / 2)
  expect(await x('bar0-n0')).toBeCloseTo(await x('guitar-0-0'), 0)
  expect(await x('bar0-n2')).toBeCloseTo(await x('lower-0-1'), 0)
  await expect(page.locator('[data-beam-voice="voice0"]')).not.toHaveCount(0)
  await expect(page.locator('[data-beam-voice="gvoice"]')).not.toHaveCount(0)
  await expect(page.locator('[data-beam-voice="voice1"]')).toHaveCount(0)
  await expect(page.locator('[data-note-event="lower-0-0"]')).toHaveAttribute('data-stem-direction', '-1')
  await expect(page.locator('[data-beam-voice="voice0"]').first()).toHaveAttribute('data-beam-stem', '1')
  await page.locator('[data-event-id="bar1-n0"][data-pitch-index="0"]').click()
  await page.keyboard.press('ArrowDown')
  expect((await saved(page)).parts[0].staves[0].score.measures[1].voices[0].events[0]).toMatchObject({ pitch: { step: 'C', octave: 4, alter: 0 }, duration: { n: 1, d: 16 } })
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await saved(page)).toEqual(project)
  await page.locator('[data-event-id="bar1-n0"][data-pitch-index="0"]').click()
  await page.locator('[data-event-id="bar1-n1"]').click({ modifiers: ['Shift'] })
  await expect(page.getByRole('button', { name: '8분음표', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '온음표', exact: true })).toBeDisabled()
  expect(await inkOutsideSVG(page)).toEqual([])
})

test('extreme beamed pitches and chord hit targets stay inside the SVG at tablet zoom', async ({ page }) => {
  const project = engravingProject('4/4', 4)
  const extreme = { ...project, parts: project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.map(measure => ({ ...measure, voices: measure.voices.map(voice => ({ ...voice, events: voice.events.map((event, i) => event.kind === 'note' ? { ...event, pitch: { step: 'C' as const, octave: i % 2 ? 7 : 2, alter: 0 as const }, chord: undefined } : event) })) })) } })) })) }
  await open(page, extreme)
  await page.setViewportSize({ width: 800, height: 1280 })
  await page.getByLabel('악보 배율', { exact: true }).selectOption('1.5')
  expect(await inkOutsideSVG(page)).toEqual([])
  expect(await page.locator('.event-target').evaluateAll(elements => elements.every(element => Math.abs(element.getBoundingClientRect().width - 44) < 0.1))).toBe(true)
  expect(await saved(page)).toEqual(extreme)
  await page.screenshot({ path: 'test-results/engraving-extreme-tablet.png' })
})

test('incremental beam repaint matches reopening the same score after edits and reflow', async ({ page }) => {
  const project = engravingProject()
  await open(page, project)
  await page.locator('[data-event-id="bar0-n0"]').click()
  await page.keyboard.press('ArrowUp')
  const changed = await saved(page)
  const geometry = () => page.locator('[data-rendered-measure]').evaluateAll(elements => elements.map(group => ({
    id: (group as SVGElement).dataset.renderedMeasure,
    beams: [...group.querySelectorAll('[data-beam-events]')].map(beam => ({ ids: (beam as SVGElement).dataset.beamEvents, paths: [...beam.querySelectorAll('path')].map(path => path.getAttribute('d')) })),
    targets: [...group.querySelectorAll('.event-target')].map(target => [target.getAttribute('data-event-id'), target.getAttribute('x'), target.getAttribute('y')]),
  })))
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.locator('[data-beam-events]')).not.toHaveCount(0)
    const before = await geometry()
    await open(page, changed)
    expect(await geometry()).toEqual(before)
    expect(await saved(page)).toEqual(changed)
  }
})
