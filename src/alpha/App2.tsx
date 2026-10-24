import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createProjectState, projectReducer } from '../project/state'
import { createProject, DRUMS, INSTRUMENTS, insertAt, makePart, primaryScore, replaceEvent, staffAt, uid, updateStaff, validateProject } from '../project/model'
import type { Instrument, Part, Project, ProjectSelection } from '../project/model'
import { addMeasure, addStaff, addVoice, removeMeasure, removeVoice } from '../project/structure'
import { DURATIONS, durationName, eventName, eventPitches, locate } from '../music/score'
import type { RhythmEvent } from '../music/score'
import { movePitch, pitchName } from '../music/pitch'
import type { Pitch } from '../music/pitch'
import type { Action } from '../editor/state'
import type { Rational } from '../music/rational'
import { KEY_LABELS, TIME_SIGNATURES } from '../music/settings'
import type { TimeSignature } from '../music/settings'
import { download, parseProject, serializeProject } from '../files/project'
import { exportMusicXML, importMusicXML } from '../files/musicxml'
import { compileTimeline } from '../playback/timeline'
import type { PlaybackBackend, PlaybackState } from '../playback/backend'
import EnsembleView from './EnsembleView'
import { isGroupSelection } from '../project/selection'
import './studio.css'

function Menu({ name, children }: { name: string; children: ReactNode }) {
  return <details className="studio-menu"><summary>{name}</summary><div onClick={event => { if ((event.target as Element).closest('button')) event.currentTarget.closest('details')!.open = false }}>{children}</div></details>
}
const seconds = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
const EMPTY_AUDIO: PlaybackState = { playing: false, position: 0, duration: 0, peak: 0, timeline: null }

export default function App2() {
  const [state, dispatch] = useReducer(projectReducer, undefined, () => createProjectState())
  const { project, selection, selected } = state.present
  const groupSelected = isGroupSelection(selected)
  const wholeBarSelected = selected?.kind === 'measure' && selected.targets.every(target => target.staffId === selection?.staffId && target.measureId === selection?.measureId)
  const legacyClipboardDisabled = groupSelected && !wholeBarSelected
  const [active, setActive] = useState(() => ({ partId: project.parts[0].id, staffId: project.parts[0].staves[0].id }))
  const [left, setLeft] = useState(true)
  const [right, setRight] = useState(false)
  const [mixer, setMixer] = useState(false)
  const [input, setInput] = useState(false)
  const [rest, setRest] = useState(false)
  const [duration, setDuration] = useState(3)
  const [voice, setVoice] = useState(0)
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
  const playingMeasure = audio.playing ? timeline.measureTimes.reduce((result, time, index) => time <= audio.position + 0.01 ? index : result, 0) : null
  const playingProgress = playingMeasure === null ? 0 : Math.max(0, Math.min(1, (audio.position - timeline.measureTimes[playingMeasure]) / ((timeline.measureTimes[playingMeasure + 1] ?? timeline.duration) - timeline.measureTimes[playingMeasure])))

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
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || state.gesture) return
      if ((event.target as Element)?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
    }
    window.addEventListener('keydown', historyKey)
    return () => window.removeEventListener('keydown', historyKey)
  }, [state.gesture])
  useEffect(() => {
    if (!selection) return
    const target = document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(selection.eventId)}"][data-pitch-index="${selection.pitchIndex ?? 0}"]`)
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    if (document.activeElement?.classList.contains('score-surface')) target?.closest<HTMLElement>('.score-surface')?.focus({ preventScroll: true })
  }, [selection])

  const change = (transform: (project: Project) => Project, nextSelection?: ProjectSelection | null) => dispatch({ type: 'change', change: transform, selection: nextSelection })
  const action = (command: Action) => dispatch({ type: 'canvas', partId: current.part.id, staffId: current.staff.id, action: command })
  const activate = useCallback((partId: string, staffId: string) => { setActive({ partId, staffId }); dispatch({ type: 'selection', selection: null }); setVoice(0) }, [])
  const insert = useCallback((partId: string, staffId: string, measureId: string, start: Rational, pitch: Pitch) => {
    dispatch({ type: 'change', change: before => {
      const { part, staff } = staffAt(before, { partId, staffId })
      const voiceId = staff.score.measures[0].voices[Math.min(voice, staff.score.measures[0].voices.length - 1)].id
      return insertAt(before, { partId, staffId, measureId, voiceId, eventId: '' }, start, DURATIONS[duration], rest ? null : part.instrument === 'drums' ? DRUMS[0].pitch : pitch)
    } })
    setActive({ partId, staffId })
  }, [duration, rest, voice])

  const save = () => {
    download(serializeProject(project), `${project.title}.pocketscore.json`, 'application/json')
    setMessage('프로젝트를 다운로드했습니다. 음표·성부·믹서·템포를 함께 저장합니다.')
  }
  const replace = (next: Project) => {
    change(() => next, null)
    setActive({ partId: next.parts[0].id, staffId: next.parts[0].staves[0].id }); setVoice(0)
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

  return <main className="studio" onDragStart={event => { if (!(event.target as Element).closest('input, textarea')) event.preventDefault() }}>
    <header className="studio-header"><h1>PocketScore <small>2.0 Alpha</small></h1><input aria-label="악보 제목" value={project.title} onChange={event => change(before => ({ ...before, title: event.target.value }))}/><span className="profile">MS Basic</span></header>
    <nav className="menubar" aria-label="상단 메뉴">
      <Menu name="파일"><button onClick={() => { replace(createProject(false)); setMessage('빈 악보를 만들었습니다. 이전 악보는 실행 취소할 수 있습니다.') }}>새 악보</button><button onClick={() => fileInput.current?.click()}>열기…</button><button onClick={save}>프로젝트 저장</button><button onClick={() => { download(exportMusicXML(project), `${project.title}.musicxml`, 'application/vnd.recordare.musicxml+xml'); setMessage('MusicXML 내보내기 완료. 뮤트·솔로·마스터 설정은 프로젝트 JSON에 저장하세요.') }}>MusicXML 내보내기</button></Menu>
      <Menu name="편집"><button onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length}>실행 취소</button><button onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length}>다시 실행</button><button disabled={legacyClipboardDisabled} onClick={copy}>마디 복사</button><button disabled={legacyClipboardDisabled} onClick={paste}>마디 붙여넣기</button><button disabled={!selection || groupSelected} onClick={() => convert(false)}>음표 삭제 → 쉼표</button></Menu>
      <Menu name="보기"><button onClick={() => setLeft(value => !value)}>팔레트 {left ? '접기' : '열기'}</button><button onClick={() => setRight(value => !value)}>속성 {right ? '접기' : '열기'}</button><button onClick={() => setMixer(value => !value)}>믹서 {mixer ? '접기' : '열기'}</button><button onClick={() => setContinuous(value => !value)}>{continuous ? '페이지 보기' : '연속 보기'}</button></Menu>
      <Menu name="추가"><button onClick={addInstrument}>선택 악기 추가</button><button onClick={() => change(before => addStaff(before, current.part.id))}>오선지 추가</button><button onClick={() => change(before => addVoice(before, current.staff.id))}>성부 추가</button><button onClick={() => change(addMeasure)}>마디 추가</button><button disabled={groupSelected} onClick={() => chord()}>화음 구성음 추가</button></Menu>
      <Menu name="형식"><button onClick={() => setLeft(true)}>조표·박자표 설정</button><button onClick={() => setRight(true)}>오선지·음자리표 설정</button></Menu>
      <Menu name="도구"><button onClick={() => setMessage(validateProject(project).join(' ') || '검증 완료: 모든 악기·성부의 정확한 박자 합계와 음높이가 유효합니다.')}>악보 무결성 검사</button><button onClick={() => setRight(true)}>입력 감도 설정</button></Menu>
      <Menu name="도움말"><button onClick={() => setHelp(true)}>사용법·지원 범위·라이선스</button></Menu>
    </nav>
    <input ref={fileInput} type="file" accept=".json,.xml,.musicxml" hidden onChange={event => { void open(event) }}/>
    <div className="note-toolbar" aria-label="음표 도구 모음">
      <button aria-label="팔레트" aria-expanded={left} onClick={() => setLeft(value => !value)}>☰</button>
      <button aria-pressed={input} onClick={() => setInput(value => !value)}>N 음표 입력</button>
      <label>길이 <select aria-label="입력 길이" value={duration} onChange={event => setDuration(Number(event.target.value))}>{DURATIONS.map((item, index) => <option key={index} value={index}>{durationName(item)}</option>)}</select></label>
      <button aria-pressed={rest} onClick={() => setRest(value => !value)}>쉼표 입력</button>
      {([['♯', 1], ['♭', -1], ['♮', 0]] as const).map(([label, alter]) => <button key={alter} aria-label={`임시표 ${label}`} disabled={groupSelected || event?.kind !== 'note' || current.part.instrument === 'drums'} onClick={() => action({ type: 'accidental', alter })}>{label}</button>)}
      <label>성부 <select aria-label="입력 성부" value={Math.min(voice, current.staff.score.measures[0].voices.length - 1)} onChange={event => setVoice(Number(event.target.value))}>{current.staff.score.measures[0].voices.map((item, index) => <option key={item.id} value={index}>{index + 1}</option>)}</select></label>
      <button aria-label="실행 취소" disabled={!state.past.length || !!state.gesture} onClick={() => dispatch({ type: 'undo' })}>↶</button><button aria-label="다시 실행" disabled={!state.future.length || !!state.gesture} onClick={() => dispatch({ type: 'redo' })}>↷</button>
      <button aria-label="속성" aria-expanded={right} onClick={() => setRight(value => !value)}>속성</button>
    </div>
    <div className="transport" aria-label="재생 도구" data-playing={audio.playing}>
      <button aria-label="처음으로" disabled={loading} onClick={() => player.current?.seek(0)}>⏮</button>
      <button disabled={loading || !!state.gesture} onClick={() => { if (audio.playing) pause(); else void play() }}>{loading ? '음원 준비 중…' : audio.playing ? '일시정지' : '재생'}</button>
      <button onClick={stop}>정지</button><button disabled={!selection || loading || !!state.gesture} onClick={() => { void play(true) }}>선택 마디부터</button>
      <input aria-label="재생 위치" type="range" min="0" max={transportLength} step="0.05" value={Math.min(audio.position, transportLength)} disabled={!audioReady || loading} onChange={event => player.current?.seek(Number(event.target.value))}/>
      <output aria-label="재생 시간">{seconds(audio.position)} / {seconds(transportLength)}</output>
      <label><input type="checkbox" checked={loop} onChange={event => { setLoop(event.target.checked); player.current?.setLoop(event.target.checked) }}/> 반복</label>
      <label><input type="checkbox" checked={metronome} onChange={event => { stop(); setMetronome(event.target.checked) }}/> 메트로놈</label>
      <meter aria-label="출력 레벨" min="0" max="1" value={audio.peak}/><output className="peak" aria-label="출력 진폭">{audio.peak.toFixed(4)}</output>
      <button aria-expanded={mixer} onClick={() => setMixer(value => !value)}>믹서</button>
    </div>
    {mixer && <section className="mixer" aria-label="믹서">
      <label>마스터 <input aria-label="마스터 볼륨" type="range" min="0" max="1" step="0.01" value={project.masterVolume} onChange={event => dispatch({ type: 'sound', change: before => ({ ...before, masterVolume: Number(event.target.value) }) })}/></label>
      {project.parts.map(part => <fieldset key={part.id}><legend>{part.name}</legend><span>Basic · MS Basic</span><label>GM 음색 <input aria-label={`${part.name} 음색`} disabled={part.instrument === 'drums'} type="number" min="1" max="128" value={part.mixer.program + 1} onChange={event => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, program: Number(event.target.value) - 1 } }))}/></label><label>볼륨 <input aria-label={`${part.name} 볼륨`} type="range" min="0" max="1" step="0.01" value={part.mixer.volume} onChange={event => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, volume: Number(event.target.value) } }))}/></label><label>팬 <input aria-label={`${part.name} 팬`} type="range" min="-1" max="1" step="0.1" value={part.mixer.pan} onChange={event => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, pan: Number(event.target.value) } }))}/></label><button aria-pressed={part.mixer.mute} aria-label={`${part.name} 뮤트`} onClick={() => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, mute: !item.mixer.mute } }))}>M</button><button aria-pressed={part.mixer.solo} aria-label={`${part.name} 솔로`} onClick={() => mixPart(part.id, item => ({ ...item, mixer: { ...item.mixer, solo: !item.mixer.solo } }))}>S</button></fieldset>)}
    </section>}
    <div className="studio-workspace" data-left={left} data-right={right}>
      {left && <aside className="palette" aria-label="팔레트와 악기">
        <h2>팔레트 · 악기</h2><label>추가할 악기<select aria-label="추가할 악기" value={instrument} onChange={event => setInstrument(event.target.value as Instrument)}>{Object.entries(INSTRUMENTS).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}</select></label><button onClick={addInstrument}>악기 추가</button>
        <ul className="part-list">{project.parts.map(part => <li key={part.id}><strong>{part.name}</strong>{part.staves.map(staff => <button key={staff.id} aria-pressed={current.staff.id === staff.id} onClick={() => activate(part.id, staff.id)}>{staff.name}</button>)}</li>)}</ul>
        <label>조표<select aria-label="전체 조표" value={score.keySignature} onChange={event => action({ type: 'keySignature', key: Number(event.target.value) })}>{KEY_LABELS.map((label, index) => <option key={index} value={index - 7}>{label}</option>)}</select></label>
        <label>박자표<select aria-label="전체 박자표" value={score.timeSignature} onChange={event => action({ type: 'timeSignature', time: event.target.value as TimeSignature })}>{TIME_SIGNATURES.map(time => <option key={time}>{time}</option>)}</select></label>
        <label>{measureIndex + 1}마디 템포 ♩<input aria-label="선택 마디 템포" type="number" min="30" max="240" value={[...project.tempos].reverse().find(tempo => tempo.measure <= measureIndex)!.bpm} onChange={event => change(before => ({ ...before, tempos: [...before.tempos.filter(tempo => tempo.measure !== measureIndex), { measure: measureIndex, bpm: Number(event.target.value) }].sort((a, b) => a.measure - b.measure) }))}/></label>
        <button onClick={() => change(addMeasure)}>＋ 마디 추가</button><button disabled={!selection} onClick={() => change(before => removeMeasure(before, measureIndex), null)}>선택 마디 삭제</button>
        <p>연음표·붙임줄·이음줄·강약·아티큘레이션·기보 반복은 다음 단계에서 지원합니다.</p>
      </aside>}
      <section className="score-desk" aria-label="악보 작업 공간">
        <div className="view-tools"><span aria-label="선택 개수" aria-live="polite">{selected ? `${selected.targets.length}개 선택` : '선택 없음'}</span><label>보기<select aria-label="악보 보기" value={continuous ? 'continuous' : 'page'} onChange={event => setContinuous(event.target.value === 'continuous')}><option value="page">페이지</option><option value="continuous">연속</option></select></label><label>배율<select aria-label="악보 배율" value={zoom} onChange={event => { dispatch({ type: 'cancel' }); setZoom(Number(event.target.value)) }}>{[0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label><label><input type="checkbox" checked={fingerEdit} onChange={event => { dispatch({ type: 'cancel' }); setFingerEdit(event.target.checked) }}/> 손가락 편집</label></div>
        <div className="score-page" data-view={continuous ? 'continuous' : 'page'}><h2>{project.title}</h2><p className="score-subtitle">{project.parts.map(part => part.name).join(' · ')} · ♩ = {project.tempos[0].bpm}</p>
          <EnsembleView project={project} selection={selection} selected={selected} dispatch={dispatch} zoom={zoom} sensitivity={sensitivity} fingerEdit={fingerEdit} continuous={continuous} input={input} inputVoice={voice} insert={insert} playingMeasure={playingMeasure} playingProgress={playingProgress}/>
        </div>
      </section>
      {right && <aside className="properties" aria-label="속성 패널"><h2>속성</h2><p aria-label="선택 상태">{groupSelected ? `${selected!.targets.length}개 선택 · ` : ''}{event ? `${measureIndex + 1}마디 · ${event.kind === 'note' ? `${pitchName(eventPitches(event)[selection?.pitchIndex ?? 0])} ${durationName(event.duration)}음표` : eventName(event)}` : '음표 또는 쉼표를 선택하세요.'}</p>
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
      </aside>}
    </div>
    <p className="studio-status" role="status">{state.notice || message}</p><p id="editing-help" className="input-help">펜·마우스: 음표 좌우 드래그 = 길이, 상하 = 음높이 · ↑↓ 반음 이동 · Shift+←→ / Shift+클릭 범위 선택 · Ctrl+클릭 음표 추가 선택 · 그룹 길이 변경 불가 · Ctrl+Z / Y / Shift+Z · Esc 취소 · 손가락은 기본 스크롤·확대</p>
    {help && <dialog className="help-dialog" aria-label="Alpha 도움말" ref={element => { if (element && !element.open) element.showModal() }} onCancel={() => setHelp(false)}><div><button autoFocus onClick={() => setHelp(false)}>닫기</button><h2>PocketScore 2.0 Alpha</h2><p>음표 입력을 켜고 빈 오선지를 누르세요. 쉼표를 음표로 바꾸려면 선택한 뒤 속성을 여세요. 기존 음표·쉼표는 펜으로 직접 끌어 길이와 음높이를 바꿉니다. 화음 구성음은 음표 머리나 속성에서 선택합니다. 삭제·새 악보·불러오기도 실행 취소할 수 있습니다.</p><p>악기·오선이 같은 마디·박자 위치에 정렬되는 총보입니다. Shift+클릭은 시간·성부 범위를, Ctrl+클릭은 구성음을 개별 선택합니다. 겹친 동음의 단일 선택은 입력 성부로 구분할 수 있습니다. 그룹에서는 음높이만 편집하며 길이는 변경할 수 없습니다.</p><p>MuseScore Studio 4.7.5의 UI·모듈 구조를 참고한 React/VexFlow 편집기입니다. MuseScore C++ 엔진·Qt UI를 실행하지 않습니다. MS Basic SF3를 실제 SoundFont 합성기로 재생합니다. 첫 재생 시 51.3 MB가 필요합니다.</p><p>현재: 다중 악기·성부·화음·템포·JSON·제한된 MusicXML. 다음: 연음표·붙임줄·이음줄·강약·스타카토/레가토·기보 반복, 사용자 SF2/SF3, Muse Sounds 공식 연동, 자동 복구·오프라인. 이 기능이 있는 MusicXML은 변환하지 않고 거부합니다.</p><p>Muse Sounds는 포함되지 않습니다. 실제 Galaxy Tab/S펜과 MuseScore GUI 검증은 별도 필요합니다.</p><p><a href={`${import.meta.env.BASE_URL}audio/MSBasic-LICENSE.md`} target="_blank" rel="noreferrer">MS Basic MIT 라이선스</a> · SpessaSynth 4.3.14 / core 4.3.22 / stb-vorbis 0.0.6: Apache-2.0 · VexFlow: MIT</p></div></dialog>}
  </main>
}
