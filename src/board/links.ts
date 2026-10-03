import { NOTE_SIZE } from '../constants'
import type { ArrowMode, Link, Task } from '../types'
import { distToSegment } from './ink'

export const ARROW_MODES: ArrowMode[] = ['one', 'both', 'none']

export const encodeLink = (l: Link) => JSON.stringify({ from: l.from, to: l.to, arrow: l.arrow })

export function decodeLink(id: string, raw: unknown): Link | null {
  if (typeof raw !== 'string') return null
  try {
    const o = JSON.parse(raw) as { from?: unknown; to?: unknown; arrow?: unknown }
    // Older rows stored a boolean: true = arrow at the end, false = plain line.
    const arrow: ArrowMode = o.arrow === false ? 'none' : ARROW_MODES.includes(o.arrow as ArrowMode) ? (o.arrow as ArrowMode) : 'one'
    if (typeof o.from !== 'string' || typeof o.to !== 'string' || !o.from || !o.to || o.from === o.to) return null
    return { id, from: o.from, to: o.to, arrow }
  } catch {
    return null
  }
}

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

const GAP = 6 // world units of air between a note's edge and the line

/** The point where the line from a note's center toward (tx, ty) leaves the note, pushed out by GAP. */
function exit(t: Task, tx: number, ty: number): { x: number; y: number } {
  const cx = t.board.x + NOTE_SIZE / 2
  const cy = t.board.y + NOTE_SIZE / 2
  const dx = tx - cx
  const dy = ty - cy
  const len = Math.hypot(dx, dy) || 1
  const half = NOTE_SIZE / 2
  // Distance to the square's border along the direction (the square is axis-aligned).
  const k = Math.min(dx === 0 ? Infinity : half / Math.abs(dx), dy === 0 ? Infinity : half / Math.abs(dy))
  const reach = k * len + GAP
  return { x: cx + (dx / len) * reach, y: cy + (dy / len) * reach }
}

/** Border-to-border segment between two notes, or null if they overlap too much to draw one. */
export function segmentBetween(a: Task, b: Task): Segment | null {
  const ac = { x: a.board.x + NOTE_SIZE / 2, y: a.board.y + NOTE_SIZE / 2 }
  const bc = { x: b.board.x + NOTE_SIZE / 2, y: b.board.y + NOTE_SIZE / 2 }
  const p = exit(a, bc.x, bc.y)
  const q = exit(b, ac.x, ac.y)
  // If the notes overlap or touch, the exit points cross over: nothing sensible to draw.
  if ((q.x - p.x) * (bc.x - ac.x) + (q.y - p.y) * (bc.y - ac.y) <= 0) return null
  return { x1: p.x, y1: p.y, x2: q.x, y2: q.y }
}

/** Segment from a note's border toward a free point (while dragging a new link). */
export function segmentToPoint(a: Task, x: number, y: number): Segment | null {
  const c = { x: a.board.x + NOTE_SIZE / 2, y: a.board.y + NOTE_SIZE / 2 }
  const p = exit(a, x, y)
  if ((x - p.x) * (x - c.x) + (y - p.y) * (y - c.y) <= 0) return null // pointer still over the source note
  return { x1: p.x, y1: p.y, x2: x, y2: y }
}

export const distToSeg = (s: Segment, x: number, y: number) => distToSegment(x, y, s.x1, s.y1, s.x2, s.y2)

/** Arrowhead triangle at the end of a segment: three points "x,y x,y x,y". */
export function arrowHead(s: Segment, size = 16): string {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = s.x2 - ux * size
  const by = s.y2 - uy * size
  const w = size * 0.45
  return `${s.x2},${s.y2} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}`
}
