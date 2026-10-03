import { memo } from 'react'
import { NOTE_SIZE, SPAN } from '../constants'
import type { Link } from '../types'
import { arrowHead, type Segment } from './links'

export interface LinkItem {
  link: Link
  seg: Segment
  /** One of its notes is filtered out. */
  dim: boolean
}

export interface LiveLink {
  seg: Segment | null
  /** The note the pointer is over (a valid drop target), shown with an outline. */
  target: { x: number; y: number } | null
}

/** Dotted lines between notes, with an arrowhead at the target end. Lives inside the world. */
export const LinksLayer = memo(function LinksLayer({
  items,
  selectedId,
  live,
  zoom,
}: {
  items: LinkItem[]
  selectedId: string | null
  live: LiveLink | null
  zoom: number
}) {
  // Keep the arrowhead readable when zoomed out: never smaller than ~10 screen pixels.
  const head = Math.max(16, 10 / zoom)
  return (
    <svg className="links" width={SPAN} height={SPAN} viewBox={`${-SPAN / 2} ${-SPAN / 2} ${SPAN} ${SPAN}`} style={{ left: -SPAN / 2, top: -SPAN / 2 }}>
      {items.map(({ link, seg, dim }) => (
        <g key={link.id} className={`link${link.id.startsWith('stack:') ? ' stack' : ''}${dim ? ' dim' : ''}`}>
          {link.id === selectedId && <line className="link-halo" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} />}
          <line className="link-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} />
          {link.arrow !== 'none' && <polygon className="link-arrow" points={arrowHead(seg, head)} />}
          {link.arrow === 'both' && (
            <polygon className="link-arrow" points={arrowHead({ x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 }, head)} />
          )}
        </g>
      ))}
      {live?.seg && (
        <g className="link live">
          <line className="link-line" x1={live.seg.x1} y1={live.seg.y1} x2={live.seg.x2} y2={live.seg.y2} />
          <polygon className="link-arrow" points={arrowHead(live.seg, head)} />
        </g>
      )}
      {live?.target && (
        <rect className="link-target" x={live.target.x - 4} y={live.target.y - 4} width={NOTE_SIZE + 8} height={NOTE_SIZE + 8} rx={8} />
      )}
    </svg>
  )
})
