import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// SVG/font layout is tested in real Chromium; these tests isolate React input handling.
vi.mock('./notation/renderScore', () => ({ renderScore: vi.fn() }))
beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
}))
afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('renders the editor and clearly labels unverified tablet behavior', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'PocketScore' })).toBeVisible()
    expect(screen.getByText('4마디 · 4/4 · 박자 검증 통과')).toBeVisible()
    expect(screen.getByText(/실제 갤럭시 탭의 S펜/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeDisabled()
  })

  it('moves through rests, changes pitch with Shift, and supports undo/redo', () => {
    render(<App />)
    const canvas = screen.getByRole('region', { name: '악보 편집 영역' })
    const status = screen.getByTestId('selection-status')
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(status).toHaveTextContent('C4 4분음표')
    fireEvent.keyDown(canvas, { key: 'ArrowUp', shiftKey: true })
    expect(status).toHaveTextContent('C♯4')
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    expect(status).toHaveTextContent('C4')
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(status).toHaveTextContent('C♯4')
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(status).toHaveTextContent('4분쉼표')
    fireEvent.keyDown(canvas, { key: 'ArrowUp' })
    expect(status).toHaveTextContent('4분쉼표')
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    expect(status).toHaveTextContent('C♯4')
  })

  it('keeps shortcuts scoped to the canvas and disables editing in navigation mode', () => {
    render(<App />)
    const canvas = screen.getByRole('region', { name: '악보 편집 영역' })
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: '도구 막대 펼치기' }))
    const select = screen.getByRole('combobox', { name: '선택 길이' })
    fireEvent.keyDown(select, { key: 'ArrowUp' })
    expect(screen.getByTestId('selection-status')).toHaveTextContent('C4')
    fireEvent.click(screen.getByRole('button', { name: '탐색 모드' }))
    fireEvent.keyDown(canvas, { key: 'ArrowUp' })
    expect(screen.getByTestId('selection-status')).toHaveTextContent('C4')
    expect(select).toBeDisabled()
  })
})
