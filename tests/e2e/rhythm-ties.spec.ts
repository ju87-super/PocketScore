import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { heldRhythmProject, longHeldProject, rhythmProject, rhythmTarget as target } from '../fixtures/rhythm'
import type { Project, ProjectSelection } from '../../src/project/model'
import { eventPitches } from '../../src/music/score'
import { midi } from '../../src/music/pitch'
import { fraction } from '../../src/music/rational'

const hit = (page: Page, point: ProjectSelection) => page.locator(`[data-event-id="${point.eventId}"][data-pitch-index="${point.pitchIndex ?? 0}"]`)
const tools = (page: Page) => page.getByRole('toolbar', { name: '음표 도구 모음', exact: true })
const voice = (project: Project, bar = 0) => project.parts[0].staves[0].score.measures[bar].voices[0].events
const pitches = (project: Project, bar = 0) => voice(project, bar).map(event => eventPitches(event).map(midi))
async function load(page: Page, project: Project) {
  await page.locator('input[type=file]').setInputFiles({ name: 'rhythm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
}
async function saved(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '악보 저장', exact: true }).click()
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
const musical = (project: Project) => project.parts.map(part => part.staves.map(staff => ({ key: staff.score.keySignature, meter: staff.score.timeSignature,
  measures: staff.score.measures.map(bar => bar.voices.map(voice => voice.events.map(event => ({ start: event.start, duration: event.duration, pitches: eventPitches(event).map(midi), ties: event.kind === 'note' ? event.tieTo ?? [] : [] })))),
})))
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.goto('/PocketScore/')
  await page.getByRole('button', { name: '팔레트', exact: true }).click()
  await load(page, rhythmProject())
})

test('32nd/64th screen tools, numeric keys, dots and rests keep exact input timing', async ({ page }) => {
  await hit(page, target(2)).click()
  await tools(page).getByRole('button', { name: '음표 입력', exact: true }).click()
  await tools(page).getByRole('button', { name: '32분음표', exact: true }).click()
  await page.keyboard.press('c')
  await page.keyboard.press('1'); await page.keyboard.press('d')
  await tools(page).getByRole('button', { name: '32분음표', exact: true }).click()
  await tools(page).getByRole('button', { name: '점음표', exact: true }).click()
  await page.keyboard.press('0')
  const after = await saved(page)
  expect(voice(after, 2).slice(0, 3)).toMatchObject([
    { kind: 'note', start: { n: 0, d: 1 }, duration: { n: 1, d: 32 }, pitch: { step: 'C' } },
    { kind: 'note', start: { n: 1, d: 32 }, duration: { n: 1, d: 64 }, pitch: { step: 'D' } },
    { kind: 'rest', start: { n: 3, d: 64 }, duration: { n: 3, d: 64 } },
  ])
  expect(after.parts[0].staves[0].score.measures[2].voices[1]).toEqual(rhythmProject().parts[0].staves[0].score.measures[2].voices[1])
  await tools(page).getByRole('button', { name: '64분음표', exact: true }).click()
  await tools(page).getByRole('button', { name: '점음표', exact: true }).click()
  await expect(page.locator('.studio-status')).toContainText('점64분')
  expect(await saved(page)).toEqual(after)
})

test('Chromium pen emulation enters a 64th and restores it with one undo/redo', async ({ page, context }) => {
  await hit(page, target(2)).click()
  await tools(page).getByRole('button', { name: '음표 입력', exact: true }).click()
  await tools(page).getByRole('button', { name: '64분음표', exact: true }).click()
  await hit(page, target(2)).scrollIntoViewIfNeeded()
  const box = (await hit(page, target(2)).boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, pointerType: 'pen', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, pointerType: 'pen', clickCount: 1 })
  const after = await saved(page)
  expect(voice(after, 2)[0]).toMatchObject({ kind: 'note', duration: { n: 1, d: 64 } })
  await tools(page).getByRole('button', { name: '실행 취소', exact: true }).click()
  expect(await saved(page)).toEqual(rhythmProject())
  await tools(page).getByRole('button', { name: '다시 실행', exact: true }).click()
  expect(await saved(page)).toEqual(after)
  await cdp.detach()
})

test('a chord-component tie sustains one tone, follows pitch edits and supports both redo shortcuts', async ({ page }) => {
  await hit(page, target()).click()
  await tools(page).getByRole('button', { name: '다음 음과 붙임줄', exact: true }).click()
  await expect(page.locator('[data-score-tie][data-tie-midi="60"]')).toHaveCount(1)
  expect(voice(await saved(page))[0]).toMatchObject({ tieTo: [60] })
  await hit(page, target(0, 1)).click(); await page.keyboard.press('ArrowUp')
  const after = await saved(page)
  expect(pitches(after).slice(0, 2)).toEqual([[61, 64], [61, 67]])
  await expect(page.locator('[data-score-tie][data-tie-midi="61"]')).toHaveCount(1)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  expect(await saved(page)).toEqual(rhythmProject())
  await page.keyboard.press('Control+y'); await page.keyboard.press('Control+Shift+z')
  expect(await saved(page)).toEqual(after)
  await tools(page).getByRole('button', { name: '선택 붙임줄 해제', exact: true }).click()
  await expect(page.locator('[data-score-tie]')).toHaveCount(0)
})

test('barline ties split at responsive system boundaries; incremental untie restores the actual accidental', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 }); await load(page, heldRhythmProject())
  await hit(page, target(0, 3)).click()
  const crossing = page.locator('[data-score-tie][data-tie-from="rhythm-0-0-3"]')
  await expect(crossing).toHaveCount(1)
  const sharp = page.locator('[data-note-event="rhythm-0-1-0"] text').filter({ hasText: '\ue262' })
  await expect(sharp).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(crossing).toHaveCount(2)
  expect(await crossing.evaluateAll(groups => groups.every(group => {
    const ink = (group as SVGGraphicsElement).getBBox(), svg = group.closest('svg')!
    return ink.width > 0 && ink.x >= 0 && ink.y >= 0 && ink.x + ink.width <= svg.width.baseVal.value + 1 && ink.y + ink.height <= svg.height.baseVal.value + 1
  }))).toBe(true)
  await page.setViewportSize({ width: 1600, height: 1000 }); await expect(crossing).toHaveCount(1)
  await hit(page, target(0, 3)).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '선택 음의 붙임줄 모두 해제', exact: true }).click()
  await expect(sharp).toHaveCount(1)
  await page.keyboard.press('Control+z'); await expect(sharp).toHaveCount(0)
  expect(await saved(page)).toEqual(heldRhythmProject())
  await page.screenshot({ path: 'test-results/rhythm-ties-desktop.png', fullPage: true })
})

test('range clipboard preserves internal ties and group rules, and undo restores the whole paste', async ({ page }) => {
  await load(page, heldRhythmProject())
  await hit(page, target()).click(); await hit(page, target(0, 1)).click({ modifiers: ['Shift'] })
  await page.keyboard.press('Control+c'); await hit(page, target(2)).click(); await page.keyboard.press('Control+v')
  const pasted = await saved(page), bar = voice(pasted, 2)
  expect(bar[0]).toMatchObject({ tieTo: [60] })
  expect(eventPitches(bar[0]).map(midi)).toEqual([60, 64])
  await expect(tools(page).getByRole('button', { name: '다음 음과 붙임줄', exact: true })).toBeDisabled()
  for (const name of ['32분음표', '64분음표']) await expect(tools(page).getByRole('button', { name, exact: true })).toBeDisabled()
  await page.locator('.score-surface').focus(); await page.keyboard.press('ArrowUp')
  expect(pitches(await saved(page), 2).slice(0, 2)).toEqual([[61, 65], [61, 68]])
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  expect(await saved(page)).toEqual(heldRhythmProject())
  await page.keyboard.press('Control+y'); expect(await saved(page)).toEqual(pasted)
})

test('tie errors are atomic; rests, groups and text inputs retain their editing rules', async ({ page }) => {
  await hit(page, target(0, 0, 1)).click()
  await tools(page).getByRole('button', { name: '다음 음과 붙임줄', exact: true }).click()
  await expect(page.locator('.studio-status')).toContainText('같은 음높이')
  expect(await saved(page)).toEqual(rhythmProject())
  await hit(page, target()).click(); await hit(page, target(0, 1)).click({ modifiers: ['Shift'] })
  await expect(tools(page).getByRole('button', { name: '다음 음과 붙임줄', exact: true })).toBeDisabled()
  await page.locator('.score-surface').focus(); await page.keyboard.press('2')
  await expect(page.locator('.studio-status')).toContainText('그룹')
  expect(await saved(page)).toEqual(rhythmProject())
  await hit(page, target(2)).click()
  await expect(tools(page).getByRole('button', { name: '다음 음과 붙임줄', exact: true })).toBeDisabled()
  await page.getByLabel('악보 제목').fill('짧은 리듬 123'); await page.keyboard.press('2')
  await expect(page.getByLabel('악보 제목')).toHaveValue('짧은 리듬 1232')
  expect((await saved(page)).parts).toEqual(rhythmProject().parts)
})

test('fixed MusicXML short rhythms and ties survive visible export, JSON reopen and XML reimport', async ({ page }) => {
  const source = await readFile('tests/fixtures/musicxml/rhythm-ties.musicxml', 'utf8')
  await page.locator('input[type=file]').setInputFiles({ name: 'rhythm.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
  const imported = await saved(page)
  await expect(page.locator('[data-score-tie]')).toHaveCount(2)
  const pending = page.waitForEvent('download')
  await page.locator('.menubar summary').getByText('파일', { exact: true }).click()
  await page.getByRole('button', { name: 'MusicXML 내보내기', exact: true }).click()
  const xml = await readFile((await (await pending).path())!, 'utf8')
  expect(xml).toContain('<type>64th</type>'); expect(xml).toContain('<tie type="stop"/>')
  await page.locator('input[type=file]').setInputFiles({ name: 'again.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) })
  await expect(page.locator('.studio-status')).toContainText('불러오기 완료')
  expect(musical(await saved(page))).toEqual(musical(imported))
  await load(page, imported); expect(await saved(page)).toEqual(imported)
})

test('a dense 64th-note bar renders four beam levels and stays inside the scrollable workspace', async ({ page }) => {
  const source = rhythmProject(), staff = source.parts[0].staves[0]
  const project: Project = { ...source, parts: [{ ...source.parts[0], staves: [{ ...staff, score: { ...staff.score,
    measures: staff.score.measures.map((bar, i) => i ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice,
      events: Array.from({ length: 64 }, (_, n) => ({ id: `sixtyfour-${n}`, start: fraction(n, 64), duration: fraction(1, 64), kind: 'note' as const, pitch: { step: n % 2 ? 'D' as const : 'C' as const, octave: 4, alter: 0 as const } })),
    }) }),
  } }] }] }
  await page.setViewportSize({ width: 800, height: 1280 }); await load(page, project)
  const beams = page.locator('[data-rendered-measure="rhythm-m0"] [data-beam-events]')
  await expect(beams).toHaveCount(4)
  for (const beam of await beams.all()) expect(await beam.locator('path').count()).toBeGreaterThanOrEqual(4)
  const head = page.locator('[data-event-id="sixtyfour-32"]')
  await head.click(); await expect(head).toHaveAttribute('aria-pressed', 'true')
  expect(await saved(page)).toEqual(project)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/rhythm-64ths-tablet-emulation.png', fullPage: true })
})

test('JSON replacement keeps new valid tie endpoints when the source IDs match the current project', async ({ page }) => {
  const source = heldRhythmProject(); await load(page, source)
  const loaded: Project = { ...source, parts: source.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
    measures: staff.score.measures.map((bar, b) => b ? bar : { ...bar, voices: bar.voices.map((voice, v) => v ? voice : { ...voice, events: voice.events.map((event, i) => i === 1 ? { ...event, id: 'new-loaded-tie-target' } : event) }) }),
  } })) })) }
  await load(page, loaded)
  expect(await saved(page)).toEqual(loaded)
  await expect(page.locator('[data-score-tie][data-tie-to="new-loaded-tie-target"]')).toHaveCount(1)
})

for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1280 }]) test(`touch-accessible short durations and tie context stay within ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport)
  await hit(page, target()).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '악보 작업', exact: true })
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  await menu.getByRole('menuitem', { name: '다음 같은 음과 붙임줄', exact: true }).click()
  expect(voice(await saved(page))[0]).toMatchObject({ tieTo: [60] })
  await hit(page, target(2)).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '64분음표로 변경', exact: true }).click()
  expect(voice(await saved(page), 2)[0].duration).toEqual({ n: 1, d: 64 })
})

for (const octave of [2, 7]) test(`single-voice ties curve away from stems and stay inside the SVG at C${octave}`, async ({ page }) => {
  const source = longHeldProject(), value = (octave + 1) * 12
  const project: Project = { ...source, parts: source.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff, score: { ...staff.score,
    measures: staff.score.measures.map(bar => ({ ...bar, voices: bar.voices.map(voice => ({ ...voice, events: voice.events.map(event => event.kind === 'note'
      ? { ...event, pitch: { step: 'C' as const, octave, alter: 0 as const }, ...(event.tieTo ? { tieTo: [value] } : {}) } : event) })) })),
  } })) })) }
  await load(page, project)
  await expect(page.locator('[data-score-tie]')).not.toHaveCount(0)
  expect(await page.locator('[data-score-tie]').evaluateAll(groups => groups.every(group => {
    const from = (group as SVGGElement).dataset.tieFrom!, svg = group.closest('svg')!
    const head = svg.querySelector<SVGRectElement>(`[data-event-id="${from}"]`)
    if (!head) return true // Incoming half of a system-split curve.
    const glyph = svg.querySelector(`[data-note-event="${from}"]`)!
    const stem = Number(glyph.getAttribute('data-stem-direction')), center = Number(head.getAttribute('y')) + Number(head.getAttribute('height')) / 2
    const ink = (group as SVGGraphicsElement).getBBox()
    return ink.y >= 0 && ink.y + ink.height <= svg.height.baseVal.value + 1 && (stem === 1 ? ink.y > center : ink.y + ink.height < center)
  }))).toBe(true)
  expect(await saved(page)).toEqual(project)
})

test('real PCM sustains a tied organ tone through seek/pause/resume and stop leaves no residual sound', { tag: '@audio' }, async ({ page }) => {
  test.setTimeout(120000)
  await load(page, longHeldProject())
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeVisible({ timeout: 90000 })
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 15000 }).toBeGreaterThan(0.001)
  await page.getByLabel('재생 위치').fill('3')
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(3.25)
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 2500 }).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '일시정지', exact: true }).click()
  await expect(page.getByLabel('출력 진폭')).toHaveText('0.0000')
  await page.getByLabel('재생 위치').fill('5.25')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('재생 위치').inputValue())).toBeGreaterThan(5.25)
  await expect.poll(async () => Number(await page.getByLabel('출력 진폭').textContent()), { timeout: 2500 }).toBeGreaterThan(0.001)
  await page.getByRole('button', { name: '정지', exact: true }).click()
  await expect(page.getByLabel('재생 위치')).toHaveValue('0')
  await expect(page.getByLabel('출력 진폭')).toHaveText('0.0000')
  await page.waitForTimeout(500)
  await expect(page.getByLabel('출력 진폭')).toHaveText('0.0000')
})
