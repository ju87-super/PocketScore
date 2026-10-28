import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Project, ProjectSelection } from '../../src/project/model'
import { rhythmProject, longHeldProject, rhythmTarget as target } from '../fixtures/rhythm'
import { compileTimeline } from '../../src/playback/timeline'
import { fraction } from '../../src/music/rational'
import { eventPitches } from '../../src/music/score'
import { midi } from '../../src/music/pitch'

const hit = (page: Page, point: ProjectSelection) => page.locator(`[data-event-id="${point.eventId}"][data-pitch-index="${point.pitchIndex ?? 0}"]`)
const tools = (page: Page) => page.getByRole('toolbar', { name: '음표 도구 모음', exact: true })
const tool = (page: Page, name: string) => tools(page).getByRole('button', { name, exact: true })
const score = (project: Project) => project.parts[0].staves[0].score
const intervals = (project: Project, pitch = 60) => compileTimeline(project).notes.filter(note => note.midi === pitch).map(note => [note.startTick, note.endTick])
async function load(page: Page, project: Project) {
  await page.locator('input[type=file]').setInputFiles({ name: 'automatic-ties.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
}
async function saved(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '악보 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.goto('/PocketScore/')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await load(page, rhythmProject())
})

test('keyboard input splits at a barline, adds a sustained chord and continues after the full requested length', async ({ page }) => {
  await hit(page, target(0, 3)).click()
  await tool(page, '음표 입력').click(); await tool(page, '2분음표').click()
  await page.keyboard.press('c'); await page.keyboard.press('Shift+e')
  const chord = await saved(page)
  expect(intervals(chord)).toEqual([[0, 480], [480, 960], [1440, 2400]])
  expect(intervals(chord, 64)).toEqual([[0, 480], [1440, 2400]])
  expect(score(chord).measures[0].voices[0].events.at(-1)).toMatchObject({ tieTo: [60, 64] })
  await expect(page.locator('[data-score-tie]')).toHaveCount(2)
  await page.locator('.score-surface').focus(); await page.keyboard.press('5'); await page.keyboard.press('d')
  expect(intervals(await saved(page), 62)).toContainEqual([2400, 2880])
  await tool(page, '실행 취소').click(); expect(await saved(page)).toEqual(chord)
  await tool(page, '실행 취소').click()
  expect(eventPitches(score(await saved(page)).measures[0].voices[0].events.at(-1)!).map(midi)).toEqual([60])
  await page.locator('.score-surface').focus(); await page.keyboard.press('Control+Shift+z')
  expect(await saved(page)).toEqual(chord)
})

test('pen emulation previews cross-bar input and release adds a bar atomically; cancellation leaves no input', async ({ page, context }) => {
  await hit(page, target(3, 3)).click(); await tool(page, '음표 입력').click(); await tool(page, '2분음표').click()
  await hit(page, target(3, 3)).scrollIntoViewIfNeeded()
  const box = (await hit(page, target(3, 3)).boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2
  const cdp = await context.newCDPSession(page)
  const press = () => cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, pointerType: 'pen', clickCount: 1 })
  const release = () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, pointerType: 'pen', clickCount: 1 })
  await press()
  await expect(page.locator('[data-note-input-preview]')).not.toHaveAttribute('fill', '#c33636')
  await page.keyboard.press('Escape'); await release()
  expect(await saved(page)).toEqual(rhythmProject())
  await tool(page, '음표 입력').click(); await press(); await release()
  const after = await saved(page), bars = score(after).measures
  expect(bars).toHaveLength(5)
  const first = bars[3].voices[0].events.at(-1)!, next = bars[4].voices[0].events[0]
  expect(first).toMatchObject({ kind: 'note', duration: { n: 1, d: 4 } })
  expect(next).toMatchObject({ kind: 'note', duration: { n: 1, d: 4 } })
  expect(first.kind === 'note' && first.tieTo).toEqual(eventPitches(next).map(midi))
  expect(bars[4].voices[1].events.every(event => event.kind === 'rest')).toBe(true)
  await tool(page, '실행 취소').click(); expect(await saved(page)).toEqual(rhythmProject())
  await tool(page, '다시 실행').click(); expect(await saved(page)).toEqual(after)
  await cdp.detach()
})

test('a whole-note chord crosses four 3/8 bars and creates every missing measure in one edit', async ({ page }) => {
  const source = rhythmProject(), compound: Project = { ...source, parts: source.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, timeSignature: '3/8',
    measures: [{ ...staff.score.measures[0], voices: staff.score.measures[0].voices.map((voice, v) => ({ ...voice, events: Array.from({ length: 3 }, (_, i) => ({ id: `compound-${v}-${i}`, start: fraction(i, 8), duration: fraction(1, 8), kind: 'rest' as const })) })) }],
  } })) })) }
  await load(page, compound)
  await hit(page, { ...target(), eventId: 'compound-0-2' }).click()
  await tool(page, '음표 입력').click(); await tool(page, '온음표').click()
  await page.keyboard.press('c'); await page.keyboard.press('Shift+e')
  const after = await saved(page)
  expect(score(after).measures).toHaveLength(4)
  expect(intervals(after)).toEqual([[480, 2400]])
  expect(intervals(after, 64)).toEqual([[480, 2400]])
  await tool(page, '실행 취소').click(); await tool(page, '실행 취소').click()
  expect(await saved(page)).toEqual(compound)
})

test('short input preserves an unrepresentable held tail with ties and survives file reload', async ({ page }) => {
  await load(page, longHeldProject()); await hit(page, target(1)).click()
  await tool(page, '음표 입력').click(); await tool(page, '16분음표').click(); await page.keyboard.press('d')
  const after = await saved(page)
  expect(intervals(after)).toEqual([[0, 1920], [2040, 7680]])
  expect(intervals(after, 62)).toEqual([[1920, 2040]])
  expect(score(after).measures[1].voices[0].events.map(event => event.duration)).toEqual([fraction(1, 16), fraction(3, 4), fraction(3, 16)])
  await load(page, after); expect(await saved(page)).toEqual(after)
})

test('screen clipboard splits a copied chord at the target barline and restores it with one undo', async ({ page }) => {
  await hit(page, target()).click(); await hit(page, target(0, 0, 1)).click({ modifiers: ['Shift'] })
  await tool(page, '선택 복사').click()
  await hit(page, target(3, 3)).click(); await tool(page, '8분음표').click()
  const before = await saved(page), tail = score(before).measures[3].voices[0].events.at(-1)!
  await hit(page, { ...target(3), eventId: tail.id }).click(); await tool(page, '선택 위치에 붙여넣기').click()
  const after = await saved(page)
  expect(intervals(after).at(-1)).toEqual([7440, 7920])
  expect(intervals(after, 64).at(-1)).toEqual([7440, 7920])
  expect(score(after).measures).toHaveLength(5)
  await tool(page, '실행 취소').click(); expect(await saved(page)).toEqual(before)
})

test('the screen chord tool extends all split segments and preserves the next input position after pointer entry', async ({ page }) => {
  await hit(page, target(0, 3)).click(); await tool(page, '음표 입력').click(); await tool(page, '2분음표').click()
  await page.keyboard.press('c')
  const before = await saved(page), first = score(before).measures[0].voices[0].events.at(-1)!
  await tool(page, '화음 입력').click()
  const head = hit(page, { ...target(), eventId: first.id }); await head.scrollIntoViewIfNeeded()
  const box = (await head.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 10)
  const chord = await saved(page)
  expect(intervals(chord, 64).at(-1)).toEqual([1440, 2400])
  await tool(page, '음표 입력').click(); await tool(page, '4분음표').click(); await page.keyboard.press('g')
  expect(intervals(await saved(page), 67).at(-1)).toEqual([2400, 2880])
})

for (const width of [390, 800]) test(`automatic chord ties reflow without changing stored music at ${width}px`, async ({ page }) => {
  await hit(page, target(0, 3)).click(); await tool(page, '음표 입력').click(); await tool(page, '2분음표').click()
  await page.keyboard.press('c'); await page.keyboard.press('Shift+e')
  const before = await saved(page), from = score(before).measures[0].voices[0].events.at(-1)!.id
  await page.setViewportSize({ width, height: 1280 }); await page.getByLabel('악보 배율').selectOption('1.25')
  await expect(page.locator(`[data-score-tie][data-tie-from="${from}"]`)).not.toHaveCount(0)
  await expect(page.locator('[data-note-input-cursor]')).toHaveCount(1)
  expect(await saved(page)).toEqual(before)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(await page.locator('[data-score-tie]').evaluateAll(groups => groups.every(group => {
    const box = (group as SVGGraphicsElement).getBBox(), svg = group.closest('svg')!
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= svg.width.baseVal.value + 1 && box.y + box.height <= svg.height.baseVal.value + 1
  }))).toBe(true)
  if (width === 800) await page.screenshot({ path: 'test-results/automatic-ties-tablet-emulation.png', fullPage: true })
})

test('real PCM sustains automatically split input past the barline and stop clears its output', { tag: '@audio' }, async ({ page }) => {
  test.setTimeout(120000)
  const source = rhythmProject(), project: Project = { ...source, tempos: [{ measure: 0, bpm: 30 }], parts: source.parts.map(part => ({ ...part, mixer: { ...part.mixer, program: 16 }, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
    measures: staff.score.measures.map(bar => ({ ...bar, voices: [{ ...bar.voices[0], events: bar.voices[0].events.map(event => ({ id: event.id, start: event.start, duration: event.duration, kind: 'rest' as const })) }] })),
  } })) })) }
  await load(page, project); await hit(page, target(3, 3)).click()
  await tool(page, '음표 입력').click(); await tool(page, '온음표').click(); await page.keyboard.press('c')
  const written = await saved(page)
  expect(compileTimeline(written).notes).toMatchObject([{ midi: 60, start: 30, end: 38 }])
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByLabel('재생 위치').fill('31.2')
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue()), { timeout: 10000 }).toBeGreaterThan(32.2)
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent())).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '정지', exact: true }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await expect(page.getByLabel('출력 진폭')).toHaveText('0.0000')
  await page.waitForTimeout(500)
  await expect(page.getByLabel('출력 진폭')).toHaveText('0.0000')
})
