import { NOTE_SIZE } from '../constants'
import { stampColumns, stampEmoji } from '../stamps'

/** The stamps of a note: stacked at its top right, sticking out; more than three go into a new column to the left. */
export function StampStack({ ids, x, y, dim = false }: { ids: string[]; x: number; y: number; dim?: boolean }) {
  const cols = stampColumns(ids)
  if (!cols.length) return null
  return (
    <div className={`stamps${dim ? ' dim' : ''}`} style={{ transform: `translate(${x + NOTE_SIZE}px, ${y}px)` }}>
      {cols.map((col, ci) => (
        <div key={ci} className="stamp-col" style={{ left: -40 - ci * 51 }}>
          {col.map((id) => (
            <span key={id} className="stamp">
              {stampEmoji(id)}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
