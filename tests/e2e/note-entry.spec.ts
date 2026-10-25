import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Project } from '../../src/project/model'
import { eventPitches } from '../../src/music/score'
import { midi } from '../../src/music/pitch'

async function menu(page: Page, name: string, item: string) {
  await page.locator('.menubar summary').getByText(name, { exact: true }).click()
  await page.getByRole('button', { name: item, exact: true }).click()
}
async function save(page: Page): Promise<Project> {
  const download = page.waitForEvent('download')
  await menu(page, '파일', '프로젝트 저장')
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'))
}
const events = (project: Project) => project.parts[0].staves[0].score.measures[0].voices[0].events
async function enter(page: Page) {
  await page.locator('.score-surface').focus(); await page.keyboard.press('n')
  await expect(page.getByRole('button', { name: 'N 음표 입력', exact: true })).toHaveAttribute('aria-pressed', 'true')
}
test.beforeEach(async ({ page }) => {
  await page.goto('/PocketScore/')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await menu(page, '파일', '새 악보')
})

test('N, duration, letter and Shift-letter create a real chord, then advance for the next note and rest', async ({ page }) => {
  await enter(page); await page.keyboard.press('5'); await page.keyboard.press('c')
  await page.keyboard.press('Shift+e'); await page.keyboard.press('Shift+g')
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(1)
  await expect(page.locator('[data-note-input-cursor]')).toHaveCount(1)
  await page.keyboard.press('4'); await page.keyboard.press('d'); await page.keyboard.press('0')
  const notes = events(await save(page))
  expect(eventPitches(notes[0]).map(midi)).toEqual([60, 64, 67])
  expect(notes[0].duration).toEqual({ n: 1, d: 4 })
  expect(notes[1]).toMatchObject({ start: { n: 1, d: 4 }, duration: { n: 1, d: 8 }, pitch: { step: 'D' } })
  expect(notes[2]).toMatchObject({ kind: 'rest', start: { n: 3, d: 8 }, duration: { n: 1, d: 8 } })
})

test('mouse input stacks chosen pitches at the same onset without opening properties', async ({ page }) => {
  await enter(page); await page.keyboard.press('c')
  const first = page.locator('.event-target').first()
  await first.scrollIntoViewIfNeeded()
  const box = (await first.boundingBox())!, point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.click(point.x, point.y - 10)
  await page.mouse.click(point.x, point.y - 20)
  expect(eventPitches(events(await save(page))[0]).map(midi)).toEqual([60, 64, 67])
  await page.locator('.score-surface').focus(); await page.keyboard.press('d')
  expect(events(await save(page))[1]).toMatchObject({ start: { n: 1, d: 4 }, pitch: { step: 'D' } })
  await expect(page.locator('.properties')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/note-entry-chord.png', fullPage: true })
})

test('pen input commits on release and moving or cancelling the pending tap does not insert a note', async ({ page }) => {
  await enter(page)
  const first = page.locator('.event-target').first(); await first.scrollIntoViewIfNeeded()
  const box = (await first.boundingBox())!, point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
  await page.keyboard.press('c') // A pending pen tap must not accept a second input path.
  await page.keyboard.press('Escape')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  expect(events(await save(page)).every(event => event.kind === 'rest')).toBe(true)
  await enter(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  expect(events(await save(page))[0].kind).toBe('note')
})

test('numeric lengths and dots edit one selected event but reject group length changes', async ({ page }) => {
  await enter(page); await page.keyboard.press('c'); await page.keyboard.press('e'); await page.keyboard.press('Escape')
  const first = page.locator('.event-target').first()
  await first.click(); await page.keyboard.press('4'); await page.keyboard.press('.')
  expect(events(await save(page))[0].duration).toEqual({ n: 3, d: 16 })
  await first.click(); await page.keyboard.press('Shift+ArrowRight')
  const before = await save(page)
  await page.locator('.score-surface').focus(); await page.keyboard.press('6')
  expect(await save(page)).toEqual(before)
  await expect(page.locator('.studio-status')).toContainText('그룹')
})

test('input accidentals apply to the next letter and the current bar, and natural cancels them', async ({ page }) => {
  await enter(page); await page.getByRole('button', { name: '임시표 ♯', exact: true }).click()
  await page.keyboard.press('f'); await page.keyboard.press('f')
  await page.getByRole('button', { name: '임시표 ♮', exact: true }).click(); await page.keyboard.press('f')
  const notes = events(await save(page))
  expect(notes.slice(0, 3).map(note => eventPitches(note)[0].alter)).toEqual([1, 1, 0])
  await expect(page.locator('[data-note-event] text').filter({ hasText: '\ue262' })).toHaveCount(1)
  await expect(page.locator('[data-note-event] text').filter({ hasText: '\ue261' })).toHaveCount(1)
})

test('Undo and both redo shortcuts restore notes, chord components and the next entry cursor', async ({ page }) => {
  await enter(page); await page.keyboard.press('c'); await page.keyboard.press('Shift+e')
  await page.keyboard.press('Control+z')
  expect(eventPitches(events(await save(page))[0]).map(midi)).toEqual([60])
  await page.keyboard.press('Control+y')
  expect(eventPitches(events(await save(page))[0]).map(midi)).toEqual([60, 64])
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z')
  await page.locator('.score-surface').focus(); await page.keyboard.press('d')
  expect(events(await save(page))[1]).toMatchObject({ start: { n: 1, d: 4 }, pitch: { step: 'D' } })
})

test('Ctrl Alt voice shortcut creates a voice and enters there without replacing the other voice', async ({ page }) => {
  await enter(page); await page.keyboard.press('c'); await page.keyboard.press('Control+Alt+2'); await page.keyboard.press('e')
  const project = await save(page), bar = project.parts[0].staves[0].score.measures[0]
  expect(bar.voices).toHaveLength(2)
  expect(eventPitches(bar.voices[0].events[0]).map(midi)).toEqual([60])
  expect(bar.voices[1].events.find(event => event.kind === 'note')).toMatchObject({ start: { n: 1, d: 4 }, pitch: { step: 'E' } })
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  expect((await save(page)).parts[0].staves[0].score.measures[0].voices).toHaveLength(1)
})

test('text fields retain letters and numbers; Escape restores the existing Shift range selection workflow', async ({ page }) => {
  await page.getByLabel('악보 제목').fill('입력 집중')
  await page.keyboard.type('n5ceg0')
  await expect(page.getByRole('button', { name: 'N 음표 입력', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(events(await save(page)).every(event => event.kind === 'rest')).toBe(true)
  await enter(page); await page.keyboard.press('c'); await page.keyboard.press('e')
  await page.locator('.event-target').first().click({ modifiers: ['Control'] })
  await expect(page.getByRole('button', { name: 'N 음표 입력', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await page.locator('.event-target').first().click(); await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(2)
})

test('continuing at the score end appends one bar and one Undo removes that bar and input together', async ({ page }) => {
  const project = await save(page), score = project.parts[0].staves[0].score
  const lastId = score.measures.at(-1)!.voices[0].events[0].id
  await page.locator(`[data-event-id="${lastId}"]`).click()
  await enter(page); await page.keyboard.press('7'); await page.keyboard.press('c'); await page.keyboard.press('5'); await page.keyboard.press('d')
  expect((await save(page)).parts[0].staves[0].score.measures).toHaveLength(score.measures.length + 1)
  await page.keyboard.press('Control+z')
  const restored = (await save(page)).parts[0].staves[0].score
  expect(restored.measures).toHaveLength(score.measures.length)
  expect(restored.measures.at(-1)!.voices[0].events[0].duration).toEqual({ n: 1, d: 1 })
})

test('portrait reflow keeps the entry caret and saved chords reopen through the normal UI', async ({ page }) => {
  await enter(page); await page.keyboard.press('c'); await page.keyboard.press('Shift+e'); await page.keyboard.press('Shift+g')
  await page.setViewportSize({ width: 800, height: 1280 }); await page.getByLabel('악보 배율').selectOption('1.25')
  await expect(page.locator('[data-note-input-cursor]')).toHaveCount(1)
  const saved = await save(page)
  await menu(page, '파일', '새 악보')
  await page.locator('input[type=file]').setInputFiles({ name: 'chord.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  expect(await save(page)).toEqual(saved)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
