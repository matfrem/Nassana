import type { Task } from './types'

/** A cell value as the Sheets API returns it with UNFORMATTED_VALUE. */
export type Cell = string | number | boolean

export type FieldType = 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'link'
export type Tone = 'red' | 'orange' | 'green'

/** Columns with a meaning of their own. Every other column is a custom field. */
export const RESERVED = ['id', 'title', 'description', 'board', 'drawing', 'status']

/** A custom column of the Tasks tab. */
export interface Column {
  /** Header, lowercased and trimmed: the identity of the column (e.g. "duedate#"). */
  key: string
  /** Header without the trailing `#`, as the user typed it (e.g. "dueDate"). */
  label: string
  /** 0-based index in the header row. */
  index: number
  /** Header ends with `#`: shown on the note itself. */
  shown: boolean
}

/** What the Sheet itself says about a column (data validation and number format). */
export interface FieldMeta {
  /** A dropdown: the allowed values. */
  options?: string[]
  checkbox?: boolean
  /** The cells are formatted as dates: values are serial numbers. */
  dateFormat?: boolean
  /** The column only accepts dates (validation), whether or not cells are formatted. */
  dateValidation?: boolean
}

export interface Field extends Column {
  type: FieldType
  options?: string[]
  /** Dates are stored as serial numbers (true) or as ISO text (false). */
  serial?: boolean
}

export function columnsOf(rawHeader: unknown[]): Column[] {
  const cols: Column[] = []
  rawHeader.forEach((h, index) => {
    const text = String(h ?? '').trim()
    const key = text.toLowerCase()
    if (!text || RESERVED.includes(key)) return
    const shown = text.endsWith('#')
    cols.push({ key, label: (shown ? text.slice(0, -1) : text).trim() || text, index, shown })
  })
  return cols
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const DMY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/
const URL_RE = /^https?:\/\/\S+$/i

const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
const SERIAL_TO_UNIX_DAYS = 25_569 // days between 1899-12-30 (Sheets day 0) and 1970-01-01

/** Days since 1970-01-01 for a date cell (serial number, ISO text or d/m/y text), or null. */
export function dayOf(v: Cell | undefined): number | null {
  if (typeof v === 'number') return Math.floor(v) - SERIAL_TO_UNIX_DAYS
  if (typeof v !== 'string') return null
  let m = v.match(ISO)
  if (m) return dayNumber(+m[1], +m[2], +m[3])
  m = v.match(DMY)
  return m ? dayNumber(+m[3], +m[2], +m[1]) : null
}

export const todayNumber = () => {
  const n = new Date()
  return dayNumber(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

/** `YYYY-MM-DD` for an <input type="date">. */
export function isoOf(v: Cell | undefined): string {
  const d = dayOf(v)
  return d === null ? '' : new Date(d * 86_400_000).toISOString().slice(0, 10)
}

function formatDay(day: number): string {
  const date = new Date(day * 86_400_000)
  const sameYear = date.getUTCFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  })
}

const isEmpty = (v: Cell | undefined) => v === undefined || v === ''

/** Works out each column's type: the Sheet's own metadata first, then what the values look like. */
export function buildFields(columns: Column[], tasks: Task[], meta: Record<string, FieldMeta>): Field[] {
  return columns.map((c) => {
    const m = meta[c.key] ?? {}
    const values = tasks.map((t) => t.values?.[c.key]).filter((v) => !isEmpty(v)) as Cell[]
    const all = (test: (v: Cell) => boolean) => values.length > 0 && values.every(test)

    if (m.options?.length) return { ...c, type: 'select', options: m.options }
    if (m.checkbox || all((v) => typeof v === 'boolean')) return { ...c, type: 'checkbox' }
    if (m.dateFormat || m.dateValidation) return { ...c, type: 'date', serial: !!m.dateFormat }
    // Without metadata: ISO text is a date; a "date-like" name with plausible serial numbers too.
    if (all((v) => typeof v === 'string' && ISO.test(v))) return { ...c, type: 'date', serial: false }
    if (/date|due|deadline|échéance|echeance/i.test(c.label) && all((v) => typeof v === 'number' && v > 20_000 && v < 80_000)) {
      return { ...c, type: 'date', serial: true }
    }
    if (all((v) => typeof v === 'number')) return { ...c, type: 'number' }
    if (all((v) => typeof v === 'string' && URL_RE.test(v))) return { ...c, type: 'link' }
    return { ...c, type: 'text' }
  })
}

/** What to put in the Sheet for a value typed in the panel. */
export function toCell(field: Field, input: string | boolean): Cell {
  if (field.type === 'checkbox') return input === true || input === 'true'
  const s = String(input).trim()
  if (s === '') return ''
  if (field.type === 'number') {
    const n = Number(s.replace(',', '.'))
    return Number.isFinite(n) ? n : s
  }
  if (field.type === 'date') {
    const d = dayOf(s)
    return d === null ? s : field.serial ? d + SERIAL_TO_UNIX_DAYS : new Date(d * 86_400_000).toISOString().slice(0, 10)
  }
  return s
}

export interface Chip {
  key: string
  /** Normalized value, what the quick filter compares. */
  raw: string
  text: string
  icon: string
  tone?: Tone
  /** Field label, for tooltips. */
  label: string
}

export const rawOf = (v: Cell | undefined) => (isEmpty(v) ? '' : String(v).trim().toLowerCase())

const TONES: [RegExp, Tone][] = [
  [/^(high|urgent|critical|blocker|p0|p1|haute|élevée|elevee|critique)$/i, 'red'],
  [/^(medium|med|normal|p2|moyenne)$/i, 'orange'],
  [/^(low|minor|p3|p4|basse|faible)$/i, 'green'],
]

export function chipFor(field: Field, v: Cell | undefined): Chip | null {
  if (isEmpty(v)) return null
  const base = { key: field.key, raw: rawOf(v), label: field.label }
  switch (field.type) {
    case 'date': {
      const day = dayOf(v)
      if (day === null) return { ...base, text: String(v), icon: '📅' }
      const left = day - todayNumber()
      return { ...base, text: formatDay(day), icon: '📅', tone: left < 0 ? 'red' : left <= 2 ? 'orange' : undefined }
    }
    case 'number':
      return { ...base, text: String(v), icon: '#' }
    case 'checkbox':
      return v === true ? { ...base, text: field.label, icon: '✓', tone: 'green' } : null
    case 'link': {
      let host = String(v)
      try {
        host = new URL(String(v)).hostname.replace(/^www\./, '')
      } catch {
        /* keep the raw text */
      }
      return { ...base, text: host, icon: '🔗' }
    }
    case 'select': {
      const t = String(v)
      return { ...base, text: t, icon: '', tone: TONES.find(([re]) => re.test(t))?.[1] }
    }
    default: {
      const t = String(v)
      const prio = /prio/i.test(field.label)
      return { ...base, text: prio ? t : `${field.label}: ${t}`, icon: '', tone: prio ? TONES.find(([re]) => re.test(t))?.[1] : undefined }
    }
  }
}

/** Pastel note colors for the tones, and a stable palette for everything else. */
export const TONE_COLORS: Record<Tone, string> = { red: '#FFADAD', orange: '#FFD6A5', green: '#CAFFBF' }
