import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib'
import processorURL from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import type { Project } from '../project/model'
import { activeMelodicNotes, compileTimeline, timelineMIDI } from './timeline'
import type { Timeline } from './timeline'
import { MS_BASIC } from './backend'
import type { PlaybackBackend, PlaybackState } from './backend'

export class Player implements PlaybackBackend {
  private synth: WorkletSynthesizer | null = null
  private seq: Sequencer | null = null
  private gain: GainNode
  private analyser: AnalyserNode
  private samples = new Float32Array(1024)
  private generation = 0
  private tick: ReturnType<typeof setInterval> | undefined
  private timeline: Timeline | null = null
  private position = 0
  private pendingSeek: number | null = null
  private playing = false
  private loop = false
  private loadedProject: Project | null = null
  private metronome = false
  private context: AudioContext
  private report: (state: PlaybackState) => void
  constructor(context: AudioContext, report: (state: PlaybackState) => void) {
    this.context = context
    this.report = report
    this.gain = context.createGain()
    this.gain.gain.value = 0
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 1024
    this.gain.connect(this.analyser).connect(context.destination)
  }
  async initialize(): Promise<void> {
    await this.context.audioWorklet.addModule(processorURL)
    this.synth = new WorkletSynthesizer(this.context)
    this.synth.connect(this.gain)
    const response = await fetch(`${import.meta.env.BASE_URL}${MS_BASIC.path}`)
    if (!response.ok) throw new Error(`MS Basic 음원 다운로드 실패 (${response.status})`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== MS_BASIC.bytes) throw new Error('MS Basic 음원 파일 크기가 올바르지 않습니다.')
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (checksum !== MS_BASIC.sha256) throw new Error('MS Basic 음원 무결성 검증에 실패했습니다.')
    await this.synth.soundBankManager.addSoundBank(buffer, 'ms-basic')
    await this.synth.isReady
    this.seq = new Sequencer(this.synth, { skipToFirstNoteOn: false })
    this.seq.loopCount = 0
    this.seq.eventHandler.addEvent('timeChange', 'pocketscore-seek', time => {
      if (this.playing && this.pendingSeek !== null && Math.abs(time - this.pendingSeek) < 0.000001) {
        this.pendingSeek = null
        this.emit()
      }
    })
    this.seq.eventHandler.addEvent('songEnded', 'pocketscore', () => {
      if (!this.playing) return
      if (this.loop) { this.seek(0); this.seq?.play() }
      else this.stop(false)
    })
    this.tick = setInterval(() => this.emit(), 50)
    this.emit()
  }
  private emit() {
    // The worklet acknowledges seeks asynchronously. Reporting the old clock
    // here resets the controlled slider and its final change event seeks back.
    if (this.playing && this.seq && this.pendingSeek === null) this.position = Math.min(this.timeline?.duration ?? 0, Math.max(0, this.seq.currentTime))
    this.analyser.getFloatTimeDomainData(this.samples)
    let peak = 0
    for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample))
    this.report({ playing: this.playing, position: this.position, duration: this.timeline?.duration ?? 0, peak, timeline: this.timeline })
  }
  async play(project: Project, start = this.position, metronome = false, loop = false) {
    if (!this.synth || !this.seq) throw new Error('음원이 아직 준비되지 않았습니다.')
    const generation = ++this.generation
    this.loop = loop
    this.gain.gain.value = 0
    this.seq.pause()
    this.synth.stopAll(true)
    await this.context.resume()
    if (generation !== this.generation) return
    if (this.loadedProject !== project || this.metronome !== metronome) {
      this.timeline = compileTimeline(project)
      this.metronome = metronome
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('재생 이벤트 준비 시간이 초과되었습니다.')) }, 15000)
        const cleanup = () => { clearTimeout(timer); this.seq?.eventHandler.removeEvent('songChange', 'load'); this.seq?.eventHandler.removeEvent('midiError', 'load') }
        this.seq!.eventHandler.addEvent('songChange', 'load', () => { cleanup(); resolve() })
        this.seq!.eventHandler.addEvent('midiError', 'load', error => { cleanup(); reject(error) })
        this.seq!.loadNewSongList([{ binary: timelineMIDI(project, this.timeline!, metronome), fileName: 'PocketScore.mid' }])
        this.seq!.pause()
      })
      this.loadedProject = project
      if (Math.abs(this.seq.duration - this.timeline.duration) > 0.02) throw new Error('합성기와 악보의 재생 길이가 일치하지 않습니다.')
    }
    if (generation !== this.generation) { this.seq.pause(); return }
    this.position = start >= this.timeline!.duration ? 0 : Math.max(0, start)
    this.pendingSeek = this.position
    // Start before seeking: the sequencer's paused seek snaps to the next MIDI
    // event, which may be the end of a multi-bar held note.
    this.seq.play()
    this.seq.currentTime = this.position
    this.restoreHeldNotes()
    this.gain.gain.value = project.masterVolume
    this.playing = true
    this.emit()
  }
  pause() {
    ++this.generation
    if (this.playing && this.seq && this.pendingSeek === null) this.position = this.seq.currentTime
    this.pendingSeek = null
    this.playing = false
    this.seq?.pause()
    this.synth?.stopAll(true)
    this.gain.gain.value = 0
    this.emit()
  }
  stop(rewind = true) {
    this.pause()
    if (rewind) this.position = 0
    if (this.seq) this.seq.currentTime = this.position
    this.emit()
  }
  seek(position: number) {
    this.synth?.stopAll(true)
    this.position = Math.max(0, Math.min(this.timeline?.duration ?? 0, position))
    if (this.seq && this.playing) { this.pendingSeek = this.position; this.seq.currentTime = this.position; this.restoreHeldNotes() }
    this.emit()
  }
  private restoreHeldNotes() {
    for (const note of activeMelodicNotes(this.timeline, this.position)) this.synth?.noteOn(note.channel, note.midi, note.velocity)
  }
  setLoop(loop: boolean) { this.loop = loop }
  destroy() {
    this.stop()
    clearInterval(this.tick)
    this.synth?.destroy()
    this.gain.disconnect()
    this.analyser.disconnect()
  }
}
