import type { Project } from '../project/model'
import type { Timeline } from './timeline'

export const MS_BASIC = {
  name: 'MS Basic', path: 'audio/MSBasic.sf3', bytes: 51278610,
  sha256: '5ea2375e8bd7d8e71def1036978c1621e85b66934169b6a2744b27b9b3c2d99c',
  sourceCommit: '3654226c2e99289916916953a98e585a3d3b315a', license: 'MIT',
} as const
export const SOUND_CAPABILITIES = [
  { id: 'basic', available: true, reason: 'MS Basic SF3 · SpessaSynth AudioWorklet' },
  { id: 'muse-sounds', available: false, reason: '공식 웹 API·허가된 MuseSampler와 음원 공급 경로가 필요합니다.' },
  { id: 'user-soundfont', available: false, reason: '사용자 SF2/SF3 저장·권한·프리셋 검증은 후속 단계입니다.' },
] as const
export type PlaybackState = { playing: boolean; position: number; duration: number; peak: number; timeline: Timeline | null }

// A future authorized MuseSampler adapter can implement this transport without
// pretending its proprietary sample provider is a downloadable SoundFont.
export interface PlaybackBackend {
  initialize(): Promise<void>
  play(project: Project, start?: number, metronome?: boolean, loop?: boolean): Promise<void>
  pause(): void
  stop(rewind?: boolean): void
  seek(position: number): void
  setLoop(loop: boolean): void
  destroy(): void
}
