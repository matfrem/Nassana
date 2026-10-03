import { useEffect, useRef, useState } from 'react'
import { dayOf, isoOf, todayNumber, type Cell } from './fields'

/** Field order and separator of the user's locale, e.g. d/m/y with "/" in France. */
const LOCALE = (() => {
  const parts = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(2000, 10, 22))
  const order = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type) as ('day' | 'month' | 'year')[]
  const sep = parts.find((p) => p.type === 'literal')?.value ?? '/'
  return { order, sep }
})()

const HINT = LOCALE.order.map((t) => (t === 'day' ? 'DD' : t === 'month' ? 'MM' : 'YYYY')).join(LOCALE.sep)

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function show(v: Cell | undefined): string {
  const iso = isoOf(v)
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return LOCALE.order.map((t) => (t === 'day' ? pad(d) : t === 'month' ? pad(m) : pad(y, 4))).join(LOCALE.sep)
}

/** Typed text -> `YYYY-MM-DD`. Accepts any separator, or digits only (15012030), in the locale's order. */
function parse(text: string): string | null {
  const t = text.trim()
  if (!t) return ''
  let nums: number[]
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) nums = t.split('-').map(Number).reverse() // ISO: y-m-d -> d,m,y below
  else {
    const groups = t.split(/\D+/).filter(Boolean)
    if (groups.length === 3) nums = groups.map(Number)
    else if (groups.length === 1 && /^\d{6}$|^\d{8}$/.test(groups[0])) {
      const g = groups[0]
      const w = g.length === 8 ? [LOCALE.order[0] === 'year' ? 4 : 2, LOCALE.order[1] === 'year' ? 4 : 2, LOCALE.order[2] === 'year' ? 4 : 2] : [2, 2, 2]
      nums = [Number(g.slice(0, w[0])), Number(g.slice(w[0], w[0] + w[1])), Number(g.slice(w[0] + w[1]))]
    } else return null
    // `nums` follows the locale order: reorder to [d, m, y] for the ISO branch below.
    const by = Object.fromEntries(LOCALE.order.map((k, i) => [k, nums[i]])) as Record<'day' | 'month' | 'year', number>
    nums = [by.day, by.month, by.year]
  }
  let [d, m, y] = nums
  if (y < 100) y += 2000
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

const plusDays = (n: number) => new Date((todayNumber() + n) * 86_400_000).toISOString().slice(0, 10)

interface Props {
  value: Cell | undefined
  /** Receives `YYYY-MM-DD`, or '' to clear. */
  onChange: (iso: string) => void
}

/**
 * A date entry that works on phones: type digits (numeric keypad), pick from the calendar button,
 * or use a shortcut. The native <input type="date"> is unreliable in a bottom sheet.
 */
export function DateField({ value, onChange }: Props) {
  const [draft, setDraft] = useState(show(value))
  const [invalid, setInvalid] = useState(false)
  const native = useRef<HTMLInputElement>(null)

  // Follow changes made elsewhere (shortcuts, another note being opened).
  useEffect(() => {
    setDraft(show(value))
    setInvalid(false)
  }, [value])

  const commit = (text: string) => {
    const iso = parse(text)
    if (iso === null) return setInvalid(true)
    setInvalid(false)
    if (iso !== isoOf(value)) onChange(iso)
    else setDraft(show(value))
  }

  return (
    <div className="datefield">
      <div className="row">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={HINT}
          value={draft}
          aria-invalid={invalid}
          className={invalid ? 'bad' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          type="button"
          aria-label="Pick a date"
          onClick={() => {
            const el = native.current
            if (!el) return
            el.value = isoOf(value)
            try {
              el.showPicker()
            } catch {
              el.click()
            }
          }}
        >
          📅
        </button>
        {/* Off-screen native picker, used only for the calendar button. */}
        <input ref={native} type="date" tabIndex={-1} aria-hidden className="native-date" onChange={(e) => e.target.value && onChange(e.target.value)} />
      </div>
      <div className="quick">
        <button type="button" onClick={() => onChange(plusDays(0))}>Today</button>
        <button type="button" onClick={() => onChange(plusDays(1))}>Tomorrow</button>
        <button type="button" onClick={() => onChange(plusDays(7))}>+1 week</button>
        {dayOf(value) !== null && (
          <button type="button" onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
