import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createProject, allSelections, primaryScore } from '../../src/project/model'
import { serializeProject } from '../../src/files/project'
import { exportMusicXML } from '../../src/files/musicxml'

async function menu(page: Page, name: string, item: string) {
  await page.locator('.menubar summary').getByText(name, { exact: true }).click()
  await page.locator('.menubar').getByRole('button', { name: item, exact: true }).click()
}
async function center(locator: Locator) {
  let result!: { x: number; y: number }
  // A panel toggle can replace SVG nodes during ResizeObserver reflow.
  await expect(async () => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    result = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  }).toPass({ timeout: 5000 })
  return result
}
async function save(page: Page) {
  const download = page.waitForEvent('download')
  await menu(page, '파일', '프로젝트 저장')
  return JSON.parse(await readFile((await (await download).path())!, 'utf8')) as ReturnType<typeof createProject>
}
const open = (page: Page, source: string, name = 'score.pocketscore.json') => page.locator('input[type=file]').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'application/xml', buffer: Buffer.from(source) })

let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/PocketScore/')
  await expect(page.locator('[data-event-id=m1-e1]')).toBeVisible()
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
})
test.afterEach(() => expect(errors).toEqual([]))

test('Alpha shows four instruments and keeps keyboard, rest/bar traversal and focus-safe controls', async ({ page }) => {
  await expect(page.locator('.staff-card')).toHaveCount(4)
  await expect(page.locator('svg[data-score-system]')).toHaveCount(2)
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await page.locator('[data-event-id=m1-e1]').click()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByLabel('선택 상태')).toContainText('C♯4')
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('선택 상태')).toContainText('C4')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowUp')
  await expect(page.getByLabel('선택 상태')).toContainText('4분쉼표')
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
  await expect(page.getByLabel('선택 상태')).toContainText('2마디 · G4')
  await page.getByLabel('악보 제목').fill('키보드 집중 테스트')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByLabel('선택 상태')).toContainText('G4')
  await page.screenshot({ path: 'test-results/alpha-desktop.png', fullPage: true })
})

test('Alpha pen edits pitch, ignores horizontal duration drags and supports keyboard duration with undo', async ({ page }) => {
  await page.getByRole('button', { name: '속성', exact: true }).click()
  const cdp = await page.context().newCDPSession(page)
  let point = await center(page.locator('[data-event-id=m1-e1]'))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 32, y: point.y, button: 'left', buttons: 1, pointerType: 'pen' })
  await expect(page.getByLabel('선택 상태')).toContainText('C4 4분음표')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 32, y: point.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled()
  await page.keyboard.press('.')
  await expect(page.getByLabel('선택 상태')).toContainText('점4분음표')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await expect(page.getByLabel('선택 상태')).toContainText('C4 4분음표')
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled()
  point = await center(page.locator('[data-event-id=m1-e1]'))
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x, point.y - 20)
  await page.mouse.move(point.x + 80, point.y - 20); await page.mouse.up()
  await expect(page.getByLabel('선택 상태')).toContainText('E4 4분음표')
  await page.keyboard.press('Control+z')
  point = await center(page.locator('[data-event-id=m1-e1]'))
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x, point.y - 20)
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.getByLabel('선택 상태')).toContainText('C4 4분음표')
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled()
})

test('Alpha creates notes, voices and selected chord tones and reloads complete mixer/project data', async ({ page }) => {
  await menu(page, '파일', '새 악보')
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  await page.locator('.event-target').first().click()
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  const note = page.locator('.event-target').first()
  await note.click()
  await page.getByRole('button', { name: '화음에 3도 추가', exact: true }).click()
  await expect(page.getByLabel('화음 구성음').locator('option')).toHaveCount(2)
  const originalTone = await page.getByLabel('화음 구성음').locator('option').first().textContent()
  await page.getByLabel('화음 구성음').selectOption('1')
  await page.locator('.score-surface').first().focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByLabel('화음 구성음').locator('option').first()).toHaveText(originalTone!)
  await menu(page, '추가', '성부 추가')
  expect((await save(page)).parts[0].staves[0].score.measures[0].voices).toHaveLength(2)
  await page.getByRole('button', { name: '믹서', exact: true }).click()
  await page.getByLabel('피아노 뮤트', { exact: true }).click()
  const saved = await save(page)
  expect(saved.parts[0].mixer.mute).toBe(true)
  await menu(page, '파일', '새 악보')
  await open(page, serializeProject(saved))
  await expect(page.getByLabel('피아노 뮤트', { exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await save(page)).toEqual(saved)
})

test('Alpha blank-staff insertion commits on release and pointer cancellation leaves the score untouched', async ({ page }) => {
  await menu(page, '파일', '새 악보')
  await page.getByRole('button', { name: '음표 입력', exact: true }).click()
  const before = await save(page)
  const entry = page.locator('.entry-target').first()
  await entry.scrollIntoViewIfNeeded()
  const box = (await entry.boundingBox())!
  const point = { x: box.x + box.width * 0.55, y: box.y + 5 }
  await page.mouse.move(point.x, point.y); await page.mouse.down()
  await page.locator('.score-surface').first().evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })))
  await page.mouse.up()
  expect(await save(page)).toEqual(before)
  await page.mouse.click(point.x, point.y)
  const after = await save(page)
  expect(primaryScore(after).measures[0].voices[0].events.some(event => event.kind === 'note')).toBe(true)
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await save(page)).toEqual(before)
})

test('Alpha imports valid MusicXML and refuses unsupported notation without changing the project', async ({ page }) => {
  const project = createProject()
  await open(page, exportMusicXML(project), 'ensemble.musicxml')
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
  await expect(page.locator('.staff-card')).toHaveCount(4)
  const before = await save(page)
  await open(page, exportMusicXML(project).replace('<note>', '<note><tie type="start"/>'), 'tie.musicxml')
  await expect(page.locator('.studio-status')).toContainText('지원하지 않는 MusicXML')
  expect(await save(page)).toEqual(before)
})

test('Alpha plays real bundled SF3 PCM, pauses, seeks, stops and restarts without residual output', { tag: '@audio' }, async ({ page }) => {
  test.setTimeout(120000)
  await page.locator('.score-surface').focus(); await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeVisible({ timeout: 90000 })
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 15000 }).toBeGreaterThan(0.001)
  await expect(page.locator('[data-playing-measure="0"]')).toHaveCount(4)
  await expect(page.locator('[data-playback-cursor]')).toHaveCount(4)
  await page.locator('.score-surface').focus(); await page.keyboard.press('Space')
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent())).toBe(0)
  const paused = Number(await page.getByLabel('재생 위치').inputValue())
  await page.waitForTimeout(250)
  expect(Number(await page.getByLabel('재생 위치').inputValue())).toBe(paused)
  await page.getByLabel('재생 위치').fill('0')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 15000 }).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '정지', exact: true }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await expect(page.locator('[data-playback-cursor]')).toHaveCount(0)
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent())).toBe(0)
  await page.waitForTimeout(1500)
  await expect(page.getByLabel('출력 진폭')).toHaveText('0.0000')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 15000 }).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '정지', exact: true }).click()
})

test('Alpha stop during initial sound download prevents deferred autoplay', { tag: '@audio' }, async ({ page }) => {
  test.setTimeout(120000)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let requested!: () => void
  const request = new Promise<void>(resolve => { requested = resolve })
  await page.route('**/audio/MSBasic.sf3', async route => { requested(); await gate; await route.continue() })
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await request
  await page.getByRole('button', { name: '정지', exact: true }).click()
  release()
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeEnabled({ timeout: 90000 })
  await expect(page.locator('.transport')).toHaveAttribute('data-playing', 'false')
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent())).toBe(0)
})

test('Alpha reports a missing sound asset and retries with a fresh audio context', { tag: '@audio' }, async ({ page }) => {
  test.setTimeout(120000)
  await page.route('**/audio/MSBasic.sf3', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.locator('.studio-status')).toContainText('다운로드 실패 (404)')
  await page.unroute('**/audio/MSBasic.sf3')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 90000 }).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '정지', exact: true }).click()
})

test('Alpha reflows signatures on portrait/zoom and traverses to another instrument', async ({ page }) => {
  const project = createProject()
  await open(page, serializeProject(project))
  await page.getByRole('button', { name: '속성', exact: true }).click()
  const last = allSelections(project)[13]
  await page.locator(`[data-event-id="${last.eventId}"]`).click()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.event-target.selected')).toHaveAttribute('data-event-id', allSelections(project)[14].eventId)
  await expect(page.locator('.score-surface')).toBeFocused()
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.getByLabel('악보 배율').selectOption('1.25')
  await expect(page.locator(`[data-staff-id="${project.parts[0].staves[0].id}"][data-rendered-measure] [data-system-start=true]`)).toHaveCount(primaryScore(project).measures.length)
  await expect(page.locator('.staff-card').first().locator('.vf-timesignature')).toHaveCount(1)
  await page.getByLabel('악보 배율').selectOption('0.75')
  await expect.poll(async () => (await page.locator('.event-target').first().boundingBox())!.width).toBeGreaterThanOrEqual(43.9)
  await page.getByLabel('악보 배율').selectOption('1.25')
  await page.getByRole('button', { name: '속성', exact: true }).click()
  await page.screenshot({ path: 'test-results/alpha-portrait.png', fullPage: true })
})

test('Alpha each instrument emits real audio, and loop/metronome survive transport reuse', { tag: '@audio' }, async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const source = createProject()
  // Short, independent scores exercise the same synth/transport across edits.
  for (const part of source.parts) {
    await test.step(`real PCM from ${part.instrument}`, async () => {
      const project = { ...source, parts: [{ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score, measures: staff.score.measures.slice(0, 1) } })) }], tempos: [{ measure: 0, bpm: 120 }] }
      await open(page, serializeProject(project))
      await expect(page.getByLabel('악보 제목')).toHaveValue(project.title)
      await expect(page.locator('.staff-card')).toHaveCount(1)
      // The title/count are shared by every fixture. Wait for the actual imported
      // instrument, then capture every meter update before playback starts. A
      // one-second poll can miss the sole short drum/bass transient entirely.
      await expect(page.locator('.staff-card')).toContainText(part.name)
      const output = await page.getByLabel('출력 진폭').evaluateHandle(element => {
        const evidence = { peak: 0, samples: [] as number[] }
        const observer = new MutationObserver(() => {
          const value = Number(element.textContent)
          evidence.peak = Math.max(evidence.peak, value)
          evidence.samples.push(value)
        })
        observer.observe(element, { subtree: true, characterData: true, childList: true })
        return { evidence, observer }
      })
      try {
        await page.getByRole('button', { name: '재생', exact: true }).click()
        await expect.poll(() => output.evaluate(state => state.evidence.peak), { timeout: 90000 }).toBeGreaterThan(0.001)
      } finally {
        await testInfo.attach(`pcm-${part.instrument}.json`, { body: JSON.stringify(await output.evaluate(state => { state.observer.disconnect(); return state.evidence })), contentType: 'application/json' })
        await output.dispose()
      }
      await page.getByRole('button', { name: '정지', exact: true }).click()
      await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent())).toBe(0)
    })
  }
  await page.getByLabel('반복', { exact: true }).check()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  let passedHalf = false
  const positions: number[] = []
  await expect.poll(async () => {
    const position = Number(await page.getByLabel('재생 위치').inputValue())
    positions.push(position)
    if (position > 1) passedHalf = true
    return passedHalf && position < 0.5
  }, { timeout: 10000, intervals: [50] }).toBe(true).catch(error => { throw new Error(`${String(error)}; observed positions: ${positions.join(', ')}`) })
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '정지', exact: true }).click()
  const silent = createProject(false)
  await open(page, serializeProject(silent))
  await page.getByLabel('메트로놈', { exact: true }).check()
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 15000 }).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '정지', exact: true }).click()
})

test.describe('Alpha emulated finger input', () => {
  test.use({ hasTouch: true, viewport: { width: 800, height: 1100 } })
  test('finger navigates by default, explicit finger editing changes pitch and cancellation restores it', async ({ page }) => {
    await page.getByRole('button', { name: '속성', exact: true }).click()
    await page.locator('[data-event-id=m1-e1]').click()
    const cdp = await page.context().newCDPSession(page)
    const gesture = async () => {
      const point = await center(page.locator('[data-event-id=m1-e1]'))
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - 20, id: 0 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await gesture()
    await expect(page.getByLabel('선택 상태')).toContainText('C4')
    await page.getByLabel('손가락 편집', { exact: true }).check()
    await gesture()
    await expect(page.getByLabel('선택 상태')).toContainText('E4')
    await page.getByRole('button', { name: '실행 취소', exact: true }).click()
    await expect(page.getByLabel('선택 상태')).toContainText('C4')
    for (const type of ['pointercancel', 'lostpointercapture']) {
      const point = await center(page.locator('[data-event-id=m1-e1]'))
      await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x, point.y - 20)
      await expect(page.getByLabel('선택 상태')).toContainText('E4')
      await page.locator('.score-surface').first().evaluate((element, type) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1 })), type)
      await page.mouse.up()
      await expect(page.getByLabel('선택 상태')).toContainText('C4')
    }
  })
})
