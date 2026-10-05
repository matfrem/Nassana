import type { Camera } from './types'
import type { Isolation, MineRule } from './visibility'

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
  /** Draw the stamps on notes. */
  showStamps: boolean
  /** Draw the property pills on notes (when zoomed in enough). */
  showChips: boolean
  /** The board's background: the dots, a plain color, or nothing (the theme's color). */
  background: 'dots' | 'color' | 'empty'
  bgColor: string
  /** Show the tasks whose status is closed (they are hidden by default). */
  showClosed: boolean
  /** "My tasks": the column and value that mean a task is mine (a personal setting, kept in this browser only). */
  mine: MineRule | null
  /** The isolation in force, if any. */
  isolate: Isolation | null
  /** The sub-task stacks opened by "auto isolate", outermost first (a second isolation, on top of `isolate`). */
  stackPath: string[]
  /** Opening a sub-task stack isolates it (a personal setting; on by default). */
  autoIsolate: boolean
}

export const DEFAULT_BG = '#e8eef7'

const KEY = (sheetId: string) => `nassana.view.${sheetId}`

const isRule = (r: unknown): r is HideRule =>
  !!r && typeof r === 'object' && ['key', 'raw', 'text', 'label'].every((k) => typeof (r as Record<string, unknown>)[k] === 'string')

const isIsolation = (i: unknown): i is Isolation => {
  const o = i as { kind?: unknown; ids?: unknown } | null
  return !!o && typeof o === 'object' && (o.kind === 'mine' || (o.kind === 'tasks' && Array.isArray(o.ids) && o.ids.every((x) => typeof x === 'string')))
}

/** Older versions kept the opened stacks inside `isolate`. */
const legacyStack = (i: unknown): string[] => {
  const o = i as { kind?: unknown; path?: unknown } | null
  return o && o.kind === 'stack' && Array.isArray(o.path) && o.path.every((x) => typeof x === 'string') ? (o.path as string[]) : []
}

const isCamera = (c: unknown): c is Camera =>
  !!c && typeof c === 'object' && ['x', 'y', 'zoom'].every((k) => Number.isFinite((c as Record<string, unknown>)[k]))

const empty = (): ViewState => ({ colorBy: '', hidden: [], only: null, camera: null, showLinks: true, showStamps: true, showChips: true, background: 'dots', bgColor: DEFAULT_BG, showClosed: false, mine: null, isolate: null, stackPath: [], autoIsolate: true })

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
      showStamps: v.showStamps !== false,
      showChips: v.showChips !== false,
      background: v.background === 'color' || v.background === 'empty' ? v.background : 'dots',
      showClosed: v.showClosed === true,
      mine: isRule(v.mine) ? { key: v.mine.key, raw: v.mine.raw, text: v.mine.text, label: v.mine.label } : null,
      isolate: isIsolation(v.isolate) ? v.isolate : null,
      stackPath: Array.isArray(v.stackPath) && v.stackPath.every((x) => typeof x === 'string') ? v.stackPath : legacyStack(v.isolate),
      autoIsolate: v.autoIsolate !== false,
      bgColor: typeof v.bgColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.bgColor) ? v.bgColor : DEFAULT_BG,
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
