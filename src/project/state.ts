import { eventPitches, locate, resizeEvent, setAccidental, setKeySignature, setTimeSignature, transposeEvent } from '../music/score'
import type { Pitch } from '../music/pitch'
import type { Action } from '../editor/state'
import type { Mixer, Project, ProjectSelection } from './model'
import { allSelections, createProject, DRUMS, freshScoreEvents, reconcileProjectTies, staffAt, updateStaff, validateProject } from './model'
import { isGroupSelection, navigationTargets, pickSelection, reconcileSelection, singleSelection, targetKey, transposeSelection, validTarget } from './selection'
import type { ScoreSelection } from './selection'
import { addEntryChord, beginEntry, createNoteEntry, entryPosition, followingPosition, letterPitch, reconcileEntry, writeEntry } from './noteEntry'
import type { EntryPosition, NoteEntry } from './noteEntry'
import { addVoice } from './structure'
import { compare } from '../music/rational'
import { midi } from '../music/pitch'
import { copyScoreSelection, pasteScoreSelection } from './clipboard'
import type { ScoreClipboard } from './clipboard'
import { clearTies, toggleTie } from '../music/ties'

export type Snapshot = Readonly<{ project: Project; selection: ProjectSelection | null; selected: ScoreSelection | null; entry: NoteEntry }>
type Sound = Readonly<{ master: number; parts: Readonly<Record<string, Mixer>> }>
export type ProjectState = Readonly<{
  present: Snapshot; past: readonly Snapshot[]; future: readonly Snapshot[]
  gesture: Readonly<{ before: Snapshot; target: ProjectSelection; selected: ScoreSelection }> | null
  notice: string
  sound: Sound
  clipboard: ScoreClipboard | null
}>
export type ProjectAction =
  | { type: 'canvas'; partId: string; staffId: string; action: Action }
  | { type: 'change'; change: (project: Project) => Project; selection?: ProjectSelection | null }
  | { type: 'selection'; selection: ProjectSelection | null }
  | { type: 'pick'; selection: ProjectSelection; extend?: boolean; additive?: boolean }
  | { type: 'navigate'; direction: -1 | 1; extend?: boolean }
  | { type: 'sound'; change: (project: Project) => Project }
  | { type: 'entryMode'; enabled: boolean; selection?: ProjectSelection }
  | { type: 'entrySettings'; settings: Partial<Pick<NoteEntry, 'duration' | 'accidental' | 'rest' | 'chord'>> }
  | { type: 'entryWrite'; letter?: Pitch['step']; pitch?: Pitch; position?: EntryPosition; chord?: boolean; chordTarget?: ProjectSelection; rest?: boolean }
  | { type: 'entryVoice'; index: number; selection?: ProjectSelection }
  | { type: 'deleteSelected' }
  | { type: 'copySelected' | 'copyMeasure' }
  | { type: 'paste'; target?: ProjectSelection }
  | { type: 'tie' | 'clearTies' }
  | { type: 'undo' | 'redo' | 'cancel' }

const captureSound = (project: Project, previous?: Sound): Sound => ({ master: project.masterVolume, parts: { ...previous?.parts, ...Object.fromEntries(project.parts.map(part => [part.id, part.mixer])) } })
function restoreSound(project: Project, sound: Sound): Project {
  return { ...project, masterVolume: sound.master, parts: project.parts.map(part => ({ ...part, mixer: sound.parts[part.id] ?? part.mixer })) }
}
function sameFields(a: object, b: object, excluded: readonly string[]) {
  const keys = Object.keys(a).filter(key => !excluded.includes(key))
  return keys.length === Object.keys(b).filter(key => !excluded.includes(key)).length
    && keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])
}
// Compare all score fields; only explicitly external sound fields are omitted.
const sameMusic = (a: Project, b: Project) => sameFields(a, b, ['masterVolume', 'parts']) && a.parts.length === b.parts.length
  && a.parts.every((part, i) => sameFields(part, b.parts[i], ['mixer']))
export const createProjectState = (project = createProject()): ProjectState => ({ present: { project, selection: null, selected: null, entry: createNoteEntry() }, past: [], future: [], gesture: null, notice: '', sound: captureSound(project), clipboard: null })
function commit(state: ProjectState, next: Snapshot, before = state.present): ProjectState {
  if (next.project === before.project) return { ...state, present: next, gesture: null }
  const errors = validateProject(next.project)
  if (errors.length) throw new Error(errors.join(' '))
  const selected = reconcileSelection(next.project, next.selected)
  const selection = next.selection && validTarget(next.project, next.selection) ? next.selection : selected?.focus ?? null
  const sound = captureSound(next.project, state.sound)
  const entry = reconcileEntry(next.project, next.entry)
  if (sameMusic(before.project, next.project)) return { ...state, present: { ...next, selection, selected, entry }, sound, gesture: null, notice: '' }
  return { ...state, present: { ...next, selection, selected, entry }, past: [...state.past, before].slice(-100), future: [], gesture: null, notice: '', sound }
}

export function projectReducer(state: ProjectState, input: ProjectAction): ProjectState {
  const action = input.type === 'canvas' ? input.action : input
  if (action.type === 'cancel') return state.gesture ? { ...state, present: state.gesture.before, gesture: null, notice: '드래그를 취소했습니다.' } : state
  if (state.gesture && !['previewPitch', 'previewDuration', 'commit'].includes(action.type)) return state
  try {
    if (input.type === 'tie' || input.type === 'clearTies') {
      const { project, selection, selected } = state.present
      if (!selection || !selected) throw new Error('먼저 음표를 선택하세요.')
      if (input.type === 'tie' && isGroupSelection(selected)) throw new Error('붙임줄은 구성음을 하나 선택한 뒤 연결하세요.')
      if (input.type === 'tie' && staffAt(project, selection).part.instrument === 'drums') throw new Error('타악기 붙임줄은 현재 지원하지 않습니다.')
      let next = project
      if (input.type === 'tie') next = updateStaff(project, selection.staffId, staff => ({ ...staff, score: toggleTie(staff.score, selection) }))
      else for (const staff of project.parts.flatMap(part => part.staves)) {
        const score = clearTies(staff.score, selected.targets.filter(target => target.staffId === staff.id))
        if (score !== staff.score) next = updateStaff(next, staff.id, item => ({ ...item, score }))
      }
      return commit(state, { ...state.present, project: next })
    }
    if (input.type === 'copySelected' || input.type === 'copyMeasure') {
      const selected = input.type === 'copyMeasure' && state.present.selection
        ? pickSelection(state.present.project, null, { ...state.present.selection, scope: 'measure' }) : state.present.selected
      const clipboard = copyScoreSelection(state.present.project, selected)
      return { ...state, clipboard, notice: `${clipboard.rows.length}개 성부의 선택 요소를 복사했습니다.` }
    }
    if (input.type === 'paste') {
      const result = pasteScoreSelection(state.present.project, state.clipboard, input.target ?? state.present.selection)
      const next = commit(state, { ...state.present, project: result.project, selection: result.selection, selected: result.selected,
        entry: { ...state.present.entry, enabled: false, last: null, cursor: null } })
      return { ...next, notice: `붙여넣기 완료${result.addedMeasures ? ` · ${result.addedMeasures}마디 추가` : ''}${result.skippedRows ? ` · 아래 성부 부족으로 ${result.skippedRows}개 성부 건너뜀` : ''}` }
    }
    if (action.type === 'undo' || action.type === 'redo') {
      const source = action.type === 'undo' ? state.past : state.future
      const next = source.at(-1)
      if (!next) return state
      const restored = { ...next, project: restoreSound(next.project, state.sound), entry: { ...next.entry,
        enabled: state.present.entry.enabled, duration: state.present.entry.duration, rest: state.present.entry.rest, chord: state.present.entry.chord, accidental: null } }
      return action.type === 'undo'
        ? { ...state, present: restored, past: state.past.slice(0, -1), future: [...state.future, state.present], notice: '' }
        : { ...state, present: restored, past: [...state.past, state.present], future: state.future.slice(0, -1), notice: '' }
    }
    if (input.type === 'entryMode') {
      const target = input.selection ?? state.present.selection
      const entry = input.enabled ? beginEntry(state.present.project, state.present.entry, target)
        : { ...state.present.entry, enabled: false, accidental: null, chord: false }
      return { ...state, present: { ...state.present, entry,
        ...(input.enabled && target ? { selection: target, selected: singleSelection(target) } : {}) }, notice: '' }
    }
    if (input.type === 'entrySettings') return { ...state, present: { ...state.present, entry: { ...state.present.entry, ...input.settings } }, notice: '' }
    if (input.type === 'entryVoice') {
      if (!Number.isInteger(input.index) || input.index < 0 || input.index > 3) throw new Error('성부는 1–4번까지 지원합니다.')
      let { project } = state.present
      const origin = state.present.entry.enabled && state.present.entry.cursor ? state.present.entry.cursor
        : entryPosition(project, input.selection ?? state.present.selection ?? allSelections(project)[0])
      while (staffAt(project, origin).staff.score.measures[0].voices.length <= input.index) project = addVoice(project, origin.staffId)
      const staff = staffAt(project, origin).staff
      const voice = staff.score.measures.find(bar => bar.id === origin.measureId)!.voices[input.index]
      const event = voice.events.find(item => compare(item.start, origin.start) >= 0) ?? voice.events.at(-1)!
      const selection = { partId: origin.partId, staffId: origin.staffId, voiceId: voice.id, measureId: origin.measureId, eventId: event.id }
      return commit(state, { ...state.present, project, selection, selected: singleSelection(selection), entry: { ...state.present.entry, cursor: { ...origin, voiceId: voice.id }, last: null, chord: false } })
    }
    if (input.type === 'entryWrite') {
      const before = state.present
      let entry = before.entry
      if (input.position) entry = { ...entry, cursor: input.chordTarget
        ? followingPosition(before.project, input.position, locate(staffAt(before.project, input.chordTarget).staff.score, input.chordTarget).event.duration) : input.position }
      const chordTarget = input.chordTarget ?? (input.chord ? entry.enabled ? entry.last : before.selection : null)
      if (input.chord && !chordTarget) throw new Error('화음에 추가할 음표를 먼저 입력하거나 선택하세요.')
      if (chordTarget && isGroupSelection(before.selected)) throw new Error('화음 입력은 음표 하나를 선택한 뒤 사용하세요.')
      let value = input.rest ? null : input.pitch
      if (input.letter) {
        if (chordTarget) {
          const targetEntry = { ...entry, cursor: entryPosition(before.project, chordTarget) }
          const tones = eventPitches(locate(staffAt(before.project, chordTarget).staff.score, chordTarget).event)
          const highest = [...tones].sort((a, b) => midi(b) - midi(a))[0]
          value = letterPitch(before.project, targetEntry, input.letter, highest)
        } else value = letterPitch(before.project, entry, input.letter)
      }
      const origin = chordTarget ?? entry.cursor
      if (origin && staffAt(before.project, origin).part.instrument === 'drums' && value) {
        const drum = DRUMS.find(item => item.midi === midi(value!))
        if (!drum) throw new Error('드럼은 마우스·펜으로 킥·스네어·하이햇 위치를 선택하세요.')
      }
      if (value === undefined) value = null
      const result = chordTarget && value ? addEntryChord(before.project, entry, chordTarget, value) : writeEntry(before.project, entry, value)
      return commit(state, { ...before, ...result, selected: singleSelection(result.selection) })
    }
    if (input.type === 'deleteSelected') {
      const { selected } = state.present
      if (!selected) return state
      const keys = new Set(selected.targets.map(targetKey))
      let changed = false
      const project = { ...state.present.project, parts: state.present.project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff,
        score: { ...staff.score, measures: staff.score.measures.map(bar => ({ ...bar, voices: bar.voices.map(voice => ({ ...voice, events: voice.events.map(event => {
          const pitches = eventPitches(event).filter((_, pitchIndex) => !keys.has(targetKey({ partId: part.id, staffId: staff.id, measureId: bar.id, voiceId: voice.id, eventId: event.id, pitchIndex })))
          if (pitches.length === eventPitches(event).length) return event
          changed = true
          const base = { id: event.id, start: event.start, duration: event.duration }
          const tieTo = event.kind === 'note' ? event.tieTo?.filter(value => pitches.some(pitch => midi(pitch) === value)) : undefined
          return pitches.length ? { ...base, kind: 'note' as const, pitch: pitches[0], chord: pitches.slice(1), ...(tieTo?.length ? { tieTo } : {}) } : { ...base, kind: 'rest' as const }
        }) })) })) },
      })) })) }
      if (!changed) return state
      return commit(state, { ...state.present, project: reconcileProjectTies(state.present.project, project) })
    }
    if (input.type === 'sound') {
      const project = input.change(state.present.project)
      if (!sameMusic(project, state.present.project)) throw new Error('음원 설정에서 악보를 변경할 수 없습니다.')
      const errors = validateProject(project)
      if (errors.length) throw new Error(errors.join(' '))
      return { ...state, present: { ...state.present, project }, sound: captureSound(project, state.sound), notice: '' }
    }
    if (input.type === 'change') return commit(state, { ...state.present, project: input.change(state.present.project), selection: input.selection === undefined ? state.present.selection : input.selection,
      selected: input.selection === undefined ? state.present.selected : input.selection ? singleSelection(input.selection) : null })
    if (input.type === 'selection') return { ...state, present: { ...state.present, selection: input.selection, selected: input.selection ? pickSelection(state.present.project, null, input.selection) : null }, notice: '' }
    if (input.type === 'pick') {
      const selected = pickSelection(state.present.project, state.present.selected, input.selection, input.extend, input.additive)
      return { ...state, present: { ...state.present, selected, selection: selected?.focus ?? null,
        entry: input.extend || input.additive ? { ...state.present.entry, enabled: false } : state.present.entry }, notice: '' }
    }
    if (input.type === 'navigate') {
      const all = navigationTargets(state.present.project)
      const from = input.extend ? state.present.selected?.focus ?? state.present.selection : state.present.selection
      const current = all.findIndex(item => item.eventId === from?.eventId)
      const index = current < 0 ? (input.direction === 1 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, current + input.direction))
      const point = { ...all[index], pitchIndex: 0 }
      const selected = pickSelection(state.present.project, state.present.selected, point, input.extend)
      return { ...state, present: { ...state.present, selection: point, selected, entry: state.present.entry.enabled
        ? { ...state.present.entry, enabled: !input.extend, cursor: entryPosition(state.present.project, point), last: null } : state.present.entry }, notice: '' }
    }
    if (input.type !== 'canvas') return state
    if (action.type === 'begin' || action.type === 'select') {
      const selection = { ...action.selection, partId: input.partId, staffId: input.staffId,
        pitchIndex: action.selection.pitchIndex ?? (action.selection.eventId === state.present.selection?.eventId ? state.present.selection.pitchIndex : 0) }
      const keepGroup = action.type === 'begin' && state.present.selected?.targets.some(item => targetKey(item) === targetKey(selection))
      const selected = keepGroup ? state.present.selected : singleSelection(selection)
      return { ...state, present: { ...state.present, selection, selected }, gesture: action.type === 'begin' ? { before: state.present, target: selection, selected: selected! } : null, notice: '' }
    }
    if (action.type === 'commit') return state.gesture ? commit(state, state.present, { ...state.gesture.before, selection: state.gesture.target, selected: state.gesture.selected }) : state
    if (action.type === 'cursor') {
      const all = allSelections(state.present.project)
      const current = all.findIndex(item => item.eventId === state.present.selection?.eventId)
      const index = current < 0 ? (action.direction === 1 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, current + action.direction))
      return { ...state, present: { ...state.present, selection: all[index], selected: singleSelection(all[index]) }, notice: '' }
    }
    const preview = action.type === 'previewPitch' || action.type === 'previewDuration'
    if (preview && !state.gesture) return state
    const before = preview && state.gesture ? { ...state.gesture.before, selection: state.gesture.target, selected: state.gesture.selected } : state.present
    if (action.type === 'keySignature' || action.type === 'timeSignature') {
      const project = { ...before.project, parts: before.project.parts.map(part => ({ ...part, staves: part.staves.map(staff => ({ ...staff,
        score: action.type === 'keySignature' ? setKeySignature(staff.score, action.key) : freshScoreEvents(staff.score, setTimeSignature(staff.score, action.time)),
      })) })) }
      return commit(state, { ...before, project })
    }
    const selection = before.selection
    if (!selection) throw new Error('먼저 음표나 쉼표를 선택하세요.')
    if (isGroupSelection(before.selected)) {
      if (action.type === 'duration' || action.type === 'previewDuration') throw new Error('그룹 선택에서는 음표 길이를 변경할 수 없습니다.')
      if (action.type === 'pitch' || action.type === 'previewPitch') {
        const project = transposeSelection(before.project, before.selected!, action.amount, action.type === 'pitch' ? action.chromatic !== false : false, before.selection ?? undefined)
        if (preview) return { ...state, present: { ...before, project }, notice: '' }
        return commit(state, { ...before, project })
      }
      if (action.type === 'accidental') throw new Error('임시표는 구성음을 하나 선택한 뒤 지정하세요.')
    }
    const { part, staff } = staffAt(before.project, selection)
    if (part.instrument === 'drums' && ['pitch', 'previewPitch', 'accidental'].includes(action.type)) throw new Error('드럼 음은 속성에서 킥·스네어·하이햇으로 지정하세요.')
    const score = action.type === 'pitch' || action.type === 'previewPitch'
      ? transposeEvent(staff.score, selection, action.amount, action.type === 'pitch' && action.chromatic)
      : action.type === 'duration' || action.type === 'previewDuration' ? resizeEvent(staff.score, selection, action.duration)
      : action.type === 'accidental' ? setAccidental(staff.score, selection, action.alter) : staff.score
    if (score === staff.score) return preview ? { ...state, present: before, notice: '' } : state
    const project = updateStaff(before.project, staff.id, item => ({ ...item, score: freshScoreEvents(staff.score, score) }))
    const next = { ...before, project }
    if (preview) {
      const errors = validateProject(project)
      if (errors.length) throw new Error(errors.join(' '))
      return { ...state, present: next, notice: '' }
    }
    return commit(state, next)
  } catch (error) {
    return { ...state, present: state.gesture ? { ...state.gesture.before, selection: state.gesture.target, selected: state.gesture.selected } : state.present, notice: error instanceof Error ? error.message : '편집할 수 없습니다.' }
  }
}
