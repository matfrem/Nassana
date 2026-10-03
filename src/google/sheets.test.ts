import { describe, expect, it } from 'vitest'
import { parseSheetId, parseTasks, SheetError } from './sheets'

describe('parseSheetId', () => {
  const id = 'A'.repeat(30)
  it('accepts a link or a bare id', () => {
    expect(parseSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id)
    expect(parseSheetId(`  ${id}  `)).toBe(id)
  })
  it('rejects anything else', () => {
    expect(parseSheetId('hello')).toBeNull()
    expect(parseSheetId('https://example.com')).toBeNull()
  })
})

describe('parseTasks', () => {
  const board = (x: number, y: number, color = '#ff0000') => JSON.stringify({ x, y, color })

  it('matches columns by name, whatever their order, and ignores blank headers', () => {
    const { tasks, columns } = parseTasks([
      ['', 'Title', 'ID', 'board', 'Qui', 'pole#', 'status', 'description'],
      ['', 'Blockout', 't1', board(10, 20), 'Laura', 'LD', 'En Cours', 'Make it'],
    ])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ id: 't1', title: 'Blockout', status: 'En Cours', description: 'Make it' })
    expect(tasks[0].board).toEqual({ x: 10, y: 20, color: '#ff0000' })
    expect(tasks[0].autoPlaced).toBe(false)
    expect(tasks[0].values).toEqual({ qui: 'Laura', 'pole#': 'LD' })
    expect(columns.map((c) => [c.label, c.shown])).toEqual([
      ['Qui', false],
      ['pole', true],
    ])
  })

  it('keeps cell values as the API returns them (numbers, booleans)', () => {
    const { tasks } = parseTasks([
      ['id', 'title', 'points#', 'done#'],
      ['1', 'a', 5, true],
    ])
    expect(tasks[0].values).toEqual({ 'points#': 5, 'done#': true })
  })

  it('lays out notes without a position below the placed ones, 5 per row', () => {
    const rows: unknown[][] = [['id', 'title', 'board'], ['p', 'placed', board(0, 0)]]
    for (let i = 0; i < 7; i++) rows.push([`n${i}`, `new ${i}`, ''])
    const { tasks } = parseTasks(rows)
    const auto = tasks.filter((t) => t.autoPlaced)
    expect(auto).toHaveLength(7)
    expect(new Set(auto.map((t) => t.board.y)).size).toBe(2) // two rows
    expect(auto.every((t) => t.board.y > 180)).toBe(true) // below the placed note
    expect(new Set(auto.map((t) => `${t.board.x},${t.board.y}`)).size).toBe(7) // no two on the same spot
  })

  it('survives broken board cells', () => {
    const { tasks } = parseTasks([['id', 'title', 'board'], ['1', 'a', '{oops'], ['2', 'b', '{"x":"left","y":1}']])
    expect(tasks.every((t) => t.autoPlaced && Number.isFinite(t.board.x))).toBe(true)
  })

  it('skips rows without an id (and says which) and duplicate ids', () => {
    const { tasks, warnings, missingIdRows, idColumn } = parseTasks([
      ['id', 'title'],
      ['1', 'one'],
      ['', 'no id'],
      ['', ''], // a blank row is not a problem
      ['1', 'duplicate'],
      ['2', 'two'],
    ])
    expect(tasks.map((t) => t.id)).toEqual(['1', '2'])
    expect(missingIdRows).toEqual([3]) // sheet row 3
    expect(idColumn).toBe(0)
    expect(warnings).toEqual(['1 row(s) skipped: empty id.', '1 row(s) skipped: duplicate id.'])
  })

  it('explains what is wrong with the structure and how to repair it', () => {
    expect(() => parseTasks([])).toThrow(SheetError)
    try {
      parseTasks([])
    } catch (e) {
      expect((e as SheetError).fix).toEqual({ kind: 'empty' })
    }
    try {
      parseTasks([['title', 'foo']])
    } catch (e) {
      // The repair adds what is missing from id | title | board, so `board` comes along with `id`.
      expect((e as SheetError).fix).toEqual({ kind: 'missing-columns', columns: ['id', 'board'] })
    }
  })
})
