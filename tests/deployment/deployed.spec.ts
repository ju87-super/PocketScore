import { expect, test } from '@playwright/test'

test('serves the deployed HTML and assets, renders four measures, and edits a note', async ({ page, request, baseURL }, testInfo) => {
  test.setTimeout(120_000)
  // Pages can finish deployment before the CDN starts serving the new site.
  await expect.poll(async () => (await request.get('./', { timeout: 10_000 })).status(), {
    message: 'Wait for the deployed site to return HTTP 200',
    timeout: 90_000,
    intervals: [2000, 5000, 10_000],
  }).toBe(200)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const response = await page.goto('./')
  expect(response?.status()).toBe(200)
  expect(response?.headers()['content-type']).toContain('text/html')
  await expect(page.getByRole('heading', { level: 1, name: 'PocketScore' })).toBeVisible()
  await expect(page.getByText('4마디 · 4/4 · 박자 검증 통과')).toBeVisible()
  await expect(page.locator('.event-target')).toHaveCount(14)
  for (const measure of ['m1', 'm2', 'm3', 'm4']) {
    expect(await page.locator(`[data-measure-id="${measure}"]`).count()).toBeGreaterThan(0)
  }
  expect(await page.locator('svg path').count()).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.fonts.check('20px Bravura') && document.fonts.check('20px Academico'))).toBe(true)

  const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll(elements =>
    elements.map(element => element.getAttribute('src') || element.getAttribute('href') || ''),
  )
  expect(assets.length).toBeGreaterThanOrEqual(2)
  for (const asset of assets) {
    const url = new URL(asset, baseURL)
    expect(url.origin).toBe(new URL(baseURL!).origin)
    expect(url.pathname).toMatch(/^\/PocketScore\/assets\//)
    const result = await request.get(url.href)
    expect(result.status()).toBe(200)
    expect(result.headers()['content-type']).toMatch(url.pathname.endsWith('.css') ? /text\/css/ : /javascript/)
    expect((await result.body()).length).toBeGreaterThan(0)
  }

  await page.locator('[data-event-id="m1-e1"]').click()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('selection-status')).toContainText('D4 4분음표')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('selection-status')).toContainText('C4 4분음표')
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('deployed-site.png'), fullPage: true })
})
