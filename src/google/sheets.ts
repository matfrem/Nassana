import { NOTE_COLORS, NOTE_SIZE, NOTE_STEP } from '../constants'
import { REQUIRED_COLUMNS, TASKS_TAB } from '../config'
import type { BoardInfo, Task } from '../types'
import { AuthRequiredError, getToken, invalidateToken } from './auth'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export class SheetError extends Error {}

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

async function api(url: string, retry = true): Promise<unknown> {
  const token = await getToken()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) {
    invalidateToken()
    if (retry) return api(url, false)
    throw new AuthRequiredError()
  }
  if (res.ok) return res.json()

  let detail = ''
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 403) {
    throw new SheetError("You don't have access to this Sheet. Ask its owner to share it with you.")
  }
  if (res.status === 404) throw new SheetError('Sheet not found. Check the link.')
  if (res.status === 400 && /Unable to parse range/i.test(detail)) {
    throw new SheetError(`This Sheet has no tab named "${TASKS_TAB}".`)
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
  if (rows.length === 0) throw new SheetError(`The "${TASKS_TAB}" tab is empty. Add a header row first.`)

  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const missing = REQUIRED_COLUMNS.filter((c) => col(c) < 0)
  if (missing.length) {
    throw new SheetError(`Missing column(s) in the header row: ${missing.join(', ')}.`)
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
