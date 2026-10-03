import { memo } from 'react'
import type { Stroke } from '../types'
import { pathFor } from './ink'

/** The drawing layer. Lives inside the world, so it pans and zooms with the notes. */
export const Ink = memo(function Ink({ strokes, live }: { strokes: Stroke[]; live: Stroke | null }) {
  return (
    <svg className="ink" width={1} height={1}>
      {strokes.map((s) => (
        <path key={s.id} d={pathFor(s.p)} stroke={s.c} strokeWidth={s.w} />
      ))}
      {live && <path d={pathFor(live.p)} stroke={live.c} strokeWidth={live.w} />}
    </svg>
  )
})
