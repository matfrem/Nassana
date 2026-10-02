import { NOTE_COLORS, NOTE_SIZE, NOTE_STEP } from '../constants'
import { REQUIRED_COLUMNS, TASKS_TAB } from '../config'
import type { BoardInfo, Task } from '../types'
import { AuthRequiredError, getToken, invalidateToken } from './auth'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

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

async function api(url: string, opts: ApiOptions = {}, retry = true): Promise<unknown> {
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

  const { tasks, warnings } = parseTasks(values.values ?? [])
  return { title: meta.properties?.title ?? 'Untitled sheet', tasks, warnings }
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

export function parseTasks(rows: unknown[][]): { tasks: Task[]; warnings: string[] } {
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
  const [iId, iTitle, iBoard] = [col('id'), col('title'), col('board')]

  const warnings: string[] = []
  const seen = new Set<string>()
  const tasks: Task[] = []
  let skippedNoId = 0
  let skippedDup = 0

  rows.slice(1).forEach((row, n) => {
    const id = String(row[iId] ?? '').trim()
    const title = String(row[iTitle] ?? '').trim()
    if (!id && !title) return // blank row
    if (!id) return void skippedNoId++
    if (seen.has(id)) return void skippedDup++
    seen.add(id)
    const b = iBoard >= 0 ? parseBoard(row[iBoard]) : {}
    tasks.push({
      id,
      title,
      board: { x: b.x ?? NaN, y: b.y ?? NaN, color: b.color ?? NOTE_COLORS[n % NOTE_COLORS.length] },
      autoPlaced: b.x === undefined,
    })
  })

  if (skippedNoId) warnings.push(`${skippedNoId} row(s) skipped: empty id.`)
  if (skippedDup) warnings.push(`${skippedDup} row(s) skipped: duplicate id.`)
  autoPlace(tasks)
  return { tasks, warnings }
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

/**
 * Writes the `board` cell of the given tasks, locating each row by id (never by
 * position, so sorting or inserting rows in the Sheet cannot misdirect a write).
 * Adds the `board` column if the header does not have it yet.
 */
export async function saveBoards(sheetId: string, items: { id: string; board: BoardInfo }[]): Promise<void> {
  if (items.length === 0) return
  const id = encodeURIComponent(sheetId)
  const res = (await api(
    `${API}/${id}/values/${encodeURIComponent(TASKS_TAB)}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as { values?: unknown[][] }
  const rows = res.values ?? []
  if (rows.length === 0) throw new SheetError(`The "${TASKS_TAB}" tab is empty.`, { kind: 'empty' })

  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase())
  const iId = header.indexOf('id')
  if (iId < 0) throw new SheetError('Missing column(s) in the header row: id.', { kind: 'missing-columns', columns: ['id'] })

  let iBoard = header.indexOf('board')
  const data: { range: string; values: string[][] }[] = []
  if (iBoard < 0) {
    iBoard = header.length
    data.push({ range: `${TASKS_TAB}!${columnLetter(iBoard)}1`, values: [['board']] })
  }

  const rowOf = new Map<string, number>()
  rows.forEach((r, i) => {
    if (i > 0) rowOf.set(String(r[iId] ?? '').trim(), i + 1) // 1-based sheet row
  })
  for (const { id: taskId, board } of items) {
    const row = rowOf.get(taskId)
    if (!row) continue // the row was deleted in the meantime
    const value = JSON.stringify({ x: Math.round(board.x), y: Math.round(board.y), color: board.color })
    data.push({ range: `${TASKS_TAB}!${columnLetter(iBoard)}${row}`, values: [[value]] })
  }
  if (data.length === 0) return

  await api(`${API}/${id}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'RAW', data },
  })
}
