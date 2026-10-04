import { TASKS_TAB } from '../config'
import { api, API, SheetError } from './sheets'

/** Column types the page can set. They map onto what Google Sheets itself supports. */
export type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'select'

/** One value of a dropdown column, with the background color it gets. */
export interface Opt {
  value: string
  color: string
}

export interface SheetColumn {
  index: number
  /** Header text exactly as written (including a trailing `#`). */
  header: string
  hidden: boolean
}

/** A conditional-format rule that colors one value of one column. */
export interface CfRule {
  /** Position in the sheet's list of rules (what `deleteConditionalFormatRule` needs). */
  index: number
  column: number | null
  value: string | null
  color: string | null
}

export interface Structure {
  gid: number
  /** Number of columns in the grid (header columns plus empty ones to the right). */
  gridColumns: number
  /** Columns up to the last non-empty header cell. */
  columns: SheetColumn[]
  rules: CfRule[]
}

/** What the page edits for a custom column. */
export interface Draft {
  uid: string
  /** Index in the Sheet if the column exists already. */
  index?: number
  name: string
  shown: boolean
  type: ColType
  opts: Opt[]
  hidden: boolean
  deleted: boolean
  /** The column as it was when the page opened (existing columns only). */
  orig?: { name: string; shown: boolean; type: ColType; opts: Opt[]; hidden: boolean }
}

/** A column the app manages (id, title, description, status, board, drawing): it can only be hidden. */
export interface SystemEdit {
  index: number
  hidden: boolean
  origHidden: boolean
}

/** A managed column the Sheet lacks and the user asked to add. */
export type SystemAdd = 'description' | 'status'

interface GridRange {
  sheetId?: number
  startRowIndex?: number
  startColumnIndex?: number
  endColumnIndex?: number
}

interface RgbJson {
  red?: number
  green?: number
  blue?: number
}

const toHex = (c: RgbJson | undefined): string | null => {
  if (!c) return null
  const n = (v?: number) => Math.round((v ?? 0) * 255)
  return '#' + [n(c.red), n(c.green), n(c.blue)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const toRgb = (hex: string): RgbJson => {
  const n = parseInt(hex.slice(1), 16)
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 }
}

/** Reads the Tasks tab's header, hidden columns and color rules. */
export async function fetchStructure(sheetId: string): Promise<Structure> {
  const res = (await api(
    `${API}/${encodeURIComponent(sheetId)}?ranges=${encodeURIComponent(`${TASKS_TAB}!1:1`)}&includeGridData=true` +
      '&fields=sheets(properties(sheetId,title,gridProperties.columnCount),conditionalFormats,data(columnMetadata(hiddenByUser),rowData(values(formattedValue))))',
  )) as {
    sheets?: {
      properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } }
      conditionalFormats?: {
        ranges?: GridRange[]
        booleanRule?: { condition?: { type?: string; values?: { userEnteredValue?: string }[] }; format?: { backgroundColor?: RgbJson } }
      }[]
      data?: { columnMetadata?: { hiddenByUser?: boolean }[]; rowData?: { values?: { formattedValue?: string }[] }[] }[]
    }[]
  }
  const sheet = res.sheets?.find((s) => s.properties.title === TASKS_TAB)
  if (!sheet) throw new SheetError(`This Sheet has no tab named "${TASKS_TAB}".`)

  const headers = (sheet.data?.[0]?.rowData?.[0]?.values ?? []).map((v) => v.formattedValue ?? '')
  const meta = sheet.data?.[0]?.columnMetadata ?? []
  let last = -1
  headers.forEach((h, i) => {
    if (h.trim()) last = i
  })
  const columns: SheetColumn[] = []
  for (let i = 0; i <= last; i++) columns.push({ index: i, header: (headers[i] ?? '').trim(), hidden: !!meta[i]?.hiddenByUser })

  const rules: CfRule[] = (sheet.conditionalFormats ?? []).map((r, index) => {
    const range = r.ranges?.length === 1 ? r.ranges[0] : undefined
    const single = range && range.startColumnIndex !== undefined && range.endColumnIndex === range.startColumnIndex + 1
    const cond = r.booleanRule?.condition
    return {
      index,
      column: single ? range.startColumnIndex! : null,
      value: cond?.type === 'TEXT_EQ' ? (cond.values?.[0]?.userEnteredValue ?? null) : null,
      color: toHex(r.booleanRule?.format?.backgroundColor),
    }
  })
  return { gid: sheet.properties.sheetId, gridColumns: sheet.properties.gridProperties?.columnCount ?? columns.length, columns, rules }
}

/** Two structures with the same signature can be edited with the same plan. */
export const signature = (s: Structure) => JSON.stringify([s.gid, s.columns, s.rules])

export const sameOpts = (a: Opt[], b: Opt[]) => a.length === b.length && a.every((o, i) => o.value === b[i].value && o.color.toLowerCase() === b[i].color.toLowerCase())

/**
 * The header text of a column. Whether a column is shown on notes is a board setting: the Sheet never gets a `#` from the app.
 * A column that already had one keeps it (we don't touch what is there); a new column never gets one.
 */
export const fullHeader = (d: Pick<Draft, 'name'>, was = '') => d.name.trim() + (was.endsWith('#') ? '#' : '')

export const TYPE_LABEL: Record<ColType, string> = { text: 'Text', number: 'Number', date: 'Date', checkbox: 'Checkbox', select: 'Dropdown' }

interface Plan {
  requests: object[]
  /** Human-readable list of what will happen, shown before applying. */
  summary: string[]
}

/**
 * Turns the edits into one batch of Sheets requests. Order matters because indexes shift:
 * drop color rules, delete columns, reorder, append new ones, write headers, then format/hide
 * using the final positions.
 */
export function buildRequests(
  st: Structure,
  drafts: Draft[],
  systemEdits: SystemEdit[],
  systemAdds: SystemAdd[],
  valueCounts: Record<number, number> = {},
): Plan {
  const requests: object[] = []
  const summary: string[] = []
  const dim = (start: number, end = start + 1) => ({ sheetId: st.gid, dimension: 'COLUMNS', startIndex: start, endIndex: end })
  const cells = (col: number) => ({ sheetId: st.gid, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 })

  const kept = drafts.filter((d) => d.index !== undefined && !d.deleted)
  const fresh = drafts.filter((d) => d.index === undefined && !d.deleted)
  const removed = drafts.filter((d) => d.index !== undefined && d.deleted)

  // A column whose type or dropdown values changed gets its color rules rebuilt.
  const typeChanged = (d: Draft) => !!d.orig && d.type !== d.orig.type
  const optsChanged = (d: Draft) => !d.orig || !sameOpts(d.opts, d.orig.opts)
  const rerule = kept.filter((d) => typeChanged(d) || (d.type === 'select' && optsChanged(d)))
  const dropRules = st.rules.filter((r) => r.column !== null && r.value !== null && rerule.some((d) => d.index === r.column))
  for (const r of [...dropRules].sort((a, b) => b.index - a.index)) {
    requests.push({ deleteConditionalFormatRule: { sheetId: st.gid, index: r.index } })
  }

  // Working copy of the columns, to track positions as requests are applied.
  let work = st.columns.map((c) => ({ key: 'c' + c.index }))
  let gridCols = st.gridColumns

  for (const d of [...removed].sort((a, b) => b.index! - a.index!)) {
    const pos = work.findIndex((w) => w.key === 'c' + d.index)
    requests.push({ deleteDimension: { range: dim(pos) } })
    work.splice(pos, 1)
    gridCols--
    const n = valueCounts[d.index!] ?? 0
    summary.push(`Delete column “${d.orig?.name ?? d.name}”${n ? ` (${n} value${n === 1 ? '' : 's'})` : ''}`)
  }

  // Custom columns may be reordered among the positions custom columns already occupy.
  const wanted = kept.map((d) => 'c' + d.index)
  const target = work.map((w) => w.key)
  let n = 0
  work.forEach((w, i) => {
    if (wanted.includes(w.key)) target[i] = wanted[n++]
  })
  let reordered = false
  for (let i = 0; i < target.length; i++) {
    const j = work.findIndex((w) => w.key === target[i])
    if (j === i) continue
    requests.push({ moveDimension: { source: dim(j), destinationIndex: i } })
    const [w] = work.splice(j, 1)
    work.splice(i, 0, w)
    reordered = true
  }
  if (reordered) summary.push('Change the order of the columns')

  // New columns go after the last header cell.
  const adds = [
    ...systemAdds.map((name) => ({ key: 'n:' + name, header: name, draft: undefined as Draft | undefined })),
    ...fresh.map((d) => ({ key: 'n:' + d.uid, header: fullHeader(d), draft: d })),
  ]
  if (adds.length) {
    const start = work.length
    requests.push(
      start >= gridCols
        ? { appendDimension: { sheetId: st.gid, dimension: 'COLUMNS', length: adds.length } }
        : { insertDimension: { range: dim(start, start + adds.length), inheritFromBefore: false } },
    )
    work = [...work, ...adds.map((a) => ({ key: a.key }))]
    for (const a of adds) summary.push(a.draft ? `Add column “${a.draft.name.trim()}” (${TYPE_LABEL[a.draft.type]})` : `Add the “${a.header}” column`)
  }
  const at = (key: string) => work.findIndex((w) => w.key === key)

  // Header text.
  const writeHeader = (key: string, text: string) =>
    requests.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { stringValue: text } }] }],
        fields: 'userEnteredValue',
        start: { sheetId: st.gid, rowIndex: 0, columnIndex: at(key) },
      },
    })
  for (const a of adds) writeHeader(a.key, a.header)
  for (const d of kept) {
    const was = st.columns.find((c) => c.index === d.index)!.header
    const now = fullHeader(d, was)
    if (was !== now) {
      writeHeader('c' + d.index, now)
      const a = was.replace(/#$/, '')
      const b = now.replace(/#$/, '')
      if (a !== b) summary.push(`Rename “${a}” to “${b}”`)
    }
  }

  // Types, dropdown lists and their colors.
  const format = (d: Draft, key: string) => {
    const col = at(key)
    const was = d.orig?.type
    if (d.type === 'checkbox') {
      requests.push({ setDataValidation: { range: cells(col), rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true } } })
    } else if (d.type === 'select') {
      requests.push({
        setDataValidation: {
          range: cells(col),
          // Not strict: values already in the column that are not in the list stay valid.
          rule: { condition: { type: 'ONE_OF_LIST', values: d.opts.map((o) => ({ userEnteredValue: o.value })) }, showCustomUi: true, strict: false },
        },
      })
      for (const o of d.opts) {
        requests.push({
          addConditionalFormatRule: {
            rule: { ranges: [cells(col)], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: o.value }] }, format: { backgroundColor: toRgb(o.color) } } },
            index: 0,
          },
        })
      }
    } else {
      if (was === 'checkbox' || was === 'select') requests.push({ setDataValidation: { range: cells(col) } }) // no rule = clear it
      if (d.type === 'date') requests.push({ repeatCell: { range: cells(col), cell: { userEnteredFormat: { numberFormat: { type: 'DATE' } } }, fields: 'userEnteredFormat.numberFormat' } })
    }
  }
  for (const d of fresh) if (d.type !== 'text') format(d, 'n:' + d.uid)
  for (const d of kept) {
    if (typeChanged(d)) {
      format(d, 'c' + d.index)
      summary.push(`Change “${d.name.trim()}” to ${TYPE_LABEL[d.type]}`)
    } else if (d.type === 'select' && optsChanged(d)) {
      format(d, 'c' + d.index)
      summary.push(`Update the dropdown values of “${d.name.trim()}”`)
    }
  }

  // Hidden columns.
  const setHidden = (key: string, hidden: boolean, label: string) => {
    requests.push({ updateDimensionProperties: { range: dim(at(key)), properties: { hiddenByUser: hidden }, fields: 'hiddenByUser' } })
    summary.push(`${hidden ? 'Hide' : 'Show'} the “${label}” column in the Sheet`)
  }
  for (const s of systemEdits) {
    if (s.hidden !== s.origHidden) setHidden('c' + s.index, s.hidden, st.columns.find((c) => c.index === s.index)?.header ?? '')
  }
  for (const d of kept) if (d.hidden !== d.orig?.hidden) setHidden('c' + d.index, d.hidden, d.name.trim())
  for (const d of fresh) if (d.hidden) setHidden('n:' + d.uid, true, d.name.trim())

  return { requests, summary }
}

/** Re-reads the Sheet, checks nobody changed its structure meanwhile, and applies the edits in one batch. */
export async function applyColumns(
  sheetId: string,
  opened: Structure,
  drafts: Draft[],
  systemEdits: SystemEdit[],
  systemAdds: SystemAdd[],
): Promise<void> {
  const current = await fetchStructure(sheetId)
  if (signature(current) !== signature(opened)) {
    throw new SheetError('The Sheet’s columns changed since you opened this page. Close it and open it again.')
  }
  const { requests } = buildRequests(current, drafts, systemEdits, systemAdds)
  if (requests.length === 0) return
  await api(`${API}/${encodeURIComponent(sheetId)}:batchUpdate`, { method: 'POST', body: { requests } })
}
