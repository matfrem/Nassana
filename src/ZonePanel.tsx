import { useEffect } from 'react'
import { ZONE_COLORS } from './constants'
import type { Zone } from './types'

interface Props {
  zone: Zone
  /** Notes currently inside the zone. */
  count: number
  onClose: () => void
  onName: (id: string, name: string) => void
  onColor: (id: string, color: string) => void
  onLimit: (id: string, limit: number | undefined) => void
  onDelete: (id: string) => void
}

/** Details of a zone: its name (which is also the status it gives), color and work-in-progress limit. */
export function ZonePanel({ zone, count, onClose, onName, onColor, onLimit, onDelete }: Props) {
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

  return (
    <aside className="panel" aria-label="Zone details">
      <header>
        <input className="panel-title" value={zone.name} aria-label="Zone name" onChange={(e) => onName(zone.id, e.target.value)} />
        <button onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>
      <div className="panel-body">
        <p className="read">
          {count} note{count === 1 ? '' : 's'} inside. A note dropped here gets the status “{zone.name || '—'}”.
        </p>

        <label>
          <span>Work-in-progress limit</span>
          <input
            inputMode="numeric"
            placeholder="No limit"
            value={zone.limit ?? ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              onLimit(zone.id, Number.isInteger(n) && n > 0 ? n : undefined)
            }}
          />
        </label>

        <div className="colors">
          <span>Color</span>
          <div>
            {ZONE_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${c === zone.color ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={`Zone color ${c}`}
                onClick={() => onColor(zone.id, c)}
              />
            ))}
          </div>
        </div>

        <button className="danger" onClick={() => onDelete(zone.id)}>
          🗑 Delete zone
        </button>
      </div>
    </aside>
  )
}
