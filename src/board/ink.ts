import type { Stroke } from '../types'

/** One decimal is plenty: even at 400% zoom it is 0.4 screen pixels. */
const round1 = (n: number) => Math.round(n * 10) / 10

/** Ramer-Douglas-Peucker: drops points that deviate less than `eps` from the simplified line. */
export function simplify(p: number[], eps: number): number[] {
  const n = p.length / 2
  if (n <= 2) return p
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1
    let dmax = eps
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(p[i * 2], p[i * 2 + 1], p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1])
      if (d > dmax) {
        dmax = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1])
  return out
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** SVG path through the points, smoothed with quadratic curves through the midpoints. */
export function pathFor(p: number[]): string {
  const n = p.length / 2
  if (n === 0) return ''
  if (n === 1) return `M${p[0]} ${p[1]}h0.01` // a dot (round caps make it a circle)
  let d = `M${p[0]} ${p[1]}`
  for (let i = 1; i < n - 1; i++) {
    const mx = (p[i * 2] + p[i * 2 + 2]) / 2
    const my = (p[i * 2 + 1] + p[i * 2 + 3]) / 2
    d += `Q${p[i * 2]} ${p[i * 2 + 1]} ${mx} ${my}`
  }
  return d + `L${p[n * 2 - 2]} ${p[n * 2 - 1]}`
}

/** True if the world point (x, y) is within `radius` of the stroke's line (plus half its width). */
export function hitsStroke(s: Stroke, x: number, y: number, radius: number): boolean {
  const r = radius + s.w / 2
  const n = s.p.length / 2
  if (n === 1) return Math.hypot(x - s.p[0], y - s.p[1]) <= r
  for (let i = 0; i < n - 1; i++) {
    if (distToSegment(x, y, s.p[i * 2], s.p[i * 2 + 1], s.p[i * 2 + 2], s.p[i * 2 + 3]) <= r) return true
  }
  return false
}

/** A Google Sheets cell holds at most 50 000 characters. */
const MAX_CELL = 45_000

/**
 * Compact text form: {"c":"#fff","w":3,"p":[x0,y0,dx,dy,...]} (deltas after the first point).
 * If it would not fit in a cell, the stroke is simplified harder until it does.
 */
export function encodeStroke(s: Stroke, eps: number): string {
  let p = simplify(s.p, eps)
  for (let tries = 0; tries < 12; tries++) {
    const out: number[] = []
    let px = 0
    let py = 0
    for (let i = 0; i < p.length; i += 2) {
      const x = round1(p[i])
      const y = round1(p[i + 1])
      out.push(round1(i === 0 ? x : x - px), round1(i === 0 ? y : y - py))
      px = x
      py = y
    }
    const json = JSON.stringify({ c: s.c, w: round1(s.w), p: out })
    if (json.length <= MAX_CELL) return json
    p = simplify(p, eps * 2 ** (tries + 1))
  }
  throw new Error('This stroke is too long to store. Try drawing it in pieces.')
}

const HEX = /^#[0-9a-f]{3,8}$/i

export function decodeStroke(id: string, raw: unknown): Stroke | null {
  if (typeof raw !== 'string') return null
  try {
    const o = JSON.parse(raw) as { c?: unknown; w?: unknown; p?: unknown }
    if (typeof o.c !== 'string' || !HEX.test(o.c) || !Number.isFinite(o.w) || !Array.isArray(o.p)) return null
    if (o.p.length < 2 || o.p.length % 2 || !o.p.every(Number.isFinite)) return null
    const p: number[] = []
    let x = 0
    let y = 0
    for (let i = 0; i < o.p.length; i += 2) {
      x = round1(x + (o.p[i] as number))
      y = round1(y + (o.p[i + 1] as number))
      p.push(x, y)
    }
    return { id, c: o.c, w: o.w as number, p }
  } catch {
    return null
  }
}
