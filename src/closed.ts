import type { Task } from './types'

/**
 * The state that means "this task is finished". Today: the status is "Closed" (any case). Everything that needs to know
 * whether a task is closed goes through `isClosed`, so that the definition can change (a boolean column, say) in one place.
 */
export const CLOSED_STATUS = 'Closed'

export const isClosed = (t: Task): boolean => (t.status ?? '').trim().toLowerCase() === CLOSED_STATUS.toLowerCase()

/** Number of closed tasks among `ids`, looked up in `byId`. */
export const closedCount = (ids: string[], byId: ReadonlyMap<string, Task>): number => ids.filter((id) => byId.has(id) && isClosed(byId.get(id)!)).length
