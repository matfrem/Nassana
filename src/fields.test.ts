import { describe, expect, it } from 'vitest'
import { buildFields, chipFor, columnsOf, dayOf, inkFor, isoOf, rawOf, todayNumber, toCell, type Field } from './fields'
import type { Task } from './types'

const SERIAL_EPOCH = 25_569 // Sheets day 25569 is 1970-01-01

describe('columnsOf', () => {
  it('skips the columns the app owns and blank headers, and detects the # suffix', () => {
    const cols = columnsOf(['', 'id', 'title', 'Description', 'dueDate#', 'Qui', 'board', 'status', 'Priority #'])
    expect(cols.map((c) => [c.key, c.label, c.shown, c.index])).toEqual([
      ['duedate#', 'dueDate', true, 4],
      ['qui', 'Qui', false, 5],
      ['priority #', 'Priority', true, 8],
    ])
  })
})

describe('dates', () => {
  it('reads serial numbers, ISO text and d/m/y text', () => {
    expect(dayOf(SERIAL_EPOCH)).toBe(0)
    expect(dayOf(SERIAL_EPOCH + 1.75)).toBe(1) // the time of day is ignored
    expect(dayOf('1970-01-02')).toBe(1)
    expect(dayOf('2/1/1970')).toBe(1)
    expect(dayOf('02.01.1970')).toBe(1)
    expect(dayOf('soon')).toBeNull()
    expect(dayOf(undefined)).toBeNull()
    expect(dayOf(true)).toBeNull()
  })

  it('gives the ISO form an <input type="date"> wants', () => {
    expect(isoOf(SERIAL_EPOCH + 365)).toBe('1971-01-01')
    expect(isoOf('15/01/2030')).toBe('2030-01-15')
    expect(isoOf('nope')).toBe('')
  })
})

const task = (id: string, values: Task['values']): Task => ({ id, title: id, board: { x: 0, y: 0, color: '#FFE066' }, values })
const col = (label: string, index = 0) => columnsOf(Array.from({ length: index }, () => '').concat(label))[0]

describe('buildFields: the type of a column', () => {
  const typeOf = (label: string, values: unknown[], meta = {}) =>
    buildFields([col(label)], values.map((v, i) => task(String(i), { [col(label).key]: v as never })), { [col(label).key]: meta })[0].type

  it('trusts what the Sheet says first', () => {
    expect(typeOf('prio', ['x'], { options: ['A', 'B'] })).toBe('select')
    expect(typeOf('done', ['x'], { checkbox: true })).toBe('checkbox')
    expect(typeOf('start', [1], { dateFormat: true })).toBe('date')
    expect(typeOf('start', ['x'], { dateValidation: true })).toBe('date')
  })

  it('otherwise guesses from the values', () => {
    expect(typeOf('flag', [true, false])).toBe('checkbox')
    expect(typeOf('day', ['2026-10-03', '2026-11-01'])).toBe('date')
    expect(typeOf('due', [46_000, 46_100])).toBe('date') // date-like name + plausible serials
    expect(typeOf('points', [3, 5, 8])).toBe('number')
    expect(typeOf('url', ['https://a.io/x', 'http://b.io'])).toBe('link')
    expect(typeOf('notes', ['hello', 3])).toBe('text')
    expect(typeOf('empty', [])).toBe('text')
  })

  it('keeps the Sheet colors on dropdown and text columns', () => {
    const f = buildFields([col('project')], [task('1', { project: 'BSN' })], { project: { colors: { bsn: '#112233' } } })[0]
    expect(f.colors).toEqual({ bsn: '#112233' })
  })
})

describe('toCell: what a typed value becomes in the Sheet', () => {
  const field = (type: Field['type'], serial = false): Field => ({ ...col('x'), type, serial })

  it('converts per type', () => {
    expect(toCell(field('checkbox'), true)).toBe(true)
    expect(toCell(field('number'), '3,5')).toBe(3.5)
    expect(toCell(field('number'), 'abc')).toBe('abc') // not a number: keep the text
    expect(toCell(field('text'), '  hi ')).toBe('hi')
    expect(toCell(field('text'), '')).toBe('')
  })

  it('writes dates the way the column stores them', () => {
    expect(toCell(field('date', true), '1970-01-02')).toBe(SERIAL_EPOCH + 1) // a date-formatted column wants a serial number
    expect(toCell(field('date', false), '15/01/2030')).toBe('2030-01-15') // a text column wants ISO text
    expect(toCell(field('date', true), '')).toBe('')
  })
})

describe('chipFor', () => {
  const field = (label: string, type: Field['type'], extra: Partial<Field> = {}): Field => ({ ...col(label), type, ...extra })
  const dayFromNow = (n: number) => new Date((todayNumber() + n) * 86_400_000).toISOString().slice(0, 10)

  it('turns overdue dates red and near ones orange', () => {
    const f = field('due', 'date')
    expect(chipFor(f, dayFromNow(-1))?.tone).toBe('red')
    expect(chipFor(f, dayFromNow(0))?.tone).toBe('orange')
    expect(chipFor(f, dayFromNow(2))?.tone).toBe('orange')
    expect(chipFor(f, dayFromNow(3))?.tone).toBeUndefined()
  })

  it('colors priorities by name', () => {
    const f = field('Priority', 'select', { options: [] })
    expect(chipFor(f, 'High')?.tone).toBe('red')
    expect(chipFor(f, 'P2')?.tone).toBe('orange')
    expect(chipFor(f, 'low')?.tone).toBe('green')
    expect(chipFor(f, 'A')?.tone).toBeUndefined()
  })

  it('shows nothing for empty values and false checkboxes, and the site name for links', () => {
    expect(chipFor(field('x', 'text'), '')).toBeNull()
    expect(chipFor(field('ok', 'checkbox'), false)).toBeNull()
    expect(chipFor(field('ok', 'checkbox'), true)?.text).toBe('ok')
    expect(chipFor(field('url', 'link'), 'https://www.example.com/a/b')?.text).toBe('example.com')
  })

  it('prefixes plain text with the column label, but not the value used for filters', () => {
    const c = chipFor(field('pole', 'text'), 'LD')!
    expect(c.text).toBe('pole: LD')
    expect(c.value).toBe('LD')
    expect(c.raw).toBe('ld')
  })
})

describe('small helpers', () => {
  it('rawOf normalizes values for comparisons', () => {
    expect(rawOf('  En Cours ')).toBe('en cours')
    expect(rawOf(undefined)).toBe('')
    expect(rawOf(3)).toBe('3')
  })

  it('inkFor picks readable text', () => {
    expect(inkFor('#FFE066')).toBe('#1f2328') // light fill: dark text
    expect(inkFor('#1a4d26')).toBe('#f5f5f5') // dark fill: light text
    expect(inkFor('not a color')).toBe('#1f2328')
  })
})
