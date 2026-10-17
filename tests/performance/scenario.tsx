import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Fixture } from './Fixture'
import type { Action, EditorState } from '../../src/editor/state'
import type { Score } from '../../src/music/score'
import { validateScore } from '../../src/music/score'
import { fraction } from '../../src/music/rational'
import { renderScore } from '../../src/notation/renderScore'
import { longScore } from '../fixtures/scores'
import '../../src/styles.css'

let current: EditorState
let dispatch: (action: Action) => void
const root = createRoot(document.getElementById('root')!)
const publish = (state: EditorState, send: (action: Action) => void) => { current = state; dispatch = send }

const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], samples: values }
}
const longTasks: number[] = []
new PerformanceObserver(list => { longTasks.push(...list.getEntries().map(entry => entry.duration)) }).observe({ type: 'longtask' })

async function run(count: number, steps = 12) {
  await document.fonts.ready
  const initial: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    flushSync(() => root.render(<Fixture key={`${count}-${i}`} count={count} publish={publish} />))
    document.querySelector('svg')!.getBoundingClientRect()
    if (i > 0) initial.push(performance.now() - start)
    await frame()
  }
  const raw = document.getElementById('raw')! as HTMLDivElement
  const svgTimes: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    // Fresh container measures a full layout, never an incremental cache hit.
    const container = document.createElement('div')
    raw.replaceChildren(container)
    renderScore(container, longScore(count), null, 1280)
    container.getBoundingClientRect()
    if (i > 0) svgTimes.push(performance.now() - start)
    await frame()
  }
  raw.replaceChildren()
  const results: Record<string, ReturnType<typeof summary>> = {}
  const taskStart = longTasks.length
  let worstFrame = 0
  let previousRAF: number | null = null
  let frameRequest = 0
  const trackFrame = (timestamp: number) => {
    if (previousRAF !== null) worstFrame = Math.max(worstFrame, timestamp - previousRAF)
    previousRAF = timestamp
    frameRequest = requestAnimationFrame(trackFrame)
  }
  frameRequest = requestAnimationFrame(trackFrame)
  const mutations = { added: 0, removed: 0 }
  const observer = new MutationObserver(records => {
    for (const record of records) { mutations.added += record.addedNodes.length; mutations.removed += record.removedNodes.length }
  })
  observer.observe(document.querySelector('.notation')!, { childList: true, subtree: true })
  async function measure(name: string, action: (index: number) => void) {
    const times: number[] = []
    for (let i = 0; i < steps; i++) {
      await frame()
      const start = performance.now()
      action(i)
      document.querySelector('svg')!.getBoundingClientRect()
      if (name === 'resize') { await frame(); await frame() }
      times.push(performance.now() - start)
      await frame()
    }
    results[name] = summary(times)
  }
  const send = (action: Action) => flushSync(() => dispatch(action))
  await measure('pitch', i => send({ type: 'pitch', amount: i % 2 ? -1 : 1 }))
  await measure('duration', i => send({ type: 'duration', duration: fraction(1, i % 2 ? 4 : 8) }))
  await measure('history', i => send({ type: i % 2 ? 'redo' : 'undo' }))
  await measure('key', i => send({ type: 'keySignature', key: i % 2 ? 0 : 7 }))
  await measure('meter', i => send({ type: 'timeSignature', time: i % 2 ? '4/4' : '12/8' }))
  await measure('cursor', i => send({ type: 'cursor', direction: i % 2 ? -1 : 1 }))
  const surface = document.querySelector('.score-surface')! as HTMLElement
  // Allow the browser's real ResizeObserver to deliver reflow, included in duration.
  await measure('resize', i => { surface.style.width = i % 2 ? '100%' : '600px' })
  await frame()
  observer.disconnect()
  cancelAnimationFrame(frameRequest)
  const errors = validateScore(current.present.score)
  if (errors.length) throw new Error(errors.join(' '))
  return { count, initial: summary(initial), fullSVG: summary(svgTimes), updates: results, mutations,
    domNodes: document.querySelectorAll('*').length, svgNodes: document.querySelectorAll('svg *').length,
    longTasks: longTasks.slice(taskStart), worstFrameMs: worstFrame }
}
function unmount() { flushSync(() => root.unmount()); document.getElementById('raw')!.replaceChildren() }
Object.assign(window, { benchmark: { run, unmount } })

let serial = 0
Object.assign(window, { fixture: {
  mount: (count: number, score?: Score) => flushSync(() => root.render(<Fixture key={`fixture-${serial++}`} count={count} score={score} publish={publish} />)),
  act: (action: Action) => flushSync(() => dispatch(action)),
  state: () => current,
  freshSVG: () => {
    const container = document.createElement('div')
    document.getElementById('raw')!.replaceChildren(container)
    renderScore(container, current.present.score, current.present.selection, document.querySelector('.score-surface')!.clientWidth)
    const result = container.querySelector('svg')!.outerHTML
    container.remove()
    return result
  },
} })
