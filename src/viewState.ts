import type { Camera } from './types'

/** A value hidden from the board (or, for `OnlyRule`, the only one shown). `text`/`label` are for the pill. */
export interface HideRule {
  key: string
  raw: string
  text: string
  label: string
}
export type OnlyRule = HideRule

/**
 * How one browser looks at one board: color-by column, hidden values, "only" filter and the camera.
 * Purely local (localStorage, one entry per Sheet); never written to the Sheet, so each person keeps their own view.
 */
export interface ViewState {
  colorBy: string
  hidden: HideRule[]
  only: OnlyRule | null
  camera: Camera | null
  /** Draw the dotted links between notes (sub-task lines are always drawn). */
  showLinks: boolean
}

const KEY = (sheetId: string) => `nassana.view.${sheetId}`

const isRule = (r: unknown): r is HideRule =>
  !!r && typeof r === 'object' && ['key', 'raw', 'text', 'label'].every((k) => typeof (r as Record<string, unknown>)[k] === 'string')

const isCamera = (c: unknown): c is Camera =>
  !!c && typeof c === 'object' && ['x', 'y', 'zoom'].every((k) => Number.isFinite((c as Record<string, unknown>)[k]))

const empty = (): ViewState => ({ colorBy: '', hidden: [], only: null, camera: null, showLinks: true })

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function loadView(sheetId: string | null): ViewState {
  if (!sheetId) return empty()
  const v = readJson(KEY(sheetId)) as Partial<ViewState> | undefined
  if (v && typeof v === 'object') {
    return {
      colorBy: typeof v.colorBy === 'string' ? v.colorBy : '',
      hidden: Array.isArray(v.hidden) ? v.hidden.filter(isRule) : [],
      only: isRule(v.only) ? v.only : null,
      camera: isCamera(v.camera) ? v.camera : null,
      showLinks: v.showLinks !== false,
    }
  }
  // Older versions kept these two in separate entries.
  let colorBy = ''
  try {
    colorBy = localStorage.getItem(`nassana.colorBy.${sheetId}`) ?? ''
  } catch {
    /* ignore */
  }
  const old = readJson(`nassana.hidden.${sheetId}`)
  return { ...empty(), colorBy, hidden: Array.isArray(old) ? old.filter(isRule) : [] }
}

export function saveView(sheetId: string | null, patch: Partial<ViewState>) {
  if (!sheetId) return
  try {
    localStorage.setItem(KEY(sheetId), JSON.stringify({ ...loadView(sheetId), ...patch }))
  } catch {
    /* storage unavailable (private window…): the view just won't be remembered */
  }
}
