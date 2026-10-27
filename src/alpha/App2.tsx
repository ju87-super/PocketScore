import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import { createProjectState, projectReducer } from '../project/state'
import { createProject, DRUMS, INSTRUMENTS, makePart, primaryScore, replaceEvent, staffAt, uid, updateStaff, validateProject } from '../project/model'
import type { Instrument, Part, Project, ProjectSelection } from '../project/model'
import { addMeasure, addStaff, addVoice, removeMeasure, removeVoice } from '../project/structure'
import { DURATIONS, durationName, eventName, eventPitches, locate } from '../music/score'
import type { RhythmEvent } from '../music/score'
import { movePitch, pitchName } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import type { Action } from '../editor/state'
import type { Rational } from '../music/rational'
import { dottedDuration, ENTRY_DURATIONS, isNoteLetter } from '../project/noteEntry'
import { KEY_LABELS, TIME_SIGNATURES } from '../music/settings'
import type { TimeSignature } from '../music/settings'
import { download, parseProject, serializeProject } from '../files/project'
import { exportMusicXML, importMusicXML } from '../files/musicxml'
import { compileTimeline } from '../playback/timeline'
import type { PlaybackBackend, PlaybackState } from '../playback/backend'
import EnsembleView from './EnsembleView'
import NoteInputToolbar from './NoteInputToolbar'
import DockResizeHandle from './DockResizeHandle'
import { useScoreViewport } from './useScoreViewport'
import { isGroupSelection } from '../project/selection'
import './studio.css'

function Menu({ name, children }: { name: string; children: ReactNode }) {
  return <details className="studio-menu" onToggle={event => {
    const menu = event.currentTarget
    if (!menu.open) return
    const rect = menu.getBoundingClientRect()
    menu.style.setProperty('--menu-top', `${rect.bottom}px`)
    menu.style.setProperty('--menu-left', `${Math.max(8, Math.min(rect.left, innerWidth - 248))}px`)
    menu.parentElement?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(other => { if (other !== menu) other.open = false })
  }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary>{name}</summary><div onClick={event => { if ((event.target as Element).closest('button')) event.currentTarget.closest('details')!.open = false }}>{children}</div></details>
}
const seconds = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
const EMPTY_AUDIO: PlaybackState = { playing: false, position: 0, duration: 0, peak: 0, timeline: null }
const focusScore = () => document.querySelector<HTMLElement>('.ensemble-surface')?.focus({ preventScroll: true })

export default function App2() {
  const [state, dispatch] = useReducer(projectReducer, undefined, () => createProjectState())
  const { project, selection, selected, entry } = state.present
  const input = entry.enabled
  const groupSelected = isGroupSelection(selected)
  const wholeBarSelected = selected?.kind === 'measure' && selected.targets.every(target => target.staffId === selection?.staffId && target.measureId === selection?.measureId)
  const legacyClipboardDisabled = groupSelected && !wholeBarSelected
  const [active, setActive] = useState(() => ({ partId: project.parts[0].id, staffId: project.parts[0].staves[0].id }))
  const [left, setLeft] = useState(true)
  const [leftTab, setLeftTab] = useState<'palette' | 'instruments'>('palette')
  const [right, setRight] = useState(false)
  const [compact, setCompact] = useState(false)
  const [leftWidth, setLeftWidth] = useState(300)
  const [rightWidth, setRightWidth] = useState(300)
  const { desk, remember, restore, reveal, reset } = useScoreViewport()
  const openLeft = (open: boolean) => { remember(); setLeft(open); if (open && matchMedia('(max-width: 900px)').matches) setRight(false) }
  const openRight = (open: boolean) => { remember(); setRight(open); if (open && matchMedia('(max-width: 900px)').matches) setLeft(false) }
  const [mixer, setMixer] = useState(false)
  const [instrument, setInstrument] = useState<Instrument>('piano')
  const [fingerEdit, setFingerEdit] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [sensitivity, setSensitivity] = useState(1)
  const [continuous, setContinuous] = useState(false)
  const [message, setMessage] = useState('예제 앙상블을 편집하거나 파일 → 새 악보로 시작하세요.')
  const [help, setHelp] = useState(false)
  const [audio, setAudio] = useState<PlaybackState>(EMPTY_AUDIO)
  const [loading, setLoading] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [loop, setLoop] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const player = useRef<PlaybackBackend | null>(null)
  const context = useRef<AudioContext | null>(null)
  const playerPromise = useRef<Promise<PlaybackBackend> | null>(null)
  const mounted = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const playButton = useRef<HTMLButtonElement>(null)
  const clipboard = useRef<readonly (readonly RhythmEvent[])[] | null>(null)
  const clipboardTime = useRef<TimeSignature>('4/4')
  const projectRef = useRef(project)
  const generation = useRef(0)
  const current = useMemo(() => {
    if (selection) return staffAt(project, selection)
    try { return staffAt(project, active) } catch { return { part: project.parts[0], staff: project.parts[0].staves[0] } }
  }, [project, selection, active])
  const event = selection ? locate(current.staff.score, selection).event : null
  const score = primaryScore(project)
  const timeline = useMemo(() => compileTimeline(project), [project])
  const measureIndex = selection ? current.staff.score.measures.findIndex(measure => measure.id === selection.measureId) : 0
  const voiceId = input && entry.cursor?.staffId === current.staff.id ? entry.cursor.voiceId : selection?.voiceId
  const voice = Math.max(0, current.staff.score.measures[0].voices.findIndex(item => item.id === voiceId))
  const playingMeasure = audio.playing ? timeline.measureTimes.reduce((result, time, index) => time <= audio.position + 0.01 ? index : result, 0) : null
  const playingProgress = playingMeasure === null ? 0 : Math.max(0, Math.min(1, (audio.position - timeline.measureTimes[playingMeasure]) / ((timeline.measureTimes[playingMeasure + 1] ?? timeline.duration) - timeline.measureTimes[playingMeasure])))
  const entryTarget = useMemo(() => selection ?? { partId: current.part.id, staffId: current.staff.id,
    measureId: current.staff.score.measures[0].id, voiceId: current.staff.score.measures[0].voices[Math.min(voice, current.staff.score.measures[0].voices.length - 1)].id,
    eventId: current.staff.score.measures[0].voices[Math.min(voice, current.staff.score.measures[0].voices.length - 1)].events[0].id }, [selection, current, voice])
  const chooseDuration = useCallback((value: Rational) => {
    if (!input && selection) dispatch({ type: 'canvas', ...selection, action: { type: 'duration', duration: value } })
    if (!groupSelected || input) dispatch({ type: 'entrySettings', settings: { duration: value } })
    focusScore()
  }, [input, selection, groupSelected])
  const inputMode = (mode: 'select' | 'note' | 'chord') => {
    if (mode === 'select' || (mode === 'note' && input && !entry.chord)) dispatch({ type: 'entryMode', enabled: false })
    else {
      if (!input) dispatch({ type: 'entryMode', enabled: true, selection: entryTarget })
      dispatch({ type: 'entrySettings', settings: { chord: mode === 'chord' ? !entry.chord : false, rest: false } })
    }
    focusScore()
  }
  const chooseVoice = (index: number) => {
    if (!input) dispatch({ type: 'entryMode', enabled: true, selection: entryTarget })
    dispatch({ type: 'entryVoice', index, selection: entryTarget }); focusScore()
  }
  const chooseRest = () => {
    if (!input) dispatch({ type: 'entryMode', enabled: true, selection: entryTarget })
    dispatch({ type: 'entrySettings', settings: { rest: !input || !entry.rest, chord: false } }); focusScore()
  }
  const chooseDot = () => {
    try { chooseDuration(dottedDuration(input || !event ? entry.duration : event.duration)) }
    catch (error) { dispatch({ type: 'entrySettings', settings: {} }); setMessage((error as Error).message) }
  }

  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('.studio-menu[open], .status-details[open]').forEach(menu => {
        if (!menu.contains(event.target as Node)) menu.open = false
      })
    }
    const media = matchMedia('(max-width: 900px)')
    const narrow = () => { if (media.matches && right) { remember(); setLeft(false) } }
    document.addEventListener('pointerdown', dismiss)
    media.addEventListener('change', narrow)
    return () => { document.removeEventListener('pointerdown', dismiss); media.removeEventListener('change', narrow) }
  }, [right, remember])

  useEffect(() => {
    projectRef.current = project
    ++generation.current
    player.current?.stop()
  }, [project])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; player.current?.destroy(); void context.current?.close() }
  }, [])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (state.past.length) event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [state.past.length])
  useEffect(() => {
    const historyKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || state.gesture) return
      if ((event.target as Element)?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey) {
        if (event.altKey && /^[1-4]$/.test(key)) {
          event.preventDefault(); dispatch({ type: 'entryVoice', index: Number(key) - 1, selection: entryTarget }); focusScore()
        } else if (!event.altKey && (key === 'z' || key === 'y')) {
          event.preventDefault(); dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
        }
        return
      }
      if (event.altKey) return
      const target = event.target as Element
      if (target !== document.body && !target.closest?.('.score-surface, .note-toolbar')) return
      if (key === 'n' && !event.repeat) {
        event.preventDefault(); dispatch({ type: 'entryMode', enabled: !entry.enabled, selection: entryTarget }); focusScore(); return
      }
      if (key === 'escape') { dispatch({ type: 'entryMode', enabled: false }); return }
      if (key === ' ' && !target.closest?.('button, summary')) { event.preventDefault(); if (!event.repeat) playButton.current?.click(); return }
      if (ENTRY_DURATIONS[key]) { event.preventDefault(); chooseDuration(ENTRY_DURATIONS[key]); return }
      if (key === '.') {
        event.preventDefault()
        try { chooseDuration(dottedDuration(!entry.enabled && selection ? locate(staffAt(project, selection).staff.score, selection).event.duration : entry.duration)) }
        catch (error) { dispatch({ type: 'entrySettings', settings: {} }); setMessage((error as Error).message) }
        return
      }
      if (/^[1289]$/.test(key)) {
        event.preventDefault(); dispatch({ type: 'entrySettings', settings: {} }); setMessage('현재 입력 길이는 3~7키(16분~온음표)를 지원합니다.'); return
      }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); dispatch({ type: 'deleteSelected' }); return }
      if (key === '0' && entry.enabled) { event.preventDefault(); dispatch({ type: 'entryWrite', rest: true }); return }
      const letter = key.toUpperCase()
      if (isNoteLetter(letter) && (entry.enabled || event.shiftKey)) {
        event.preventDefault(); dispatch({ type: 'entryWrite', letter, chord: event.shiftKey || entry.enabled && entry.chord })
      }
    }
    window.addEventListener('keydown', historyKey)
    return () => window.removeEventListener('keydown', historyKey)
  }, [state.gesture, entry, selection, project, chooseDuration, entryTarget])
  useEffect(() => {
    if (!selection) return
    const target = document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(selection.eventId)}"][data-pitch-index="${selection.pitchIndex ?? 0}"]`)
    reveal(target)
    if (document.activeElement?.classList.contains('score-surface')) target?.closest<HTMLElement>('.score-surface')?.focus({ preventScroll: true })
  }, [selection, reveal])
  useEffect(() => {
    if (entry.enabled && document.activeElement?.classList.contains('score-surface')) reveal(document.querySelector('[data-note-input-cursor]'))
  }, [entry.cursor, entry.enabled, reveal])

  const change = (transform: (project: Project) => Project, nextSelection?: ProjectSelection | null) => dispatch({ type: 'change', change: transform, selection: nextSelection })
  const action = (command: Action) => dispatch({ type: 'canvas', partId: current.part.id, staffId: current.staff.id, action: command })
  const activate = useCallback((partId: string, staffId: string) => { setActive({ partId, staffId }); dispatch({ type: 'selection', selection: null }); dispatch({ type: 'entryMode', enabled: false }) }, [])
  const save = () => {
    download(serializeProject(project), `${project.title}.pocketscore.json`, 'application/json')
    setMessage('프로젝트를 다운로드했습니다. 음표·성부·믹서·템포를 함께 저장합니다.')
  }
  const replace = (next: Project) => {
    reset()
    change(() => next, null)
    dispatch({ type: 'entryMode', enabled: false })
    setActive({ partId: next.parts[0].id, staffId: next.parts[0].staves[0].id })
  }
  async function open(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 5_000_000) throw new Error('파일은 5 MB까지 지원합니다.')
      const source = await file.text()
      const next = file.name.toLowerCase().endsWith('.xml') || file.name.toLowerCase().endsWith('.musicxml') ? importMusicXML(source) : parseProject(source)
      replace(next); setMessage(`${file.name} 불러오기 완료. 이전 악보는 실행 취소로 복원할 수 있습니다.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '파일을 열 수 없습니다.') }
  }
  const copy = () => {
    if (!selection) { setMessage('복사할 마디의 음표 또는 쉼표를 선택하세요.'); return }
    clipboard.current = current.staff.score.measures[measureIndex].voices.map(voice => voice.events)
    clipboardTime.current = score.timeSignature
    setMessage(`${measureIndex + 1}마디의 모든 성부를 복사했습니다.`)
  }
  const paste = () => {
    const copied = clipboard.current
    if (!selection || !copied) { setMessage('마디를 복사한 뒤 붙여넣을 마디를 선택하세요.'); return }
    change(before => {
      const { staff } = staffAt(before, selection)
      const measure = staff.score.measures[measureIndex]
      if (clipboardTime.current !== staff.score.timeSignature || copied.length !== measure.voices.length) throw new Error('박자와 성부 수가 같은 마디에만 붙여넣을 수 있습니다.')
      return updateStaff(before, staff.id, item => ({ ...item, score: { ...item.score, measures: item.score.measures.map(bar => bar.id !== measure.id ? bar : { ...bar, voices: bar.voices.map((voice, i) => ({ ...voice, events: copied[i].map(event => ({ ...event, id: uid() })) })) }) } }))
    }, null)
  }
  const convert = (pitched: boolean) => {
    if (!selection) return
    change(before => replaceEvent(before, selection, event => ({ id: event.id, start: event.start, duration: event.duration, ...(pitched ? { kind: 'note', pitch: current.part.instrument === 'drums' ? DRUMS[0].pitch : { step: 'C', octave: 4, alter: 0 } as Pitch } : { kind: 'rest' }) })))
  }
  const chord = (remove = false) => {
    if (!selection) return
    change(before => replaceEvent(before, selection, item => {
      if (item.kind === 'rest') throw new Error('화음은 음표에서만 편집할 수 있습니다.')
      const pitches = [...eventPitches(item)]
      if (remove) {
        if (pitches.length === 1) throw new Error('마지막 구성음은 삭제 대신 쉼표로 바꾸세요.')
        pitches.splice(selection.pitchIndex ?? 0, 1)
      } else {
        if (current.part.instrument === 'drums') throw new Error('드럼 화음은 다른 성부에 음을 입력하세요.')
        pitches.push(movePitch(item.pitch, pitches.length * 2, false, score.keySignature))
      }
      return { ...item, pitch: pitches[0], chord: pitches.slice(1) }
    }), { ...selection, pitchIndex: 0 })
  }
  const addInstrument = () => change(before => ({ ...before, parts: [...before.parts, makePart(instrument, primaryScore(before))] }))
  const mixPart = (partId: string, transform: (part: Part) => Part) => dispatch({ type: 'sound', change: before => ({ ...before, parts: before.parts.map(part => part.id === partId ? transform(part) : part) }) })

  async function play(fromSelection = false) {
    const token = generation.current
    setLoading(true)
    try {
      if (!context.current) context.current = new AudioContext()
      await context.current.resume()
      if (!playerPromise.current) {
        setMessage('MS Basic 음원 51.3 MB를 준비하고 있습니다. 첫 재생에 다운로드가 필요합니다.')
        playerPromise.current = import('../playback/player').then(async ({ Player }) => {
          const next = new Player(context.current!, value => { if (mounted.current) setAudio(value) })
          player.current = next
          await next.initialize()
          if (!mounted.current) next.destroy()
          return next
        }).catch(error => { player.current?.destroy(); player.current = null; playerPromise.current = null; void context.current?.close(); context.current = null; throw error })
      }
      const ready = await playerPromise.current
      setAudioReady(true)
      if (!mounted.current || token !== generation.current) return
      const start = fromSelection ? timeline.measureTimes[measureIndex] : audio.position
      await ready.play(projectRef.current, start, metronome, loop)
      setMessage('MS Basic · SoundFont AudioWorklet 재생 중')
    } catch (error) { setMessage(`오디오: ${error instanceof Error ? error.message : '재생 실패'}`) }
    finally { if (mounted.current) setLoading(false) }
  }
  const stop = () => { ++generation.current; player.current?.stop() }
  const pause = () => { ++generation.current; player.current?.pause() }
  const transportLength = timeline.duration

  return <main className="studio" data-compact={compact} style={{ '--left-dock-width': `${leftWidth}px`, '--right-dock-width': `${rightWidth}px` } as CSSProperties} onDragStart={event => { if (!(event.target as Element).closest('input, textarea')) event.preventDefault() }}>
    <div className="studio-chrome">
    <header className="studio-header"><h1>PocketScore <small>Studio</small>{import.meta.env.BASE_URL !== '/PocketScore/' && <small className="beta-channel" aria-label="베타 버전">2.1 Beta</small>}</h1><div className="document-tab"><span aria-hidden="true">♩</span><input aria-label="악보 제목" value={project.title} onChange={event => change(before => ({ ...before, title: event.target.value }))}/></div><span className="profile">MS Basic</span></header>
    <nav className="menubar" aria-label="상단 메뉴">
      <Menu name="파일"><button onClick={() => { replace(createProject(false)); setMessage('빈 악보를 만들었습니다. 이전 악보는 실행 취소할 수 있습니다.') }}>새 악보</button><button onClick={() => fileInput.current?.click()}>열기…</button><button onClick={save}>프로젝트 저장</button><button onClick={() => { download(exportMusicXML(project), `${project.title}.musicxml`, 'application/vnd.recordare.musicxml+xml'); setMessage('MusicXML 내보내기 완료. 뮤트·솔로·마스터 설정은 프로젝트 JSON에 저장하세요.') }}>MusicXML 내보내기</button></Menu>
      <Menu name="편집"><button onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length}>실행 취소</button><button onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length}>다시 실행</button><button disabled={legacyClipboardDisabled} onClick={copy}>마디 복사</button><button disabled={legacyClipboardDisabled} onClick={paste}>마디 붙여넣기</button><button disabled={!selection} onClick={() => dispatch({ type: 'deleteSelected' })}>음표 삭제 → 쉼표</button></Menu>
      <Menu name="보기"><button onClick={() => openLeft(!left)}>팔레트 {left ? '접기' : '열기'}</button><button onClick={() => openRight(!right)}>속성 {right ? '접기' : '열기'}</button><button onClick={() => setMixer(value => !value)}>믹서 {mixer ? '접기' : '열기'}</button><button onClick={() => { remember(); setContinuous(value => !value) }}>{continuous ? '페이지 보기' : '연속 보기'}</button></Menu>
      <Menu name="추가"><button onClick={addInstrument}>선택 악기 추가</button><button onClick={() => change(before => addStaff(before, current.part.id))}>오선지 추가</button><button onClick={() => change(before => addVoice(before, current.staff.id))}>성부 추가</button><button onClick={() => change(addMeasure)}>마디 추가</button><button disabled={groupSelected} onClick={() => chord()}>화음 구성음 추가</button></Menu>
      <Menu name="형식"><button onClick={() => { setLeftTab('palette'); openLeft(true) }}>조표·박자표 설정</button><button onClick={() => openRight(true)}>오선지·음자리표 설정</button></Menu>
      <Menu name="도구"><button onClick={() => setMessage(validateProject(project).join(' ') || '검증 완료: 모든 악기·성부의 정확한 박자 합계와 음높이가 유효합니다.')}>악보 무결성 검사</button><button onClick={() => openRight(true)}>입력 감도 설정</button></Menu>
      <Menu name="도움말"><button onClick={() => setHelp(true)}>사용법·지원 범위·라이선스</button></Menu>
    </nav>
    </div>
    <input ref={fileInput} type="file" accept=".json,.xml,.musicxml" hidden onChange={event => { void open(event) }}/>
    <div className="transport" aria-label="재생 도구" data-playing={audio.playing}>
      <button className="chrome-toggle" aria-label={compact ? '상단 메뉴 펼치기' : '상단 메뉴 접기'} title={compact ? '상단 메뉴 펼치기' : '상단 메뉴 접기'} aria-expanded={!compact} onClick={() => { remember(); setCompact(value => !value); requestAnimationFrame(() => restore()) }}><span aria-hidden="true">{compact ? '⌄' : '⌃'}</span></button>
      <div className="transport-file-tools" role="group" aria-label="파일 도구">
        <button aria-label="새 악보 만들기" title="새 악보" onClick={() => { replace(createProject(false)); setMessage('빈 악보를 만들었습니다.') }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5Zm9 0v6h5M8 13h8M8 17h8"/></svg></button>
        <button aria-label="악보 파일 열기" title="열기" onClick={() => fileInput.current?.click()}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 8V5h7l2 3h9v12H3Zm0 12 3-9h15"/></svg></button>
        <button aria-label="악보 저장" title="저장" onClick={save}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 3h14l3 3v15H3V3Zm3 0v6h10V3M7 21v-8h10v8"/></svg></button>
      </div>
      <button aria-label="처음으로" disabled={loading} onClick={() => player.current?.seek(0)}>⏮</button>
      <button ref={playButton} disabled={loading || !!state.gesture} onClick={() => { if (audio.playing) pause(); else void play() }}>{loading ? '음원 준비 중…' : audio.playing ? '일시정지' : '재생'}</button>
      <button onClick={stop}>정지</button><button disabled={!selection || loading || !!state.gesture} onClick={() => { void play(true) }}>선택 마디부터</button>
      <input aria-label="재생 위치" type="range" min="0" max={transportLength} step="0.05" value={Math.min(audio.position, transportLength)} disabled={!audioReady || loading} onChange={event => player.current?.seek(Number(event.target.value))}/>
      <output aria-label="재생 시간">{seconds(audio.position)} / {seconds(transportLength)}</output>
      <label><input type="checkbox" checked={loop} onChange={event => { setLoop(event.target.checked); player.current?.setLoop(event.target.checked) }}/> 반복</label>
      <label><input type="checkbox" checked={metronome} onChange={event => { stop(); setMetronome(event.target.checked) }}/> 메트로놈</label>
      <meter aria-label="출력 레벨" min="0" max="1" value={audio.peak}/><output className="peak" aria-label="출력 진폭">{audio.peak.toFixed(4)}</output>
      <button aria-expanded={mixer} onClick={() => setMixer(value => !value)}>믹서</button>
    </div>
    <NoteInputToolbar entry={entry} duration={!input && event ? event.duration : entry.duration} voice={Math.min(voice, current.staff.score.measures[0].voices.length - 1)} group={groupSelected} percussion={current.part.instrument === 'drums'}
      chordAllowed={event?.kind === 'note' || !!entry.last} accidentalAllowed={!groupSelected && (input || event?.kind === 'note')} busy={!!state.gesture}
      undo={!!state.past.length} redo={!!state.future.length} left={left} right={right} mode={inputMode} length={chooseDuration} dot={chooseDot} rest={chooseRest}
      accidental={alter => { if (input) dispatch({ type: 'entrySettings', settings: { accidental: entry.accidental === alter ? null : alter } }); else action({ type: 'accidental', alter }); focusScore() }}
      selectVoice={chooseVoice} history={type => dispatch({ type })} palette={() => openLeft(!left)} properties={() => openRight(!right)}/>
    <div className="studio-workspace" data-left={left} data-right={right}>
      <aside className="palette" aria-label="팔레트와 악기" hidden={!left}>
        <div className="dock-heading"><strong>{leftTab === 'palette' ? '팔레트' : '악기'}</strong><button aria-label="팔레트 패널 닫기" title="패널 닫기" onClick={() => openLeft(false)}>×</button></div>
        <div className="dock-content">
        <div className="dock-tabs" role="tablist" aria-label="왼쪽 패널"><button role="tab" aria-selected={leftTab === 'palette'} aria-controls="palette-content" id="palette-tab" onClick={() => setLeftTab('palette')}>팔레트</button><button role="tab" aria-selected={leftTab === 'instruments'} aria-controls="instruments-content" id="instruments-tab" onClick={() => setLeftTab('instruments')}>악기</button></div>
        <section role="tabpanel" id="instruments-content" aria-labelledby="instruments-tab" hidden={leftTab !== 'instruments'}>
        <h2>악기</h2><label>추가할 악기<select aria-label="추가할 악기" value={instrument} onChange={event => setInstrument(event.target.value as Instrument)}>{Object.entries(INSTRUMENTS).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}</select></label><button className="dock-primary" onClick={addInstrument}>악기 추가</button>
        <ul className="part-list">{project.parts.map(part => <li key={part.id}><strong>{part.name}</strong>{part.staves.map(staff => <button key={staff.id} aria-pressed={current.staff.id === staff.id} onClick={() => activate(part.id, staff.id)}>{staff.name}</button>)}</li>)}</ul>
        </section>
        <section role="tabpanel" id="palette-content" aria-labelledby="palette-tab" hidden={leftTab !== 'palette'}>
        <h2>팔레트</h2>
        <details className="palette-category" open><summary>음자리표</summary><div className="clef-palette"><button aria-label="높은음자리표 적용" title="현재 오선에 높은음자리표 적용" disabled={current.part.instrument === 'drums'} onClick={() => change(before => updateStaff(before, current.staff.id, staff => ({ ...staff, clef: 'treble' })))}><span className="music-symbol" aria-hidden="true">&#xe050;</span></button><button aria-label="낮은음자리표 적용" title="현재 오선에 낮은음자리표 적용" disabled={current.part.instrument === 'drums'} onClick={() => change(before => updateStaff(before, current.staff.id, staff => ({ ...staff, clef: 'bass' })))}><span className="music-symbol" aria-hidden="true">&#xe062;</span></button></div></details>
        <details className="palette-category" open><summary>조표 · 박자표</summary>
        <label>조표<select aria-label="전체 조표" value={score.keySignature} onChange={event => action({ type: 'keySignature', key: Number(event.target.value) })}>{KEY_LABELS.map((label, index) => <option key={index} value={index - 7}>{label}</option>)}</select></label>
        <label>박자표<select aria-label="전체 박자표" value={score.timeSignature} onChange={event => action({ type: 'timeSignature', time: event.target.value as TimeSignature })}>{TIME_SIGNATURES.map(time => <option key={time}>{time}</option>)}</select></label>
        </details><details className="palette-category" open><summary>템포 · 마디</summary>
        <label>{measureIndex + 1}마디 템포 ♩<input aria-label="선택 마디 템포" type="number" min="30" max="240" value={[...project.tempos].reverse().find(tempo => tempo.measure <= measureIndex)!.bpm} onChange={event => change(before => ({ ...before, tempos: [...before.tempos.filter(tempo => tempo.measure !== measureIndex), { measure: measureIndex, bpm: Number(event.target.value) }].sort((a, b) => a.measure - b.measure) }))}/></label>
        <button onClick={() => change(addMeasure)}>＋ 마디 추가</button><button disabled={!selection} onClick={() => change(before => removeMeasure(before, measureIndex), null)}>선택 마디 삭제</button>
        </details>
        <p className="palette-tip">도구를 고른 뒤 악보를 누르세요. 같은 박자에 음을 쌓으면 화음이 됩니다.</p>
        </section>
        </div>
        <DockResizeHandle side="left" width={leftWidth} change={value => { remember(); setLeftWidth(value) }}/>
      </aside>
      <section ref={desk} className="score-desk" aria-label="악보 작업 공간" tabIndex={-1}>
        <div className="score-page" data-view={continuous ? 'continuous' : 'page'}><h2>{project.title}</h2><p className="score-subtitle">{project.parts.map(part => part.name).join(' · ')} · ♩ = {project.tempos[0].bpm}</p>
          <EnsembleView project={project} selection={selection} selected={selected} entry={entry} dispatch={dispatch} zoom={zoom} sensitivity={sensitivity} fingerEdit={fingerEdit} continuous={continuous} inputVoice={voice} playingMeasure={playingMeasure} playingProgress={playingProgress} onLayout={restore}/>
        </div>
      </section>
      <aside className="properties" aria-label="속성 패널" hidden={!right}><div className="dock-heading"><h2>속성</h2><button aria-label="속성 패널 닫기" title="패널 닫기" onClick={() => openRight(false)}>×</button></div><div className="dock-content"><p aria-label="선택 상태">{groupSelected ? `${selected!.targets.length}개 선택 · ` : ''}{event ? `${measureIndex + 1}마디 · ${event.kind === 'note' ? `${pitchName(eventPitches(event)[selection?.pitchIndex ?? 0])} ${durationName(event.duration)}음표` : eventName(event)}` : '음표 또는 쉼표를 선택하세요.'}</p>
        {selection && <div className="pitch-tools" role="group" aria-label="음높이"><button aria-label="반음 내리기" onClick={() => action({ type: 'pitch', amount: -1, chromatic: true })}>♭ 내려</button><button aria-label="반음 올리기" onClick={() => action({ type: 'pitch', amount: 1, chromatic: true })}>♯ 올려</button></div>}
        {selection && event?.kind === 'note' && <button onClick={() => { dispatch({ type: 'entryMode', enabled: false }); dispatch({ type: 'pick', selection }); dispatch({ type: 'pick', selection, extend: true }); focusScore() }}>화음 전체 선택</button>}
        {selection && <button onClick={() => dispatch({ type: 'deleteSelected' })}>선택 음표 삭제</button>}
        {selection && event && <><label>길이<select aria-label="선택 길이" disabled={groupSelected} value={DURATIONS.findIndex(item => item.n === event.duration.n && item.d === event.duration.d)} onChange={event => action({ type: 'duration', duration: DURATIONS[Number(event.target.value)] })}>{DURATIONS.map((duration, index) => <option key={index} value={index}>{durationName(duration)}</option>)}</select></label>
          {event.kind === 'note' && <><label>선택 구성음<select aria-label="화음 구성음" value={selection.pitchIndex ?? 0} onChange={event => dispatch({ type: 'selection', selection: { ...selection, pitchIndex: Number(event.target.value) } })}>{eventPitches(event).map((pitch, index) => <option key={index} value={index}>{index + 1}. {pitchName(pitch)}</option>)}</select></label><button disabled={groupSelected} onClick={() => chord()}>화음에 3도 추가</button><button disabled={groupSelected} onClick={() => chord(true)}>선택 구성음 삭제</button></>}
          <button disabled={groupSelected} onClick={() => convert(event.kind === 'rest')}>{event.kind === 'rest' ? 'C4 음표로 바꾸기' : eventPitches(event).length > 1 ? '화음 전체를 쉼표로 바꾸기' : '쉼표로 바꾸기'}</button>
          {current.part.instrument === 'drums' && event.kind === 'note' && <label>드럼 음<select aria-label="드럼 음" disabled={groupSelected} value={pitchName(event.pitch)} onChange={event => { const pitch = DRUMS.find(drum => pitchName(drum.pitch) === event.target.value)!.pitch; change(before => replaceEvent(before, selection, item => item.kind === 'note' ? { ...item, pitch } : item)) }}>{DRUMS.map(drum => <option key={drum.name} value={pitchName(drum.pitch)}>{drum.name}</option>)}</select></label>}
        </>}
        <hr/><p>{current.part.name} · {current.staff.name}</p><label>음자리표<select aria-label="오선지 음자리표" disabled={current.part.instrument === 'drums'} value={current.staff.clef} onChange={event => change(before => updateStaff(before, current.staff.id, staff => ({ ...staff, clef: event.target.value as 'treble' | 'bass' })))}><option value="treble">높은음자리표</option><option value="bass">낮은음자리표</option><option value="percussion" disabled>타악기</option></select></label>
        <button onClick={() => change(before => addStaff(before, current.part.id))}>오선지 추가</button><button disabled={current.part.staves.length <= 1} onClick={() => change(before => ({ ...before, parts: before.parts.map(part => part.id !== current.part.id ? part : { ...part, staves: part.staves.filter(staff => staff.id !== current.staff.id) }) }), null)}>선택 오선지 삭제</button>
        <button onClick={() => change(before => addVoice(before, current.staff.id))}>성부 추가</button><button disabled={current.staff.score.measures[0].voices.length <= 1} onClick={() => change(before => removeVoice(before, current.staff.id, selection?.voiceId ?? current.staff.score.measures[0].voices.at(-1)!.id), null)}>선택 성부 삭제</button>
        <button disabled={project.parts.length <= 1} onClick={() => change(before => ({ ...before, parts: before.parts.filter(part => part.id !== current.part.id) }), null)}>선택 악기 삭제</button>
        <label>드래그 간격<select aria-label="드래그 감도" value={sensitivity} onChange={event => { dispatch({ type: 'cancel' }); setSensitivity(Number(event.target.value)) }}><option value="0.75">촘촘하게 75%</option><option value="1">기본 100%</option><option value="1.5">넓게 150%</option></select></label>
      </div><DockResizeHandle side="right" width={rightWidth} change={value => { remember(); setRightWidth(value) }}/></aside>
      <section className="mixer" aria-label="믹서" hidden={!mixer}>
        <div className="dock-heading"><h2>믹서</h2><button aria-label="믹서 닫기" onClick={() => setMixer(false)}>×</button></div>
        <div className="mixer-content"><label>마스터 <input aria-label="마스터 볼륨" type="range" min="0" max="1" step="0.01" value={project.masterVolume} onChange={event => dispatch({ type: 'sound', change: before => ({ ...before, masterVolume: Number(event.target.value) }) })}/></label>
        {project.parts.map(part => <fieldset key={part.id}><legend>{part.name}</legend><span>Basic · MS Basic</span><label>GM 음색 <input aria-label={`${part.name} 음색`} disabled={part.instrument === 'drums'} type="number" min="1" max="128" value={part.mixer.program + 1} onChange={event => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, program: Number(event.target.value) - 1 } }))}/></label><label>볼륨 <input aria-label={`${part.name} 볼륨`} type="range" min="0" max="1" step="0.01" value={part.mixer.volume} onChange={event => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, volume: Number(event.target.value) } }))}/></label><label>팬 <input aria-label={`${part.name} 팬`} type="range" min="-1" max="1" step="0.1" value={part.mixer.pan} onChange={event => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, pan: Number(event.target.value) } }))}/></label><button aria-pressed={part.mixer.mute} aria-label={`${part.name} 뮤트`} onClick={() => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, mute: !item.mixer.mute } }))}>M</button><button aria-pressed={part.mixer.solo} aria-label={`${part.name} 솔로`} onClick={() => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, solo: !item.mixer.solo } }))}>S</button></fieldset>)}
        </div>
      </section>
    </div>
    <footer className="studio-status">
      <div className="status-message" role="status"><span className="mode-status">{input ? entry.rest ? '쉼표 입력' : entry.chord ? '화음 입력' : '음표 입력' : '선택'} · {durationName(input || !event ? entry.duration : event.duration)} · {Math.min(voice, current.staff.score.measures[0].voices.length - 1) + 1}성부</span><span className="status-notice" title={state.notice || message}>{state.notice || message}</span></div>
      <details className="status-details"><summary aria-label="상태 메시지 자세히" title="상태 메시지 자세히">ⓘ</summary><div>{state.notice || message}</div></details>
      <div className="view-tools"><span aria-label="선택 개수" aria-live="polite">{selected ? `${selected.targets.length}개 선택` : '선택 없음'}</span><label>보기<select aria-label="악보 보기" value={continuous ? 'continuous' : 'page'} onChange={event => { remember(); setContinuous(event.target.value === 'continuous') }}><option value="page">페이지</option><option value="continuous">연속</option></select></label><label>배율<select aria-label="악보 배율" value={zoom} onChange={event => { remember(); dispatch({ type: 'cancel' }); setZoom(Number(event.target.value)) }}>{[0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label><label><input type="checkbox" checked={fingerEdit} onChange={event => { dispatch({ type: 'cancel' }); setFingerEdit(event.target.checked) }}/> 손가락 편집</label></div>
    </footer><p id="editing-help" className="visually-hidden">음표 입력을 켜고 길이를 고른 뒤 악보를 누르세요. 화음 도구를 켜고 다른 높이를 누르면 음을 쌓을 수 있습니다. 선택 도구로 돌아가면 음표를 편집할 수 있습니다.</p>
    {help && <dialog className="help-dialog" aria-label="Alpha 도움말" ref={element => { if (element && !element.open) element.showModal() }} onCancel={() => setHelp(false)}><div><button autoFocus onClick={() => setHelp(false)}>닫기</button><h2>PocketScore 사용 방법</h2><p>음표 입력 버튼을 켜고 음표 길이 기호를 고른 뒤 오선지를 누르세요. 옅은 미리보기가 실제 입력 위치를 보여줍니다. 음표를 하나 입력한 다음 화음 버튼을 켜고 다른 높이를 누르면 같은 박자에 음을 쌓습니다. 쉼표·점·임시표와 1~4성부도 도구 모음에서 선택합니다. 선택 버튼으로 돌아가 음표를 고르면 속성에서 길이와 음높이를 수정할 수 있습니다. 실행 취소·다시 실행과 재생도 화면 버튼으로 사용할 수 있습니다. 지원 길이는 16분~온음표와 점8분·점4분·점2분이며 자동 붙임줄은 아직 지원하지 않습니다.</p><p>악기·오선이 같은 마디·박자 위치에 정렬되는 총보입니다. 선택 모드의 Shift+클릭은 시간·성부 범위를, Ctrl+클릭은 구성음을 개별 선택합니다. 겹친 동음의 단일 선택은 입력 성부로 구분할 수 있습니다. 그룹에서는 음높이만 편집하며 길이는 변경할 수 없습니다.</p><p>MuseScore Studio 4.7.5의 UI·모듈 구조를 참고한 React/VexFlow 편집기입니다. MuseScore C++ 엔진·Qt UI를 실행하지 않습니다. MS Basic SF3를 실제 SoundFont 합성기로 재생합니다. 첫 재생 시 51.3 MB가 필요합니다.</p><details><summary>키보드 보조 조작</summary><p>N 입력 전환 · 3~7 길이 · A–G 음표 · Shift+A–G 화음 · 0 쉼표 · Esc 종료 · Space 재생 · Ctrl/Cmd+Z 취소 · Ctrl+Y 또는 Ctrl/Cmd+Shift+Z 다시 실행. 선택 모드에서는 Shift+클릭으로 범위를, Ctrl/Cmd+클릭으로 개별 음을 고릅니다.</p></details><p>현재: 다중 악기·성부·화음·템포·JSON·제한된 MusicXML. 다음: 연음표·붙임줄·이음줄·강약·스타카토/레가토·기보 반복, 사용자 SF2/SF3, Muse Sounds 공식 연동, 자동 복구·오프라인. 이 기능이 있는 MusicXML은 변환하지 않고 거부합니다.</p><p>Muse Sounds는 포함되지 않습니다. 실제 Galaxy Tab/S펜과 MuseScore GUI 검증은 별도 필요합니다.</p><p><a href={`${import.meta.env.BASE_URL}audio/MSBasic-LICENSE.md`} target="_blank" rel="noreferrer">MS Basic MIT 라이선스</a> · SpessaSynth 4.3.14 / core 4.3.22 / stb-vorbis 0.0.6: Apache-2.0 · VexFlow: MIT</p></div></dialog>}
  </main>
}
