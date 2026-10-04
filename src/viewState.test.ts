import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadView, saveView } from './viewState'

let store: Record<string, string>
beforeEach(() => {
  store = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  })
})

const rule = { key: 'status', raw: 'done', text: 'Done', label: 'Status' }

describe('view state (kept per browser and per Sheet)', () => {
  it('starts empty', () => {
    expect(loadView('S')).toEqual({ colorBy: '', hidden: [], only: null, camera: null, showLinks: true, showStamps: true, showChips: true, background: 'dots', bgColor: '#e8eef7' })
    expect(loadView(null)).toEqual({ colorBy: '', hidden: [], only: null, camera: null, showLinks: true, showStamps: true, showChips: true, background: 'dots', bgColor: '#e8eef7' })
  })

  it('merges what is saved, per Sheet', () => {
    saveView('S', { colorBy: 'status' })
    saveView('S', { hidden: [rule] })
    saveView('S', { camera: { x: 1, y: 2, zoom: 0.5 }, showLinks: true, showStamps: true, showChips: true, background: 'dots', bgColor: '#e8eef7' })
    saveView('OTHER', { colorBy: 'pole' })
    expect(loadView('S')).toEqual({ colorBy: 'status', hidden: [rule], only: null, camera: { x: 1, y: 2, zoom: 0.5 }, showLinks: true, showStamps: true, showChips: true, background: 'dots', bgColor: '#e8eef7' })
    expect(loadView('OTHER').colorBy).toBe('pole')
  })

  it('reads the entries older versions wrote', () => {
    store['nassana.colorBy.S'] = 'qui'
    store['nassana.hidden.S'] = JSON.stringify([rule])
    expect(loadView('S')).toMatchObject({ colorBy: 'qui', hidden: [rule] })
  })

  it('ignores corrupted data instead of crashing', () => {
    store['nassana.view.S'] = JSON.stringify({ colorBy: 3, hidden: [{ key: 1 }, rule], only: 'x', camera: { x: 'a' } })
    expect(loadView('S')).toEqual({ colorBy: '', hidden: [rule], only: null, camera: null, showLinks: true, showStamps: true, showChips: true, background: 'dots', bgColor: '#e8eef7' })
    store['nassana.view.T'] = '{not json'
    expect(loadView('T').hidden).toEqual([])
  })

  it('does not throw when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => saveView('S', { colorBy: 'x' })).not.toThrow()
    expect(loadView('S').colorBy).toBe('')
  })
  it('remembers hidden stamps and pills', () => {
    saveView('S', { showStamps: false, showChips: false })
    expect(loadView('S')).toMatchObject({ showStamps: false, showChips: false })
    expect(loadView('Other')).toMatchObject({ showStamps: true, showChips: true, background: 'dots', bgColor: '#e8eef7' })
  })
  it('remembers the background, and ignores nonsense', () => {
    saveView('S', { background: 'color', bgColor: '#112233' })
    expect(loadView('S')).toMatchObject({ background: 'color', bgColor: '#112233' })
    localStorage.setItem('nassana.view.T', JSON.stringify({ background: 'weird', bgColor: 'red' }))
    expect(loadView('T')).toMatchObject({ background: 'dots', bgColor: '#e8eef7' })
  })
  it('remembers hidden links', () => {
    saveView('S', { showLinks: false })
    expect(loadView('S').showLinks).toBe(false)
    expect(loadView('Other').showLinks).toBe(true)
  })
})
