import { useEffect } from 'react'
import { ZONE_COLORS, ZONE_TITLE_SIZE, ZONE_TITLE_SIZES } from './constants'
import type { Zone } from './types'

interface Props {
  zone: Zone
  /** Notes currently inside the zone. */
  count: number
  onClose: () => void
  onTitle: (id: string, title: string) => void
  onStatus: (id: string, status: string) => void
  onTitleSize: (id: string, size: number) => void
  onColor: (id: string, color: string) => void
  onLimit: (id: string, limit: number | undefined) => void
  onDelete: (id: string) => void
}

/** Details of a zone: title and its size, the status it auto-assigns, color and work-in-progress limit. */
export function ZonePanel({ zone, count, onClose, onTitle, onStatus, onTitleSize, onColor, onLimit, onDelete }: Props) {
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
        <input
          className="panel-title"
          value={zone.title ?? ''}
          placeholder={zone.name || 'Title'}
          aria-label="Zone title"
          onChange={(e) => onTitle(zone.id, e.target.value)}
        />
        <button onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>
      <div className="panel-body">
        <p className="read">
          {count} note{count === 1 ? '' : 's'} inside.
          {zone.name.trim() ? ` A note dropped here gets the status “${zone.name.trim()}”.` : ' No status is assigned: this zone only groups notes.'}
        </p>

        <label>
          <span>Auto-assign status</span>
          <input
            value={zone.name}
            placeholder="None (just a group)"
            aria-label="Auto-assign status"
            onChange={(e) => onStatus(zone.id, e.target.value)}
          />
        </label>

        <label>
          <span>Title size ({zone.titleSize ?? ZONE_TITLE_SIZE})</span>
          <input
            type="range"
            aria-label="Title size"
            min={ZONE_TITLE_SIZES.min}
            max={ZONE_TITLE_SIZES.max}
            value={zone.titleSize ?? ZONE_TITLE_SIZE}
            onChange={(e) => onTitleSize(zone.id, Number(e.target.value))}
          />
        </label>

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
