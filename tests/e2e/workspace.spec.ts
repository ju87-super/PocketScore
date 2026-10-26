import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createProject, primaryScore } from '../../src/project/model'
import type { Project } from '../../src/project/model'
import { addMeasure } from '../../src/project/structure'
import { serializeProject } from '../../src/files/project'

let score = createProject(false)
for (let i = 1; i < 24; i++) score = addMeasure(score)
const measure = primaryScore(score).measures[16]
const bar = (page: Page) => page.locator(`[data-entry-measure="${measure.id}"]`).first()
const desk = (page: Page) => page.getByRole('region', { name: '악보 작업 공간', exact: true })
async function saved(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '악보 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
async function load(page: Page) {
  await page.goto('/PocketScore/')
  await page.locator('input[type=file]').setInputFiles({ name: 'long-score.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(score)) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
}
test('scrolling cancels a pending pen insertion and clears the shadow note', async ({ page }) => {
  await load(page)
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  const first = page.locator('[data-entry-measure]').first()
  const p = await first.evaluate(element => {
    const target = element as SVGElement
    const p = new DOMPoint(Number(target.dataset.noteStartX), Number(target.dataset.staffBottomY) + 10).matrixTransform(element.closest('svg')!.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
  await expect(page.locator('[data-note-input-preview]')).toHaveCount(1)
  await desk(page).evaluate(element => { element.scrollTop += 400 })
  await expect(page.locator('[data-note-input-preview]')).toHaveCount(0)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  expect(await saved(page)).toEqual(score)
})
async function nearMeasure(page: Page) {
  await bar(page).scrollIntoViewIfNeeded()
  await desk(page).evaluate((element, measureId) => {
    const target = element.querySelector<SVGElement>(`[data-entry-measure="${CSS.escape(measureId)}"]`)!
    element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 60
  }, measure.id)
  await expect.poll(() => desk(page).evaluate(element => element.scrollTop)).toBeGreaterThan(100)
}
async function anchor(page: Page) {
  return desk(page).evaluate(element => {
    const top = element.getBoundingClientRect().top
    const first = [...element.querySelectorAll<SVGElement>('[data-entry-measure]')].find(item => item.getBoundingClientRect().bottom > top + 16)!
    return { id: first.dataset.entryMeasure!, staff: first.dataset.staffId!, offset: first.getBoundingClientRect().top - top }
  })
}
async function expectAnchor(page: Page, before: Awaited<ReturnType<typeof anchor>>) {
  await expect.poll(async () => {
    const current = await anchor(page)
    return { id: current.id, staff: current.staff, delta: Math.abs(current.offset - before.offset) < 2 ? 0 : Math.round(current.offset - before.offset) }
  }).toEqual({ id: before.id, staff: before.staff, delta: 0 })
}

test('wheel scrolls only the score; tools edit the seventeenth bar and undo without returning to the top', async ({ page }) => {
  await load(page)
  const toolbar = await page.getByRole('toolbar', { name: '음표 도구 모음' }).boundingBox()
  const transport = await page.getByLabel('재생 도구', { exact: true }).boundingBox()
  const view = await desk(page).boundingBox()
  await page.mouse.move(view!.x + view!.width / 2, view!.y + view!.height / 2)
  await page.mouse.wheel(0, 1000)
  await expect.poll(() => desk(page).evaluate(element => element.scrollTop)).toBeGreaterThan(500)
  await nearMeasure(page)
  await page.locator(`[data-event-id="${measure.voices[0].events[0].id}"]`).click()
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  const before = await desk(page).evaluate(element => element.scrollTop)
  await page.getByRole('button', { name: '8분음표', exact: true }).click()
  expect(await desk(page).evaluate(element => element.scrollTop)).toBeCloseTo(before, 0)
  const p = await bar(page).evaluate(element => {
    const svg = element.closest('svg')!, target = element as SVGElement
    const p = new DOMPoint(Number(target.dataset.noteStartX), Number(target.dataset.staffBottomY) + 10).matrixTransform(svg.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
  await page.mouse.click(p.x, p.y)
  let project = await saved(page)
  expect(primaryScore(project).measures[16].voices[0].events[0]).toMatchObject({ kind: 'note', pitch: { step: 'C', octave: 4, alter: 0 }, start: { n: 0, d: 1 }, duration: { n: 1, d: 8 } })
  expect(primaryScore(project).measures.slice(0, 16)).toEqual(primaryScore(score).measures.slice(0, 16))
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await saved(page)).toEqual(score)
  await page.getByRole('button', { name: '다시 실행', exact: true }).click()
  project = await saved(page)
  expect(primaryScore(project).measures[16].voices[0].events[0].kind).toBe('note')
  expect(await desk(page).evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  expect(await page.getByRole('toolbar', { name: '음표 도구 모음' }).boundingBox()).toEqual(toolbar)
  expect(await page.getByLabel('재생 도구', { exact: true }).boundingBox()).toEqual(transport)
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, overflow: document.documentElement.scrollHeight > innerHeight }))).toEqual({ x: 0, y: 0, overflow: false })
})

test('docked panel reflow, resize/cancel, compact chrome and zoom preserve the visible musical location', async ({ page }) => {
  await load(page); await nearMeasure(page)
  let before = await anchor(page)
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await expectAnchor(page, before)
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await expectAnchor(page, before)
  const handle = page.getByRole('separator', { name: '팔레트 패널 너비', exact: true })
  const rect = (await handle.boundingBox())!
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 100)
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + 100); await page.mouse.up()
  await expect(handle).toHaveAttribute('aria-valuenow', '360')
  await expectAnchor(page, before)
  const resized = (await handle.boundingBox())!
  await page.mouse.move(resized.x + resized.width / 2, resized.y + 100); await page.mouse.down()
  await page.mouse.move(resized.x + resized.width / 2 - 50, resized.y + 100)
  await handle.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect(handle).toHaveAttribute('aria-valuenow', '360')
  await expectAnchor(page, before)
  await page.getByRole('button', { name: '팔레트 패널 닫기' }).click()
  await page.getByRole('button', { name: '속성 패널 닫기' }).click()
  await expectAnchor(page, before)
  before = await anchor(page)
  const oldHeight = (await desk(page).boundingBox())!.height
  await page.getByRole('button', { name: '상단 메뉴 접기' }).click()
  await expect(page.getByRole('navigation', { name: '상단 메뉴' })).toBeHidden()
  expect((await desk(page).boundingBox())!.height).toBeGreaterThan(oldHeight + 60)
  await expectAnchor(page, before)
  await page.getByLabel('악보 배율', { exact: true }).selectOption('1.25')
  await expectAnchor(page, before)
  await page.getByRole('button', { name: '상단 메뉴 펼치기' }).click()
  await expect(page.getByRole('navigation', { name: '상단 메뉴' })).toBeVisible()
    await page.setViewportSize({ width: 800, height: 1280 })
    await expectAnchor(page, before)
  expect(await saved(page)).toEqual(score)
})

test('panel contents and mixer scroll separately while headings and score controls remain available', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 })
  await load(page); await nearMeasure(page)
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '팔레트와 악기' })
  const content = panel.locator('.dock-content'), heading = await panel.locator('.dock-heading').boundingBox()
  const top = await desk(page).evaluate(element => element.scrollTop)
  await content.hover(); await page.mouse.wheel(0, 700)
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(20)
  const panelTop = await content.evaluate(element => element.scrollTop)
  expect(await desk(page).evaluate(element => element.scrollTop)).toBe(top)
  expect(await panel.locator('.dock-heading').boundingBox()).toEqual(heading)
  await page.getByRole('button', { name: '팔레트 패널 닫기' }).click()
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  expect(await content.evaluate(element => element.scrollTop)).toBe(panelTop)
  const height = (await desk(page).boundingBox())!.height
  await page.getByRole('button', { name: '믹서', exact: true }).click()
  expect((await desk(page).boundingBox())!.height).toBe(height)
  await expect(page.getByRole('button', { name: '믹서 닫기' })).toBeInViewport()
  await page.getByRole('button', { name: '믹서 닫기' }).click()
  expect(await saved(page)).toEqual(score)
})

for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
  test(`workspace stays within ${viewport.width}x${viewport.height} and menus do not shift the score`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await load(page); await nearMeasure(page)
    const before = await anchor(page)
    await page.getByRole('button', { name: '팔레트', exact: true }).click()
    await page.getByRole('button', { name: '속성', exact: true }).click()
    if (viewport.width <= 900) await expect(page.getByRole('complementary', { name: '팔레트와 악기' })).toBeHidden()
    await expect(page.getByRole('button', { name: '속성 패널 닫기' })).toBeInViewport()
    await page.getByRole('button', { name: '속성 패널 닫기' }).click()
    await expectAnchor(page, before)
    for (const name of ['파일', '편집', '보기', '추가', '형식', '도구', '도움말']) {
      await page.locator('.menubar summary').getByText(name, { exact: true }).click()
      const menu = (await page.locator('.studio-menu[open] > div').boundingBox())!
      expect(menu.x).toBeGreaterThanOrEqual(0)
      expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width)
    }
    await expect(page.locator('.studio-menu[open]')).toHaveCount(1)
    await page.getByLabel('악보 배율', { exact: true }).click()
    await expect(page.locator('.studio-menu[open]')).toHaveCount(0)
    await page.keyboard.press('Escape') // dismiss the native select, not an editor shortcut
    await page.getByLabel('상태 메시지 자세히', { exact: true }).click()
    await expect(page.locator('.status-details > div')).toBeInViewport()
    const notice = (await page.locator('.status-details > div').boundingBox())!
    expect(notice.x).toBeGreaterThanOrEqual(0)
    expect(notice.x + notice.width).toBeLessThanOrEqual(viewport.width)
    const paper = (await page.locator('.score-page').boundingBox())!
    const notation = (await page.locator('svg[data-score-system]').first().boundingBox())!
    expect(notation.x + notation.width).toBeLessThanOrEqual(paper.x + paper.width)
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width: viewport.width, height: viewport.height })
    const area = (await desk(page).boundingBox())!
    expect(area.height).toBeGreaterThan(viewport.height < 500 ? 130 : viewport.height / 2)
    await page.screenshot({ path: `test-results/workspace-${viewport.width}x${viewport.height}.png` })
  })
}

test.describe('touch navigation (Chromium emulation)', () => {
  test.use({ viewport: { width: 800, height: 1280 }, hasTouch: true })
  test('finger swipe scrolls the inner score without editing; overflow arrows expose offscreen tools', async ({ page }) => {
    await load(page)
    const client = await page.context().newCDPSession(page)
    const view = (await desk(page).boundingBox())!, x = view.x + view.width / 2, y = view.y + view.height - 100
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
    for (let i = 1; i <= 12; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 20, id: 0 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => desk(page).evaluate(element => element.scrollTop)).toBeGreaterThan(100)
    await expect(page.getByRole('button', { name: '다음 음표 도구' })).toBeInViewport()
    await page.getByRole('button', { name: '다음 음표 도구' }).click()
    await expect.poll(() => page.locator('.notation-tools').evaluate(element => element.scrollLeft)).toBeGreaterThan(100)
    await page.getByRole('button', { name: '이전 음표 도구' }).click()
    await expect.poll(() => page.locator('.notation-tools').evaluate(element => element.scrollLeft)).toBe(0)
    expect(await saved(page)).toEqual(score)
    expect(await page.evaluate(() => scrollY)).toBe(0)
  })
})
