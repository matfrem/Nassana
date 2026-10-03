import { describe, expect, it } from 'vitest'
import { buildRequests, sameOpts, type Draft, type Structure } from './columns'

// ---- A tiny in-memory Sheet: just the parts the requests touch, to check the index maths for real.
interface Col {
  header: string
  hidden: boolean
  validation?: string
  numberFormat?: string
}
interface Rule {
  header: string
  value: string
}

function makeSheet(st: Structure) {
  const cols: Col[] = st.columns.map((c) => ({ header: c.header, hidden: c.hidden }))
  // Sheets keeps a rule attached to its column when columns move or go away: track them by header text.
  const rules: Rule[] = st.rules.map((r) => ({ header: st.columns[r.column!].header, value: r.value! }))
  let grid = st.gridColumns

  function apply(requests: any[]) {
    for (const q of requests) {
      if (q.deleteConditionalFormatRule) rules.splice(q.deleteConditionalFormatRule.index, 1)
      else if (q.deleteDimension) {
        const [removed] = cols.splice(q.deleteDimension.range.startIndex, 1)
        for (let i = rules.length - 1; i >= 0; i--) if (rules[i].header === removed.header) rules.splice(i, 1)
        grid--
      } else if (q.moveDimension) {
        const [c] = cols.splice(q.moveDimension.source.startIndex, 1)
        cols.splice(q.moveDimension.destinationIndex, 0, c)
      } else if (q.insertDimension || q.appendDimension) {
        const n = q.insertDimension ? q.insertDimension.range.endIndex - q.insertDimension.range.startIndex : q.appendDimension.length
        const at = q.insertDimension ? q.insertDimension.range.startIndex : cols.length
        cols.splice(at, 0, ...Array.from({ length: n }, () => ({ header: '', hidden: false })))
        grid += n
      } else if (q.updateCells) {
        const col = cols[q.updateCells.start.columnIndex]
        const old = col.header
        col.header = q.updateCells.rows[0].values[0].userEnteredValue.stringValue
        for (const r of rules) if (r.header === old) r.header = col.header // a renamed column keeps its rules
      } else if (q.setDataValidation) cols[q.setDataValidation.range.startColumnIndex].validation = q.setDataValidation.rule?.condition.type
      else if (q.repeatCell) cols[q.repeatCell.range.startColumnIndex].numberFormat = q.repeatCell.cell.userEnteredFormat.numberFormat.type
      else if (q.addConditionalFormatRule) {
        const r = q.addConditionalFormatRule.rule
        rules.unshift({ header: cols[r.ranges[0].startColumnIndex].header, value: r.booleanRule.condition.values[0].userEnteredValue })
      } else if (q.updateDimensionProperties) cols[q.updateDimensionProperties.range.startIndex].hidden = q.updateDimensionProperties.properties.hiddenByUser
      else throw new Error('unknown request ' + JSON.stringify(q))
    }
  }
  return { cols, rules, apply, grid: () => grid }
}

const structure = (extra: Partial<Structure> = {}): Structure => ({
  gid: 7,
  gridColumns: 8,
  columns: ['id', 'title', 'prio#', 'notes', 'project#', 'board', 'drawing', 'status'].map((header, index) => ({ index, header, hidden: false })),
  rules: [
    { index: 0, column: 4, value: 'BSN', color: '#b8e0cc' },
    { index: 1, column: 4, value: 'TZ', color: '#fabd00' },
    { index: 2, column: 2, value: 'High', color: '#ff0000' }, // another column's rule: it must survive
  ],
  ...extra,
})

const existing = (index: number, name: string, shown: boolean, type: Draft['type'], extra: Partial<Draft> = {}): Draft => ({
  uid: 'c' + index,
  index,
  name,
  shown,
  type,
  opts: [],
  hidden: false,
  deleted: false,
  orig: { name, shown, type, opts: [], hidden: false },
  ...extra,
})
const fresh = (uid: string, name: string, type: Draft['type'], extra: Partial<Draft> = {}): Draft => ({
  uid,
  name,
  shown: true,
  type,
  opts: [],
  hidden: false,
  deleted: false,
  ...extra,
})

describe('buildRequests', () => {
  it('does nothing when nothing changed', () => {
    const plan = buildRequests(structure(), [existing(2, 'prio', true, 'text'), existing(3, 'notes', false, 'text'), existing(4, 'project', true, 'text')], [], [])
    expect(plan.requests).toEqual([])
    expect(plan.summary).toEqual([])
  })

  it('deletes, renames, reorders, adds, hides: the final Sheet matches what was asked', () => {
    const st = structure()
    const prio = existing(2, 'priority', true, 'text') // renamed from "prio"
    prio.orig!.name = 'prio'
    const notes = existing(3, 'notes', false, 'text', { deleted: true })
    const project = existing(4, 'project', true, 'select', {
      opts: [
        { value: 'BSN', color: '#112233' },
        { value: 'TZ', color: '#fabd00' },
        { value: 'NEW', color: '#00ff00' },
      ],
    })
    project.orig!.opts = [
      { value: 'BSN', color: '#b8e0cc' },
      { value: 'TZ', color: '#fabd00' },
    ]
    const sprint = fresh('n1', 'sprint', 'select', { opts: [{ value: 'S1', color: '#ffadad' }, { value: 'S2', color: '#9bf6ff' }] })
    const due = fresh('n2', 'due', 'date')

    const sheet = makeSheet(st)
    // wanted order: project, priority, (notes deleted), sprint, due
    const plan = buildRequests(st, [project, prio, notes, sprint, due], [{ index: 5, hidden: true, origHidden: false }], ['description'], { 3: 12 })
    sheet.apply(plan.requests)

    expect(sheet.cols.map((c) => c.header)).toEqual(['id', 'title', 'project#', 'priority#', 'board', 'drawing', 'status', 'description', 'sprint#', 'due#'])
    expect(sheet.cols.filter((c) => c.hidden).map((c) => c.header)).toEqual(['board'])
    expect(Object.fromEntries(sheet.cols.filter((c) => c.validation).map((c) => [c.header, c.validation]))).toEqual({
      'project#': 'ONE_OF_LIST',
      'sprint#': 'ONE_OF_LIST',
    })
    expect(sheet.cols.filter((c) => c.numberFormat).map((c) => c.header)).toEqual(['due#'])
    expect(sheet.grid()).toBe(sheet.cols.length)
    // project's color rules were rebuilt (3 values), the other column's rule survived, sprint got 2
    const byHeader = (h: string) => sheet.rules.filter((r) => r.header === h).map((r) => r.value).sort()
    expect(byHeader('project#')).toEqual(['BSN', 'NEW', 'TZ'])
    expect(byHeader('sprint#')).toEqual(['S1', 'S2'])
    expect(byHeader('priority#')).toEqual(['High']) // another column's rule survived, and followed its column through the rename

    expect(plan.summary).toEqual([
      'Delete column “notes” (12 values)',
      'Change the order of the columns',
      'Add the “description” column',
      'Add column “sprint” (Dropdown, shown on notes)',
      'Add column “due” (Date, shown on notes)',
      'Rename “prio” to “priority”',
      'Update the dropdown values of “project”',
      'Hide the “board” column in the Sheet',
    ])
  })

  it('appends when the grid has no spare column, inserts before the empty ones otherwise', () => {
    const drafts = [existing(2, 'prio', true, 'text'), existing(3, 'notes', false, 'text'), existing(4, 'project', true, 'text'), fresh('x', 'extra', 'checkbox')]
    expect(buildRequests(structure({ gridColumns: 8 }), drafts, [], []).requests[0]).toHaveProperty('appendDimension')
    const spare = buildRequests(structure({ gridColumns: 26 }), drafts, [], []).requests[0] as any
    expect(spare.insertDimension.range).toMatchObject({ startIndex: 8, endIndex: 9 })
  })

  it('clears validation and color rules when a dropdown becomes text', () => {
    const project = existing(4, 'project', true, 'text')
    project.orig = { ...project.orig!, type: 'select', opts: [{ value: 'BSN', color: '#b8e0cc' }, { value: 'TZ', color: '#fabd00' }] }
    const sheet = makeSheet(structure())
    const plan = buildRequests(structure(), [existing(2, 'prio', true, 'text'), existing(3, 'notes', false, 'text'), project], [], [])
    sheet.apply(plan.requests)
    expect(sheet.rules.filter((r) => r.header === 'project#')).toEqual([])
    expect(sheet.cols[4].validation).toBeUndefined()
    expect(plan.summary).toEqual(['Change “project” to Text'])
  })

  it('does not touch the rules of a dropdown whose values are unchanged', () => {
    const opts = [{ value: 'BSN', color: '#b8e0cc' }]
    const project = existing(4, 'project', true, 'select', { opts })
    project.orig!.opts = opts
    expect(buildRequests(structure(), [existing(2, 'prio', true, 'text'), existing(3, 'notes', false, 'text'), project], [], []).requests).toEqual([])
  })
})

describe('sameOpts', () => {
  it('compares values and colors in order, ignoring color case', () => {
    expect(sameOpts([{ value: 'a', color: '#ABCDEF' }], [{ value: 'a', color: '#abcdef' }])).toBe(true)
    expect(sameOpts([{ value: 'a', color: '#000000' }], [{ value: 'b', color: '#000000' }])).toBe(false)
    expect(sameOpts([{ value: 'a', color: '#000000' }], [])).toBe(false)
  })
})
