import { NOTE_COLORS, NOTE_SIZE, NOTE_STEP } from '../constants'
import { DRAWING_TAB, REQUIRED_COLUMNS, TASKS_TAB } from '../config'
import { decodeNoteDrawing, decodeStroke, encodeNoteDrawing, encodeStroke } from '../board/ink'
import { decodeLink } from '../board/links'
import { decodeZone } from '../board/zones'
import { columnsOf, type Cell, type Column, type FieldMeta } from '../fields'
import type { BoardInfo, ColorRule, Link, Stroke, Task, Zone } from '../types'
import { AuthRequiredError, getToken, invalidateToken } from './auth'

export const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** A problem with the Sheet's structure that we can repair for the user. */
export type SetupFix =
  | { kind: 'empty' }
  | { kind: 'no-tab' }
  | { kind: 'missing-columns'; columns: string[] }
  /** Not a structure problem: the app has no access to this file until the user picks it. */
  | { kind: 'pick' }

export class SheetError extends Error {
  constructor(
    message: string,
    readonly fix?: SetupFix,
  ) {
    super(message)
  }
}

const HEADER = ['id', 'title', 'board']

export interface SheetData {
  title: string
  tasks: Task[]
  /** Custom columns (everything besides id, title, description, board, drawing, status). */
  columns: Column[]
  /** Sheet rows (1-based) that have a title but no id, so the board cannot show them. */
  missingIdRows: number[]
  /** Index of the `id` column. */
  idColumn: number
  /** Non-fatal problems (e.g. rows skipped), shown to the user. */
  warnings: string[]
}

/** Accepts a full Google Sheets URL or a bare spreadsheet ID. */
export function parseSheetId(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null
}

interface ApiOptions {
  method?: 'GET' | 'PUT' | 'POST'
  body?: unknown
}

export async function api(url: string, opts: ApiOptions = {}, retry = true): Promise<unknown> {
  const token = await getToken()
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401) {
    invalidateToken()
    if (retry) return api(url, opts, false)
    throw new AuthRequiredError()
  }
  if (res.ok) return res.json()

  let detail = ''
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    /* non-JSON error body */
  }
  if (opts.method && opts.method !== 'GET' && res.status === 403) {
    throw new SheetError("You don't have edit access to this Sheet. Ask its owner, or fix it by hand.")
  }
  // With the drive.file scope, a Sheet we were not given access to answers 403 or 404.
  if (res.status === 403 || res.status === 404) {
    throw new SheetError(
      'Nassana can only open Sheets you choose. Pick this one to give it access.',
      { kind: 'pick' },
    )
  }
  if (res.status === 400 && /Unable to parse range/i.test(detail)) {
    throw new SheetError(`This Sheet has no tab named "${TASKS_TAB}".`, { kind: 'no-tab' })
  }
  if (res.status === 429) throw new SheetError('Google rate limit reached. Try again in a minute.')
  throw new SheetError(detail || `Google Sheets error (${res.status}).`)
}

export async function fetchSheet(sheetId: string): Promise<SheetData> {
  const id = encodeURIComponent(sheetId)
  const [meta, values] = (await Promise.all([
    api(`${API}/${id}?fields=properties.title`),
    api(`${API}/${id}/values/${encodeURIComponent(TASKS_TAB)}?valueRenderOption=UNFORMATTED_VALUE`),
  ])) as [{ properties?: { title?: string } }, { values?: unknown[][] }]

  const { tasks, warnings, columns, missingIdRows, idColumn } = parseTasks(values.values ?? [])
  return { title: meta.properties?.title ?? 'Untitled sheet', tasks, columns, missingIdRows, idColumn, warnings }
}

const HEX = /^#[0-9a-f]{3,8}$/i

function parseBoard(raw: unknown): Partial<BoardInfo> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<BoardInfo> = {}
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) {
      out.x = o.x as number
      out.y = o.y as number
    }
    if (typeof o.color === 'string' && HEX.test(o.color)) out.color = o.color
    return out
  } catch {
    return {}
  }
}

export function parseTasks(rows: unknown[][]): {
  tasks: Task[]
  warnings: string[]
  columns: Column[]
  missingIdRows: number[]
  idColumn: number
} {
  if (rows.length === 0) throw new SheetError(`The "${TASKS_TAB}" tab is empty. It needs a header row.`, { kind: 'empty' })

  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const missing = REQUIRED_COLUMNS.filter((c) => col(c) < 0)
  if (missing.length) {
    throw new SheetError(`Missing column(s) in the header row: ${missing.join(', ')}.`, {
      kind: 'missing-columns',
      columns: HEADER.filter((c) => col(c) < 0),
    })
  }
  const [iId, iTitle, iBoard, iDrawing, iStatus, iDesc, iParent] = [col('id'), col('title'), col('board'), col('drawing'), col('status'), col('description'), col('parent')]
  const columns = columnsOf(rows[0])

  const warnings: string[] = []
  const seen = new Set<string>()
  const tasks: Task[] = []
  let skippedNoId = 0
  const missingIdRows: number[] = []
  let skippedDup = 0

  rows.slice(1).forEach((row, n) => {
    const id = String(row[iId] ?? '').trim()
    const title = String(row[iTitle] ?? '').trim()
    if (!id && !title) return // blank row
    if (!id) {
      skippedNoId++
      missingIdRows.push(n + 2) // +1 for the header, +1 because sheet rows start at 1
      return
    }
    if (seen.has(id)) return void skippedDup++
    seen.add(id)
    const b = iBoard >= 0 ? parseBoard(row[iBoard]) : {}
    tasks.push({
      id,
      title,
      board: { x: b.x ?? NaN, y: b.y ?? NaN, color: b.color ?? NOTE_COLORS[n % NOTE_COLORS.length] },
      autoPlaced: b.x === undefined,
      drawing: iDrawing >= 0 ? decodeNoteDrawing(id, row[iDrawing]) : [],
      status: iStatus >= 0 ? String(row[iStatus] ?? '').trim() || undefined : undefined,
      description: iDesc >= 0 ? String(row[iDesc] ?? '') || undefined : undefined,
      parent: iParent >= 0 ? String(row[iParent] ?? '').trim() || undefined : undefined,
      values: Object.fromEntries(
        columns.flatMap((c) => (row[c.index] === undefined || row[c.index] === '' ? [] : [[c.key, row[c.index] as Cell]])),
      ),
    })
  })

  if (skippedNoId) warnings.push(`${skippedNoId} row(s) skipped: empty id.`)
  if (skippedDup) warnings.push(`${skippedDup} row(s) skipped: duplicate id.`)
  autoPlace(tasks)
  return { tasks, warnings, columns, missingIdRows, idColumn: iId }
}

/** Puts tasks without a saved position on a grid, below the notes that already have one. */
function autoPlace(tasks: Task[]) {
  const placed = tasks.filter((t) => !t.autoPlaced)
  const startX = placed.length ? Math.min(...placed.map((t) => t.board.x)) : 0
  const startY = placed.length ? Math.max(...placed.map((t) => t.board.y)) + NOTE_SIZE + 60 : 0
  const cols = 5
  tasks
    .filter((t) => t.autoPlaced)
    .forEach((t, i) => {
      t.board.x = startX + (i % cols) * NOTE_STEP
      t.board.y = startY + Math.floor(i / cols) * NOTE_STEP
    })
}

function columnLetter(index: number): string {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  }
  return s
}

/** Repairs the Sheet's structure (needs edit rights on the Sheet). */
export async function applySetupFix(sheetId: string, fix: SetupFix): Promise<void> {
  const id = encodeURIComponent(sheetId)
  const put = (range: string, row: string[]) =>
    api(`${API}/${id}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [row] },
    })

  if (fix.kind === 'no-tab') {
    await api(`${API}/${id}:batchUpdate`, {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: TASKS_TAB } } }] },
    })
    await put(`${TASKS_TAB}!A1:${columnLetter(HEADER.length - 1)}1`, HEADER)
  } else if (fix.kind === 'empty') {
    await put(`${TASKS_TAB}!A1:${columnLetter(HEADER.length - 1)}1`, HEADER)
  } else if (fix.kind === 'missing-columns') {
    // Append the missing columns right after the existing header cells.
    const res = (await api(`${API}/${id}/values/${encodeURIComponent(`${TASKS_TAB}!1:1`)}`)) as {
      values?: unknown[][]
    }
    const start = res.values?.[0]?.length ?? 0
    await put(`${TASKS_TAB}!${columnLetter(start)}1:${columnLetter(start + fix.columns.length - 1)}1`, fix.columns)
  }
}

interface Table {
  rows: unknown[][]
  header: string[]
  iId: number
  iTitle: number
}

/** Reads the whole Tasks tab (a few hundred cells at most) and locates the key columns. */
async function readTable(sheetId: string): Promise<Table> {
  const res = (await api(
    `${API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(TASKS_TAB)}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as { values?: unknown[][] }
  const rows = res.values ?? []
  if (rows.length === 0) throw new SheetError(`The "${TASKS_TAB}" tab is empty.`, { kind: 'empty' })
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase())
  const [iId, iTitle] = [header.indexOf('id'), header.indexOf('title')]
  const missing = [iId < 0 && 'id', iTitle < 0 && 'title'].filter(Boolean) as string[]
  if (missing.length) {
    throw new SheetError(`Missing column(s) in the header row: ${missing.join(', ')}.`, {
      kind: 'missing-columns',
      columns: missing,
    })
  }
  return { rows, header, iId, iTitle }
}

/** Base simplification (board units) when writing a note's drawing; more is applied if it does not fit. */
const DRAWING_EPS = 0.5

const boardJson = (b: BoardInfo) =>
  JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), color: b.color })

/** 1-based sheet row of each task id. */
function rowsById(t: Table): Map<string, number> {
  const m = new Map<string, number>()
  t.rows.forEach((r, i) => {
    if (i > 0) m.set(String(r[t.iId] ?? '').trim(), i + 1)
  })
  return m
}

export interface TaskPatch {
  id: string
  title?: string
  board?: BoardInfo
  drawing?: Stroke[]
  /** An empty string clears the status. */
  status?: string
  description?: string
  /** The parent's id; an empty string clears it. */
  parent?: string
  /** Custom columns to write, by column key (the column must already exist in the header). */
  values?: Record<string, Cell>
}

/**
 * Writes only the cells that changed (title and/or board), locating each row by id
 * (never by position, so sorting or inserting rows in the Sheet cannot misdirect a write).
 * Adds the `board` column to the header if it is missing.
 */
export async function saveTasks(sheetId: string, patches: TaskPatch[]): Promise<void> {
  if (patches.length === 0) return
  const t = await readTable(sheetId)
  const rowOf = rowsById(t)
  const data: { range: string; values: Cell[][] }[] = []

  // Columns we may have to add to the header: `board` and `drawing` (appended after the last one).
  let width = t.header.length
  const added = new Map<string, number>()
  const column = (name: string): number => {
    const i = t.header.indexOf(name)
    if (i >= 0) return i
    if (!added.has(name)) {
      added.set(name, width)
      data.push({ range: `${TASKS_TAB}!${columnLetter(width)}1`, values: [[name]] })
      width++
    }
    return added.get(name)!
  }
  for (const p of patches) {
    const row = rowOf.get(p.id)
    if (!row) continue // the row was deleted in the meantime
    if (p.title !== undefined) {
      data.push({ range: `${TASKS_TAB}!${columnLetter(t.iTitle)}${row}`, values: [[p.title]] })
    }
    if (p.board) data.push({ range: `${TASKS_TAB}!${columnLetter(column('board'))}${row}`, values: [[boardJson(p.board)]] })
    if (p.status !== undefined) {
      data.push({ range: `${TASKS_TAB}!${columnLetter(column('status'))}${row}`, values: [[p.status]] })
    }
    if (p.description !== undefined) {
      data.push({ range: `${TASKS_TAB}!${columnLetter(column('description'))}${row}`, values: [[p.description]] })
    }
    if (p.parent !== undefined) {
      data.push({ range: `${TASKS_TAB}!${columnLetter(column('parent'))}${row}`, values: [[p.parent]] })
    }
    for (const [key, v] of Object.entries(p.values ?? {})) {
      const i = t.header.indexOf(key)
      if (i >= 0) data.push({ range: `${TASKS_TAB}!${columnLetter(i)}${row}`, values: [[v]] })
    }
    if (p.drawing) {
      data.push({
        range: `${TASKS_TAB}!${columnLetter(column('drawing'))}${row}`,
        values: [[encodeNoteDrawing(p.drawing, DRAWING_EPS)]],
      })
    }
  }
  if (data.length === 0) return

  await api(`${API}/${encodeURIComponent(sheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'RAW', data },
  })
}

/** Appends a task as a new row at the bottom of the Tasks tab, with all its columns. */
export async function appendTask(sheetId: string, task: Task): Promise<void> {
  const id = encodeURIComponent(sheetId)
  const t = await readTable(sheetId)
  const header = [...t.header]
  // Columns this task needs but the Sheet does not have yet are added to the header.
  const need = (name: string) => {
    let i = header.indexOf(name)
    if (i < 0) {
      i = header.length
      header.push(name)
    }
    return i
  }
  const cells = new Map<number, Cell>([
    [t.iId, task.id],
    [t.iTitle, task.title],
    [need('board'), boardJson(task.board)],
  ])
  if (task.description) cells.set(need('description'), task.description)
  if (task.status) cells.set(need('status'), task.status)
  if (task.parent) cells.set(need('parent'), task.parent)
  if (task.drawing?.length) cells.set(need('drawing'), encodeNoteDrawing(task.drawing, DRAWING_EPS))
  for (const [key, v] of Object.entries(task.values ?? {})) {
    const i = header.indexOf(key)
    if (i >= 0) cells.set(i, v)
  }

  if (header.length > t.header.length) {
    const added = header.slice(t.header.length)
    await api(
      `${API}/${id}/values/${encodeURIComponent(`${TASKS_TAB}!${columnLetter(t.header.length)}1:${columnLetter(header.length - 1)}1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: { values: [added] } },
    )
  }
  const row: Cell[] = header.map((_, i) => cells.get(i) ?? '')
  // Written at an explicit row below the last used one (never by table detection: it could land on the header).
  let last = t.rows.length
  while (last > 1 && t.rows[last - 1].every((c) => c === undefined || c === null || String(c).trim() === '')) last--
  await api(
    `${API}/${id}/values/${encodeURIComponent(`${TASKS_TAB}!A${last + 1}`)}?valueInputOption=RAW`,
    { method: 'PUT', body: { values: [row] } },
  )
}

/** Deletes the task's row from the Sheet. A task that is already gone counts as deleted. */
export async function deleteTask(sheetId: string, taskId: string): Promise<void> {
  const id = encodeURIComponent(sheetId)
  const [t, meta] = await Promise.all([
    readTable(sheetId),
    api(`${API}/${id}?fields=sheets.properties(sheetId,title)`) as Promise<{
      sheets?: { properties: { sheetId: number; title: string } }[]
    }>,
  ])
  const row = rowsById(t).get(taskId)
  const gid = meta.sheets?.find((s) => s.properties.title === TASKS_TAB)?.properties.sheetId
  if (!row || gid === undefined) return
  await api(`${API}/${id}:batchUpdate`, {
    method: 'POST',
    body: {
      requests: [
        { deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } },
      ],
    },
  })
}

// ---------------------------------------------------------------------------------
// The `_board` tab: strokes and zones, one row each: id | type | data
// ---------------------------------------------------------------------------------

const BOARD_HEADER = ['id', 'type', 'data']

const isMissingTab = (e: unknown) => e instanceof SheetError && e.fix?.kind === 'no-tab'

export interface BoardData {
  strokes: Stroke[]
  zones: Zone[]
  links: Link[]
  colors: ColorRule[]
  /** Parents whose stack is spread open. */
  open: string[]
}

/** Reads strokes and zones. A Sheet without the `_board` tab simply has neither. */
export async function fetchBoardData(sheetId: string): Promise<BoardData> {
  try {
    const res = (await api(
      `${API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(DRAWING_TAB)}?valueRenderOption=UNFORMATTED_VALUE`,
    )) as { values?: unknown[][] }
    const out: BoardData = { strokes: [], zones: [], links: [], colors: [], open: [] }
    for (const r of (res.values ?? []).slice(1)) {
      const id = String(r[0] ?? '')
      const type = String(r[1] ?? '')
      if (type === 'stroke') {
        const s = decodeStroke(id, r[2])
        if (s) out.strokes.push(s)
      } else if (type === 'zone') {
        const z = decodeZone(id, r[2])
        if (z) out.zones.push(z)
      } else if (type === 'color') {
        const c = decodeColor(r[2])
        if (c) out.colors.push(c)
      } else if (type === 'link') {
        const l = decodeLink(id, r[2])
        if (l) out.links.push(l)
      } else if (type === 'open') {
        const parent = id.replace(/^open:/, '')
        if (parent) out.open.push(parent)
      }
    }
    return out
  } catch (e) {
    if (isMissingTab(e)) return { strokes: [], zones: [], links: [], colors: [], open: [] }
    throw e
  }
}

async function createBoardTab(sheetId: string): Promise<void> {
  const id = encodeURIComponent(sheetId)
  const meta = (await api(`${API}/${id}?fields=sheets.properties.title`)) as {
    sheets?: { properties: { title: string } }[]
  }
  if (!meta.sheets?.some((s) => s.properties.title === DRAWING_TAB)) {
    await api(`${API}/${id}:batchUpdate`, {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: DRAWING_TAB } } }] },
    })
  }
  await api(`${API}/${id}/values/${encodeURIComponent(`${DRAWING_TAB}!A1:C1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: { values: [BOARD_HEADER] },
  })
}

/** Appends a row, creating the `_board` tab first if this is the Sheet's first one. */
export async function appendBoardRow(sheetId: string, rowId: string, type: 'stroke' | 'zone' | 'link' | 'color' | 'open', data: string): Promise<void> {
  const url = `${API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${DRAWING_TAB}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  const body = { values: [[rowId, type, data]] }
  try {
    await api(url, { method: 'POST', body })
  } catch (e) {
    if (!isMissingTab(e)) throw e
    await createBoardTab(sheetId)
    await api(url, { method: 'POST', body })
  }
}

export const appendStroke = (sheetId: string, stroke: Stroke, eps: number) =>
  appendBoardRow(sheetId, stroke.id, 'stroke', encodeStroke(stroke, eps))

/** Rewrites the data cell of existing rows (found by id). Rows that are gone are ignored. */
export async function updateBoardRows(sheetId: string, items: { id: string; data: string }[]): Promise<void> {
  if (items.length === 0) return
  const id = encodeURIComponent(sheetId)
  let res: { values?: unknown[][] }
  try {
    res = (await api(`${API}/${id}/values/${encodeURIComponent(DRAWING_TAB)}?valueRenderOption=UNFORMATTED_VALUE`)) as typeof res
  } catch (e) {
    if (isMissingTab(e)) return
    throw e
  }
  const rowOf = new Map<string, number>()
  ;(res.values ?? []).forEach((r, i) => {
    if (i > 0) rowOf.set(String(r[0] ?? ''), i + 1)
  })
  const data = items.flatMap((it) => {
    const row = rowOf.get(it.id)
    return row ? [{ range: `${DRAWING_TAB}!C${row}`, values: [[it.data]] }] : []
  })
  if (data.length === 0) return
  await api(`${API}/${id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } })
}

/** Deletes the rows with the given ids (strokes or zones). Rows already gone are ignored. */
export async function deleteBoardRows(sheetId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const id = encodeURIComponent(sheetId)
  let res: { values?: unknown[][] }
  try {
    res = (await api(`${API}/${id}/values/${encodeURIComponent(DRAWING_TAB)}?valueRenderOption=UNFORMATTED_VALUE`)) as typeof res
  } catch (e) {
    if (isMissingTab(e)) return
    throw e
  }
  const wanted = new Set(ids)
  const rows: number[] = [] // 0-based row indexes
  ;(res.values ?? []).forEach((r, i) => {
    if (i > 0 && wanted.has(String(r[0] ?? ''))) rows.push(i)
  })
  if (rows.length === 0) return
  const meta = (await api(`${API}/${id}?fields=sheets.properties(sheetId,title)`)) as {
    sheets?: { properties: { sheetId: number; title: string } }[]
  }
  const gid = meta.sheets?.find((s) => s.properties.title === DRAWING_TAB)?.properties.sheetId
  if (gid === undefined) return
  // Bottom-up, so deleting one row does not shift the indexes of the ones still to delete.
  const requests = rows
    .sort((a, b) => b - a)
    .map((i) => ({ deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } }))
  await api(`${API}/${id}:batchUpdate`, { method: 'POST', body: { requests } })
}

// ---------------------------------------------------------------------------------
// What the Sheet knows about its columns: dropdown lists, checkboxes, date formats
// ---------------------------------------------------------------------------------

interface Rgb {
  red?: number
  green?: number
  blue?: number
}

interface GridCell {
  effectiveValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean }
  effectiveFormat?: { backgroundColor?: Rgb }
  dataValidation?: { condition?: { type?: string; values?: { userEnteredValue?: string }[] } }
  userEnteredFormat?: { numberFormat?: { type?: string }; backgroundColor?: Rgb }
}

/** `#rrggbb` for a cell fill, or null when the cell has none (or white, the default). */
function fillOf(cell: GridCell | undefined): string | null {
  // effectiveFormat includes conditional formatting; userEnteredFormat is the plain fill.
  const c = cell?.effectiveFormat?.backgroundColor ?? cell?.userEnteredFormat?.backgroundColor
  if (!c) return null
  const to255 = (v?: number) => Math.round((v ?? 0) * 255)
  const [r, g, b] = [to255(c.red), to255(c.green), to255(c.blue)]
  if (r > 250 && g > 250 && b > 250) return null
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

function valueKey(cell: GridCell | undefined): string {
  const v = cell?.effectiveValue
  const raw = v?.stringValue ?? (v?.numberValue !== undefined ? String(v.numberValue) : v?.boolValue !== undefined ? String(v.boolValue) : '')
  return raw.trim().toLowerCase()
}

/** `='Lists'!A1:A9` or `=A1:A9` (this tab) -> a range usable in the values API. */
function rangeOfFormula(formula: string): string | null {
  const m = formula.trim().match(/^=\s*(?:'([^']+)'|([^'!]+))?!?(.+)$/)
  if (!m) return null
  const hasTab = formula.includes('!')
  const tab = m[1] ?? (hasTab ? m[2] : TASKS_TAB)
  const cells = hasTab ? m[3] : (m[2] ?? '') + m[3]
  return `'${tab}'!${cells}`
}

/**
 * Reads data validation (dropdown lists, checkboxes) and number formats (dates) from the first
 * rows of each column. Best effort: any failure just means fields are typed from their values.
 */
export async function fetchFieldMeta(sheetId: string, columns: Column[], rowCount: number): Promise<Record<string, FieldMeta>> {
  if (columns.length === 0 || rowCount === 0) return {}
  try {
    const id = encodeURIComponent(sheetId)
    const last = columnLetter(Math.max(...columns.map((c) => c.index)))
    const range = encodeURIComponent(`${TASKS_TAB}!A2:${last}${Math.min(rowCount + 1, 101)}`)
    const res = (await api(
      `${API}/${id}?ranges=${range}&includeGridData=true&fields=sheets.data.rowData.values(dataValidation,effectiveValue,effectiveFormat.backgroundColor,userEnteredFormat(numberFormat.type,backgroundColor))`,
    )) as { sheets?: { data?: { rowData?: { values?: GridCell[] }[] }[] }[] }
    const rows = res.sheets?.[0]?.data?.[0]?.rowData ?? []

    const meta: Record<string, FieldMeta> = {}
    for (const c of columns) {
      const m: FieldMeta = {}
      for (const row of rows) {
        const cell = row.values?.[c.index]
        const rule = cell?.dataValidation?.condition
        const fmt = cell?.userEnteredFormat?.numberFormat?.type
        // The fill the Sheet gives a value is the color we use for it when coloring notes by this column.
        const fill = fillOf(cell)
        const key = valueKey(cell)
        if (fill && key) (m.colors ??= {})[key] ??= fill
        if (fmt === 'DATE' || fmt === 'DATE_TIME') m.dateFormat = true
        if (!rule?.type) continue
        const vals = (rule.values ?? []).map((v) => v.userEnteredValue ?? '')
        if (rule.type === 'ONE_OF_LIST') m.options ??= vals.filter(Boolean)
        else if (rule.type === 'ONE_OF_RANGE') {
          const ref = vals[0] ? rangeOfFormula(vals[0]) : null
          if (ref && !m.options) {
            const list = (await api(`${API}/${id}/values/${encodeURIComponent(ref)}`).catch(() => null)) as { values?: unknown[][] } | null
            m.options = (list?.values ?? []).flat().map((v) => String(v)).filter(Boolean)
          }
        } else if (rule.type === 'BOOLEAN') m.checkbox = true
        else if (rule.type.startsWith('DATE_')) m.dateValidation = true
      }
      // A fill shared by several values is a row or banding color, not that value's color: ignore it.
      if (m.colors) {
        const users = new Map<string, string[]>()
        for (const [value, hex] of Object.entries(m.colors)) users.set(hex, [...(users.get(hex) ?? []), value])
        for (const values of users.values()) if (values.length > 1) for (const v of values) delete m.colors[v]
        if (Object.keys(m.colors).length === 0) delete m.colors
      }
      if (m.options || m.checkbox || m.dateFormat || m.dateValidation || m.colors) meta[c.key] = m
    }
    return meta
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e
    return {}
  }
}

// ---------------------------------------------------------------------------------
// Colors picked in the app for values of a column (the API cannot read dropdown-chip colors)
// ---------------------------------------------------------------------------------

export const colorRowId = (c: Pick<ColorRule, 'key' | 'raw'>) => `color:${c.key}|${c.raw}`
export const encodeColor = (c: ColorRule) => JSON.stringify({ key: c.key, value: c.raw, color: c.color })

function decodeColor(raw: unknown): ColorRule | null {
  if (typeof raw !== 'string') return null
  try {
    const o = JSON.parse(raw) as { key?: unknown; value?: unknown; color?: unknown }
    if (typeof o.key !== 'string' || typeof o.value !== 'string' || typeof o.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(o.color)) return null
    return { key: o.key, raw: o.value, color: o.color }
  } catch {
    return null
  }
}

/** Gives each of the Sheet rows (1-based) a fresh id, so the board can show them. Only empty id cells are written. */
export async function assignIds(sheetId: string, rows: number[], idColumn: number): Promise<void> {
  if (rows.length === 0) return
  const data = rows.map((row) => ({
    range: `${TASKS_TAB}!${columnLetter(idColumn)}${row}`,
    values: [[crypto.randomUUID().slice(0, 8)]],
  }))
  await api(`${API}/${encodeURIComponent(sheetId)}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } })
}
