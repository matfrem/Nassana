import type { Task } from '../types'

/** child id -> parent id. A note has at most one parent; the chain upward forms a tree. */
export type Parents = Record<string, string>

/** True when making `parent` the parent of `child` would close a loop (or point a note at itself). */
export function wouldCycle(parents: Parents, child: string, parent: string): boolean {
  for (let id: string | undefined = parent, n = 0; id && n < 1000; id = parents[id], n++) if (id === child) return true
  return false
}

/** parent id -> its direct children. */
export function childrenOf(parents: Parents): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const [child, parent] of Object.entries(parents)) m.set(parent, [...(m.get(parent) ?? []), child])
  return m
}

/** Number of notes below `id`, at any depth. */
export function descendantCount(kids: Map<string, string[]>, id: string): number {
  let n = 0
  const seen = new Set([id])
  const todo = [id]
  while (todo.length) for (const c of kids.get(todo.pop()!) ?? []) if (!seen.has(c)) (seen.add(c), n++, todo.push(c))
  return n
}

/**
 * The notes tucked away inside a closed stack, with the note they hide under: the closed ancestor closest to the root
 * (the one still on the board). Notes that are not hidden are absent.
 */
export function tucked(tasks: Task[], parents: Parents, open: ReadonlySet<string>): Map<string, string> {
  const ids = new Set(tasks.map((t) => t.id))
  const out = new Map<string, string>()
  for (const t of tasks) {
    let anchor: string | undefined
    let id = t.id
    for (let n = 0; n < 1000; n++) {
      const p: string | undefined = parents[id]
      if (!p || !ids.has(p)) break
      if (!open.has(p)) anchor = p // keep climbing: the last closed one wins (closest to the root)
      id = p
    }
    if (anchor) out.set(t.id, anchor)
  }
  return out
}

/** Drops parents that point at missing notes, or that would loop. */
export function cleanParents(parents: Parents, ids: ReadonlySet<string>): Parents {
  const out: Parents = {}
  for (const [c, p] of Object.entries(parents)) {
    if (!ids.has(c) || !ids.has(p) || c === p || wouldCycle(out, c, p)) continue
    out[c] = p
  }
  return out
}
