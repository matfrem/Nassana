import { describe, expect, it } from 'vitest'
import { byFrequency, hexToHsl, hslToHex, normalizeHex, PALETTE } from './colorUtil'

describe('colorUtil', () => {
  it('converts between hex and hsl', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 })
    expect(hslToHex({ h: 120, s: 100, l: 50 })).toBe('#00ff00')
    expect(hslToHex({ h: 0, s: 0, l: 100 })).toBe('#ffffff')
    for (const c of ['#ffe066', '#3b82f6', '#808080']) expect(hslToHex(hexToHsl(c)).toLowerCase()).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('normalizes typed hex values', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('ffe066')).toBe('#ffe066')
    expect(normalizeHex('#ffe06')).toBeNull()
    expect(normalizeHex('nope')).toBeNull()
  })
  it('lists board colors most used first, without duplicates', () => {
    expect(byFrequency(['#FF0000', '#00ff00', '#ff0000', 'nope', '#0000ff', '#00ff00', '#ff0000'])).toEqual(['#ff0000', '#00ff00', '#0000ff'])
    expect(byFrequency(['#111111', '#222222', '#333333'], 2)).toHaveLength(2)
  })
  it('has a palette of valid colors', () => {
    expect(PALETTE).toHaveLength(80)
    expect(new Set(PALETTE).size).toBe(80)
    expect(PALETTE.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })
})
