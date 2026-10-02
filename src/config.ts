// OAuth client IDs are public (they ship in every web app), so this is safe to commit.
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  '524157790192-5ofms6vsldkrrmn53rpg1oa933ha2pcb.apps.googleusercontent.com'

/** Name of the tab that holds the tasks. */
export const TASKS_TAB = 'Tasks'

/** Required columns, matched by header name (case-insensitive). */
export const REQUIRED_COLUMNS = ['id', 'title'] as const
