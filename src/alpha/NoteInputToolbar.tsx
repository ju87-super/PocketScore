import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { MouseEvent } from 'react'
import type { NoteEntry } from '../project/noteEntry'
import type { Rational } from '../music/rational'
import { equal, fraction } from '../music/rational'
import { durationName } from '../music/score'
import { rhythmSymbol, VOICE_COLORS } from '../notation/symbols'

type Props = {
  entry: NoteEntry; duration: Rational; voice: number; group: boolean; percussion: boolean
  chordAllowed: boolean; accidentalAllowed: boolean; busy: boolean; undo: boolean; redo: boolean; left: boolean; right: boolean
  mode: (mode: 'select' | 'note' | 'chord') => void
  length: (duration: Rational) => void; dot: () => void; rest: () => void
  accidental: (alter: -1 | 0 | 1) => void; selectVoice: (voice: number) => void
  history: (action: 'undo' | 'redo') => void; palette: () => void; properties: () => void
  canCopy: boolean; canPaste: boolean; copy: () => void; paste: () => void; actions: (event: MouseEvent<HTMLButtonElement>) => void
  canTie: boolean; tied: boolean; canUntie: boolean; tie: () => void; untie: () => void
}
function Tool({ label, children, pressed, disabled, onClick, className = '' }: {
  label: string; children: ReactNode; pressed?: boolean; disabled?: boolean; onClick: () => void; className?: string
}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={`notation-tool ${className}`}>{children}</button>
}
export default function NoteInputToolbar(p: Props) {
  const tools = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ before: false, after: false })
  useLayoutEffect(() => {
    const element = tools.current!
    const update = () => {
      const before = element.scrollLeft > 1, after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setOverflow(previous => previous.before === before && previous.after === after ? previous : { before, after })
    }
    const observer = new ResizeObserver(update)
    observer.observe(element); observer.observe(element.firstElementChild!)
    element.addEventListener('scroll', update, { passive: true }); update()
    return () => { observer.disconnect(); element.removeEventListener('scroll', update) }
  }, [])
  const enabled = p.entry.enabled
  const blocked = p.busy || (p.group && !enabled)
  const base = p.duration.n === 3 ? fraction(1, p.duration.d / 2) : p.duration
  return <div className="note-toolbar" role="toolbar" aria-label="음표 도구 모음">
    <button className="toolbar-scroll" aria-label="이전 음표 도구" title="이전 도구" disabled={!overflow.before} hidden={!overflow.before && !overflow.after} onClick={() => tools.current?.scrollBy({ left: -240 })}>‹</button>
    <div ref={tools} className="notation-tools">
    <div className="tool-section dock-tools">
      <Tool label="팔레트" pressed={p.left} onClick={p.palette}><span aria-hidden="true">☷</span></Tool>
    </div>
    <div className="tool-section mode-tools" role="group" aria-label="입력 방식">
      <Tool label="선택 도구" pressed={!enabled} disabled={p.busy} onClick={() => p.mode('select')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3v17l5-5 4 7 3-2-4-7h7Z"/></svg><span>선택</span></Tool>
      <Tool label="음표 입력" pressed={enabled && !p.entry.chord} disabled={p.busy} onClick={() => p.mode('note')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m16 3 5 5-12 12-6 1 1-6Zm-10 13-.4 2.4L8 18 18 8l-2-2Z"/></svg><span>음표 입력</span></Tool>
      <Tool label="화음 입력" pressed={enabled && p.entry.chord} disabled={p.busy || p.group || !p.chordAllowed || p.percussion} onClick={() => p.mode('chord')}><svg aria-hidden="true" viewBox="0 0 24 24"><ellipse cx="9" cy="17" rx="4" ry="2.5"/><ellipse cx="9" cy="11" rx="4" ry="2.5"/><ellipse cx="9" cy="5" rx="4" ry="2.5"/><path d="M12 3h2v17h-2Z"/></svg><span>화음</span></Tool>
    </div>
    <div className="tool-section duration-tools" role="group" aria-label="음표 길이">
      {[1, 2, 4, 8, 16, 32, 64].map(denominator => {
        const duration = fraction(1, denominator), label = `${durationName(duration)}음표`
        return <Tool key={denominator} label={label} pressed={equal(base, duration)} disabled={blocked} onClick={() => p.length(duration)}>
          <span className="music-symbol" aria-hidden="true">{rhythmSymbol(duration)}</span><span className="tool-caption">{durationName(duration)}</span>
        </Tool>
      })}
      <Tool label="점음표" pressed={p.duration.n === 3} disabled={blocked} onClick={p.dot}><span className="augmentation-dot" aria-hidden="true">·</span><span className="tool-caption">점</span></Tool>
      <Tool label="쉼표 입력" pressed={enabled && p.entry.rest} disabled={p.busy || p.group} onClick={p.rest}><span className="music-symbol" aria-hidden="true">{rhythmSymbol(fraction(1, 4), true)}</span><span className="tool-caption">쉼표</span></Tool>
    </div>
    <div className="tool-section tie-tools" role="group" aria-label="붙임줄">
      <Tool label="다음 음과 붙임줄" pressed={p.tied} disabled={p.busy || !p.canTie} onClick={p.tie}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 8Q12 22 21 8Q12 17 3 8Z"/></svg><span>붙임줄</span></Tool>
      <Tool label="선택 붙임줄 해제" disabled={p.busy || !p.canUntie} onClick={p.untie}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 8Q12 22 21 8Q12 17 3 8Z"/><path d="m4 3 17 17" stroke="currentColor" strokeWidth="2"/></svg><span>해제</span></Tool>
    </div>
    <div className="tool-section accidental-tools" role="group" aria-label="임시표">
      {([['♭', -1, '\ue260'], ['♮', 0, '\ue261'], ['♯', 1, '\ue262']] as const).map(([label, alter, symbol]) =>
        <Tool key={alter} label={`임시표 ${label}`} pressed={enabled && p.entry.accidental === alter} disabled={p.busy || !p.accidentalAllowed || p.percussion} onClick={() => p.accidental(alter)}><span className="music-symbol" aria-hidden="true">{symbol}</span></Tool>)}
    </div>
    <div className="tool-section voice-tools" role="group" aria-label="입력 성부">
      {[0, 1, 2, 3].map(index => <button type="button" key={index} aria-label={`${index + 1}성부`} title={`${index + 1}성부`} aria-pressed={p.voice === index} disabled={p.busy} onClick={() => p.selectVoice(index)} style={{ color: VOICE_COLORS[index] }}>{index + 1}</button>)}
    </div>
    <div className="tool-section history-tools">
      <Tool label="실행 취소" disabled={!p.undo || p.busy} onClick={() => p.history('undo')}><span aria-hidden="true">↶</span></Tool>
      <Tool label="다시 실행" disabled={!p.redo || p.busy} onClick={() => p.history('redo')}><span aria-hidden="true">↷</span></Tool>
    </div>
    <div className="tool-section clipboard-tools" role="group" aria-label="복사와 붙여넣기">
      <Tool label="선택 복사" disabled={p.busy || !p.canCopy} onClick={p.copy}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3h12v16H8Zm2 2v12h8V5ZM4 7h2v14h10v2H4Z"/></svg><span>복사</span></Tool>
      <Tool label="선택 위치에 붙여넣기" disabled={p.busy || !p.canPaste} onClick={p.paste}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 2h8v3h4v17H4V5h4Zm2 2v2h4V4ZM6 7v13h12V7h-2v1H8V7Z"/></svg><span>붙여넣기</span></Tool>
      <button type="button" className="notation-tool" aria-label="선택 작업" title="선택 작업" aria-haspopup="menu" disabled={p.busy || !p.canCopy} onClick={p.actions}><span aria-hidden="true">⋯</span><span>작업</span></button>
    </div>
    <div className="tool-section inspector-toggle"><Tool label="속성" pressed={p.right} onClick={p.properties}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 4h18v2H3Zm0 7h18v2H3Zm0 7h18v2H3Z"/><path d="M7 2h3v6H7Zm8 7h3v6h-3ZM6 16h3v6H6Z"/></svg><span>속성</span></Tool></div>
    </div>
    <button className="toolbar-scroll" aria-label="다음 음표 도구" title="다음 도구" disabled={!overflow.after} hidden={!overflow.before && !overflow.after} onClick={() => tools.current?.scrollBy({ left: 240 })}>›</button>
  </div>
}
