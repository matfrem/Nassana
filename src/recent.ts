export interface RecentSheet {
  id: string
  title: string
}

const KEY = 'nassana.recent'

export function loadRecent(): RecentSheet[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string') : []
  } catch {
    return []
  }
}

export function rememberSheet(sheet: RecentSheet) {
  try {
    const list = [sheet, ...loadRecent().filter((r) => r.id !== sheet.id)].slice(0, 8)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: recents just won't persist */
  }
}
