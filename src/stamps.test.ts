import { describe, expect, it } from 'vitest'
import { formatStamps, parseStamps, stampColumns, stampEmoji, toggledStamps } from './stamps'

describe('stamps', () => {
  it('parses the column, ignoring blanks and duplicates', () => {
    expect(parseStamps(' fire, bomb ,,fire')).toEqual(['fire', 'bomb'])
    expect(parseStamps(undefined)).toEqual([])
    expect(formatStamps(['fire', 'bomb'])).toBe('fire,bomb')
  })
  it('toggles', () => {
    expect(toggledStamps(undefined, 'fire')).toEqual(['fire'])
    expect(toggledStamps(['fire', 'bomb'], 'fire')).toEqual(['bomb'])
  })
  it('knows its emojis and skips unknown ids when laying out', () => {
    expect(stampEmoji('fire')).toBe('🔥')
    expect(stampEmoji('nope')).toBeUndefined()
    expect(stampColumns(['fire', 'nope', 'bomb', 'star', 'bug'])).toEqual([['fire', 'bomb', 'star'], ['bug']])
    expect(stampColumns([])).toEqual([])
  })
})
