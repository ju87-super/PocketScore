import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('serves the validated Alpha commit, production assets, SPA fallback and working editing', async ({ page, request, baseURL }, testInfo) => {
  test.setTimeout(120000)
  const expected = process.env.POCKETSCORE_EXPECTED_SHA!
  await expect.poll(async () => {
    const response = await request.get(`build-info.json?commit=${expected}`, { timeout: 10000, headers: { 'Cache-Control': 'no-cache' } })
    try { return (await response.json()).sourceSha } catch { return `HTTP ${response.status()}` }
  }, { message: 'Wait for the validated deployment, not a stale CDN success', timeout: 90000, intervals: [2000, 5000] }).toBe(expected)
  const metadata = await (await request.get(`build-info.json?commit=${expected}`)).json()
  expect(metadata.base).toBe('/PocketScore/')
  expect(metadata.audioIncluded).toBe(true)
  for (const asset of metadata.assets as { path: string; sha256: string; bytes: number }[]) {
    const url = new URL(asset.path, baseURL)
    expect(url.origin).toBe(new URL(baseURL!).origin)
    expect(url.pathname).toMatch(/^\/PocketScore\/(assets|audio)\//)
    // GitHub Pages/CDN can compress HTTP responses. HEAD Content-Length is
    // the transferred (encoded) byte count, not the original SoundFont size.
    // Check the decoded GET body against the source artifact's size and hash.
    const response = await request.get(url.href, { timeout: 90000 })
    expect(response.status()).toBe(200)
    if (url.pathname.endsWith('.sf3')) {
      expect(response.headers()['content-type']).not.toContain('text/html')
    } else {
      expect(response.headers()['content-type']).toMatch(url.pathname.endsWith('.css') ? /text\/css/ : /javascript/)
    }
    const bytes = await response.body()
    expect(bytes.length).toBe(asset.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
  }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  expect((await page.goto('./'))?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: /PocketScore/ })).toBeVisible()
  await expect(page.locator('.staff-card')).toHaveCount(4)
  await expect(page.locator('[data-event-id=m1-e1]')).toBeVisible()
  expect(await page.evaluate(() => document.fonts.check('20px Bravura') && document.fonts.check('20px Academico'))).toBe(true)
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await page.locator('[data-event-id=m1-e1]').click()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByLabel('선택 상태')).toContainText('D4 4분음표')
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('선택 상태')).toContainText('C4 4분음표')
  await page.screenshot({ path: testInfo.outputPath('deployed-alpha.png'), fullPage: true })
  expect((await request.get('legacy/')).status()).toBe(200)
  expect((await request.get('404.html')).status()).toBe(200)
  // GitHub Pages serves the SPA fallback with HTTP 404; Vite preview uses 200.
  expect([200, 404]).toContain((await page.goto('ci-route-smoke/'))?.status())
  await expect(page.locator('[data-event-id=m1-e1]')).toBeVisible()
  expect(errors).toEqual([])
})
