import { expect, test } from '@playwright/test'
import type { CDPSession, Locator, Page } from '@playwright/test'

let pageErrors: string[] = []
test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('./')
  await expect(page.locator('[data-event-id="m1-e1"]')).toBeVisible()
})
test.afterEach(() => expect(pageErrors).toEqual([]))

async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('Missing event hit target')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function drag(page: Page, id: string, dx: number, dy: number) {
  const point = await center(page.locator(`[data-event-id="${id}"]`))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 4 })
  await page.mouse.up()
}

test('renders real notation and embedded fonts, then navigates all rhythm events', async ({ page }) => {
  await expect(page.locator('.event-target')).toHaveCount(14)
  expect(await page.locator('svg path').count()).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.fonts.check('20px Bravura') && document.fonts.check('20px Academico'))).toBe(true)
  const canvas = page.getByRole('region', { name: '악보 편집 영역' })
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('selection-status')).toContainText('C4')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(page.getByTestId('selection-status')).toContainText('C♯4')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('selection-status')).toContainText('C4')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByTestId('selection-status')).toContainText('C♯4')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('selection-status')).toContainText('4분쉼표')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('selection-status')).toContainText('2마디 · G4')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('selection-status')).toContainText('1마디 · 4분쉼표')
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true })
})

test('locks vertical drag intent and records one undoable edit', async ({ page }) => {
  const point = await center(page.locator('[data-event-id="m1-e1"]'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y - 20)
  await expect(page.getByTestId('selection-status')).toContainText('E4 4분음표')
  await page.mouse.move(point.x + 80, point.y - 20)
  await page.mouse.up()
  await expect(page.getByTestId('selection-status')).toContainText('E4 4분음표')
  await page.getByRole('button', { name: '실행 취소' }).click()
  await expect(page.getByTestId('selection-status')).toContainText('C4 4분음표')
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled()
  await page.getByRole('button', { name: '다시 실행' }).click()
  await expect(page.getByTestId('selection-status')).toContainText('E4 4분음표')
})

test('resizes notes and rests horizontally, merges released rests and preserves later onsets', async ({ page }) => {
  await drag(page, 'm1-e1', -64, 0)
  await expect(page.getByTestId('selection-status')).toContainText('C4 8분음표')
  await expect(page.locator('[data-measure-id="m1"]')).toHaveCount(4)
  await expect(page.getByRole('button', { name: '1마디 2번째 점4분쉼표' })).toBeVisible()
  await page.getByRole('button', { name: '실행 취소' }).click()
  await expect(page.getByTestId('selection-status')).toContainText('C4 4분음표')
  await drag(page, 'm1-e2', -64, 0)
  await expect(page.getByTestId('selection-status')).toContainText('8분쉼표 · 시작 1/4')
  await expect(page.locator('[data-measure-id="m1"]')).toHaveCount(5)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('selection-status')).toContainText('8분쉼표 · 시작 3/8')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('selection-status')).toContainText('E4 4분음표 · 시작 1/2')
  await expect(page.getByText('4마디 · 4/4 · 박자 검증 통과')).toBeVisible()
})

test('rolls back pointercancel, capture loss and Escape without recording history', async ({ page }) => {
  await page.locator('[data-event-id="m1-e1"]').click()
  for (const cancel of ['pointercancel', 'lostpointercapture', 'Escape']) {
    const point = await center(page.locator('[data-event-id="m1-e1"]'))
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x, point.y - 20)
    await expect(page.getByTestId('selection-status')).toContainText('E4')
    if (cancel === 'Escape') await page.keyboard.press('Escape')
    else await page.getByRole('region', { name: '악보 편집 영역' }).dispatchEvent(cancel, { pointerId: 1, isPrimary: true, pointerType: 'mouse' })
    await page.mouse.up()
    await expect(page.getByTestId('selection-status')).toContainText('C4 4분음표')
    await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled()
  }
})

test('rejects lengthening through a note and keeps keyboard shortcuts out of toolbar controls', async ({ page }) => {
  await page.locator('[data-event-id="m1-e2"]').click()
  await page.getByRole('button', { name: '도구 막대 펼치기' }).click()
  await page.getByRole('combobox', { name: '선택 길이' }).selectOption({ label: '2분' })
  await expect(page.getByText(/바로 뒤 쉼표의 길이가 부족/)).toBeVisible()
  await expect(page.getByTestId('selection-status')).toContainText('4분쉼표')
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled()
  await page.getByRole('button', { name: '도구 막대 접기' }).click()
  await page.locator('[data-event-id="m1-e1"]').click()
  await page.keyboard.press('ArrowUp')
  await page.getByRole('button', { name: '도구 막대 펼치기' }).focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('selection-status')).toContainText('D4')
})

test('handles an emulated pen through the ordinary Pointer Events path', async ({ page }) => {
  const point = await center(page.locator('[data-event-id="m1-e1"]'))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y - 20, button: 'left', buttons: 1, pointerType: 'pen' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y - 20, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  await expect(page.getByTestId('selection-status')).toContainText('E4')
})

async function touchDrag(cdp: CDPSession, point: { x: number; y: number }, dy: number) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] })
  for (let step = 1; step <= 5; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + dy * step / 5, id: 0 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test.describe('emulated mobile touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 800, height: 800 } })
  test('edits with touch and permits native scrolling in navigation mode', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await touchDrag(cdp, await center(page.locator('[data-event-id="m1-e1"]')), -20)
    await expect(page.getByTestId('selection-status')).toContainText('E4')
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.getByRole('button', { name: '탐색 모드' }).click()
    await touchDrag(cdp, await center(page.locator('[data-event-id="m1-e3"]')), -120)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect(page.getByTestId('selection-status')).toContainText('E4')
  })
})

test('keeps narrow viewport overflow inside the score and the toolbar collapsible', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await expect(page.locator('[data-event-id="m1-e1"]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '도구 막대 펼치기' }).click()
  await expect(page.getByRole('combobox', { name: '선택 길이' })).toBeVisible()
  await page.getByRole('button', { name: '도구 막대 접기' }).click()
  await expect(page.getByRole('combobox', { name: '선택 길이' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true })
})
