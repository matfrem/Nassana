import { useEffect } from 'react'
import { STAMPS } from './stamps'

interface Props {
  title: string
  /** Stamps carried by every selected note (highlighted). */
  active: ReadonlySet<string>
  /** Stamps carried by some of them, not all. */
  some: ReadonlySet<string>
  onToggle: (id: string) => void
  onClose: () => void
}

/** Bottom sheet with the grid of stamps: a tap adds the stamp, another removes it. Stays open to stamp several. */
export function StampPicker({ title, active, some, onToggle, onClose }: Props) {
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
    <div className="cp-backdrop" onPointerDown={onClose}>
      <div className="cp" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="stamp-grid">
          {STAMPS.map((s) => (
            <button
              key={s.id}
              className={`stamp-cell${active.has(s.id) ? ' on' : some.has(s.id) ? ' some' : ''}`}
              aria-label={`Stamp ${s.label}`}
              aria-pressed={active.has(s.id)}
              title={s.label}
              onClick={() => onToggle(s.id)}
            >
              {s.emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
