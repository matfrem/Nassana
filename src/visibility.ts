import { isClosed } from './closed'
import type { Parents } from './board/stacks'
import type { Task } from './types'

/** Isolation: only some tasks stay on the board. `tasks`: a fixed list picked by the user; `mine`: the tasks that match "my" filter. */
export type Isolation = { kind: 'tasks'; ids: string[] } | { kind: 'mine' }

/** "My tasks": a column and the value that means the task is mine (compared exactly, ignoring case). */
export interface MineRule {
  key: string
  raw: string
  text: string
  label: string
}

/** Every note below the given ones, at any depth. */
export function descendantsOf(parents: Parents, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const [child, parent] of Object.entries(parents)) {
      if (!out.has(child) && (ids.has(parent) || out.has(parent))) {
        out.add(child)
        grew = true
      }
    }
  }
  return out
}

/** Every parent above the given notes, up to the roots. */
export function ancestorsOf(parents: Parents, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    for (let p = parents[id], n = 0; p && !out.has(p) && n < 1000; p = parents[p], n++) out.add(p)
  }
  return out
}

/**
 * The tasks that stay when an isolation is on (null when there is none): the isolated ones and their sub-tasks. For "my tasks",
 * also the parents of those, so a sub-task is not shown without its context. Closed tasks are not "mine" unless closed tasks are shown.
 */
export function isolatedSet(
  tasks: Task[],
  parents: Parents,
  isolation: Isolation | null,
  isMine: (t: Task) => boolean,
  showClosed: boolean,
): Set<string> | null {
  if (!isolation) return null
  const exists = new Set(tasks.map((t) => t.id))
  const base = new Set(
    isolation.kind === 'tasks' ? isolation.ids.filter((id) => exists.has(id)) : tasks.filter((t) => isMine(t) && (showClosed || !isClosed(t))).map((t) => t.id),
  )
  const out = new Set([...base, ...descendantsOf(parents, base)])
  if (isolation.kind === 'mine') ancestorsOf(parents, base).forEach((id) => out.add(id))
  return out
}

/** The tasks that are not drawn at all: closed ones (unless shown), and the ones left out by an isolation. */
export function goneIds(tasks: Task[], showClosed: boolean, isolated: ReadonlySet<string> | null): Set<string> {
  return new Set(tasks.filter((t) => (!showClosed && isClosed(t)) || (isolated !== null && !isolated.has(t.id))).map((t) => t.id))
}
