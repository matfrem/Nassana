import { useEffect } from 'react'
import type { MineRule } from './visibility'

interface Props {
  /** The columns a rule can be about (the status and the custom columns). */
  columns: { key: string; label: string; icon?: string }[]
  /** The distinct values found in a column, to pick from. */
  valuesFor: (key: string) => { raw: string; text: string }[]
  mine: MineRule | null
  onChange: (rule: MineRule | null) => void
  onClose: () => void
}

/** Personal settings, kept in this browser only: for now, which tasks are "mine" (a column and one of its values). */
export function MySettings({ columns, valuesFor, mine, onChange, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const column = columns.find((c) => c.key === mine?.key)
  const values = mine ? valuesFor(mine.key) : []

  return (
    <div className="cp-backdrop" onPointerDown={onClose}>
      <div className="cp" role="dialog" aria-label="My settings" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <strong>My settings</strong>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </header>
        <p className="hint">Kept in this browser only; nobody else sees it.</p>
        <section>
          <h3>My tasks</h3>
          <p className="hint">The tasks whose column has this value are the ones “Isolate my tasks” keeps on the board.</p>
          <label className="my-field">
            Column
            <select
              aria-label="My column"
              value={mine?.key ?? ''}
              onChange={(e) => {
                const c = columns.find((x) => x.key === e.target.value)
                // changing the column forgets the value: it was a value of another column
                onChange(c ? { key: c.key, label: c.label, raw: '', text: '' } : null)
              }}
            >
              <option value="">— none</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {mine && (
            <label className="my-field">
              Value
              <select
                aria-label="My value"
                value={mine.raw}
                onChange={(e) => {
                  const v = values.find((x) => x.raw === e.target.value)
                  onChange({ ...mine, raw: v?.raw ?? '', text: v?.text ?? '' })
                }}
              >
                <option value="">— choose</option>
                {values.map((v) => (
                  <option key={v.raw} value={v.raw}>
                    {v.text}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mine && !mine.raw && column && <p className="hint">Pick a value to finish.</p>}
        </section>
      </div>
    </div>
  )
}
