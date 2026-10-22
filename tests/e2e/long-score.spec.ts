import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import type {} from '../performance/types'
import { longScore } from '../fixtures/scores'
import { fraction, ZERO } from '../../src/music/rational'
import { retime } from '../../src/music/score'
import { TIME_SIGNATURES } from '../../src/music/settings'

// A separate test-only production bundle, never a product route or feature.
test.use({ baseURL: 'http://127.0.0.1:4176/tests/performance/' })
test.describe.configure({ mode: 'default' })
let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await page.waitForFunction(() => window.fixture)
  await page.evaluate(async () => { await document.fonts.ready; window.fixture.mount(64) })
  await expect(page.locator('[data-rendered-measure]')).toHaveCount(64)
})
test.afterEach(() => expect(errors).toEqual([]))

function normalize(svg: string) { return svg.replace(/ id="vf-[^"]*"/g, '') }
const digest = (svg: string) => createHash('sha256').update(normalize(svg)).digest('hex')

test('keeps the minimum hit target inside the SVG at the highest and lowest pitches', async ({ page }) => {
  await page.evaluate(() => { window.fixture.mount(4); for (let i = 0; i < 21; i++) window.fixture.act({ type: 'pitch', amount: 1 }) })
  await expect(page.locator('[data-event-id="m1-e1"]')).toHaveAttribute('aria-label', /C7/)
  for (const amount of [0, -35]) {
    if (amount) await page.evaluate(amount => window.fixture.act({ type: 'pitch', amount }), amount)
    const size = await page.locator('[data-event-id="m1-e1"]').evaluate(el => {
      const hit = el.getBoundingClientRect()
      const svg = el.closest('svg')!.getBoundingClientRect()
      return { visibleHeight: Math.min(hit.bottom, svg.bottom) - Math.max(hit.top, svg.top), visibleWidth: Math.min(hit.right, svg.right) - Math.max(hit.left, svg.left) }
    })
    expect(size.visibleHeight).toBeGreaterThanOrEqual(44)
    expect(size.visibleWidth).toBeGreaterThanOrEqual(44)
  }
})

test('reuses the SVG for cursor movement and redraws only changed measures', async ({ page }) => {
  const svg = await page.locator('.notation svg').elementHandle()
  const last = await page.locator('[data-rendered-measure="m64"]').elementHandle()
  const first = await page.locator('[data-rendered-measure="m1"]').elementHandle()
  await page.evaluate(() => window.fixture.act({ type: 'cursor', direction: 1 }))
  expect(await first!.evaluate(node => node.isConnected)).toBe(true)
  await page.evaluate(() => window.fixture.act({ type: 'cursor', direction: -1 }))
  await page.evaluate(() => window.fixture.act({ type: 'pitch', amount: 1 }))
  expect(await first!.evaluate(node => node.isConnected)).toBe(false)
  expect(await last!.evaluate(node => node.isConnected)).toBe(true)
  expect(await svg!.evaluate(node => node.isConnected)).toBe(true)
  await expect(page.locator('[data-event-id="m1-e1"]')).toHaveAttribute('aria-label', /D4/)
  expect(digest(await page.locator('.notation svg').evaluate(el => el.outerHTML)))
    .toBe(digest(await page.evaluate(() => window.fixture.freshSVG())))
})

test('matches a full fresh rendering after duration, history, key, meter and repeated reflow changes', async ({ page }) => {
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      window.fixture.act({ type: 'duration', duration: { n: 1, d: 8 } })
      window.fixture.act({ type: 'undo' })
      window.fixture.act({ type: 'redo' })
      window.fixture.act({ type: 'keySignature', key: -7 })
      window.fixture.act({ type: 'timeSignature', time: '12/8' })
    })
    for (const width of [600, 1440, 800, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('.vf-clef')).toHaveCount(width < 1100 ? 64 : 32)
      const actual = digest(await page.locator('.notation svg').evaluate(el => el.outerHTML))
      expect(actual).toBe(digest(await page.evaluate(() => window.fixture.freshSVG())))
      await expect(page.locator('.notation svg')).toHaveCount(1)
    }
  }
})

test('traverses every event in a long score and edits at the far end without stale targets', async ({ page }) => {
  await page.evaluate(() => {
    for (let i = 0; i < 223; i++) window.fixture.act({ type: 'cursor', direction: 1 })
    window.fixture.act({ type: 'pitch', amount: 1 }) // final rest remains unchanged
  })
  await expect(page.locator('.event-target.selected')).toHaveAttribute('data-event-id', 'm64-e2')
  await page.evaluate(() => {
    window.fixture.act({ type: 'cursor', direction: -1 })
    window.fixture.act({ type: 'pitch', amount: 1 })
  })
  await expect(page.locator('.event-target.selected')).toHaveAttribute('aria-label', /64마디.*A4/)
  await page.evaluate(() => window.fixture.act({ type: 'undo' }))
  await expect(page.locator('.event-target.selected')).toHaveAttribute('aria-label', /64마디.*G4/)
  await expect(page.locator('.event-target')).toHaveCount(224)
})

test('renders all 105 key/meter combinations without clipping glyphs or losing timing', async ({ page }) => {
  const score = longScore(4)
  const short = { ...score, measures: score.measures.map(measure => ({ ...measure, voices: [{ id: 'v1', events: retime([
    { id: `${measure.id}-e1`, kind: 'note', pitch: { step: 'C', octave: 4, alter: 0 }, start: ZERO, duration: fraction(1, 4) },
    { id: `${measure.id}-r`, kind: 'rest', start: ZERO, duration: fraction(3, 4) },
  ]) }] })) }
  await page.evaluate(score => window.fixture.mount(4, score), short)
  for (const time of TIME_SIGNATURES) {
    for (let key = -7; key <= 7; key++) {
      await page.evaluate(({ time, key }) => {
        window.fixture.act({ type: 'timeSignature', time })
        window.fixture.act({ type: 'keySignature', key })
      }, { time, key })
      await expect(page.locator('.vf-timesignature')).toHaveCount(1)
      const stave = page.locator('[data-rendered-measure="m1"]')
      await expect(stave.locator('.vf-keysignature text')).toHaveCount(Math.abs(key))
      await expect(page.locator('[data-event-id="m1-e1"]')).toHaveAttribute('aria-label', /C4 4분음표/)
      const inBounds = await stave.evaluate(group => {
        const svg = group.closest('svg')!.getBoundingClientRect()
        const context = document.createElement('canvas').getContext('2d')!
        return [...group.querySelectorAll('text')].every(text => {
          // SVG text boxes include Bravura's full 160px font cell, not the
          // glyph's ink. Measure actual ink so this detects visible clipping.
          const style = getComputedStyle(text)
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const metrics = context.measureText(text.textContent!)
          const x = Number(text.getAttribute('x'))
          const y = Number(text.getAttribute('y'))
          const matrix = text.getScreenCTM()!
          const topLeft = new DOMPoint(x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent).matrixTransform(matrix)
          const bottomRight = new DOMPoint(x + metrics.actualBoundingBoxRight, y + metrics.actualBoundingBoxDescent).matrixTransform(matrix)
          return topLeft.x >= svg.left && bottomRight.x <= svg.right && topLeft.y >= svg.top && bottomRight.y <= svg.bottom
        })
      })
      expect(inBounds, `key=${key}, meter=${time}`).toBe(true)
    }
  }
})
