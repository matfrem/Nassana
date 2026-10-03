export const HEX6 = /^#[0-9a-f]{6}$/i

export interface Hsl {
  h: number // 0..360
  s: number // 0..100
  l: number // 0..100
}

export function hexToHsl(hex: string): Hsl {
  const m = HEX6.test(hex) ? hex : '#cccccc'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const S = s / 100
  const L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

/** Accepts `#abc`, `abc`, `#aabbcc`, `aabbcc` (any case); returns `#aabbcc` or null. */
export function normalizeHex(input: string): string | null {
  const t = input.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(t)) return '#' + [...t].map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(t) ? '#' + t : null
}

/** Colors by how often they appear, most used first, without duplicates (case-insensitive). */
export function byFrequency(colors: string[], max = 12): string[] {
  const n = new Map<string, number>()
  for (const c of colors) {
    const k = normalizeHex(c)
    if (k) n.set(k, (n.get(k) ?? 0) + 1)
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c)
}

/** A friendly default palette: soft and strong tones of 12 hues, then greys. */
export const PALETTE: string[] = [
  ...[78, 58].flatMap((l) => Array.from({ length: 12 }, (_, i) => hslToHex({ h: i * 30, s: l > 70 ? 90 : 72, l }))),
  '#ffffff', '#e5e7eb', '#9ca3af', '#6b7280', '#374151', '#111111',
]
