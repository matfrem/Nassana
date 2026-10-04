/** The stamps a note can carry (a fixed list; a note stores their ids in the `stamps` column, e.g. `fire,bomb`). */
export const STAMPS: { id: string; emoji: string; label: string }[] = [
  { id: 'fire', emoji: '🔥', label: 'Fire' },
  { id: 'bomb', emoji: '💣', label: 'Bomb' },
  { id: 'star', emoji: '⭐', label: 'Star' },
  { id: 'check', emoji: '✅', label: 'Done' },
  { id: 'warning', emoji: '⚠️', label: 'Warning' },
  { id: 'wip', emoji: '🚧', label: 'Work in progress' },
  { id: 'question', emoji: '❓', label: 'Question' },
  { id: 'idea', emoji: '💡', label: 'Idea' },
  { id: 'bug', emoji: '🐞', label: 'Bug' },
  { id: 'lock', emoji: '🔒', label: 'Locked' },
  { id: 'rocket', emoji: '🚀', label: 'Rocket' },
  { id: 'target', emoji: '🎯', label: 'Target' },
  { id: 'eyes', emoji: '👀', label: 'To review' },
  { id: 'clock', emoji: '⏰', label: 'Deadline' },
  { id: 'comment', emoji: '💬', label: 'Discuss' },
  { id: 'pin', emoji: '📌', label: 'Pinned' },
  { id: 'heart', emoji: '❤️', label: 'Heart' },
  { id: 'thumbsup', emoji: '👍', label: 'Thumbs up' },
  { id: 'thumbsdown', emoji: '👎', label: 'Thumbs down' },
  { id: 'test', emoji: '🧪', label: 'Test' },
  { id: 'wrench', emoji: '🔧', label: 'Fix' },
  { id: 'memo', emoji: '📝', label: 'Notes' },
  { id: 'stop', emoji: '🛑', label: 'Blocked' },
  { id: 'flag', emoji: '🏁', label: 'Milestone' },
  { id: 'party', emoji: '🎉', label: 'Celebrate' },
  { id: 'money', emoji: '💰', label: 'Budget' },
  { id: 'brain', emoji: '🧠', label: 'Think' },
  { id: 'art', emoji: '🎨', label: 'Art' },
  { id: 'sound', emoji: '🔊', label: 'Sound' },
  { id: 'game', emoji: '🎮', label: 'Gameplay' },
  { id: 'chart', emoji: '📈', label: 'Metrics' },
  { id: 'shield', emoji: '🛡️', label: 'Protected' },
]

const BY_ID = new Map(STAMPS.map((s) => [s.id, s]))

/** `fire, bomb,unknown` -> the ids, trimmed, without duplicates. */
export function parseStamps(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

export const formatStamps = (ids: string[]): string => ids.join(',')

/** The emoji of a stamp id; unknown ids (written by hand in the Sheet) are not drawn. */
export const stampEmoji = (id: string): string | undefined => BY_ID.get(id)?.emoji

/** Adds the stamp when it is absent, removes it when present. */
export const toggledStamps = (ids: string[] | undefined, id: string): string[] => {
  const cur = ids ?? []
  return cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]
}

/** Stamps in columns of `perColumn`: the first column is nearest the note's edge, the next ones go to its left. */
export function stampColumns(ids: string[], perColumn = 3): string[][] {
  const shown = ids.filter((id) => BY_ID.has(id))
  const out: string[][] = []
  for (let i = 0; i < shown.length; i += perColumn) out.push(shown.slice(i, i + perColumn))
  return out
}
