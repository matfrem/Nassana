// OAuth client IDs are public (they ship in every web app), so this is safe to commit.
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  '524157790192-5ofms6vsldkrrmn53rpg1oa933ha2pcb.apps.googleusercontent.com'

// Public too: the key is restricted to this site's origin and to the Picker API in Google Cloud.
export const GOOGLE_API_KEY: string =
  import.meta.env.VITE_GOOGLE_API_KEY ?? 'AIzaSyAZ1rrFsCbU1S8ZhA_O99UW2Ho2fk9ReDw'

/** Google Cloud project number (the first part of the client ID). Required by the Picker. */
export const GOOGLE_PROJECT_NUMBER = GOOGLE_CLIENT_ID.split('-')[0]

/** Name of the tab that holds the tasks. */
export const TASKS_TAB = 'Tasks'

/** Required columns, matched by header name (case-insensitive). */
export const REQUIRED_COLUMNS = ['id', 'title'] as const
