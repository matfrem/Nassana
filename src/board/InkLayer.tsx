import { memo } from 'react'
import type { Stroke } from '../types'
import { pathFor } from './ink'

/** The drawing layer. Lives inside the world, so it pans and zooms with the notes. */
export interface Clip {
  x: number
  y: number
  size: number
}

export const Ink = memo(function Ink({
  strokes,
  live,
  liveClip,
  selectedId,
}: {
  strokes: Stroke[]
  live: Stroke | null
  /** While drawing on a note, the stroke is cut at the note's edges, as it will be once saved. */
  liveClip: Clip | null
  /** The stroke picked with the move tool. */
  selectedId: string | null
}) {
  return (
    <svg className="ink" width={1} height={1}>
      {strokes.map((s) => (
        <g key={s.id}>
          {s.id === selectedId && <path className="stroke-halo" d={pathFor(s.p)} style={{ strokeWidth: `calc(${s.w}px + 12px / var(--zoom, 1))` }} />}
          <path d={pathFor(s.p)} stroke={s.c} strokeWidth={s.w} />
        </g>
      ))}
      {live && liveClip && (
        <clipPath id="live-clip">
          <rect x={liveClip.x} y={liveClip.y} width={liveClip.size} height={liveClip.size} />
        </clipPath>
      )}
      {live && (
        <path
          d={pathFor(live.p)}
          stroke={live.c}
          strokeWidth={live.w}
          clipPath={liveClip ? 'url(#live-clip)' : undefined}
        />
      )}
    </svg>
  )
})
