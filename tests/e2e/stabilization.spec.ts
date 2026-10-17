import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function beginDrag(page: Page) {
  const note = page.locator('[data-event-id="m1-e1"]')
  await note.scrollIntoViewIfNeeded()
  const box = (await note.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 20)
  await expect(page.getByTestId('selection-status')).toContainText('E4')
}

let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await expect(page.locator('.event-target')).toHaveCount(14)
})

test.afterEach(() => expect(errors).toEqual([]))

test('rolls back a drag on window blur instead of leaving a half-finished edit', async ({ page }) => {
  await page.locator('[data-event-id="m1-e1"]').click()
  await beginDrag(page)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByTestId('selection-status')).toContainText('C4')
  await expect(page.getByRole('button', { name: '탐색 모드' })).toBeEnabled()
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled()
})

test('releases pointer capture immediately on Escape and cancels repeated drags cleanly', async ({ page }) => {
  await page.locator('[data-event-id="m1-e1"]').click()
  for (let i = 0; i < 6; i++) {
    await beginDrag(page)
    await page.keyboard.press('Escape')
    expect(await page.getByRole('region', { name: '악보 편집 영역' }).evaluate(el => el.hasPointerCapture(1))).toBe(false)
    await page.mouse.up()
    await expect(page.getByTestId('selection-status')).toContainText('C4')
  }
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled()
})

test('rolls back a drag when resizing repositions its target', async ({ page }) => {
  await page.locator('[data-event-id="m1-e1"]').click()
  await beginDrag(page)
  await page.setViewportSize({ width: 600, height: 900 })
  await expect(page.getByTestId('selection-status')).toContainText('C4')
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled()
})
