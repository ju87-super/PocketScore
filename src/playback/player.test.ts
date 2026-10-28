// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { longHeldProject } from '../../tests/fixtures/rhythm'
import type { PlaybackState } from './backend'

const fake = vi.hoisted(() => {
  class Sequencer {
    static current: Sequencer
    duration = 8
    clock = 0
    requests: number[] = []
    listeners = new Map<string, Map<string, (value: number) => void>>()
    eventHandler = {
      addEvent: (type: string, id: string, callback: (value: number) => void) => {
        const group = this.listeners.get(type) ?? new Map(); group.set(id, callback); this.listeners.set(type, group)
      },
      removeEvent: (type: string, id: string) => this.listeners.get(type)?.delete(id),
    }
    constructor() { Sequencer.current = this }
    get currentTime() { return this.clock }
    set currentTime(value: number) { this.requests.push(value) }
    acknowledge(value: number) { this.clock = value; this.listeners.get('timeChange')?.forEach(callback => callback(value)) }
    loadNewSongList() { this.listeners.get('songChange')?.forEach(callback => callback(0)) }
    play() {}
    pause() {}
  }
  class Synth {
    soundBankManager = { addSoundBank: async () => {} }
    isReady = Promise.resolve()
    connect() {}
    stopAll() {}
    noteOn() {}
    destroy() {}
  }
  return { Sequencer, Synth }
})
vi.mock('spessasynth_lib', () => ({ Sequencer: fake.Sequencer, WorkletSynthesizer: fake.Synth }))
vi.mock('./backend', () => ({ MS_BASIC: { path: 'test.sf3', bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' } }))
import { Player } from './player'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('retains the latest requested position until the worklet acknowledges it, including pause and resume', async () => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', async () => new Response('abc'))
  const node = () => ({ gain: { value: 0 }, connect: (destination: unknown) => destination, disconnect: () => {}, getFloatTimeDomainData: (data: Float32Array) => data.fill(0) })
  const context = { createGain: node, createAnalyser: node, destination: {}, audioWorklet: { addModule: async () => {} }, resume: async () => {} } as unknown as AudioContext
  const reports: PlaybackState[] = [], player = new Player(context, state => reports.push(state)), project = longHeldProject()
  try {
    await player.initialize(); await player.play(project)
    const seq = fake.Sequencer.current
    seq.acknowledge(0); seq.clock = 0.25
    player.seek(3.25)
    expect(reports.at(-1)?.position).toBe(3.25)
    vi.advanceTimersByTime(50)
    expect(reports.at(-1)?.position).toBe(3.25)
    player.seek(5.5); seq.acknowledge(3.25)
    vi.advanceTimersByTime(50)
    expect(reports.at(-1)?.position).toBe(5.5)
    seq.acknowledge(5.5); seq.clock = 5.6; vi.advanceTimersByTime(50)
    expect(reports.at(-1)?.position).toBe(5.6)
    player.seek(6.25); player.pause()
    expect(reports.at(-1)).toMatchObject({ playing: false, position: 6.25 })
    await player.play(project)
    expect(seq.requests.at(-1)).toBe(6.25)
    expect(reports.at(-1)).toMatchObject({ playing: true, position: 6.25 })
    seq.acknowledge(6.25); player.stop()
    expect(reports.at(-1)).toMatchObject({ playing: false, position: 0 })
  } finally { player.destroy() }
})
