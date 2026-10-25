import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Project } from '../../src/project/model'
import { eventPitches } from '../../src/music/score'
import { midi } from '../../src/music/pitch'

// These scenarios deliberately use screen controls and pointer events only.
// A blank score is created through the same file button the user sees.
async function saved(page: Page): Promise<Project> {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '악보 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'))
}
const events = (project: Project) => project.parts[0].staves[0].score.measures[0].voices[0].events
async function point(page: Page, offset: number, eventId?: string) {
  const bar = page.locator('[data-entry-measure]').first()
  await bar.scrollIntoViewIfNeeded()
  return bar.evaluate((node, options) => {
    const element = node as SVGElement, svg = element.closest('svg')!
    const hit = options.eventId ? svg.querySelector<SVGRectElement>(`[data-event-id="${CSS.escape(options.eventId)}"]`) : null
    const x = hit ? Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2 : Number(element.dataset.noteStartX)
    const position = new DOMPoint(x, Number(element.dataset.staffBottomY) + options.offset).matrixTransform(svg.getScreenCTM()!)
    return { x: position.x, y: position.y }
  }, { offset, eventId })
}
async function clickPitch(page: Page, offset: number, eventId?: string) {
  const p = await point(page, offset, eventId); await page.mouse.click(p.x, p.y)
}
test.beforeEach(async ({ page }) => {
  await page.goto('/PocketScore/')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await page.getByRole('button', { name: '새 악보 만들기', exact: true }).click()
})

test('screen tools enter a chord, transpose the complete chord, delete and undo without keyboard shortcuts', async ({ page }) => {
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  await page.getByRole('button', { name: '4분음표', exact: true }).click()
  await clickPitch(page, 10) // C4
  await page.getByRole('button', { name: '화음 입력', exact: true }).click()
  await clickPitch(page, 0); await clickPitch(page, -10) // E4, G4
  let project = await saved(page)
  expect(eventPitches(events(project)[0]).map(midi)).toEqual([60, 64, 67])
  await page.getByRole('button', { name: '선택 도구', exact: true }).click()
  await page.locator(`[data-event-id="${events(project)[0].id}"][data-pitch-index="0"]`).click()
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await page.getByRole('button', { name: '화음 전체 선택', exact: true }).click()
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '2분음표', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '16분음표', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '반음 올리기', exact: true }).click()
  project = await saved(page)
  expect(eventPitches(events(project)[0]).map(midi)).toEqual([61, 65, 68])
  expect(events(project)[0].duration).toEqual({ n: 1, d: 4 })
  await page.getByRole('button', { name: '선택 음표 삭제', exact: true }).click()
  expect(events(await saved(page))[0]).toMatchObject({ kind: 'rest', duration: { n: 1, d: 4 } })
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(eventPitches(events(await saved(page))[0]).map(midi)).toEqual([61, 65, 68])
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(eventPitches(events(await saved(page))[0]).map(midi)).toEqual([60, 64, 67])
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  expect(eventPitches(events(await saved(page))[0]).map(midi)).toEqual([61, 65, 68])
})

test('visible duration, dot, accidental and rest tools preserve exact timing with mouse input', async ({ page }) => {
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  await page.getByRole('button', { name: '8분음표', exact: true }).click()
  await page.getByRole('button', { name: '점음표', exact: true }).click()
  await page.getByRole('button', { name: '임시표 ♭', exact: true }).click()
  await clickPitch(page, 10)
  let project = await saved(page)
  expect(events(project)[0]).toMatchObject({ pitch: { step: 'C', octave: 4, alter: -1 }, duration: { n: 3, d: 16 } })
  const rest = events(project).find(event => event.kind === 'rest')!
  await page.getByRole('button', { name: '쉼표 입력', exact: true }).click()
  await clickPitch(page, 0, rest.id)
  project = await saved(page)
  expect(events(project)[1]).toMatchObject({ kind: 'rest', start: { n: 3, d: 16 }, duration: { n: 3, d: 16 } })
})

test('voice buttons create the chosen voice and selection restores its checked state for mouse entry', async ({ page }) => {
  await page.getByRole('button', { name: '2성부', exact: true }).click()
  await expect(page.getByRole('button', { name: '2성부', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await clickPitch(page, 10)
  let project = await saved(page), bar = project.parts[0].staves[0].score.measures[0]
  expect(bar.voices[0].events.every(event => event.kind === 'rest')).toBe(true)
  expect(eventPitches(bar.voices[1].events[0]).map(midi)).toEqual([60])
  await page.getByRole('button', { name: '선택 도구', exact: true }).click()
  await page.locator(`[data-event-id="${bar.voices[1].events[0].id}"]`).click()
  await expect(page.getByRole('button', { name: '2성부', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  await clickPitch(page, -10, bar.voices[1].events.find(event => event.kind === 'rest')!.id)
  project = await saved(page); bar = project.parts[0].staves[0].score.measures[0]
  expect(bar.voices[0].events.every(event => event.kind === 'rest')).toBe(true)
  expect(bar.voices[1].events.filter(event => event.kind === 'note').map(event => eventPitches(event).map(midi))).toEqual([[60], [67]])
})

test('hover shows the actual pitch preview without editing score data and selection mode clears it', async ({ page }) => {
  const before = await saved(page)
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  let p = await point(page, 10); await page.mouse.move(p.x, p.y)
  await expect(page.locator('[data-note-input-preview]')).toHaveAttribute('data-preview-pitch', 'C4 4분음표')
  await page.screenshot({ path: 'test-results/studio-pointer-desktop.png' })
  expect(await saved(page)).toEqual(before)
  p = await point(page, -10); await page.mouse.move(p.x, p.y)
  await expect(page.locator('[data-note-input-preview]')).toHaveAttribute('data-preview-pitch', 'G4 4분음표')
  await page.getByRole('button', { name: '선택 도구', exact: true }).click()
  await expect(page.locator('[data-note-input-preview]')).toHaveCount(0)
  await expect(page.locator('[data-note-input-cursor]')).toHaveCount(0)
  expect(await saved(page)).toEqual(before)
})

test('palette and instruments tabs expose real score settings and support undo', async ({ page }) => {
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await page.getByRole('button', { name: '낮은음자리표 적용', exact: true }).click()
  await page.getByLabel('전체 조표', { exact: true }).selectOption('-3')
  await page.getByLabel('전체 박자표', { exact: true }).selectOption('6/8')
  let project = await saved(page)
  expect(project.parts[0].staves[0]).toMatchObject({ clef: 'bass', score: { keySignature: -3, timeSignature: '6/8' } })
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  project = await saved(page)
  expect(project.parts[0].staves[0]).toMatchObject({ clef: 'treble', score: { keySignature: 0, timeSignature: '4/4' } })
  await page.getByRole('tab', { name: '악기', exact: true }).click()
  await page.getByLabel('추가할 악기', { exact: true }).selectOption('guitar')
  await page.getByRole('button', { name: '악기 추가', exact: true }).click()
  expect((await saved(page)).parts[1].instrument).toBe('guitar')
})

test('pen taps enter a chord through visible tools and pointer cancellation never inserts a preview', async ({ page }) => {
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  const cdp = await page.context().newCDPSession(page)
  const tap = async (offset: number, cancel = false) => {
    const p = await point(page, offset)
    if (cancel) await page.locator('.score-surface').evaluate(element => element.addEventListener('pointerdown', event => element.setAttribute('data-test-pointer-id', String((event as PointerEvent).pointerId)), { once: true }))
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
    if (cancel) await page.locator('.score-surface').evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: Number(element.getAttribute('data-test-pointer-id')), pointerType: 'pen' })))
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  }
  await tap(10, true)
  expect(events(await saved(page)).every(event => event.kind === 'rest')).toBe(true)
  await tap(10); await page.getByRole('button', { name: '화음 입력', exact: true }).click(); await tap(0); await tap(-10)
  expect(eventPitches(events(await saved(page))[0]).map(midi)).toEqual([60, 64, 67])
})

for (const width of [390, 800]) test.describe(`pointer controls at ${width}px`, () => {
  test.use({ viewport: { width, height: 1280 }, hasTouch: true })
  test('touch tools remain reachable, multitouch cancels entry and no page-wide horizontal overflow occurs', async ({ page }) => {
    await page.getByLabel('손가락 편집', { exact: true }).check()
    await page.getByRole('button', { name: '음표 입력', exact: true }).click()
    await page.getByRole('button', { name: '4분음표', exact: true }).click()
    const cdp = await page.context().newCDPSession(page), p = await point(page, 10)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }, { x: p.x + 50, y: p.y, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect(events(await saved(page)).every(event => event.kind === 'rest')).toBe(true)
    let position = await point(page, 10); await page.touchscreen.tap(position.x, position.y)
    await page.getByRole('button', { name: '화음 입력', exact: true }).click()
    position = await point(page, 0); await page.touchscreen.tap(position.x, position.y)
    expect(eventPitches(events(await saved(page))[0]).map(midi)).toEqual([60, 64])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/studio-pointer-${width}.png`, fullPage: true })
  })
})
