import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

type Asset = { path: string; sha256: string; bytes: number }

test('isolated beta preview: pinned version, scoped assets, playable bank and editor', async ({ page, request, baseURL }) => {
  test.setTimeout(150000)
  const expected = process.env.POCKETSCORE_EXPECTED_SHA!
  const base = '/PocketScore/beta/'
  await expect.poll(async () => {
    const response = await request.get(`build-info.json?commit=${expected}`, { headers: { 'Cache-Control': 'no-cache' } })
    try { return (await response.json()).sourceSha } catch { return `HTTP ${response.status()}` }
  }, { timeout: 20000, intervals: [1000, 3000] }).toBe(expected)
  const metadata = await (await request.get('build-info.json')).json()
  expect(metadata.base).toBe(base)
  expect(metadata.audioIncluded).toBe(true)
  expect(metadata.assets.length).toBeGreaterThanOrEqual(3)
  for (const asset of metadata.assets as Asset[]) {
    expect(asset.path).toMatch(/^\/PocketScore\/beta\/(assets|audio)\//)
    const url = new URL(asset.path, baseURL)
    expect(url.origin).toBe(new URL(baseURL!).origin)
    const response = await request.get(url.href, { timeout: 90000 })
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).not.toContain('text/html')
    const bytes = await response.body()
    expect(bytes.length).toBe(asset.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
  }

  const exceptions: string[] = []
  page.on('pageerror', exception => exceptions.push(exception.message))
  expect((await page.goto('./'))?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: /PocketScore/ })).toBeVisible()
  await expect(page.locator('.staff-card')).toHaveCount(4)
  await expect(page.locator('[data-event-id=m1-e1]')).toBeVisible()
  await page.locator('[data-event-id=m1-e1]').click()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByLabel('선택 상태')).toContainText('C♯4 4분음표')
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('선택 상태')).toContainText('C4 4분음표')
  expect((await request.get('legacy/')).status()).toBe(200)
  expect(exceptions).toEqual([])
})
