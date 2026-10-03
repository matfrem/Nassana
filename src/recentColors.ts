import { normalizeHex } from './colorUtil'

const KEY = 'nassana.recentColors'
const MAX = 8

export function loadRecentColors(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.flatMap((c) => (typeof c === 'string' ? (normalizeHex(c) ?? []) : [])).slice(0, MAX) : []
  } catch {
    return []
  }
}

/** Puts a color first in the per-browser list of recently chosen colors. */
export function rememberColor(color: string): void {
  const c = normalizeHex(color)
  if (!c) return
  try {
    localStorage.setItem(KEY, JSON.stringify([c, ...loadRecentColors().filter((x) => x !== c)].slice(0, MAX)))
  } catch {
    /* storage unavailable: the list just isn't kept */
  }
}
