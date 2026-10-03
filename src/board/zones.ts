import { NOTE_SIZE, ZONE_HEADER } from '../constants'
import type { Task, Zone } from '../types'

const norm = (s: string) => s.trim().toLowerCase()
const round = (n: number) => Math.round(n)

export const centerOf = (t: Task) => ({ x: t.board.x + NOTE_SIZE / 2, y: t.board.y + NOTE_SIZE / 2 })

const inside = (z: Zone, x: number, y: number) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h

/** The zone under a world point. When zones overlap, the one drawn last (on top) wins. */
export function zoneAt(zones: Zone[], x: number, y: number): Zone | undefined {
  for (let i = zones.length - 1; i >= 0; i--) if (inside(zones[i], x, y)) return zones[i]
  return undefined
}

export const zoneOfNote = (zones: Zone[], t: Task) => {
  const c = centerOf(t)
  return zoneAt(zones, c.x, c.y)
}

/** Tasks whose center is in the zone (and that the zone is on top of). */
export const notesInZone = (zones: Zone[], zone: Zone, tasks: Task[]) =>
  tasks.filter((t) => zoneOfNote(zones, t)?.id === zone.id)

/**
 * Makes the board agree with the statuses written in the Sheet:
 * - a note that has no saved position goes into the zone named like its status;
 * - a note sitting in a zone, whose status names a different zone, moves to that zone.
 * Notes outside every zone stay where they are, and statuses matching no zone are ignored.
 * Moved notes are flagged `autoPlaced`, so the next edit session saves their new position.
 */
export function applyZones(tasks: Task[], zones: Zone[]): Task[] {
  if (zones.length === 0) return tasks
  const byName = new Map<string, Zone>()
  for (const z of zones) byName.set(norm(z.name), z)

  const target = (t: Task): Zone | undefined => {
    const want = t.status ? byName.get(norm(t.status)) : undefined
    if (!want) return undefined
    if (t.autoPlaced) return want
    const current = zoneOfNote(zones, t)
    return current && current.id !== want.id ? want : undefined
  }

  const moving = new Map<string, Zone>()
  for (const t of tasks) {
    const z = target(t)
    if (z) moving.set(t.id, z)
  }
  if (moving.size === 0) return tasks

  // Notes that stay put occupy their spots; moved notes take the next free slot as they arrive.
  const occupied = tasks.filter((t) => !moving.has(t.id)).map((t) => ({ ...t.board }))
  const gap = 12
  const pad = 16
  const step = NOTE_SIZE + gap

  return tasks.map((t) => {
    const z = moving.get(t.id)
    if (!z) return t
    const cols = Math.max(1, Math.floor((z.w - pad * 2 + gap) / step))
    for (let k = 0; ; k++) {
      const x = z.x + pad + (k % cols) * step
      const y = z.y + ZONE_HEADER + pad + Math.floor(k / cols) * step
      const free = occupied.every((o) => Math.abs(o.x - x) >= NOTE_SIZE || Math.abs(o.y - y) >= NOTE_SIZE)
      if (free) {
        occupied.push({ x, y, color: t.board.color })
        return { ...t, autoPlaced: true, board: { ...t.board, x: round(x), y: round(y) } }
      }
    }
  })
}

const HEX6 = /^#[0-9a-f]{6}$/i

export const encodeZone = (z: Zone) =>
  JSON.stringify({ x: round(z.x), y: round(z.y), w: round(z.w), h: round(z.h), name: z.name, color: z.color, limit: z.limit })

export function decodeZone(id: string, raw: unknown): Zone | null {
  if (typeof raw !== 'string') return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (![o.x, o.y, o.w, o.h].every(Number.isFinite) || (o.w as number) <= 0 || (o.h as number) <= 0) return null
    return {
      id,
      x: o.x as number,
      y: o.y as number,
      w: o.w as number,
      h: o.h as number,
      name: typeof o.name === 'string' ? o.name : '',
      color: typeof o.color === 'string' && HEX6.test(o.color) ? o.color : '#94A3B8',
      limit: Number.isInteger(o.limit) && (o.limit as number) > 0 ? (o.limit as number) : undefined,
    }
  } catch {
    return null
  }
}
