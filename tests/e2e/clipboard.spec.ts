import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clipboardProject, clipboardTarget as target } from '../fixtures/clipboard'
import type { Project, ProjectSelection } from '../../src/project/model'
import { eventPitches } from '../../src/music/score'
import { midi } from '../../src/music/pitch'

const note = (page: Page, point: ProjectSelection) => page.locator(`[data-event-id="${point.eventId}"][data-pitch-index="${point.pitchIndex ?? 0}"]`)
const menu = (page: Page) => page.getByRole('menu', { name: '악보 작업', exact: true })
const pitches = (project: Project, p = 0, v = 0, m = 0) => project.parts[p].staves[0].score.measures[m].voices[v].events.map(item => eventPitches(item).map(midi))
async function saved(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '악보 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
async function load(page: Page) {
  await page.goto('/PocketScore/')
  await page.locator('input[type=file]').setInputFiles({ name: 'clipboard.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(clipboardProject())) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
}
test.beforeEach(async ({ page }) => { await load(page) })

test('Ctrl C/V copies a Shift range across voices/staves and overwrites existing rows with one undo', async ({ page }) => {
  await note(page, target()).click()
  await note(page, target(1, 0, 1, 1)).click({ modifiers: ['Shift'] })
  await page.keyboard.press('Control+c')
  await note(page, target(0, 1, 2)).click()
  await page.keyboard.press('Control+v')
  const after = await saved(page)
  expect(pitches(after, 0, 1, 2)[0]).toEqual([60, 64, 67])
  expect(pitches(after, 1, 0, 2)[0]).toEqual([48])
  expect(pitches(after, 2, 0, 2)[0]).toEqual([72])
  expect(after.parts[0].staves[0].score.measures[2].voices[0]).toEqual(clipboardProject().parts[0].staves[0].score.measures[2].voices[0])
  await expect(page.getByRole('button', { name: '8분음표', exact: true })).toBeDisabled()
  await page.keyboard.press('Control+z')
  expect(await saved(page)).toEqual(clipboardProject())
  await page.keyboard.press('Control+y')
  expect(await saved(page)).toEqual(after)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z')
  expect(await saved(page)).toEqual(after)
})

test('Ctrl-picked chord tones and nonadjacent rows retain offsets; copied holes become rests', async ({ page }) => {
  await note(page, target()).click()
  await note(page, target(0, 0, 0, 0, 2)).click({ modifiers: ['Control'] })
  await note(page, target(2, 0, 0, 2)).click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: '선택 복사', exact: true }).click()
  await note(page, target(0, 0, 1)).click()
  await page.getByRole('button', { name: '선택 위치에 붙여넣기', exact: true }).click()
  const after = await saved(page)
  expect(pitches(after, 0, 0, 1)).toEqual([[60, 67], [], [67]])
  expect(after.parts[0].staves[0].score.measures[1].voices[0].events.map(item => item.duration)).toEqual([{ n: 1, d: 4 }, { n: 1, d: 2 }, { n: 1, d: 4 }])
  expect(after.parts[0].staves[0].score.measures[1].voices[1].events).toMatchObject([
    { kind: 'rest', start: { n: 0, d: 1 }, duration: { n: 1, d: 2 } },
    { kind: 'note', start: { n: 1, d: 2 }, pitch: { step: 'E', octave: 2 } }, { kind: 'note', start: { n: 3, d: 4 } },
  ])
})

test('screen copy and context paste append missing measures on every staff and undo atomically', async ({ page }) => {
  await page.locator('[data-entry-measure="bar-0-0"]').click({ position: { x: 8, y: 8 } })
  await page.locator('[data-entry-measure="bar-0-1"]').click({ position: { x: 8, y: 8 }, modifiers: ['Shift'] })
  await page.getByRole('button', { name: '선택 복사', exact: true }).click()
  await page.locator('[data-entry-measure="bar-0-3"]').click({ position: { x: 8, y: 8 }, button: 'right' })
  await expect(menu(page)).toBeVisible()
  await menu(page).getByRole('menuitem', { name: '붙여넣기', exact: true }).click()
  const after = await saved(page)
  expect(after.parts.every(part => part.staves[0].score.measures.length === 5)).toBe(true)
  expect(pitches(after, 0, 0, 3)).toEqual(pitches(clipboardProject()))
  expect(pitches(after, 0, 1, 4)).toEqual(pitches(clipboardProject(), 0, 1, 1))
  expect(after.parts[2].staves[0].score.measures[4].voices[0].events.every(item => item.kind === 'rest')).toBe(true)
  await expect(page.locator('.studio-status')).toContainText('1마디 추가')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await saved(page)).toEqual(clipboardProject())
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  expect(await saved(page)).toEqual(after)
})

test('paste skips excess source rows at the bottom and context click preserves a selected group', async ({ page }) => {
  await note(page, target()).click(); await note(page, target(1)).click({ modifiers: ['Shift'] })
  const count = await page.locator('.event-target[aria-pressed=true]').count()
  await note(page, target(0, 0, 0, 0, 2)).click({ button: 'right' })
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(count)
  await expect(menu(page).getByRole('menuitem', { name: '16분음표로 변경', exact: true })).toBeDisabled()
  await expect(menu(page).getByRole('menuitem', { name: '온음표로 변경', exact: true })).toBeDisabled()
  await menu(page).getByRole('menuitem', { name: '복사', exact: true }).click()
  await note(page, target(2, 0, 1)).click({ button: 'right' })
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(1)
  await menu(page).getByRole('menuitem', { name: '붙여넣기', exact: true }).click()
  await expect(page.locator('.studio-status')).toContainText('2개 성부 건너뜀')
  const after = await saved(page)
  expect(after.parts).toHaveLength(3)
  expect(pitches(after, 2, 0, 1)[0]).toEqual([60, 64, 67])
  expect(after.parts[0]).toEqual(clipboardProject().parts[0])
})

test('context edits apply to the selected group; a single note can change duration and rests reject accidentals', async ({ page }) => {
  await note(page, target()).click(); await note(page, target(0, 0, 0, 2)).click({ modifiers: ['Shift'] })
  await note(page, target()).click({ button: 'right' })
  await menu(page).getByRole('menuitem', { name: '반음 올리기', exact: true }).click()
  expect(pitches(await saved(page))[0]).toEqual([61, 65, 68])
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await note(page, target()).click({ button: 'right' })
  await menu(page).getByRole('menuitem', { name: '화음 전체 선택', exact: true }).click()
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(3)
  await note(page, target(1, 0, 0, 1)).click({ button: 'right' })
  await menu(page).getByRole('menuitem', { name: '8분음표로 변경', exact: true }).click()
  const after = await saved(page), items = after.parts[1].staves[0].score.measures[0].voices[0].events
  expect(items[1]).toMatchObject({ kind: 'note', start: { n: 1, d: 4 }, duration: { n: 1, d: 8 } })
  expect(items[2]).toMatchObject({ kind: 'rest', start: { n: 3, d: 8 }, duration: { n: 1, d: 8 } })
  await note(page, { ...target(1), eventId: items[2].id }).click({ button: 'right' })
  await expect(menu(page).getByRole('menuitem', { name: '선택 음에 ♯', exact: true })).toBeDisabled()
  await expect(menu(page).getByRole('menuitem', { name: '반음 올리기', exact: true })).toBeDisabled()
})

test('copy preserves redo and captures pitches before source changes', async ({ page }) => {
  await note(page, target(0, 0, 0, 0, 2)).click()
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+c')
  await expect(page.getByRole('button', { name: '다시 실행', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  await note(page, target(1, 0, 2)).click()
  await page.keyboard.press('Control+v')
  const after = await saved(page)
  expect(pitches(after)[0]).toEqual([60, 64, 68])
  expect(pitches(after, 1, 0, 2)[0]).toEqual([67])
})

test('text fields keep native Ctrl C/V and do not copy or paste score data', async ({ page }) => {
  await note(page, target()).click()
  const title = page.getByLabel('악보 제목', { exact: true })
  await title.fill('텍스트')
  await title.evaluate(element => {
    element.setAttribute('data-copy-default', 'pending'); element.setAttribute('data-paste-default', 'pending')
    element.addEventListener('keydown', event => {
      const key = event as KeyboardEvent
      if (key.ctrlKey && (key.key === 'c' || key.key === 'v')) queueMicrotask(() => element.setAttribute(key.key === 'c' ? 'data-copy-default' : 'data-paste-default', String(key.defaultPrevented)))
    })
  })
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Control+v')
  await expect(title).toHaveAttribute('data-copy-default', 'false')
  await expect(title).toHaveAttribute('data-paste-default', 'false')
  await expect(page.getByRole('button', { name: '선택 위치에 붙여넣기', exact: true })).toBeDisabled()
  expect((await saved(page)).parts).toEqual(clipboardProject().parts)
})

test('barline-crossing paste creates ties and one undo restores the previous music and bar count', async ({ page }) => {
  await note(page, target(1)).click(); await page.keyboard.press('Control+c')
  await note(page, target(0, 0, 3, 3)).click()
  await page.getByRole('button', { name: '8분음표', exact: true }).click()
  const before = await saved(page), rest = before.parts[0].staves[0].score.measures[3].voices[0].events.at(-1)!
  await note(page, { ...target(0, 0, 3), eventId: rest.id }).click()
  await page.keyboard.press('Control+v')
  await expect(page.locator('.studio-status')).toContainText('붙여넣기 완료')
  const after = await saved(page), score = after.parts[0].staves[0].score
  expect(score.measures).toHaveLength(5)
  expect(score.measures[3].voices[0].events.at(-1)).toMatchObject({ duration: { n: 1, d: 8 }, tieTo: [72] })
  expect(score.measures[4].voices[0].events[0]).toMatchObject({ duration: { n: 1, d: 8 }, pitch: { step: 'C', octave: 5 } })
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await saved(page)).toEqual(clipboardProject())
})

test('Meta C/V copies individual chord pitches through the same score commands', async ({ page }) => {
  await note(page, target(0, 0, 0, 0, 1)).click(); await page.keyboard.press('Meta+c')
  await note(page, target(1, 0, 2)).click(); await page.keyboard.press('Meta+v')
  expect(pitches(await saved(page), 1, 0, 2)[0]).toEqual([64])
})

test('emulated pen right-click opens tools without entering or dragging a note', async ({ page }) => {
  const element = note(page, target())
  await element.scrollIntoViewIfNeeded()
  const box = (await element.boundingBox())!, point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'right', buttons: 2, clickCount: 1, pointerType: 'pen' })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'right', buttons: 0, clickCount: 1, pointerType: 'pen' })
  await expect(menu(page)).toBeVisible()
  await menu(page).getByRole('menuitem', { name: '복사', exact: true }).click()
  expect(await saved(page)).toEqual(clipboardProject())
})

for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1280 }, { width: 1280, height: 900 }, { width: 844, height: 390 }]) test(`context and screen actions fit ${viewport.width}x${viewport.height}, support focus and dismissal`, async ({ page }) => {
  await page.setViewportSize(viewport)
  await note(page, target()).click({ button: 'right' })
  await expect(menu(page)).toBeVisible()
  const box = (await menu(page).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  await expect(menu(page).getByRole('menuitem', { name: '복사', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home')
  await expect(menu(page).getByRole('menuitem', { name: '복사', exact: true })).toBeFocused()
  await page.screenshot({ path: `test-results/clipboard-context-${viewport.width}x${viewport.height}.png` })
  await page.keyboard.press('Escape')
  await expect(menu(page)).toHaveCount(0)
  await expect(page.locator('.score-surface')).toBeFocused()
  await page.getByRole('button', { name: '선택 작업', exact: true }).click()
  await expect(menu(page)).toBeVisible()
  await page.locator('.menubar summary').getByText('보기', { exact: true }).click()
  await expect(menu(page)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true)
})
