import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Project } from '../../src/project/model'

async function saved(page: Page): Promise<Project> {
  await page.locator('.menubar summary').getByText('파일', { exact: true }).click()
  const event = page.waitForEvent('download')
  await page.locator('.menubar').getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'))
}
async function point(page: Page, id: string) {
  const target = page.locator(`[data-event-id="${id}"]`)
  let origin!: { x: number; y: number }
  // ResizeObserver may replace SVG nodes after the palette changes width.
  // Wait for a live target before sending input; never repeat the gesture.
  await expect(async () => {
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    expect(box).not.toBeNull()
    origin = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  }).toPass({ timeout: 5000 })
  return origin
}
test.beforeEach(async ({ page }) => {
  await page.goto('/PocketScore/')
  await expect(page.locator('[data-event-id=m1-e1]')).toBeVisible()
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
})
for (const move of [
  { name: 'right preserves duration; key 6 lengthens', dx: 32, dy: 0, duration: { n: 1, d: 2 }, pitch: { step: 'C', octave: 4, alter: 0 } },
  { name: 'left preserves duration; key 3 shortens', dx: -32, dy: 0, duration: { n: 1, d: 16 }, pitch: { step: 'C', octave: 4, alter: 0 } },
  { name: 'up raises pitch', dx: 0, dy: -20, duration: { n: 1, d: 4 }, pitch: { step: 'E', octave: 4, alter: 0 } },
  { name: 'down lowers pitch', dx: 0, dy: 20, duration: { n: 1, d: 4 }, pitch: { step: 'A', octave: 3, alter: 0 } },
]) test(`CI emulated S Pen ${move.name}`, async ({ page }) => {
  const origin = await point(page, 'm1-e1')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...origin, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: origin.x + move.dx, y: origin.y + move.dy, buttons: 1, pointerType: 'pen' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: origin.x + move.dx, y: origin.y + move.dy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  if (move.dx) {
    expect((await saved(page)).parts[0].staves[0].score.measures[0].voices[0].events[0].duration).toEqual({ n: 1, d: 4 })
    await page.locator('.score-surface').focus()
    await page.keyboard.press(move.dx > 0 ? '6' : '3')
  }
  const event = (await saved(page)).parts[0].staves[0].score.measures[0].voices[0].events[0]
  expect(event).toMatchObject({ duration: move.duration, pitch: move.pitch })
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect((await saved(page)).parts[0].staves[0].score.measures[0].voices[0].events[0]).toMatchObject({ pitch: { step: 'C', octave: 4, alter: 0 }, duration: { n: 1, d: 4 } })
})

for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }]) {
  test(`CI new score / input / instrument / reopen at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.locator('.menubar summary').getByText('파일', { exact: true }).click()
    await page.locator('.menubar').getByRole('button', { name: '새 악보', exact: true }).click()
    await page.getByRole('button', { name: '음표 입력', exact: true }).click()
    await page.locator('.event-target').first().click()
    await page.getByRole('button', { name: '음표 입력', exact: true }).click()
    await page.locator('.event-target').first().click()
    await page.keyboard.press('ArrowUp')
    await page.getByRole('button', { name: '팔레트', exact: true }).click()
    await page.getByRole('tab', { name: '악기', exact: true }).click()
    await page.getByLabel('추가할 악기', { exact: true }).selectOption('guitar')
    await page.getByRole('button', { name: '악기 추가', exact: true }).click()
    await expect(page.locator('.staff-card')).toHaveCount(2)
    await page.getByRole('button', { name: '팔레트', exact: true }).click()
    const project = await saved(page)
    expect(project.parts[0].staves[0].score.measures[0].voices[0].events[0].kind).toBe('note')
    expect(project.parts[1].instrument).toBe('guitar')
    await page.locator('input[type=file]').setInputFiles({ name: 'reopen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
    expect(await saved(page)).toEqual(project)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test.describe('multi-touch isolation (emulation only)', () => {
  test.use({ hasTouch: true })
  test('a second contact does not edit another note in navigation or explicit touch-edit mode', async ({ page }) => {
    const before = await saved(page)
    const cdp = await page.context().newCDPSession(page)
    for (const edit of [false, true]) {
      if (edit) await page.getByLabel('손가락 편집', { exact: true }).check()
      const first = await point(page, 'm1-e1')
      const second = await point(page, 'm1-e3')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 0 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 0 }, { ...second, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, id: 0 }, { x: second.x, y: second.y - 30, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      expect(await saved(page)).toEqual(before)
    }
  })
})
