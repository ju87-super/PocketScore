import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { allSelections, createProject, replaceEvent, staffAt } from '../../src/project/model'
import type { Project, ProjectSelection } from '../../src/project/model'
import { addStaff, addVoice } from '../../src/project/structure'
import { eventPitches, locate } from '../../src/music/score'
import { midi } from '../../src/music/pitch'

function fixture() {
  let project = createProject()
  const first = allSelections(project)[0]
  project = addStaff(addVoice(project, first.staffId), first.partId)
  project = replaceEvent(project, first, item => item.kind === 'note' ? { ...item, chord: [{ step: 'E', octave: 4, alter: 0 }, { step: 'G', octave: 4, alter: 0 }] } : item)
  const otherVoice = allSelections(project).find(item => item.staffId === first.staffId && item.voiceId !== first.voiceId)!
  project = replaceEvent(project, otherVoice, event => ({ ...event, kind: 'note', pitch: { step: 'D', octave: 4, alter: 0 } }))
  const guitar = allSelections(project).find(item => item.partId === project.parts[1].id)!
  const bass = allSelections(project).find(item => item.partId === project.parts[2].id)!
  return { project, first, otherVoice, guitar, bass }
}
const note = (page: Page, target: ProjectSelection, tone = 0) => page.locator(`[data-event-id="${target.eventId}"][data-pitch-index="${tone}"]`)
const pitches = (project: Project, point: ProjectSelection) => eventPitches(locate(staffAt(project, point).staff.score, point).event).map(midi)
async function open(page: Page, project: Project) {
  await page.goto('/PocketScore/')
  await page.locator('input[type=file]').setInputFiles({ name: 'selection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
}
async function save(page: Page): Promise<Project> {
  await page.locator('.menubar summary').getByText('파일', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'))
}
async function center(page: Page, target: ProjectSelection, tone = 0) {
  let point!: { x: number; y: number }
  await expect(async () => {
    const element = note(page, target, tone)
    await element.scrollIntoViewIfNeeded()
    const box = await element.boundingBox()
    expect(box).not.toBeNull()
    point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  }).toPass({ timeout: 5000 })
  return point
}

test('same-time Shift click selects whole chords, intermediate voices and other instruments', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await note(page, f.first).click()
  await note(page, f.first, 2).click({ modifiers: ['Shift'] })
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(3)
  await note(page, f.guitar).click({ modifiers: ['Shift'] })
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(6)
  await page.keyboard.press('ArrowUp')
  const after = await save(page)
  expect(pitches(after, f.first)).toEqual([61, 65, 68])
  expect(pitches(after, f.otherVoice)).toEqual([63])
  expect(pitches(after, f.guitar)).toEqual([61])
  expect(pitches(after, f.bass)).toEqual([40])
  await page.keyboard.press('Control+z')
  expect(pitches(await save(page), f.first)).toEqual([60, 64, 67])
  await page.keyboard.press('Control+Shift+z')
  expect(pitches(await save(page), f.guitar)).toEqual([61])
})

test('Ctrl selects only chord components across instruments and pitches only those components', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await note(page, f.first).click()
  await note(page, f.first, 2).click({ modifiers: ['Control'] })
  await note(page, f.bass).click({ modifiers: ['Control'] })
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(3)
  await page.keyboard.press('ArrowUp')
  const after = await save(page)
  expect(pitches(after, f.first)).toEqual([61, 64, 68])
  expect(pitches(after, f.bass)).toEqual([41])
  expect(pitches(after, f.otherVoice)).toEqual([62])
  expect(pitches(after, f.guitar)).toEqual([60])
})

test('Shift arrows expand and contract time ranges including rests and crossing barlines', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await note(page, f.first).click()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(4)
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(5)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(4)
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight')
  const measures = await page.locator('.event-target[aria-pressed=true]').evaluateAll(elements => [...new Set(elements.map(element => (element as SVGElement).dataset.measureId))])
  expect(measures).toHaveLength(2)
})

test('group durations are disabled and horizontal pen drags cannot change either direction', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await note(page, f.first).click()
  await note(page, f.first, 2).click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await expect(page.getByLabel('선택 길이')).toBeDisabled()
  const cdp = await page.context().newCDPSession(page)
  for (const dx of [-32, 32]) {
    const origin = await center(page, f.first)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...origin, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: origin.x + dx, y: origin.y, buttons: 1, pointerType: 'pen' })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: origin.x + dx, y: origin.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
    expect(await save(page)).toEqual(f.project)
    await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(2)
  }
})

test('range pitch drag commits once, keeps intervals, and Escape rolls back all selected notes', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await note(page, f.first).click(); await note(page, f.guitar).click({ modifiers: ['Shift'] })
  const origin = await center(page, f.first)
  await page.mouse.move(origin.x, origin.y); await page.mouse.down(); await page.mouse.move(origin.x, origin.y - 20)
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await save(page)).toEqual(f.project)
  const point = await center(page, f.first)
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x, point.y - 20); await page.mouse.up()
  const moved = await save(page)
  expect(pitches(moved, f.first)).toEqual([64, 68, 71])
  expect(pitches(moved, f.guitar)).toEqual([64])
  await page.keyboard.press('Control+z')
  expect(await save(page)).toEqual(f.project)
})

test('measure selection and native dragging use only score highlights, with no blue boxes or DOM text selection', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  const entry = page.locator(`[data-entry-measure="${f.first.measureId}"]`)
  await entry.click({ position: { x: 8, y: 9 } })
  await expect(page.locator('.selected-measure')).toHaveCount(1)
  const styles = await page.locator('.event-target.selected').evaluateAll(elements => elements.map(element => ({ fill: getComputedStyle(element).fill, stroke: getComputedStyle(element).stroke })))
  expect(styles.every(style => style.fill === 'rgba(0, 0, 0, 0)' && (style.stroke === 'rgba(0, 0, 0, 0)' || style.stroke === 'none'))).toBe(true)
  const h = await page.locator('h1').boundingBox()
  await page.mouse.move(h!.x + 5, h!.y + 8); await page.mouse.down(); await page.mouse.move(h!.x + 140, h!.y + 8); await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
})

test('mixers stay current through score undo/redo, and title inputs retain native keyboard behavior', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await note(page, f.first).click(); await page.keyboard.press('ArrowUp')
  await page.getByRole('button', { name: '믹서', exact: true }).click()
  await page.getByLabel('마스터 볼륨').fill('0.25')
  await page.getByLabel('피아노 볼륨', { exact: true }).fill('0.35')
  await page.getByLabel('피아노 팬', { exact: true }).fill('0.5')
  await page.getByLabel('피아노 뮤트', { exact: true }).click()
  await page.keyboard.press('Control+z')
  const undone = await save(page)
  expect(pitches(undone, f.first)).toEqual([60, 64, 67])
  expect(undone.masterVolume).toBe(0.25)
  expect(undone.parts[0].mixer).toMatchObject({ volume: 0.35, pan: 0.5, mute: true })
  await page.keyboard.press('Control+y')
  const redone = await save(page)
  expect(pitches(redone, f.first)).toEqual([61, 64, 67])
  expect(redone.parts[0].mixer).toEqual(undone.parts[0].mixer)
  await page.getByLabel('악보 제목').fill('텍스트 입력')
  await page.keyboard.press('ArrowUp')
  expect(pitches(await save(page), f.first)).toEqual([61, 64, 67])
})

test('full-score systems align bars across instruments and selection survives portrait reflow', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  const before = await page.locator('svg[data-score-system="0"] [data-stave-measure]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().x))
  expect(Math.max(...before.slice(0, 5)) - Math.min(...before.slice(0, 5))).toBeLessThan(1)
  await note(page, f.first).click(); await note(page, f.guitar).click({ modifiers: ['Shift'] })
  await page.setViewportSize({ width: 800, height: 1280 })
  await page.getByLabel('악보 배율').selectOption('1.25')
  await expect(page.locator('.event-target[aria-pressed=true]')).toHaveCount(6)
  await page.locator('.score-surface').focus(); await page.keyboard.press('ArrowDown')
  const after = await save(page)
  expect(pitches(after, f.first)).toEqual([59, 63, 66])
  expect(pitches(after, f.guitar)).toEqual([59])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('existing whole-measure menu copy/paste remains available for a single selected bar', async ({ page }) => {
  const f = fixture(); await open(page, f.project)
  await page.locator(`[data-entry-measure="${f.first.measureId}"]`).click({ position: { x: 8, y: 9 } })
  await page.locator('.menubar summary').getByText('편집', { exact: true }).click()
  await page.getByRole('button', { name: '마디 복사', exact: true }).click()
  const staff = staffAt(f.project, f.first).staff
  await page.locator(`[data-entry-measure="${staff.score.measures[1].id}"]`).click({ position: { x: 8, y: 9 } })
  await page.locator('.menubar summary').getByText('편집', { exact: true }).click()
  await page.getByRole('button', { name: '마디 붙여넣기', exact: true }).click()
  const pasted = staffAt(await save(page), f.first).staff
  const content = (index: number) => pasted.score.measures[index].voices.map(voice => voice.events.map(event => [event.start, event.duration, eventPitches(event).map(midi)]))
  expect(content(1)).toEqual(content(0))
  await page.keyboard.press('Control+z')
  expect(await save(page)).toEqual(f.project)
})

test.describe('touch transaction rollback (emulation)', () => {
  test.use({ hasTouch: true, viewport: { width: 800, height: 1280 } })
  test('a second finger cancels an already previewing touch edit', async ({ page }) => {
    const project = createProject(), first = allSelections(project)[0]
    await open(page, project)
    await page.getByLabel('손가락 편집', { exact: true }).check()
    const origin = await center(page, first)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...origin, id: 0 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x, y: origin.y - 20, id: 0 }] })
    await expect(note(page, first)).toHaveAttribute('aria-label', /E4/)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: origin.x, y: origin.y - 20, id: 0 }, { x: origin.x + 60, y: origin.y, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(note(page, first)).toHaveAttribute('aria-label', /C4/)
    expect(await save(page)).toEqual(project)
  })
})
