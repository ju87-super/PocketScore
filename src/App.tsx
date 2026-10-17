import { useReducer, useState } from 'react'
import ScoreCanvas from './editor/ScoreCanvas'
import { createEditor, editorReducer } from './editor/state'
import { DURATIONS, durationName, eventName, locate, validateScore } from './music/score'
import { equal, formatFraction } from './music/rational'
import { KEY_LABELS, TIME_SIGNATURES } from './music/settings'
import type { TimeSignature } from './music/settings'
import type { Pitch } from './music/pitch'

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createEditor)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(true)
  const { score, selection } = state.present
  const selected = selection ? locate(score, selection).event : null
  const errors = validateScore(score)
  const busy = state.gesture !== null

  return (
    <main>
      <header className="app-header">
        <div><h1>PocketScore</h1><p>Prototype 0.1 · 나만의 음악 노트</p></div>
        <span className="validation" role="status">{errors.length ? '박자 오류' : `${score.measures.length}마디 · ${score.timeSignature} · 박자 검증 통과`}</span>
      </header>
      <div className="workspace">
        <aside className="toolbar" data-expanded={expanded} aria-label="악보 도구 막대">
          <button aria-label={expanded ? '도구 막대 접기' : '도구 막대 펼치기'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <span aria-hidden="true">☰</span>{expanded && <span>도구 막대</span>}
          </button>
          <button aria-label="편집 모드" aria-pressed={editing} disabled={busy} onClick={() => setEditing(true)}>
            <span aria-hidden="true">✎</span>{expanded && <span>편집</span>}
          </button>
          <button aria-label="탐색 모드" aria-pressed={!editing} disabled={busy} onClick={() => setEditing(false)}>
            <span aria-hidden="true">↔</span>{expanded && <span>탐색 · 스크롤</span>}
          </button>
          <hr />
          <button aria-label="실행 취소" disabled={!state.past.length || busy} onClick={() => dispatch({ type: 'undo' })}>
            <span aria-hidden="true">↶</span>{expanded && <span>실행 취소</span>}
          </button>
          <button aria-label="다시 실행" disabled={!state.future.length || busy} onClick={() => dispatch({ type: 'redo' })}>
            <span aria-hidden="true">↷</span>{expanded && <span>다시 실행</span>}
          </button>
          {expanded && <div className="duration-tools">
            <label htmlFor="key-signature">악보 조표</label>
            <select id="key-signature" disabled={busy || !editing} value={score.keySignature}
              onChange={event => dispatch({ type: 'keySignature', key: Number(event.target.value) })}>
              {KEY_LABELS.map((label, index) => <option key={index} value={index - 7}>{label}</option>)}
            </select>
            <label htmlFor="time-signature">악보 박자표</label>
            <select id="time-signature" disabled={busy || !editing} value={score.timeSignature}
              onChange={event => dispatch({ type: 'timeSignature', time: event.target.value as TimeSignature })}>
              {TIME_SIGNATURES.map(time => <option key={time}>{time}</option>)}
            </select>
            <label htmlFor="accidental">선택 음표 임시표</label>
            <select id="accidental" disabled={selected?.kind !== 'note' || busy || !editing}
              value={selected?.kind === 'note' ? selected.pitch.alter : ''}
              onChange={event => dispatch({ type: 'accidental', alter: Number(event.target.value) as Pitch['alter'] })}>
              {selected?.kind !== 'note' && <option value="">음표 선택</option>}
              <option value="1">♯ 올림표</option><option value="-1">♭ 내림표</option><option value="0">♮ 제자리표</option>
            </select>
            <label htmlFor="duration">선택 길이</label>
            <select id="duration" disabled={!selected || busy || !editing} value={selected ? DURATIONS.findIndex(duration => equal(duration, selected.duration)) : ''}
              onChange={event => dispatch({ type: 'duration', duration: DURATIONS[Number(event.target.value)] })}>
              {!selected && <option value="">이벤트 선택</option>}
              {DURATIONS.map((duration, index) => <option key={index} value={index}>{durationName(duration)}</option>)}
            </select>
          </div>}
        </aside>
        <div className="score-content">
          <div className="score-caption">
            <h2>첫 번째 스케치</h2>
            <span>{editing ? '편집 모드' : '탐색 모드'}</span>
          </div>
          <ScoreCanvas score={score} selection={selection} editing={editing} dispatch={dispatch} />
          <output className="selection-status" aria-live="polite" data-testid="selection-status">
            {selected && selection ? `${score.measures.findIndex(measure => measure.id === selection.measureId) + 1}마디 · ${eventName(selected)} · 시작 ${formatFraction(selected.start)}` : '음표나 쉼표를 선택하세요.'}
          </output>
          <p className="notice" role="status">{state.notice || (busy ? '드래그 미리보기 · 손을 떼면 적용' : editing ? '음표·쉼표를 직접 선택하거나 악보 영역에서 방향키로 시작하세요.' : '악보를 스크롤할 수 있습니다. 수정하려면 편집 모드로 전환하세요.')}</p>
        </div>
      </div>
      <details className="help"><summary>조작 안내와 검증 범위</summary>
        <p id="editing-help">편집 모드에서 세로 드래그는 음높이, 가로 드래그는 길이를 변경합니다. ↑↓는 선택 조표의 온음계, Shift+↑↓는 반음, ←→는 쉼표를 포함한 전체 이벤트를 순회합니다. Ctrl/Cmd+Z는 실행 취소, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y는 다시 실행입니다. Esc로 드래그를 취소합니다.</p>
        <p>조표 변경은 기존 음높이를 보존합니다. 임시표는 같은 마디의 같은 음이름·옥타브에 적용되며 다음 마디에서 초기화됩니다. 박자 변경은 음표를 보존하고 남은 시간을 쉼표로 채웁니다. 음표가 잘리는 변경은 거부합니다.</p>
        <p>음역 C2–C7, 길이 16분음표–온음표(점음표 포함). 길이 변경은 같은 성부·마디의 뒤 쉼표만 사용합니다. 탐색 모드에서는 드래그 편집 대신 스크롤합니다.</p>
        <p>실제 갤럭시 탭의 S펜·손가락 입력과 MuseScore GUI 호환성은 미검증입니다. 음원 재생·저장·MusicXML·오프라인 기능은 이번 프로토타입에 포함되지 않습니다.</p>
      </details>
    </main>
  )
}
