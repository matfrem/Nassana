import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board, type StrokeRef, type Tool } from './board/Board'
import { encodeNoteDrawing, encodeStroke, simplify } from './board/ink'
import { ARROW_MODES, encodeLink } from './board/links'
import { childrenOf, cleanParents, tucked as tuckedNotes, wouldCycle, type Parents } from './board/stacks'
import { applyZones, centerOf, encodeZone, notesInZone, zoneAt, zoneLabel } from './board/zones'
import { fitCamera, fitRect, screenToWorld, zoomAt } from './board/camera'
import { GRID, INK_COLORS, NOTE_COLORS, NOTE_SIZE, PEN_WIDTHS, ZONE_COLORS, ZONE_HEADER } from './constants'
import { demoTasks } from './data'
import { selKey, type SelItem } from './board/Board'
import { ColorPicker } from './ColorPicker'
import { isClosed } from './closed'
import { MySettings } from './MySettings'
import { descendantsOf, goneIds, isolatedSet, stackSet, type Isolation, type MineRule } from './visibility'
import { StampPicker } from './StampPicker'
import { formatStamps, toggledStamps } from './stamps'
import { byFrequency } from './colorUtil'
import { DetailPanel, type LinkRow } from './DetailPanel'
import { ColumnsPage } from './ColumnsPage'
import { ZonePanel } from './ZonePanel'
import {
  buildFields,
  chipFor,
  inkFor,
  rawOf,
  toCell,
  TONE_COLORS,
  type Cell,
  type Chip,
  type Column,
  type Field,
  type FieldMeta,
} from './fields'
import { AuthRequiredError, signIn } from './google/auth'
import { pickSheet } from './google/picker'
import {
  appendBoardRow,
  appendTask,
  appendStroke,
  applySetupFix,
  assignIds,
  colorRowId,
  encodeColor,
  deleteBoardRows,
  deleteTask,
  fetchBoardData,
  fetchFieldMeta,
  fetchSheet,
  saveTasks,
  SheetError,
  type SetupFix,
  type TaskPatch,
  updateBoardRows,
} from './google/sheets'
import { rememberSheet } from './recent'
import { loadView, saveView, type HideRule, type OnlyRule } from './viewState'
import type { Camera, ColorRule, Link, Stroke, Task, Zone } from './types'

export type Source = { kind: 'demo' } | { kind: 'sheet'; id: string }

type Status =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'error'; message: string; fix?: SetupFix }
  | { kind: 'ready' }

/** The task's value for a column; `status` is not a custom column but can be colored and filtered like one. */
const valueOf = (t: Task, key: string) => (key === 'status' ? t.status : t.values?.[key])

const STATUS_FIELD: Field = { key: 'status', label: 'Status', index: -1, shown: false, type: 'text' }

const POLL_MS = 30_000
const SAVE_DELAY_MS = 800

/** Everything that moves together when a member of the multi-selection (or a selected zone's content) is dragged. */
interface Group {
  leader: string
  start: { x: number; y: number }
  notes: Map<string, { x: number; y: number }>
  zones: Map<string, { x: number; y: number }>
  strokes: Map<string, number[]>
  dx: number
  dy: number
}

type UndoOp =
  | { kind: 'add'; ref: { id: string; noteId?: string } }
  | { kind: 'remove'; items: { stroke: Stroke; noteId?: string }[] }
  | { kind: 'move'; ref: { id: string; noteId?: string }; from: number[] }

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }

const FIX_LABEL: Record<Exclude<SetupFix['kind'], 'pick'>, string> = {
  empty: 'Add header row now',
  'no-tab': 'Create Tasks tab now',
  'missing-columns': 'Add missing columns now',
}

/** The free spot closest to (x, y): a note-sized slot that overlaps no existing note. */
function freeSpot(tasks: Task[], x: number, y: number): { x: number; y: number } {
  const gap = NOTE_SIZE + 12
  const free = (px: number, py: number) =>
    tasks.every((t) => Math.abs(t.board.x - px) >= gap || Math.abs(t.board.y - py) >= gap)
  const candidates: { x: number; y: number }[] = []
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) candidates.push({ x: x + i * (NOTE_SIZE + 20), y: y + j * (NOTE_SIZE + 20) })
  }
  candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
  const spot = candidates.find((c) => free(c.x, c.y)) ?? { x, y }
  return { x: Math.round(spot.x), y: Math.round(spot.y) }
}

export function BoardView({ source }: { source: Source }) {
  const isDemo = source.kind === 'demo'
  const sheetId = source.kind === 'sheet' ? source.id : null

  const [tasks, setTasks] = useState<Task[]>(() => (isDemo ? demoTasks() : []))
  const [title, setTitle] = useState(isDemo ? 'Demo' : '')
  const [warnings, setWarnings] = useState<string[]>([])
  const [status, setStatus] = useState<Status>({ kind: isDemo ? 'ready' : 'loading' })
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [editable, setEditable] = useState(false)
  const [columns, setColumns] = useState<Column[]>([])
  const [meta, setMeta] = useState<Record<string, FieldMeta>>({})
  const [detailId, setDetailId] = useState<string | null>(null)
  const [zoneDetailId, setZoneDetailId] = useState<string | null>(null)
  /** This browser's view of this board (color-by, filters, camera), restored on reload. */
  const [savedView] = useState(() => loadView(sheetId))
  /** Quick filter: only notes with this value in this column stay bright. */
  const [filter, setFilterState] = useState<OnlyRule | null>(savedView.only)
  const setFilter = (next: OnlyRule | null | ((prev: OnlyRule | null) => OnlyRule | null)) => {
    const value = typeof next === 'function' ? next(filter) : next
    setFilterState(value)
    saveView(sheetId, { only: value })
  }
  const [colorBy, setColorByState] = useState<string>(savedView.colorBy)
  /** Values hidden from the board, kept across changes of the "color by" column and across reloads. */
  const [hidden, setHidden] = useState<HideRule[]>(savedView.hidden)
  const [viewMenu, setViewMenu] = useState(false)
  const [filterMenu, setFilterMenu] = useState(false)
  const [bgOpen, setBgOpen] = useState(false)
  const [background, setBackgroundState] = useState(savedView.background)
  const [bgColor, setBgColorState] = useState(savedView.bgColor)
  const [moreMenu, setMoreMenu] = useState(false)
  const [stampMenu, setStampMenu] = useState(false)
  /** The details panel is open for the multi-selection. */
  const [multiDetail, setMultiDetail] = useState(false)
  /** Emoji given to columns (board only), by column key; `knownIcons` are the ones that already have a row in `_board`. */
  const [colIcons, setColIcons] = useState<Record<string, string>>({})
  /** Rows of `_board` that already exist for column settings (`colicon:<key>`, `colshow:<key>`). */
  const knownPrefs = useRef(new Set<string>())
  /** Whether a column is shown on notes, by column key: a board setting that wins over a `#` in the header. */
  const [colShown, setColShown] = useState<Record<string, boolean>>({})
  const [showStamps, setShowStampsState] = useState(savedView.showStamps)
  const [showChips, setShowChipsState] = useState(savedView.showChips)
  const [showLinks, setShowLinksState] = useState(savedView.showLinks)
  const setBackground = (kind: 'dots' | 'color' | 'empty') => {
    setBackgroundState(kind)
    saveView(sheetId, { background: kind })
  }
  const setBgColor = (color: string) => {
    setBgColorState(color)
    setBackgroundState('color')
    saveView(sheetId, { bgColor: color, background: 'color' })
  }
  const setShowStamps = (on: boolean) => {
    setShowStampsState(on)
    saveView(sheetId, { showStamps: on })
  }
  const setShowChips = (on: boolean) => {
    setShowChipsState(on)
    saveView(sheetId, { showChips: on })
  }
  const setShowLinks = (on: boolean) => {
    setShowLinksState(on)
    saveView(sheetId, { showLinks: on })
  }
  const [showColumns, setShowColumns] = useState(false)
  const [zones, setZones] = useState<Zone[]>([])
  /** Colors picked in the app, by `key|value`. They win over what the Sheet says. */
  const [colorRules, setColorRules] = useState<Record<string, ColorRule>>({})
  const colorRulesRef = useRef(colorRules)
  colorRulesRef.current = colorRules
  /** Ids of color rows that already exist in the Sheet (to update them rather than append). */
  const knownColors = useRef(new Set<string>())
  const dirtyColors = useRef(new Set<string>())
  const [missingIds, setMissingIds] = useState<{ rows: number[]; column: number }>({ rows: [], column: 0 })
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  /** Zones whose geometry/name/color still has to be written to the Sheet. */
  const [links, setLinks] = useState<Link[]>([])
  const linksRef = useRef(links)
  linksRef.current = links
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  /** Stacks: child id -> parent id, and the parents whose stack is spread open. Both live in the Sheet (`_board`). */
  const parents = useMemo<Parents>(
    () => cleanParents(Object.fromEntries(tasks.flatMap((t) => (t.parent ? [[t.id, t.parent]] : []))), new Set(tasks.map((t) => t.id))),
    [tasks],
  )
  const parentsRef = useRef(parents)

  // ---- what is shown: closed tasks, isolation, "my tasks" ----
  const [showClosed, setShowClosedState] = useState(savedView.showClosed)
  /** "My tasks": the column and value that mean a task is mine (personal: kept in this browser only). */
  const [mine, setMineState] = useState<MineRule | null>(savedView.mine)
  const [isolation, setIsolationState] = useState<Isolation | null>(savedView.isolate)
  const [mySettingsOpen, setMySettingsOpen] = useState(false)
  const [autoIsolate, setAutoIsolateState] = useState(savedView.autoIsolate)
  /** The sub-task stacks opened by "auto isolate": a second isolation, applied on top of the first one. */
  const [stackPath, setStackPathState] = useState<string[]>(savedView.stackPath)
  const isMine = useCallback((t: Task) => !!mine && rawOf(valueOf(t, mine.key)) === mine.raw, [mine])
  const isolated = useMemo(() => isolatedSet(tasks, parents, isolation, isMine, showClosed), [tasks, parents, isolation, isMine, showClosed])
  /** The tasks that are not drawn at all. */
  const stackKept = useMemo(() => stackSet(tasks, parents, stackPath), [tasks, parents, stackPath])
  const goneSet = useMemo(() => goneIds(tasks, showClosed, isolated, stackKept), [tasks, showClosed, isolated, stackKept])
  /** The tasks the legend, the counts and the colors are about: closed ones do not count while hidden. */
  const listTasks = useMemo(() => (showClosed ? tasks : tasks.filter((t) => !isClosed(t))), [tasks, showClosed])
  parentsRef.current = parents
  const [openStacks, setOpenStacks] = useState<Set<string>>(() => new Set())
  const openRef = useRef(openStacks)
  openRef.current = openStacks
  /** True for a moment after a stack opens/closes: notes glide instead of jumping. */
  const [stackAnim, setStackAnim] = useState(false)
  const stackTimer = useRef<ReturnType<typeof setTimeout>>()
  const knownOpen = useRef(new Set<string>())
  /** Links whose options changed, still to be rewritten in the Sheet. */
  const dirtyLinks = useRef(new Set<string>())
  const dirtyZones = useRef(new Set<string>())
  /** While a zone is dragged: where it started and the notes it carries along. */
  const zoneDrag = useRef<{
    x: number
    y: number
    notes: { id: string; x: number; y: number }[]
    strokes: { id: string; p: number[] }[]
  } | null>(null)
  /** Strokes moved along with a zone, still to be rewritten in the Sheet. */
  const dirtyStrokes = useRef(new Set<string>())
  /** The note being dragged right now, to light up the zone it is over. */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  /** The stroke picked with the move tool. */
  const [selectedStroke, setSelectedStroke] = useState<StrokeRef | null>(null)
  const [tool, setTool] = useState<Tool>('none')
  /** The color picker sheet, when open: it edits whatever `onChange` closes over. */
  const [picker, setPicker] = useState<{ title: string; value: string; onChange: (c: string) => void } | null>(null)
  /** Multi-selection (Ctrl/Shift+click, rectangle, Select tool). While it is not empty, the single selections are empty. */
  const [multi, setMulti] = useState<SelItem[]>([])
  const multiRef = useRef(multi)
  multiRef.current = multi
  const multiKeys = useMemo(() => new Set(multi.map(selKey)), [multi])
  const multiKeysRef = useRef(multiKeys)
  multiKeysRef.current = multiKeys
  /** The group being moved (its starting positions), and the functions that move it (defined further down). */
  const group = useRef<Group | null>(null)
  const groupApi = useRef<{ move: (leader: string, x: number, y: number) => void; end: () => void }>({ move: () => {}, end: () => {} })
  const [penColor, setPenColor] = useState(INK_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS.thin)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  /** Drawing actions of this session, newest last, for undo: adding, erasing/deleting and moving strokes. */
  const undoOps = useRef<UndoOp[]>([])
  const [undoLen, setUndoLen] = useState(0)
  const pushUndo = (op: UndoOp) => {
    undoOps.current = [...undoOps.current, op].slice(-100)
    setUndoLen(undoOps.current.length)
  }
  /** Strokes erased during the current eraser gesture, deleted from the Sheet when it ends. */
  const erased = useRef(new Set<string>())
  const erasedItems = useRef<{ stroke: Stroke; noteId?: string }[]>([])
  /** Where the stroke being moved started, so the move can be undone. */
  const moveFrom = useRef<{ id: string; p: number[] } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [camera, setCamera] = useState<Camera>(
    () => savedView.camera ?? fitCamera(isDemo ? demoTasks().map((t) => t.board) : [], NOTE_SIZE, window.innerWidth, window.innerHeight),
  )
  /** The camera is already where it should be (demo, or restored from the saved view): don't fit to the content on load. */
  const fitted = useRef(isDemo || !!savedView.camera)

  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  /** Which cells of which tasks still have to be written to the Sheet. */
  const dirty = useRef(
    new Map<string, { title?: boolean; board?: boolean; drawing?: boolean; status?: boolean; description?: boolean; parent?: boolean; stamps?: boolean; cols?: Set<string> }>(),
  )
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const saving = useRef<Promise<void>>(Promise.resolve())

  // Remember where this browser was looking (not in the demo, and not before the first fit).
  useEffect(() => {
    if (isDemo || status.kind !== 'ready' || !fitted.current) return
    const t = setTimeout(() => saveView(sheetId, { camera }), 400)
    return () => clearTimeout(t)
  }, [camera, status.kind, isDemo, sheetId])

  const load = useCallback(
    async (background: boolean) => {
      if (!sheetId) return
      if (!background) setStatus({ kind: 'loading' })
      try {
        const [data, board] = await Promise.all([
          fetchSheet(sheetId),
          fetchBoardData(sheetId).catch(() => null), // a drawing/zone problem must not hide the notes
        ])
        // The Sheet is the source of truth for statuses: put notes in the zone their status names.
        const tasks = applyZones(data.tasks, board ? board.zones : zonesRef.current)
        setTasks(tasks)
        setColumns(data.columns)
        setMissingIds({ rows: data.missingIdRows, column: data.idColumn })
        setTitle(data.title)
        if (board) {
          setStrokes(board.strokes)
          setZones(board.zones)
          setLinks(board.links)
          knownOpen.current = new Set(board.open)
          setColIcons(board.icons)
          setColShown(board.shown)
          knownPrefs.current = new Set([...Object.keys(board.icons).map((k) => `colicon:${k}`), ...Object.keys(board.shown).map((k) => `colshow:${k}`)])
          if (!background) setOpenStacks(new Set(board.open)) // a read-only viewer's own toggles survive the background refresh
          setColorRules(Object.fromEntries(board.colors.map((c) => [`${c.key}|${c.raw}`, c])))
          knownColors.current = new Set(board.colors.map(colorRowId))
        }
        setWarnings(board ? data.warnings : [...data.warnings, 'Could not load the drawing and zones.'])
        setUpdatedAt(new Date())
        setStatus({ kind: 'ready' })
        rememberSheet({ id: sheetId, title: data.title })
        // Dropdown lists and date formats: read once per (re)load, never on the background poll.
        if (!background) void fetchFieldMeta(sheetId, data.columns, data.tasks.length).then(setMeta)
        if (!fitted.current) {
          fitted.current = true
          setCamera(fitCamera(tasks.map((t) => t.board), NOTE_SIZE, window.innerWidth, window.innerHeight))
        }
      } catch (e) {
        if (background) return // keep showing what we have; the next poll will retry
        if (e instanceof AuthRequiredError) setStatus({ kind: 'signin' })
        else {
          setStatus({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
            fix: e instanceof SheetError ? e.fix : undefined,
          })
        }
      }
    },
    [sheetId],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  // Poll for changes made by others. Never while editing: a refresh would fight an in-flight drag.
  useEffect(() => {
    if (!sheetId || editable || status.kind !== 'ready') return
    const t = setInterval(() => {
      if (!document.hidden) void load(true)
    }, POLL_MS)
    return () => clearInterval(t)
  }, [sheetId, editable, status.kind, load])

  const onSignIn = async () => {
    try {
      await signIn()
      await load(false)
    } catch (e) {
      if (!(e instanceof AuthRequiredError)) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  const onFix = async (fix: SetupFix) => {
    if (!sheetId) return
    setStatus({ kind: 'loading' })
    try {
      await applySetupFix(sheetId, fix)
      await load(false)
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const onPick = async () => {
    if (!sheetId) return
    try {
      const picked = await pickSheet(sheetId)
      if (picked) await load(false)
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e), fix: { kind: 'pick' } })
    }
  }

  /** A dragged note held over another one for half a second becomes its sub-task (unless that would loop). */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dwell = useRef<{ target: string | null; armed: string | null; timer?: ReturnType<typeof setTimeout> }>({ target: null, armed: null })
  const tuckedRef = useRef<Map<string, string>>(new Map())
  const hiddenRef = useRef<(t: Task) => boolean>(() => false)
  const onMove = useCallback((id: string, x: number, y: number) => {
    if (multiKeysRef.current.has(`n:${id}`)) return groupApi.current.move(`n:${id}`, x, y) // a selected note drags the whole selection
    setDraggingId(id)
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, board: { ...t.board, x, y } } : t)))
    const cx = x + NOTE_SIZE / 2
    const cy = y + NOTE_SIZE / 2
    const over = tasksRef.current.find(
      (t) =>
        t.id !== id &&
        !tuckedRef.current.has(t.id) &&
        !hiddenRef.current(t) &&
        cx >= t.board.x && cx <= t.board.x + NOTE_SIZE && cy >= t.board.y && cy <= t.board.y + NOTE_SIZE &&
        parentsRef.current[id] !== t.id &&
        !wouldCycle(parentsRef.current, id, t.id),
    )?.id ?? null
    const d = dwell.current
    if (over === d.target) return
    clearTimeout(d.timer)
    d.target = over
    d.armed = null
    setDropTarget(null)
    if (over) {
      d.timer = setTimeout(() => {
        d.armed = over
        setDropTarget(over)
      }, 500)
    }
  }, [])
  const setParentRef = useRef<(child: string, parent: string | null) => void>(() => {})

  const fail = (e: unknown) =>
    setSave({ kind: 'error', message: e instanceof Error ? e.message : String(e) })

  /** Runs Sheet writes one after the other, so e.g. a rename never races the row's creation. */
  const enqueue = useCallback((job: () => Promise<void>): Promise<void> => {
    saving.current = saving.current.then(job)
    return saving.current
  }, [])

  /** Writes pending changes to the Sheet. */
  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    if (!sheetId) return Promise.resolve()
    return enqueue(async () => {
      const pending = new Map(dirty.current)
      // Also persist auto-placed notes the first time: otherwise they would jump
      // as soon as other notes get a saved position.
      const patches: TaskPatch[] = []
      for (const t of tasksRef.current) {
        const d = pending.get(t.id)
        if (!d && !t.autoPlaced) continue
        patches.push({
          id: t.id,
          title: d?.title ? t.title : undefined,
          board: d?.board || t.autoPlaced ? t.board : undefined,
          drawing: d?.drawing ? (t.drawing ?? []) : undefined,
          status: d?.status ? (t.status ?? '') : undefined,
          description: d?.description ? (t.description ?? '') : undefined,
          parent: d?.parent ? (t.parent ?? '') : undefined,
          stamps: d?.stamps ? formatStamps(t.stamps ?? []) : undefined,
          values: d?.cols ? Object.fromEntries([...d.cols].map((k) => [k, t.values?.[k] ?? ''])) : undefined,
        })
      }
      dirty.current.clear()
      const zoneIds = new Set(dirtyZones.current)
      dirtyZones.current.clear()
      const strokeIds = new Set(dirtyStrokes.current)
      dirtyStrokes.current.clear()
      const linkIds = new Set(dirtyLinks.current)
      dirtyLinks.current.clear()
      const colorIds = new Set(dirtyColors.current)
      dirtyColors.current.clear()
      if (patches.length === 0 && zoneIds.size === 0 && strokeIds.size === 0 && linkIds.size === 0 && colorIds.size === 0) return
      setSave({ kind: 'saving' })
      try {
        await saveTasks(sheetId, patches)
        await updateBoardRows(sheetId, [
          ...zonesRef.current.filter((z) => zoneIds.has(z.id)).map((z) => ({ id: z.id, data: encodeZone(z) })),
          ...strokesRef.current.filter((st) => strokeIds.has(st.id)).map((st) => ({ id: st.id, data: encodeStroke(st, 0.3) })),
          ...linksRef.current.filter((l) => linkIds.has(l.id)).map((l) => ({ id: l.id, data: encodeLink(l) })),
        ])
        // Colors picked in the app: update the row if it exists, otherwise create it.
        for (const rule of Object.values(colorRulesRef.current)) {
          const id = colorRowId(rule)
          if (!colorIds.has(id)) continue
          if (knownColors.current.has(id)) await updateBoardRows(sheetId, [{ id, data: encodeColor(rule) }])
          else {
            await appendBoardRow(sheetId, id, 'color', encodeColor(rule))
            knownColors.current.add(id)
          }
        }
        const saved = new Set(patches.map((p) => p.id))
        setTasks((ts) => ts.map((t) => (saved.has(t.id) ? { ...t, autoPlaced: false } : t)))
        setSave({ kind: 'saved' })
      } catch (e) {
        for (const [id, d] of pending) {
          const now = dirty.current.get(id)
          dirty.current.set(id, { ...now, ...d, cols: new Set([...(now?.cols ?? []), ...(d.cols ?? [])]) }) // retry later
        }
        zoneIds.forEach((id) => dirtyZones.current.add(id))
        strokeIds.forEach((id) => dirtyStrokes.current.add(id))
        linkIds.forEach((id) => dirtyLinks.current.add(id))
        colorIds.forEach((id) => dirtyColors.current.add(id))
        fail(e)
      }
    })
  }, [sheetId, enqueue])

  const markDirty = useCallback(
    (id: string, field: 'title' | 'board' | 'drawing' | 'status' | 'description' | 'parent' | 'stamps') => {
      if (!sheetId) return
      dirty.current.set(id, { ...dirty.current.get(id), [field]: true })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [sheetId, flush],
  )

  /** A custom column of a task changed. */
  const markCol = useCallback(
    (id: string, key: string) => {
      if (!sheetId) return
      const now = dirty.current.get(id)
      dirty.current.set(id, { ...now, cols: new Set([...(now?.cols ?? []), key]) })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [sheetId, flush],
  )

  const markZoneDirty = useCallback(
    (id: string) => {
      if (!sheetId) return
      dirtyZones.current.add(id)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [sheetId, flush],
  )

  /** Dropping a note in a zone gives it that zone's status. Outside every zone, the status is kept. */
  const onMoveEnd = useCallback(
    (id: string, at?: { x: number; y: number }) => {
      if (group.current) return groupApi.current.end()
      setDraggingId(null)
      const d = dwell.current
      clearTimeout(d.timer)
      const adopt = d.armed
      d.target = d.armed = null
      setDropTarget(null)
      markDirty(id, 'board')
      if (adopt) queueMicrotask(() => setParentRef.current(id, adopt))
      const task = tasksRef.current.find((t) => t.id === id)
      if (!task) return
      const c = at ? { x: at.x + NOTE_SIZE / 2, y: at.y + NOTE_SIZE / 2 } : centerOf(task)
      const zone = zoneAt(zonesRef.current, c.x, c.y)
      if (zone && zone.name.trim() && task.status !== zone.name.trim()) {
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: zone.name.trim() } : t)))
        markDirty(id, 'status')
      }
    },
    [markDirty],
  )

  /** Every note inside the zone takes its name as status (after a rename, resize or new zone). */
  const syncStatuses = (zone: Zone, all: Zone[]) => {
    const name = zone.name.trim()
    if (!name) return // a zone being renamed has no status yet: leave the notes alone
    const inZone = notesInZone(all, zone, tasksRef.current).filter((t) => t.status !== name)
    if (inZone.length === 0) return
    const ids = new Set(inZone.map((t) => t.id))
    setTasks((ts) => ts.map((t) => (ids.has(t.id) ? { ...t, status: name } : t)))
    ids.forEach((id) => markDirty(id, 'status'))
  }

  const patchZone = (id: string, patch: Partial<Zone>) =>
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)))

  const onZoneDragStart = (id: string) => {
    const z = zonesRef.current.find((zz) => zz.id === id)
    if (!z) return
    if (multiKeysRef.current.has(`z:${id}`)) return // a selected zone drags the whole selection (see onZoneDrag)
    const carried = notesInZone(zonesRef.current, z, tasksRef.current)
    // Strokes drawn entirely inside the zone travel with it; the ones crossing its border stay.
    const inside = strokesRef.current.filter((st) => {
      for (let i = 0; i < st.p.length; i += 2) {
        if (st.p[i] < z.x || st.p[i] > z.x + z.w || st.p[i + 1] < z.y || st.p[i + 1] > z.y + z.h) return false
      }
      return true
    })
    zoneDrag.current = {
      x: z.x,
      y: z.y,
      notes: carried.map((t) => ({ id: t.id, x: t.board.x, y: t.board.y })),
      strokes: inside.map((st) => ({ id: st.id, p: st.p })),
    }
  }

  const onZoneDrag = (id: string, x: number, y: number) => {
    if (multiKeysRef.current.has(`z:${id}`)) return groupApi.current.move(`z:${id}`, x, y)
    const d = zoneDrag.current
    if (!d) return
    const dx = x - d.x
    const dy = y - d.y
    patchZone(id, { x, y })
    if (d.strokes.length) {
      const moved = new Map(d.strokes.map((st) => [st.id, st.p]))
      setStrokes((ss) =>
        ss.map((st) => {
          const p = moved.get(st.id)
          return p ? { ...st, p: p.map((v, i) => Math.round((v + (i % 2 === 0 ? dx : dy)) * 10) / 10) } : st
        }),
      )
    }
    const carried = new Map(d.notes.map((n) => [n.id, n]))
    // The notes inside move with the zone.
    setTasks((ts) =>
      ts.map((t) => {
        const n = carried.get(t.id)
        return n ? { ...t, board: { ...t.board, x: n.x + dx, y: n.y + dy } } : t
      }),
    )
  }

  const onZoneDragEnd = (id: string) => {
    if (group.current) return groupApi.current.end()
    const d = zoneDrag.current
    zoneDrag.current = null
    markZoneDirty(id)
    d?.notes.forEach((n) => markDirty(n.id, 'board'))
    if (d?.strokes.length) {
      d.strokes.forEach((st) => dirtyStrokes.current.add(st.id))
      markZoneDirty(id) // schedules the flush that writes the strokes too
    }
  }

  const onZoneResizeEnd = (id: string) => {
    markZoneDirty(id)
    const z = zonesRef.current.find((zz) => zz.id === id)
    if (z) syncStatuses(z, zonesRef.current)
  }

  /** Edits the header text only: the status given to notes is unchanged. */
  const onZoneTitle = (id: string, title: string) => {
    const z = zonesRef.current.find((zz) => zz.id === id)
    if (!z) return
    // Committing the status text untouched (shown as the title when there is none) must not turn it into a real title.
    const next = !title.trim() || (!z.title && title.trim() === z.name.trim()) ? undefined : title
    if (next === z.title) return
    patchZone(id, { title: next })
    markZoneDirty(id)
  }

  /** The status this zone gives to the notes in it; every note already inside takes it. */
  const onZoneStatus = (id: string, name: string) => {
    const z = zonesRef.current.find((zz) => zz.id === id)
    if (!z || z.name === name) return
    const renamed = { ...z, name }
    const all = zonesRef.current.map((zz) => (zz.id === id ? renamed : zz))
    setZones(all)
    markZoneDirty(id)
    syncStatuses(renamed, all)
  }

  const onZoneTitleSize = (id: string, titleSize: number) => {
    patchZone(id, { titleSize })
    markZoneDirty(id)
  }

  const onZoneColor = (color: string, id = selectedZoneId) => {
    if (!id) return
    patchZone(id, { color })
    markZoneDirty(id)
  }

  const onZoneLimit = (id: string, limit: number | undefined) => {
    patchZone(id, { limit })
    markZoneDirty(id)
  }

  const createZones = (rects: { x: number; y: number; w: number; h: number; name: string; color: string }[]) => {
    const created: Zone[] = rects.map((r) => ({ id: crypto.randomUUID().slice(0, 8), ...r }))
    const all = [...zonesRef.current, ...created]
    setZones(all)
    created.forEach((z) => syncStatuses(z, all))
    if (!sheetId) return created
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        for (const z of created) await appendBoardRow(sheetId, z.id, 'zone', encodeZone(z))
        setSave({ kind: 'saved' })
      } catch (e) {
        const gone = new Set(created.map((z) => z.id))
        setZones((zs) => zs.filter((z) => !gone.has(z.id)))
        fail(e)
      }
    })
    return created
  }

  const onZoneDraw = (rect: { x: number; y: number; w: number; h: number }) => {
    const [z] = createZones([{ ...rect, name: '', color: ZONE_COLORS[1] }]) // no status yet: it may just group notes
    setTool('none')
    setSelectedId(null)
    setSelectedZoneId(z.id)
    setEditingZoneId(z.id)
  }

  /** Backlog / In progress / Done, side by side, centered in the current view. */
  const addScrumZones = () => {
    const w = 440
    const h = 640
    const gap = 24
    const c = screenToWorld(camera, window.innerWidth / 2, window.innerHeight / 2)
    const x0 = Math.round(c.x - (3 * w + 2 * gap) / 2)
    const y0 = Math.round(c.y - h / 2)
    createZones(
      ['Backlog', 'In progress', 'Done'].map((name, i) => ({
        x: x0 + i * (w + gap),
        y: y0,
        w,
        h,
        name,
        color: ZONE_COLORS[[0, 1, 2][i]],
      })),
    )
    setCamera(fitRect(x0, y0, x0 + 3 * w + 2 * gap, y0 + h, window.innerWidth, window.innerHeight))
    setTool('none')
  }

  /** Statuses written in the Sheet that have no zone yet, in order of appearance. */
  const missingStatuses = useMemo(() => {
    const have = new Set(zones.map((z) => rawOf(z.name)))
    const seen = new Map<string, string>()
    for (const t of tasks) {
      const s = t.status?.trim()
      if (s && !have.has(rawOf(s)) && !seen.has(rawOf(s))) seen.set(rawOf(s), s)
    }
    return [...seen.values()]
  }, [tasks, zones])

  /** One zone for each status that has none, and every note with such a status moved into its zone. */
  const createStatusZones = () => {
    const names = missingStatuses
    if (names.length === 0) return
    const w = 440
    const gap = 24
    const step = NOTE_SIZE + 12
    const isNew = (t: Task) => names.some((n) => rawOf(n) === rawOf(t.status))
    const h = Math.max(
      300,
      ...names.map((n) => ZONE_HEADER + 32 + Math.max(1, Math.ceil(tasksRef.current.filter((t) => rawOf(t.status) === rawOf(n)).length / 2)) * step),
    )
    // Put the row of zones below everything that stays where it is (other notes, existing zones).
    const boxes = [
      ...tasksRef.current.filter((t) => !isNew(t)).map((t) => ({ x: t.board.x, b: t.board.y + NOTE_SIZE })),
      ...zonesRef.current.map((z) => ({ x: z.x, b: z.y + z.h })),
    ]
    const c = screenToWorld(camera, window.innerWidth / 2, window.innerHeight / 2)
    const total = names.length * w + (names.length - 1) * gap
    const x0 = Math.round(boxes.length ? Math.min(...boxes.map((b) => b.x)) : c.x - total / 2)
    const y0 = Math.round(boxes.length ? Math.max(...boxes.map((b) => b.b)) + 80 : c.y - h / 2)
    const created = createZones(
      names.map((name, i) => ({
        x: x0 + i * (w + gap),
        y: y0,
        w,
        h,
        name,
        color: /^#[0-9a-f]{6}$/i.test(colorRulesRef.current[`status|${rawOf(name)}`]?.color ?? '') ? colorRulesRef.current[`status|${rawOf(name)}`].color : ZONE_COLORS[i % ZONE_COLORS.length],
      })),
    )
    // Move the notes into their zones, as if their position had never been set.
    const moved: string[] = []
    const next = tasksRef.current.map((t) => {
      if (!isNew(t)) return t
      moved.push(t.id)
      return { ...t, autoPlaced: true }
    })
    setTasks(applyZones(next, [...zonesRef.current, ...created]))
    moved.forEach((id) => markDirty(id, 'board'))
    setCamera(fitRect(x0, y0, x0 + total, y0 + h, window.innerWidth, window.innerHeight))
    setTool('none')
  }

  const deleteZone = (id: string | null = selectedZoneId) => {
    const zone = zones.find((z) => z.id === id)
    if (!zone) return
    if (!window.confirm(`Delete the zone "${zoneLabel(zone) || 'Untitled zone'}"? Its notes stay where they are.`)) return
    removeZoneNow(zone)
  }

  const removeZoneNow = (zone: Zone) => {
    setZones((zs) => zs.filter((z) => z.id !== zone.id))
    setSelectedZoneId(null)
    setZoneDetailId(null)
    dirtyZones.current.delete(zone.id)
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await deleteBoardRows(sheetId, [zone.id])
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
        void load(true)
      }
    })
  }

  const onRename = useCallback(
    (id: string, newTitle: string) => {
      if (tasksRef.current.find((t) => t.id === id)?.title === newTitle) return
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, title: newTitle } : t)))
      markDirty(id, 'title')
    },
    [markDirty],
  )

  const onColor = (color: string) => {
    if (!selectedId) return
    setTasks((ts) => ts.map((t) => (t.id === selectedId ? { ...t, board: { ...t.board, color } } : t)))
    markDirty(selectedId, 'board')
  }

  const addNote = (parentId?: string) => {
    const c = screenToWorld(camera, window.innerWidth / 2, window.innerHeight / 2)
    const anchor = parentId ? tasksRef.current.find((t) => t.id === parentId) : undefined
    const { x, y } = anchor
      ? freeSpot(tasksRef.current, anchor.board.x + NOTE_SIZE + 20, anchor.board.y)
      : freeSpot(tasksRef.current, c.x - NOTE_SIZE / 2, c.y - NOTE_SIZE / 2)
    const task: Task = {
      id: crypto.randomUUID().slice(0, 8),
      title: 'New note',
      board: { x, y, color: NOTE_COLORS[0] },
      parent: parentId,
      // while isolating "my tasks", a new note is mine (when the rule is about a column we can write)
      values: isolation?.kind === 'mine' && mine && mine.key !== 'status' ? { [mine.key]: mine.text } : undefined,
    }
    joinIsolation([task.id])
    setTasks((ts) => [...ts, task])
    setSelectedId(task.id)
    setEditingId(task.id)
    if (parentId) setStackOpen(parentId, true)
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await appendTask(sheetId, task)
        setSave({ kind: 'saved' })
      } catch (e) {
        setTasks((ts) => ts.filter((t) => t.id !== task.id))
        dirty.current.delete(task.id)
        fail(e)
      }
    })
  }

  /** A copy of the selected note (title, description, status, properties, drawing) in the nearest free spot. */
  const duplicateSelected = () => {
    const src = tasksRef.current.find((t) => t.id === selectedId)
    if (src) duplicateTask(src)
  }

  const duplicateTask = (src: Task) => {
    const id = crypto.randomUUID().slice(0, 8)
    const spot = freeSpot(tasksRef.current, src.board.x, src.board.y)
    const copy: Task = {
      ...src,
      id,
      board: { ...src.board, ...spot },
      autoPlaced: false,
      values: { ...src.values },
      drawing: src.drawing?.map((s, i) => ({ ...s, id: `${id}-${i}`, p: [...s.p] })),
      stamps: src.stamps ? [...src.stamps] : undefined,
    }
    joinIsolation([id])
    setTasks((ts) => [...ts, copy])
    setSelectedId(id)
    setDetailId(null)
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await appendTask(sheetId, copy)
        setSave({ kind: 'saved' })
      } catch (e) {
        setTasks((ts) => ts.filter((t) => t.id !== id))
        fail(e)
      }
    })
  }

  /** Drag from one note to another: a new link, with an arrow pointing at the second note. */
  const onLinkCreate = (from: string, to: string) => {
    if (linksRef.current.some((l) => l.from === from && l.to === to)) return // already linked that way
    const link: Link = { id: crypto.randomUUID().slice(0, 8), from, to, arrow: 'one' }
    setLinks((ls) => [...ls, link])
    setSelectedLinkId(link.id)
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await appendBoardRow(sheetId, link.id, 'link', encodeLink(link))
        setSave({ kind: 'saved' })
      } catch (e) {
        setLinks((ls) => ls.filter((l) => l.id !== link.id))
        fail(e)
      }
    })
  }

  const removeLinks = (ids: string[]) => {
    if (ids.length === 0) return
    const gone = new Set(ids)
    setLinks((ls) => ls.filter((l) => !gone.has(l.id)))
    setSelectedLinkId((s) => (s && gone.has(s) ? null : s))
    ids.forEach((id) => dirtyLinks.current.delete(id))
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await deleteBoardRows(sheetId, ids)
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
        void load(true) // bring the links back: the Sheet still has them
      }
    })
  }

  const toggleLinkArrow = (id: string) => {
    // Cycle: arrow at the end -> arrows at both ends -> plain line.
    setLinks((ls) => ls.map((l) => (l.id === id ? { ...l, arrow: ARROW_MODES[(ARROW_MODES.indexOf(l.arrow) + 1) % ARROW_MODES.length] } : l)))
    if (!sheetId) return
    dirtyLinks.current.add(id)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  const persistOpen = async (id: string, open: boolean) => {
    if (!sheetId || knownOpen.current.has(id) === open) return
    if (open) await appendBoardRow(sheetId, `open:${id}`, 'open', '1')
    else await deleteBoardRows(sheetId, [`open:${id}`])
    if (open) knownOpen.current.add(id)
    else knownOpen.current.delete(id)
  }

  /** Spread a stack open or tuck it away, with a short animation. Shared through the Sheet in Edit mode. */
  const glide = () => {
    clearTimeout(stackTimer.current)
    setStackAnim(true)
    stackTimer.current = setTimeout(() => setStackAnim(false), 450)
  }
  const setStackOpen = (id: string, open: boolean) => {
    glide()
    setOpenStacks((o) => {
      const next = new Set(o)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
    if (!sheetId || !editable) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await persistOpen(id, open)
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
      }
    })
  }
  /** The opened stacks of an "auto isolate" session (empty: leave the mode). Nothing is written to the Sheet. */
  const setStackPath = (path: string[]) => {
    glide()
    setStackPathState(path)
    saveView(sheetId, { stackPath: path })
  }
  const toggleStack = (id: string) => {
    if (stackPath.length) {
      const path = stackPath
      const i = path.indexOf(id)
      if (i >= 0) return setStackPath(path.slice(0, i)) // closing a note leaves it, and everything opened after it
      const top = path[path.length - 1]
      if (id === parentsRef.current[top]) return setStackPath([id]) // the parent shown for context
      if (descendantsOf(parentsRef.current, new Set([top])).has(id)) return setStackPath([...path, id]) // a sub-task: one level deeper
      return
    }
    // "Auto isolate sub-tasks": opening a stack isolates it (on top of whatever isolation is already on)
    if (autoIsolate && !openRef.current.has(id)) return setStackPath([id])
    setStackOpen(id, !openRef.current.has(id))
  }

  /** Make `parent` the parent of the notes (null: detach them). The stack spreads open and each note steps out next to its parent. */
  const setParentMany = (childIds: string[], parent: string | null) => {
    const ok = childIds.filter((c) => !parent || (c !== parent && !wouldCycle(parentsRef.current, c, parent)))
    if (!ok.length) return
    const p = parent ? tasksRef.current.find((t) => t.id === parent) : undefined
    // Place the notes one after the other, so that they do not land on the same free spot.
    const spots = new Map<string, { x: number; y: number }>()
    if (p) {
      let occupied = tasksRef.current
      for (const c of ok) {
        const spot = freeSpot(occupied.filter((t) => t.id !== c), p.board.x + NOTE_SIZE + 20, p.board.y)
        spots.set(c, spot)
        occupied = occupied.map((t) => (t.id === c ? { ...t, board: { ...t.board, ...spot } } : t))
      }
    }
    const set = new Set(ok)
    setTasks((ts) => ts.map((t) => (set.has(t.id) ? { ...t, parent: parent ?? undefined, board: spots.has(t.id) ? { ...t.board, ...spots.get(t.id)! } : t.board } : t)))
    ok.forEach((c) => {
      markDirty(c, 'parent')
      const spot = spots.get(c)
      if (spot) {
        markDirty(c, 'board')
        onMoveEnd(c, spot) // it may have landed in another zone: take that zone's status, like a drop
      }
    })
    if (parent) setStackOpen(parent, true)
  }
  const setParent = (child: string, parent: string | null) => setParentMany([child], parent)

  setParentRef.current = setParent
  // While a stack is isolated, only the stacks opened in that session are open: the shared open/closed state of the others is ignored.
  const stackOpenForBoard = useMemo(() => new Set(stackPath.length ? stackPath : openStacks), [openStacks, stackPath])
  const stackKids = useMemo(() => childrenOf(parents), [parents])
  // A task that is not drawn (closed, isolated out) does not keep its sub-tasks tucked away: they cannot open it.
  const tuckedMap = useMemo(() => tuckedNotes(tasks, parents, new Set([...(stackPath.length ? stackPath : openStacks), ...goneSet])), [tasks, parents, openStacks, goneSet, stackPath])
  tuckedRef.current = tuckedMap

  const deleteSelected = () => {
    const task = tasks.find((t) => t.id === selectedId)
    if (!task) return
    const label = task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title
    const where = sheetId ? ' and its row in the Sheet' : ''
    if (!window.confirm(`Delete "${label}"${where}?`)) return
    deleteTaskNow(task)
  }

  /** Deletes a note, its links, and its row in the Sheet; its sub-tasks move up to its own parent. */
  const deleteTaskNow = (task: Task) => {
    setTasks((ts) => ts.filter((t) => t.id !== task.id))
    setSelectedId(null)
    dirty.current.delete(task.id)
    const linkIds = linksRef.current.filter((l) => l.from === task.id || l.to === task.id).map((l) => l.id)
    setLinks((ls) => ls.filter((l) => !linkIds.includes(l.id)))
    // Its sub-tasks move up to its own parent (or become free notes).
    const up = task.parent
    const orphans = tasksRef.current.filter((t) => t.parent === task.id).map((t) => t.id)
    setTasks((ts) => ts.map((t) => (t.parent === task.id ? { ...t, parent: up } : t)))
    orphans.forEach((id) => markDirty(id, 'parent'))
    setOpenStacks((o) => new Set([...o].filter((x) => x !== task.id)))
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await deleteTask(sheetId, task.id)
        await deleteBoardRows(sheetId, linkIds) // its links go with it
        await persistOpen(task.id, false)
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
        void load(true) // bring the note back: the Sheet still has it
      }
    })
  }

  const onStroke = (points: number[], width: number, noteId: string | null) => {
    // Simplify at about one screen pixel: the drawing stays smooth and fits in a Sheet cell.
    const eps = 1 / camera.zoom
    const round1 = (v: number) => Math.round(v * 10) / 10
    const base = { id: crypto.randomUUID().slice(0, 8), c: penColor, w: round1(width) }

    const note = noteId ? tasksRef.current.find((t) => t.id === noteId) : undefined
    if (note) {
      // A stroke started on a note belongs to it: store it in note coordinates, so it follows the note.
      const local = points.map((v, i) => v - (i % 2 === 0 ? note.board.x : note.board.y))
      const stroke: Stroke = { ...base, p: simplify(local, eps).map(round1) }
      const next = [...(note.drawing ?? []), stroke]
      try {
        encodeNoteDrawing(next, 0.5) // does it fit in the note's cell?
      } catch (e) {
        return fail(e)
      }
      setTasks((ts) => ts.map((t) => (t.id === note.id ? { ...t, drawing: next } : t)))
      pushUndo({ kind: 'add', ref: { id: stroke.id, noteId: note.id } })
      markDirty(note.id, 'drawing')
      return
    }

    const stroke: Stroke = { ...base, p: simplify(points, eps).map(round1) }
    setStrokes((ss) => [...ss, stroke])
    pushUndo({ kind: 'add', ref: { id: stroke.id } })
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await appendStroke(sheetId, stroke, eps)
        setSave({ kind: 'saved' })
      } catch (e) {
        setStrokes((ss) => ss.filter((s) => s.id !== stroke.id))
        fail(e)
      }
    })
  }

  const removeStrokes = (ids: string[]) => {
    const gone = new Set(ids)
    setStrokes((ss) => ss.filter((s) => !gone.has(s.id)))
  }

  const removeNoteStrokes = (noteId: string, ids: string[]) => {
    const gone = new Set(ids)
    setTasks((ts) => ts.map((t) => (t.id === noteId ? { ...t, drawing: (t.drawing ?? []).filter((s) => !gone.has(s.id)) } : t)))
    markDirty(noteId, 'drawing')
  }

  const deleteStrokeRows = (ids: string[]) => {
    if (!sheetId || ids.length === 0) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await deleteBoardRows(sheetId, ids)
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
        void load(true) // bring the strokes back: the Sheet still has them
      }
    })
  }

  const findStroke = (ref: { id: string; noteId?: string }): Stroke | undefined =>
    ref.noteId ? tasksRef.current.find((t) => t.id === ref.noteId)?.drawing?.find((s) => s.id === ref.id) : strokesRef.current.find((s) => s.id === ref.id)

  const setStrokePoints = (ref: { id: string; noteId?: string }, p: number[]) => {
    if (ref.noteId) {
      setTasks((ts) => ts.map((t) => (t.id === ref.noteId ? { ...t, drawing: (t.drawing ?? []).map((s) => (s.id === ref.id ? { ...s, p } : s)) } : t)))
    } else {
      setStrokes((ss) => ss.map((s) => (s.id === ref.id ? { ...s, p } : s)))
    }
  }

  const persistStrokeMove = (ref: { id: string; noteId?: string }) => {
    if (ref.noteId) return markDirty(ref.noteId, 'drawing')
    if (!sheetId) return
    dirtyStrokes.current.add(ref.id)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  const onStrokeMove = (ref: StrokeRef, p: number[]) => {
    if (!ref.noteId && multiKeysRef.current.has(`s:${ref.id}`)) return groupApi.current.move(`s:${ref.id}`, p[0], p[1])
    if (moveFrom.current?.id !== ref.id) {
      const cur = findStroke(ref)
      moveFrom.current = cur ? { id: ref.id, p: [...cur.p] } : null
    }
    setStrokePoints(ref, p)
  }

  const onStrokeMoveEnd = (ref: StrokeRef) => {
    if (group.current) return groupApi.current.end()
    if (moveFrom.current?.id === ref.id) pushUndo({ kind: 'move', ref: { id: ref.id, noteId: ref.noteId }, from: moveFrom.current.p })
    moveFrom.current = null
    persistStrokeMove(ref)
  }

  /** Arrow keys on a picked stroke: moves it by one grid step. A note's stroke may not leave its note entirely. */
  const nudgeStroke = (dx: number, dy: number) => {
    const ref = selectedStroke
    const st = ref && findStroke(ref)
    if (!ref || !st) return
    const p = st.p.map((v, i) => Math.round((v + (i % 2 === 0 ? dx : dy)) * 10) / 10)
    if (ref.noteId) {
      const xs = p.filter((_, i) => i % 2 === 0)
      const ys = p.filter((_, i) => i % 2 === 1)
      if (Math.max(...xs) < 0 || Math.min(...xs) > NOTE_SIZE || Math.max(...ys) < 0 || Math.min(...ys) > NOTE_SIZE) return
    }
    onStrokeMove(ref, p)
    onStrokeMoveEnd(ref)
  }

  const deleteSelectedStroke = () => {
    const ref = selectedStroke
    if (!ref) return
    const stroke = findStroke(ref)
    setSelectedStroke(null)
    if (stroke) pushUndo({ kind: 'remove', items: [{ stroke, noteId: ref.noteId }] })
    if (ref.noteId) return removeNoteStrokes(ref.noteId, [ref.id])
    removeStrokes([ref.id])
    deleteStrokeRows([ref.id])
  }

  const onErase = (hits: { id: string; noteId?: string }[]) => {
    for (const h of hits) {
      const stroke = findStroke(h)
      if (stroke) erasedItems.current.push({ stroke, noteId: h.noteId })
    }
    const boardIds = hits.filter((h) => !h.noteId).map((h) => h.id)
    boardIds.forEach((id) => erased.current.add(id))
    if (boardIds.length) removeStrokes(boardIds)
    const byNote = new Map<string, string[]>()
    for (const h of hits) if (h.noteId) byNote.set(h.noteId, [...(byNote.get(h.noteId) ?? []), h.id])
    byNote.forEach((ids, noteId) => removeNoteStrokes(noteId, ids))
  }

  const onEraseEnd = () => {
    const ids = [...erased.current]
    erased.current.clear()
    if (erasedItems.current.length) pushUndo({ kind: 'remove', items: erasedItems.current })
    erasedItems.current = []
    deleteStrokeRows(ids)
  }

  /** Undoes the last drawing action: a stroke added, erased or deleted, or moved. */
  const undoStroke = () => {
    const op = undoOps.current[undoOps.current.length - 1]
    if (!op) return
    undoOps.current = undoOps.current.slice(0, -1)
    setUndoLen(undoOps.current.length)
    setSelectedStroke(null)
    if (op.kind === 'add') {
      if (op.ref.noteId) return removeNoteStrokes(op.ref.noteId, [op.ref.id])
      removeStrokes([op.ref.id])
      return deleteStrokeRows([op.ref.id])
    }
    if (op.kind === 'move') {
      setStrokePoints(op.ref, op.from)
      return persistStrokeMove(op.ref)
    }
    for (const { stroke, noteId } of op.items) {
      if (noteId) {
        if (!tasksRef.current.some((t) => t.id === noteId)) continue // the note is gone
        setTasks((ts) => ts.map((t) => (t.id === noteId ? { ...t, drawing: [...(t.drawing ?? []), stroke] } : t)))
        markDirty(noteId, 'drawing')
      } else {
        setStrokes((ss) => [...ss, stroke])
        if (sheetId) {
          setSave({ kind: 'saving' })
          void enqueue(async () => {
            try {
              await appendStroke(sheetId, stroke, 0.3)
              setSave({ kind: 'saved' })
            } catch (e) {
              fail(e)
            }
          })
        }
      }
    }
  }

  const toggleEdit = async () => {
    if (editable) {
      setEditingId(null)
      setSelectedId(null)
      setSelectedZoneId(null)
      setEditingZoneId(null)
      setZoneDetailId(null)
      setSelectedStroke(null)
      setSelectedLinkId(null)
      setMulti([])
      setTool('none')
      await flush() // do not leave edit mode (which resumes polling) with unsaved changes
      setEditable(false)
      void load(true) // pick up what others changed while we were editing
    } else {
      setSave({ kind: 'idle' })
      setEditable(true)
    }
  }

  const toggleEditRef = useRef(toggleEdit)
  toggleEditRef.current = toggleEdit

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (multiRef.current.length) setMulti([])
      else void toggleEditRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- properties: fields, pills, filter, color-by ----
  const fields = useMemo(() => buildFields(columns, tasks, meta).map((f) => (colShown[f.key] === undefined ? f : { ...f, shown: colShown[f.key] })), [columns, tasks, meta, colShown])
  const shownFields = useMemo(() => fields.filter((f) => f.shown), [fields])

  /** The links of a note, with the title of the note at the other end. */
  const linksOf = (id: string): LinkRow[] =>
    links.flatMap((l) => {
      if (l.from !== id && l.to !== id) return []
      const other = tasks.find((t) => t.id === (l.from === id ? l.to : l.from))
      return other ? [{ id: l.id, title: other.title, dir: l.from === id ? ('out' as const) : ('in' as const), arrow: l.arrow }] : []
    })

  const hasStatus = tasks.some((t) => t.status) || zones.length > 0

  /** Camera that shows every note and zone. */
  const fitContent = () => {
    setViewMenu(false)
    setFilterMenu(false)
    const xs = [...tasks.flatMap((t) => [t.board.x, t.board.x + NOTE_SIZE]), ...zones.flatMap((z) => [z.x, z.x + z.w])]
    const ys = [...tasks.flatMap((t) => [t.board.y, t.board.y + NOTE_SIZE]), ...zones.flatMap((z) => [z.y, z.y + z.h])]
    if (xs.length) setCamera(fitRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), window.innerWidth, window.innerHeight))
  }

  /** A column's emoji followed by a space (or nothing), for menus and pills. */
  const icon = (key: string) => (colIcons[key] ? `${colIcons[key]} ` : '')

  /** `name (visible/total)` once some values of the column are hidden, so an active filter is visible in the menu. */
  const withCounts = (key: string, label: string) => {
    const values = new Set(listTasks.map((t) => rawOf(valueOf(t, key))).filter(Boolean))
    const hiddenHere = hidden.filter((h) => h.key === key && values.has(h.raw)).length
    return hiddenHere > 0 ? `${label} (${values.size - hiddenHere}/${values.size})` : label
  }

  /** The hidden values, grouped by column: one pill per column instead of one per value. */
  const hiddenGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; count: number }>()
    for (const h of hidden) groups.set(h.key, { key: h.key, label: h.label, count: (groups.get(h.key)?.count ?? 0) + 1 })
    return [...groups.values()]
  }, [hidden])

  /** Rows with a title but no id are invisible to the board: write a fresh id in each (on request). */
  const giveIds = async () => {
    if (!sheetId) return
    const n = missingIds.rows.length
    if (!window.confirm(`${n} row${n === 1 ? ' has' : 's have'} a title but no id, so the board can’t show ${n === 1 ? 'it' : 'them'}.\n\nWrite a new id in ${n === 1 ? 'that row' : 'those rows'}?`)) return
    try {
      await assignIds(sheetId, missingIds.rows, missingIds.column)
      await load(false)
    } catch (e) {
      fail(e)
    }
  }

  const setColorBy = (key: string) => {
    setColorByState(key)
    setFilterMenu(false)
    saveView(sheetId, { colorBy: key })
  }

  /** Color for each distinct value of the "color by" field (tones for priorities, a palette otherwise). */
  const colorScheme = useMemo(() => {
    const f = colorBy === 'status' ? STATUS_FIELD : fields.find((x) => x.key === colorBy)
    if (!f) return null
    const seen = new Map<string, { raw: string; text: string; color: string }>()
    const distinct = [...new Set(listTasks.map((t) => rawOf(valueOf(t, f.key))).filter(Boolean))].sort()
    for (const t of listTasks) {
      const v = valueOf(t, f.key)
      const raw = rawOf(v)
      if (!raw || seen.has(raw)) continue
      const chip = f.key === 'status' ? null : chipFor(f, v)
      const tone = chip?.tone
      seen.set(raw, {
        raw,
        text: chip?.value ?? String(v),
        // In order: a color picked in the app, the zone of that name (status), the Sheet's own color,
        // a tone (priorities), then a palette color.
        color:
          colorRules[`${f.key}|${raw}`]?.color ??
          (f.key === 'status' ? zones.find((z) => rawOf(z.name) === raw)?.color : undefined) ??
          f.colors?.[raw] ??
          (tone ? TONE_COLORS[tone] : NOTE_COLORS[distinct.indexOf(raw) % NOTE_COLORS.length]),
      })
    }
    return { field: f, byRaw: seen }
  }, [fields, colorBy, listTasks, colorRules, zones])

  /** Picks the color of one value of the "color by" column (Edit mode, from the legend). */
  const setValueColor = (key: string, raw: string, color: string) => {
    const rule: ColorRule = { key, raw, color }
    setColorRules((r) => ({ ...r, [`${key}|${raw}`]: rule }))
    if (!sheetId) return
    dirtyColors.current.add(colorRowId(rule))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  /** The color of each value of every dropdown column shown as a pill: the same rules as the legend. */
  const pillColors = useMemo(() => {
    const out = new Map<string, string>()
    for (const f of fields.filter((x) => x.type === 'select')) {
      const distinct = [...new Set(listTasks.map((t) => rawOf(t.values?.[f.key] as Cell)).filter(Boolean))].sort()
      for (const t of listTasks) {
        const chip = chipFor(f, t.values?.[f.key])
        if (!chip || out.has(`${f.key}|${chip.raw}`)) continue
        out.set(
          `${f.key}|${chip.raw}`,
          colorRules[`${f.key}|${chip.raw}`]?.color ?? f.colors?.[chip.raw] ?? (chip.tone ? TONE_COLORS[chip.tone] : NOTE_COLORS[distinct.indexOf(chip.raw) % NOTE_COLORS.length]),
        )
      }
    }
    return out
  }, [fields, listTasks, colorRules])

  const noteView = useCallback(
    (t: Task) => {
      const color = colorScheme ? (colorScheme.byRaw.get(rawOf(valueOf(t, colorScheme.field.key)))?.color ?? '#E5E7EB') : t.board.color
      return {
        chips: shownFields.flatMap((f) => {
          const c = chipFor(f, t.values?.[f.key])
          return c ? [{ ...(f.type === 'select' ? { ...c, color: pillColors.get(`${f.key}|${c.raw}`) } : c), icon: colIcons[f.key] ?? c.icon }] : []
        }),
        dim: filter ? rawOf(valueOf(t, filter.key)) !== filter.raw : false,
        hidden: hidden.some((h) => rawOf(valueOf(t, h.key)) === h.raw),
        gone: goneSet.has(t.id),
        color,
        ink: inkFor(color), // a dark fill from the Sheet needs light text
      }
    },
    [shownFields, filter, colorScheme, hidden, pillColors, colIcons, goneSet],
  )

  hiddenRef.current = (t) => noteView(t).hidden || noteView(t).gone
  const saveHidden = (next: HideRule[]) => {
    setHidden(next)
    saveView(sheetId, { hidden: next })
  }

  /** Hide / show every note that has this value in this column. Several values can be hidden at once. */
  const toggleHidden = (rule: HideRule) =>
    saveHidden(
      hidden.some((h) => h.key === rule.key && h.raw === rule.raw)
        ? hidden.filter((h) => !(h.key === rule.key && h.raw === rule.raw))
        : [...hidden, rule],
    )

  const onChip = (chip: Chip) =>
    setFilter((f) => (f && f.key === chip.key && f.raw === chip.raw ? null : { key: chip.key, raw: chip.raw, text: chip.value, label: chip.label }))

  // The panel edits one note or several: every handler takes the ids of the notes to change.
  const onDescription = (ids: string[], text: string) => {
    const set = new Set(ids)
    setTasks((ts) => ts.map((t) => (set.has(t.id) ? { ...t, description: text || undefined } : t)))
    ids.forEach((id) => markDirty(id, 'description'))
  }

  const onValue = (ids: string[], field: Field, input: string | boolean) => {
    const cell: Cell = toCell(field, input)
    const set = new Set(ids)
    setTasks((ts) =>
      ts.map((t) => {
        if (!set.has(t.id)) return t
        const values = { ...t.values }
        if (cell === '') delete values[field.key]
        else values[field.key] = cell
        return { ...t, values }
      }),
    )
    ids.forEach((id) => markCol(id, field.key))
  }

  /** Changing the status in the panel moves the notes into the zone of that name, like a drop would. */
  const onStatus = (ids: string[], status: string) => {
    const set = new Set(ids)
    const next = tasksRef.current.map((t) => (set.has(t.id) ? { ...t, status: status || undefined, autoPlaced: true } : t))
    setTasks(applyZones(next, zonesRef.current))
    ids.forEach((id) => markDirty(id, 'status'))
  }

  // ---- closed tasks, isolation, my tasks ----
  const setShowClosed = (on: boolean) => {
    setShowClosedState(on)
    saveView(sheetId, { showClosed: on })
  }
  const setIsolation = (iso: Isolation | null) => {
    setIsolationState(iso)
    saveView(sheetId, { isolate: iso })
  }
  /** A rule is complete once it has a value. Forgetting it also ends an isolation that was built on it. */
  const setMine = (rule: MineRule | null) => {
    setMineState(rule)
    saveView(sheetId, { mine: rule })
    if ((!rule || !rule.raw) && isolation?.kind === 'mine') setIsolation(null)
  }
  const mineReady = !!mine && !!mine.raw

  const startIsolation = (iso: Isolation) => {
    setIsolation(iso)
    setMulti([])
    setSelectedId(null)
    setSelectedZoneId(null)
    setDetailId(null)
    setMultiDetail(false)
    setViewMenu(false) // (the camera is left alone: the view is the user's to change)
  }
  /** The notes that are selected: the multi-selection's notes, or the single selected note. */
  const selectedNoteIds = (): string[] => (multi.length ? multi.filter((i) => i.kind === 'note').map((i) => i.id) : selectedId ? [selectedId] : [])
  const isolateSelected = () => {
    const ids = selectedNoteIds()
    if (ids.length) startIsolation({ kind: 'tasks', ids })
  }
  /** A note made while isolating (new, duplicated, pasted) joins the isolation, or it would vanish at once. */
  const joinIsolation = (ids: string[]) => {
    if (isolation?.kind === 'tasks') setIsolation({ kind: 'tasks', ids: [...isolation.ids, ...ids] })
  }

  // ---- multi-selection ----
  const singleItems = (): SelItem[] => [
    ...(selectedId ? [{ kind: 'note' as const, id: selectedId }] : []),
    ...(selectedZoneId ? [{ kind: 'zone' as const, id: selectedZoneId }] : []),
    ...(tool === 'move' && selectedStroke && !selectedStroke.noteId ? [{ kind: 'stroke' as const, id: selectedStroke.id }] : []),
  ]

  const applyMulti = (items: SelItem[]) => {
    const seen = new Set<string>()
    const unique = items.filter((i) => !seen.has(selKey(i)) && seen.add(selKey(i)))
    setMulti(unique)
    if (unique.length) {
      if (detailId || multiDetail) setMultiDetail(true) // an open panel follows the selection
      setSelectedId(null)
      setSelectedZoneId(null)
      setSelectedStroke(null)
      setSelectedLinkId(null)
      setDetailId(null)
      setZoneDetailId(null)
      setEditingId(null)
    }
  }

  /** Ctrl/Shift+click: adds the item to the selection, or removes it when it is already in. */
  const toggleSel = (item: SelItem) => {
    const cur = multiRef.current.length ? multiRef.current : singleItems()
    const k = selKey(item)
    applyMulti(cur.some((i) => selKey(i) === k) ? cur.filter((i) => selKey(i) !== k) : [...cur, item])
  }

  const selectRect = (items: SelItem[], additive: boolean) =>
    applyMulti(additive ? [...(multiRef.current.length ? multiRef.current : singleItems()), ...items] : items)

  /** The notes, zones and strokes that move when the selection moves: the selected ones plus what sits inside selected zones. */
  const buildGroup = (leader: string, start: { x: number; y: number }): Group => {
    const sel = multiRef.current
    const noteIds = new Set(sel.filter((i) => i.kind === 'note').map((i) => i.id))
    const zoneIds = new Set(sel.filter((i) => i.kind === 'zone').map((i) => i.id))
    const strokeIds = new Set(sel.filter((i) => i.kind === 'stroke').map((i) => i.id))
    for (const z of zonesRef.current.filter((zz) => zoneIds.has(zz.id))) {
      notesInZone(zonesRef.current, z, tasksRef.current).forEach((t) => noteIds.add(t.id))
      for (const st of strokesRef.current) {
        let inside = true
        for (let i = 0; i < st.p.length && inside; i += 2) inside = st.p[i] >= z.x && st.p[i] <= z.x + z.w && st.p[i + 1] >= z.y && st.p[i + 1] <= z.y + z.h
        if (inside) strokeIds.add(st.id)
      }
    }
    return {
      leader,
      start,
      notes: new Map(tasksRef.current.filter((t) => noteIds.has(t.id)).map((t) => [t.id, { x: t.board.x, y: t.board.y }])),
      zones: new Map(zonesRef.current.filter((z) => zoneIds.has(z.id)).map((z) => [z.id, { x: z.x, y: z.y }])),
      strokes: new Map(strokesRef.current.filter((st) => strokeIds.has(st.id)).map((st) => [st.id, st.p])),
      dx: 0,
      dy: 0,
    }
  }

  const shiftGroup = (g: Group, dx: number, dy: number) => {
    g.dx = dx
    g.dy = dy
    if (g.notes.size) setTasks((ts) => ts.map((t) => (g.notes.has(t.id) ? { ...t, board: { ...t.board, x: g.notes.get(t.id)!.x + dx, y: g.notes.get(t.id)!.y + dy } } : t)))
    if (g.zones.size) setZones((zs) => zs.map((z) => (g.zones.has(z.id) ? { ...z, x: g.zones.get(z.id)!.x + dx, y: g.zones.get(z.id)!.y + dy } : z)))
    if (g.strokes.size) {
      const r1 = (v: number) => Math.round(v * 10) / 10
      setStrokes((ss) => ss.map((st) => (g.strokes.has(st.id) ? { ...st, p: g.strokes.get(st.id)!.map((v, i) => r1(v + (i % 2 === 0 ? dx : dy))) } : st)))
    }
  }

  /** A member of the selection is being dragged to (x, y) (its own coordinates): everything follows by the same offset. */
  groupApi.current.move = (leaderKey, x, y) => {
    if (!group.current) {
      const kind = leaderKey[0]
      const start =
        kind === 'n'
          ? tasksRef.current.find((t) => `n:${t.id}` === leaderKey)?.board
          : kind === 'z'
            ? zonesRef.current.find((z) => `z:${z.id}` === leaderKey)
            : (() => {
                const p = strokesRef.current.find((st) => `s:${st.id}` === leaderKey)?.p
                return p ? { x: p[0], y: p[1] } : undefined
              })()
      if (!start) return
      group.current = buildGroup(leaderKey, { x: start.x, y: start.y })
    }
    const g = group.current
    shiftGroup(g, x - g.start.x, y - g.start.y)
  }

  /** The drag is over (or an arrow key moved the group): save everything that moved. */
  groupApi.current.end = () => {
    const g = group.current
    group.current = null
    setDraggingId(null)
    if (!g || (g.dx === 0 && g.dy === 0)) return
    g.notes.forEach((p, id) => {
      markDirty(id, 'board')
      onMoveEnd(id, { x: p.x + g.dx, y: p.y + g.dy }) // a note may have landed in another zone
    })
    g.zones.forEach((_, id) => markZoneDirty(id))
    if (g.strokes.size && sheetId) {
      g.strokes.forEach((_, id) => dirtyStrokes.current.add(id))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    }
  }

  /** The Move button: the selection follows a drag made anywhere on the board (offset from where the drag began). */
  const dragSelection = (dx: number, dy: number) => {
    if (!multiRef.current.length) return
    if (!group.current) group.current = buildGroup(selKey(multiRef.current[0]), { x: 0, y: 0 })
    shiftGroup(group.current, dx, dy)
  }

  const moveMulti = (dx: number, dy: number) => {
    if (!multiRef.current.length) return
    const first = multiRef.current[0]
    const key = selKey(first)
    const g = buildGroup(key, { x: 0, y: 0 })
    group.current = g
    shiftGroup(g, dx, dy)
    groupApi.current.end()
  }

  /** The notes the stamp menu acts on: the selected note, or every selected note. */
  const stampTargets = (): string[] =>
    multiRef.current.length ? multiRef.current.filter((i) => i.kind === 'note').map((i) => i.id) : selectedId ? [selectedId] : []

  /** Writes (or removes, with null) one column setting row of `_board`. Runs inside a queued job. */
  const persistPref = async (type: 'colicon' | 'colshow', key: string, value: string | null) => {
    if (!sheetId) return
    const row = `${type}:${key}`
    if (value !== null && knownPrefs.current.has(row)) await updateBoardRows(sheetId, [{ id: row, data: value }])
    else if (value !== null) {
      await appendBoardRow(sheetId, row, type, value)
      knownPrefs.current.add(row)
    } else if (knownPrefs.current.has(row)) {
      await deleteBoardRows(sheetId, [row])
      knownPrefs.current.delete(row)
    }
  }

  const savePrefs = (jobs: (() => Promise<void>)[]) => {
    if (!sheetId || jobs.length === 0) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        for (const j of jobs) await j()
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
      }
    })
  }

  /** Gives a column an emoji ('' removes it): shown before the value in its pills, saved in the board only. */
  const setColumnIcon = (key: string, emoji: string) => {
    setColIcons((c) => {
      const next = { ...c }
      if (emoji) next[key] = emoji
      else delete next[key]
      return next
    })
    savePrefs([() => persistPref('colicon', key, emoji || null)])
  }

  /** Shows or hides a column's pills on notes: a board setting, the Sheet's header is never touched. */
  const setColumnShown = (key: string, shown: boolean) => {
    setColShown((c) => ({ ...c, [key]: shown }))
    savePrefs([() => persistPref('colshow', key, shown ? '1' : '0')])
  }

  /** After the Columns page was applied: new columns shown on notes, and the settings of renamed columns follow them. */
  const onColumnKeys = (shown: [string, boolean][], renames: [string, string][]) => {
    const jobs: (() => Promise<void>)[] = []
    const icons = { ...colIcons }
    const shownNow = { ...colShown }
    for (const [from, to] of renames) {
      if (from === to) continue
      if (icons[from]) {
        icons[to] = icons[from]
        delete icons[from]
        jobs.push(() => persistPref('colicon', to, icons[to]), () => persistPref('colicon', from, null))
      }
      if (shownNow[from] !== undefined) {
        shownNow[to] = shownNow[from]
        delete shownNow[from]
        jobs.push(() => persistPref('colshow', to, shownNow[to] ? '1' : '0'), () => persistPref('colshow', from, null))
      }
    }
    for (const [key, on] of shown) {
      shownNow[key] = on
      jobs.push(() => persistPref('colshow', key, on ? '1' : '0'))
    }
    setColIcons(icons)
    setColShown(shownNow)
    savePrefs(jobs)
  }

  /** Adds the stamp to the notes, or removes it from all of them when they all have it already. */
  const toggleStamp = (stamp: string) => {
    const ids = new Set(stampTargets())
    const targets = tasksRef.current.filter((t) => ids.has(t.id))
    const allHave = targets.length > 0 && targets.every((t) => t.stamps?.includes(stamp))
    setTasks((ts) =>
      ts.map((t) => {
        if (!ids.has(t.id)) return t
        const has = t.stamps?.includes(stamp)
        return allHave === !!has ? { ...t, stamps: toggledStamps(t.stamps, stamp) } : t
      }),
    )
    targets.forEach((t) => markDirty(t.id, 'stamps'))
  }

  const colorMulti = (color: string) => {
    const ids = new Set(multiRef.current.filter((i) => i.kind === 'note').map((i) => i.id))
    setTasks((ts) => ts.map((t) => (ids.has(t.id) ? { ...t, board: { ...t.board, color } } : t)))
    ids.forEach((id) => markDirty(id, 'board'))
  }

  const deleteMulti = () => {
    const sel = multiRef.current
    const notes = sel.filter((i) => i.kind === 'note')
    const zs = sel.filter((i) => i.kind === 'zone')
    const sts = sel.filter((i) => i.kind === 'stroke')
    const parts = [notes.length && `${notes.length} note${notes.length > 1 ? 's' : ''}`, zs.length && `${zs.length} zone${zs.length > 1 ? 's' : ''}`, sts.length && `${sts.length} stroke${sts.length > 1 ? 's' : ''}`].filter(Boolean)
    if (!parts.length || !window.confirm(`Delete ${parts.join(', ')}${notes.length && sheetId ? ' and the rows in the Sheet' : ''}?${zs.length ? ' Notes inside deleted zones stay.' : ''}`)) return
    const stIds = sts.map((i) => i.id)
    const items = stIds.flatMap((id) => {
      const stroke = findStroke({ id })
      return stroke ? [{ stroke }] : []
    })
    if (items.length) pushUndo({ kind: 'remove', items })
    notes.forEach((i) => {
      const t = tasksRef.current.find((tt) => tt.id === i.id)
      if (t) deleteTaskNow(t)
    })
    zs.forEach((i) => {
      const z = zonesRef.current.find((zz) => zz.id === i.id)
      if (z) removeZoneNow(z)
    })
    if (stIds.length) {
      removeStrokes(stIds)
      deleteStrokeRows(stIds)
    }
    setMulti([])
  }

  /** Pastes copies of notes. Several notes keep their layout (placed to the right of the group), their sub-task structure and the links between them. */
  const pasteTasks = (src: Task[]) => {
    if (src.length === 1) return duplicateTask(src[0])
    const ids = new Map(src.map((t) => [t.id, crypto.randomUUID().slice(0, 8)]))
    const width = Math.max(...src.map((t) => t.board.x)) + NOTE_SIZE - Math.min(...src.map((t) => t.board.x))
    const dx = Math.round((width + 60) / GRID) * GRID
    const copies: Task[] = src.map((t) => {
      const id = ids.get(t.id)!
      return {
        ...t,
        id,
        board: { ...t.board, x: t.board.x + dx },
        autoPlaced: false,
        values: { ...t.values },
        drawing: t.drawing?.map((st, i) => ({ ...st, id: `${id}-${i}`, p: [...st.p] })),
        stamps: t.stamps ? [...t.stamps] : undefined,
        parent: t.parent && ids.has(t.parent) ? ids.get(t.parent) : t.parent,
      }
    })
    const newLinks: Link[] = linksRef.current
      .filter((l) => ids.has(l.from) && ids.has(l.to))
      .map((l) => ({ ...l, id: crypto.randomUUID().slice(0, 8), from: ids.get(l.from)!, to: ids.get(l.to)! }))
    joinIsolation(copies.map((c) => c.id))
    setTasks((ts) => [...ts, ...copies])
    setLinks((ls) => [...ls, ...newLinks])
    applyMulti(copies.map((t) => ({ kind: 'note' as const, id: t.id })))
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        for (const c of copies) await appendTask(sheetId, c)
        for (const l of newLinks) await appendBoardRow(sheetId, l.id, 'link', encodeLink(l))
        setSave({ kind: 'saved' })
      } catch (e) {
        const gone = new Set(copies.map((c) => c.id))
        setTasks((ts) => ts.filter((t) => !gone.has(t.id)))
        setLinks((ls) => ls.filter((l) => !newLinks.some((n) => n.id === l.id)))
        fail(e)
      }
    })
  }

  // ---- keyboard (PC): arrows move, Delete deletes, Ctrl+C / Ctrl+V copy and paste, Ctrl+A selects every note ----
  const clipboard = useRef<Task[]>([])
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e) => {
    const el = e.target as HTMLElement | null
    if (!editable || e.defaultPrevented || picker || stampMenu || (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))) return
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const step = arrows[e.key]
    const del = e.key === 'Delete' || e.key === 'Backspace'
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (multi.length && (tool === 'none' || tool === 'select' || tool === 'move' || tool === 'drag')) {
      if (step && !mod) (e.preventDefault(), moveMulti(step[0] * GRID, step[1] * GRID))
      else if (del && !mod) (e.preventDefault(), deleteMulti())
      else if (mod && key === 'c') {
        const ids = new Set(multi.filter((i) => i.kind === 'note').map((i) => i.id))
        const notes = tasksRef.current.filter((t) => ids.has(t.id))
        if (notes.length) (e.preventDefault(), (clipboard.current = notes))
      }
    } else if (tool === 'move' && selectedStroke) {
      if (step) (e.preventDefault(), nudgeStroke(step[0] * GRID, step[1] * GRID))
      else if (del) (e.preventDefault(), deleteSelectedStroke())
    } else if (tool === 'none' && selectedId && !editingId) {
      const task = tasksRef.current.find((t) => t.id === selectedId)
      if (!task) return
      if (step && !mod) {
        e.preventDefault()
        const at = { x: task.board.x + step[0] * GRID, y: task.board.y + step[1] * GRID }
        setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, board: { ...t.board, ...at } } : t)))
        onMoveEnd(task.id, at)
      } else if (del && !mod) {
        e.preventDefault()
        deleteSelected()
      } else if (mod && key === 'c') {
        e.preventDefault()
        clipboard.current = [task]
      }
    }
    if ((tool === 'none' || tool === 'select') && mod && key === 'v' && clipboard.current.length) {
      e.preventDefault()
      pasteTasks(clipboard.current)
    } else if ((tool === 'none' || tool === 'select') && mod && key === 'a' && !editingId) {
      e.preventDefault()
      applyMulti(tasksRef.current.filter((t) => !noteView(t).hidden && !noteView(t).gone && !tuckedRef.current.has(t.id)).map((t) => ({ kind: 'note' as const, id: t.id })))
    }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  useEffect(() => {
    if (tool !== 'none' && tool !== 'select' && tool !== 'move' && tool !== 'drag') setMulti([])
  }, [tool])
  useEffect(() => {
    if (multi.length === 0) {
      setMultiDetail(false)
      setTool((t) => (t === 'drag' ? 'none' : t))
    }
  }, [multi])

  useEffect(() => {
    if (stackPath.length && status.kind === 'ready' && !stackPath.some((id) => tasks.some((t) => t.id === id))) setStackPath([])
  }, [stackPath, tasks, status])

  // A tap anywhere outside an open menu closes it.
  useEffect(() => {
    if (!viewMenu && !moreMenu && !filterMenu) return
    const close = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.menu-anchor')) return
      setViewMenu(false)
      setMoreMenu(false)
      setFilterMenu(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [viewMenu, moreMenu, filterMenu])

  const zoomTo = (f: number | 'reset') =>
    setCamera((c) =>
      zoomAt(c, window.innerWidth / 2, window.innerHeight / 2, f === 'reset' ? 1 : c.zoom * f),
    )

  return (
    <>
      <Board
        tasks={tasks}
        showLinks={showLinks || tool === 'link'}
        showStamps={showStamps}
        showChips={showChips}
        background={{ kind: background, color: bgColor }}
        editable={editable}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        selectedId={editable ? selectedId : null}
        editingId={editingId}
        multiKeys={multiKeys}
        onToggleSel={toggleSel}
        onGroupDrag={dragSelection}
        onGroupDragEnd={() => groupApi.current.end()}
        onSelectRect={selectRect}
        onSelect={(id, additive) => {
          if (id && additive) return toggleSel({ kind: 'note', id })
          setMulti([])
          setSelectedId(id)
          setSelectedZoneId(null)
          setSelectedLinkId(null)
          if (id && (detailId || zoneDetailId || multiDetail)) {
            // A details panel is open: it follows the selection.
            setDetailId(id)
            setZoneDetailId(null)
          }
          if (!id) {
            setDetailId(null)
            setZoneDetailId(null)
          }
        }}
        noteView={noteView}
        stack={{ tucked: tuckedMap, kids: stackKids, open: stackOpenForBoard, animating: stackAnim, onToggle: toggleStack, dropTarget }}
        onChip={onChip}
        onNoteOpen={(id) => {
          setDetailId(id)
          setZoneDetailId(null)
        }}
        onRename={onRename}
        onRenameDone={() => setEditingId(null)}
        zones={zones}
        selectedZoneId={editable && tool === 'none' ? selectedZoneId : null}
        editingZoneId={editingZoneId}
        highlightZoneId={(() => {
          const t = draggingId ? tasks.find((n) => n.id === draggingId) : undefined
          return t ? (zoneAt(zones, centerOf(t).x, centerOf(t).y)?.id ?? null) : null
        })()}
        links={links}
        selectedLinkId={editable && tool === 'none' ? selectedLinkId : null}
        onLinkSelect={(id) => {
          setSelectedLinkId(id)
          setSelectedId(null)
          setSelectedZoneId(null)
        }}
        onLinkCreate={onLinkCreate}
        onZoneOpen={(id) => {
          setZoneDetailId(id)
          setSelectedZoneId(id)
          setSelectedId(null)
          setDetailId(null)
        }}
        onZoneSelect={(id, additive) => {
          if (additive) return toggleSel({ kind: 'zone', id })
          setMulti([])
          setSelectedZoneId(id)
          setSelectedId(null)
          if (detailId || zoneDetailId || multiDetail) {
            setZoneDetailId(id)
            setDetailId(null)
            setMultiDetail(false)
          }
        }}
        onZoneDragStart={onZoneDragStart}
        onZoneDrag={onZoneDrag}
        onZoneDragEnd={onZoneDragEnd}
        onZoneResize={(id, w, h) => patchZone(id, { w, h })}
        onZoneResizeEnd={onZoneResizeEnd}
        onZoneRename={onZoneTitle}
        onZoneRenameDone={() => setEditingZoneId(null)}
        onZoneDraw={onZoneDraw}
        selectedStroke={selectedStroke}
        onStrokeSelect={(ref, additive) => {
          if (ref && !ref.noteId && additive) return toggleSel({ kind: 'stroke', id: ref.id })
          if (ref && !ref.noteId && multiKeysRef.current.has(`s:${ref.id}`)) return // pressing a member keeps the selection: it is about to drag
          setMulti([])
          setSelectedStroke(ref)
        }}
        onStrokeMove={onStrokeMove}
        onStrokeMoveEnd={onStrokeMoveEnd}
        strokes={strokes}
        tool={editable ? tool : 'none'}
        penColor={penColor}
        penWidth={penWidth}
        onStroke={onStroke}
        onErase={onErase}
        onEraseEnd={onEraseEnd}
        camera={camera}
        setCamera={setCamera}
      />

      <div className="toolbar">
        <a className="brand" href="#/" title="Back to start">
          Nassana
        </a>
        {title && <span className="sheet-title">{title}</span>}
        <span className="sep" />
        <button className={editable ? 'primary' : ''} onClick={() => void toggleEdit()}>
          {editable ? (
            <>
              ✓<span className="label"> Done</span>
            </>
          ) : (
            '✎ Edit'
          )}
        </button>
        {editable && (
          <button onClick={() => addNote()} aria-label="Add note">
            ＋<span className="label"> Note</span>
          </button>
        )}
        {editable && (
          <button
            className={tool === 'pen' || tool === 'eraser' || tool === 'move' ? 'primary' : ''}
            aria-label="Draw"
            onClick={() => {
              setSelectedId(null)
              setSelectedZoneId(null)
              setEditingId(null)
              setSelectedStroke(null)
              setTool((t) => (t === 'pen' || t === 'eraser' || t === 'move' ? 'none' : 'pen'))
            }}
          >
            ✏<span className="label"> Draw</span>
          </button>
        )}
        {editable && (
          <button
            className={tool === 'link' ? 'primary' : ''}
            aria-label="Link"
            onClick={() => {
              setSelectedId(null)
              setSelectedZoneId(null)
              setSelectedLinkId(null)
              setEditingId(null)
              setTool((t) => (t === 'link' ? 'none' : 'link'))
            }}
          >
            ⤳<span className="label"> Link</span>
          </button>
        )}
        <span className="menu-anchor">
            <button
              className={tool === 'zone' || tool === 'select' ? 'primary' : ''}
              aria-label="More tools"
              onClick={() => {
                setMoreMenu((v) => !v)
                setViewMenu(false)
                setFilterMenu(false)
              }}
            >
              ⋯
            </button>
            {moreMenu && (
              <div className="menu">
                <strong>More tools</strong>
                {editable && (
                  <>
                <button
                  className={tool === 'zone' ? 'on' : ''}
                  onClick={() => {
                    setMoreMenu(false)
                    setSelectedId(null)
                    setSelectedZoneId(null)
                    setEditingId(null)
                    setTool((t) => (t === 'zone' ? 'none' : 'zone'))
                  }}
                >
                  ▭ Zone
                </button>
                <button
                  className={tool === 'select' ? 'on' : ''}
                  onClick={() => {
                    setMoreMenu(false)
                    setSelectedId(null)
                    setSelectedZoneId(null)
                    setEditingId(null)
                    setTool((t) => (t === 'select' ? 'none' : 'select'))
                  }}
                >
                  ⬚ Select
                </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setMoreMenu(false)
                    setMySettingsOpen(true)
                  }}
                >
                  ⚙ My settings…
                </button>
              </div>
            )}
          </span>
        <span className="menu-anchor">
          <button aria-label="View options" title="View" onClick={() => {
              setViewMenu((v) => !v)
              setFilterMenu(false)
              setMoreMenu(false)
            }}
          >
            👁
          </button>
          {viewMenu && (
            <div className="menu">
              <strong>View</strong>
              <button onClick={fitContent}>⤢ Fit to content</button>
              <button
                onClick={() => {
                  setViewMenu(false)
                  zoomTo('reset')
                }}
              >
                🔍 Zoom 100%
              </button>
              <label className="menu-check">
                <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
                Show links
              </label>
              <label className="menu-check">
                <input type="checkbox" checked={showStamps} onChange={(e) => setShowStamps(e.target.checked)} />
                Show stamps
              </label>
              <label className="menu-check">
                <input type="checkbox" checked={showChips} onChange={(e) => setShowChips(e.target.checked)} />
                Show property chips
              </label>
              <label className="menu-check">
                <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
                Show closed tasks
              </label>
              <button disabled={!editable || selectedNoteIds().length === 0} title={editable ? 'Select tasks first' : 'Selecting tasks needs Edit mode'} onClick={isolateSelected}>
                ◎ Isolate selected tasks
              </button>
              <button
                disabled={!mineReady}
                title={mineReady ? undefined : 'Set which tasks are yours in ⋯ → My settings'}
                onClick={() => mine && startIsolation({ kind: 'mine' })}
              >
                ◎ Isolate my tasks
              </button>
              <button aria-expanded={bgOpen} onClick={() => setBgOpen((o) => !o)}>
                {bgOpen ? '▾' : '▸'} Show background
              </button>
              {bgOpen && (
                <div className="submenu">
                  <button className={background === 'dots' ? 'on' : ''} onClick={() => setBackground('dots')}>
                    Dots
                  </button>
                  <button
                    className={background === 'color' ? 'on' : ''}
                    onClick={() => {
                      const prevKind = background
                      const prevColor = bgColor
                      setBackground('color')
                      setViewMenu(false)
                      // Cancel puts the previous color (and the previous kind of background) back.
                      setPicker({ title: 'Background color', value: bgColor, onChange: (c) => (c === prevColor && prevKind !== 'color' ? setBackground(prevKind) : setBgColor(c)) })
                    }}
                  >
                    Color…
                  </button>
                  <button className={background === 'empty' ? 'on' : ''} onClick={() => setBackground('empty')}>
                    Empty
                  </button>
                </div>
              )}
            </div>
          )}
        </span>
        {(fields.length > 0 || hasStatus || !!sheetId) && (
          <span className="menu-anchor">
            <button aria-label="Filter options" title="Filter" className={colorBy ? 'primary' : ''} onClick={() => {
                setFilterMenu((v) => !v)
                setViewMenu(false)
                setMoreMenu(false)
              }}
            >
              ◐
            </button>
            {filterMenu && (
              <div className="menu">
                {(fields.length > 0 || hasStatus) && (
                  <>
                    <strong>Color notes by</strong>
                    <button className={!colorBy ? 'on' : ''} onClick={() => setColorBy('')}>
                      Manual color
                    </button>
                    {hasStatus && (
                      <button className={colorBy === 'status' ? 'on' : ''} onClick={() => setColorBy('status')}>
                        {withCounts('status', 'Status')}
                      </button>
                    )}
                    {fields.map((f) => (
                      <button key={f.key} className={colorBy === f.key ? 'on' : ''} onClick={() => setColorBy(f.key)}>
                        {icon(f.key)}
                        {withCounts(f.key, f.label)}
                      </button>
                    ))}
                  </>
                )}
                {editable && sheetId && (
                  <>
                    <strong>Sheet</strong>
                    <button
                      onClick={() => {
                        setFilterMenu(false)
                        setShowColumns(true)
                      }}
                    >
                      ⚙ Edit columns…
                    </button>
                  </>
                )}
              </div>
            )}
          </span>
        )}
        {sheetId && (
          <button
            aria-label="Refresh"
            title={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Refresh'}
            onClick={() => void load(false)}
          >
            ↻
          </button>
        )}
      </div>

      {isolation && (
        <div className="selection-bar zone-bar isolate-bar">
          <span>
            {isolation.kind === 'mine' && mine
              ? `Isolated: my tasks (${mine.label} = ${mine.text})`
              : `Isolated: ${isolation.kind === 'tasks' ? isolation.ids.length : 0} task${isolation.kind === 'tasks' && isolation.ids.length === 1 ? '' : 's'}`}
          </span>
          <button onClick={() => setIsolation(null)}>Cancel isolate mode</button>
        </div>
      )}

      {stackPath.length > 0 && (
        <div className={`selection-bar zone-bar isolate-bar stack-bar${isolation ? ' second' : ''}`}>
          <span>{`Sub-tasks of “${tasks.find((t) => t.id === stackPath[stackPath.length - 1])?.title ?? ''}”`}</span>
          <button aria-label="Close up" onClick={() => setStackPath(stackPath.slice(0, -1))}>
            ↑ Close up
          </button>
          <button onClick={() => setStackPath([])}>Cancel sub-task isolation</button>
        </div>
      )}

      {mySettingsOpen && (
        <MySettings
          columns={[{ key: 'status', label: 'Status' }, ...fields.map((f) => ({ key: f.key, label: f.label, icon: colIcons[f.key] }))]}
          valuesFor={(key) => {
            const seen = new Map<string, string>()
            for (const t of tasks) {
              const v = valueOf(t, key)
              const raw = rawOf(v)
              if (raw && !seen.has(raw)) seen.set(raw, String(v).trim())
            }
            for (const o of fields.find((f) => f.key === key)?.options ?? []) if (!seen.has(rawOf(o))) seen.set(rawOf(o), o)
            return [...seen.entries()].map(([raw, text]) => ({ raw, text })).sort((a, b) => a.text.localeCompare(b.text))
          }}
          mine={mine}
          onChange={setMine}
          autoIsolate={autoIsolate}
          onAutoIsolate={(on) => {
            setAutoIsolateState(on)
            saveView(sheetId, { autoIsolate: on })
          }}
          onClose={() => setMySettingsOpen(false)}
        />
      )}

      {editable && tool !== 'select' && multi.length > 0 && !editingId && (
        <div className="selection-bar">
          <span className="multi-count">{multi.length} selected</span>
          <button className={tool === 'drag' ? 'active' : ''} aria-pressed={tool === 'drag'} aria-label="Move selection" onClick={() => setTool((t) => (t === 'drag' ? 'none' : 'drag'))}>
            ✥ Move
          </button>
          {multi.some((i) => i.kind === 'note') && (
            <>
              {!colorBy && (
                <>
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => colorMulti(c)}
                />
              ))}
              <button
                className="more-colors"
                aria-label="More colors"
                onClick={() => {
                  const first = tasks.find((t) => multi.some((i) => i.kind === 'note' && i.id === t.id))
                  setPicker({ title: 'Color of the selected notes', value: first?.board.color ?? NOTE_COLORS[0], onChange: colorMulti })
                }}
              >
                🎨
              </button>
                </>
              )}
              <span className="sep" />
              <button onClick={() => setMultiDetail(true)}>☰ Details</button>
              {multi.some((i) => i.kind === 'note' && tasks.find((t) => t.id === i.id)?.parent) && (
                <button
                  aria-label="Unparent"
                  onClick={() => setParentMany(multi.filter((i) => i.kind === 'note' && tasks.find((t) => t.id === i.id)?.parent).map((i) => i.id), null)}
                >
                  ⇱ Unparent
                </button>
              )}
              <button aria-label="Stamps" onClick={() => setStampMenu(true)}>
                ★ Stamps
              </button>
              <button
                aria-label="Duplicate"
                onClick={() => {
                  const ids = new Set(multi.filter((i) => i.kind === 'note').map((i) => i.id))
                  pasteTasks(tasks.filter((t) => ids.has(t.id)))
                }}
              >
                ⧉ Duplicate
              </button>
            </>
          )}
          <button className="danger" aria-label="Delete selection" onClick={deleteMulti}>
            🗑 Delete
          </button>
          <button aria-label="Clear selection" onClick={() => setMulti([])}>
            ✕
          </button>
        </div>
      )}

      {editable && tool === 'select' && (
        <div className="selection-bar zone-bar">
          <span>{multi.length ? `${multi.length} selected. Tap a note, zone or drawing to add or remove it; Done to act on them` : 'Drag a rectangle to select; tap a note, zone or drawing to add it'}</span>
          <button onClick={() => setTool('none')}>Done</button>
        </div>
      )}

      {editable && tool === 'none' && selectedId && !editingId && !detailId && (
        <div className="selection-bar">
          {!colorBy && (
            <>
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => onColor(c)}
            />
          ))}
          <button
            className="more-colors"
            aria-label="More colors"
            onClick={() => setPicker({ title: 'Note color', value: tasks.find((t) => t.id === selectedId)?.board.color ?? NOTE_COLORS[0], onChange: onColor })}
          >
            🎨
          </button>
            </>
          )}
          <span className="sep" />
          <button onClick={() => setDetailId(selectedId)}>☰ Details</button>
          <button onClick={() => addNote(selectedId)} aria-label="Add sub-task">
            ＋ Sub-task
          </button>
          {tasks.find((t) => t.id === selectedId)?.parent && (
            <button onClick={() => setParent(selectedId, null)} aria-label="Unparent">
              ⇱ Unparent
            </button>
          )}
          <button onClick={() => setStampMenu(true)} aria-label="Stamps">
            ★ Stamps
          </button>
          <button onClick={duplicateSelected} aria-label="Duplicate">
            ⧉ Duplicate
          </button>
          <button className="danger" onClick={deleteSelected}>
            🗑 Delete
          </button>
        </div>
      )}

      {editable && (tool === 'pen' || tool === 'eraser' || tool === 'move') && (
        <div className="selection-bar draw-bar">
          <button className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')} aria-label="Pen">
            ✏
          </button>
          <button className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')} aria-label="Move">
            ✥
          </button>
          <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} aria-label="Eraser">
            ⌫
          </button>
          <span className="sep" />
          {INK_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch${c === penColor && tool === 'pen' ? ' on' : ''}`}
              style={{ background: c }}
              aria-label={`Ink ${c}`}
              onClick={() => {
                setPenColor(c)
                setTool('pen')
              }}
            />
          ))}
          <span className="sep" />
          <button
            className={penWidth === PEN_WIDTHS.thin ? 'active' : ''}
            aria-label="Thin"
            onClick={() => {
              setPenWidth(PEN_WIDTHS.thin)
              setTool('pen')
            }}
          >
            <span className="dot thin" />
          </button>
          <button
            className={penWidth === PEN_WIDTHS.thick ? 'active' : ''}
            aria-label="Thick"
            onClick={() => {
              setPenWidth(PEN_WIDTHS.thick)
              setTool('pen')
            }}
          >
            <span className="dot thick" />
          </button>
          <span className="sep" />
          {tool === 'move' && selectedStroke && (
            <button className="danger" aria-label="Delete stroke" onClick={deleteSelectedStroke}>
              🗑
            </button>
          )}
          <button aria-label="Undo" disabled={undoLen === 0} onClick={undoStroke}>
            ↶
          </button>
        </div>
      )}

      {editable && tool === 'link' && (
        <div className="selection-bar zone-bar">
          <span>Drag from one note to another to link them</span>
          <button onClick={() => setTool('none')}>Done</button>
        </div>
      )}

      {editable && tool === 'none' && selectedLinkId && (
        <div className="selection-bar">
          <button onClick={() => toggleLinkArrow(selectedLinkId)}>
            {{ one: '→ Arrow', both: '↔ Both ways', none: '— No arrow' }[links.find((l) => l.id === selectedLinkId)?.arrow ?? 'one']}
          </button>
          <button className="danger" onClick={() => removeLinks([selectedLinkId])}>
            🗑 Delete link
          </button>
        </div>
      )}

      {editable && tool === 'zone' && (
        <div className="selection-bar zone-bar">
          <span>Drag on the board to draw a zone</span>
          {missingStatuses.length > 0 && (
            <button onClick={createStatusZones}>
              One zone per status ({missingStatuses.length})
            </button>
          )}
          {zones.length === 0 && missingStatuses.length === 0 && <button onClick={addScrumZones}>Add Backlog / In progress / Done</button>}
          <button onClick={() => setTool('none')}>Cancel</button>
        </div>
      )}

      {editable && tool === 'none' && selectedZoneId && !editingZoneId && !zoneDetailId && (
        <div className="selection-bar">
          {ZONE_COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              aria-label={`Zone color ${c}`}
              onClick={() => onZoneColor(c)}
            />
          ))}
          <button
            className="more-colors"
            aria-label="More colors"
            onClick={() => {
              const id = selectedZoneId
              setPicker({ title: 'Zone color', value: zones.find((z) => z.id === id)?.color ?? ZONE_COLORS[0], onChange: (c) => onZoneColor(c, id) })
            }}
          >
            🎨
          </button>
          <span className="sep" />
          <button onClick={() => setZoneDetailId(selectedZoneId)}>☰ Details</button>
          <button className="danger" onClick={() => deleteZone()}>
            🗑 Delete
          </button>
        </div>
      )}

      {(colorScheme || filter || hidden.length > 0) && (
        <div className="viewbar">
          {colorScheme &&
            [...colorScheme.byRaw.values()].map((v) => (
              <span className="legend-item" key={v.raw}>
                <button
                  className={hidden.some((h) => h.key === colorScheme.field.key && h.raw === v.raw) ? 'off' : ''}
                  aria-pressed={!hidden.some((h) => h.key === colorScheme.field.key && h.raw === v.raw)}
                  onClick={() => toggleHidden({ key: colorScheme.field.key, raw: v.raw, text: v.text, label: colorScheme.field.label })}
                >
                  {editable ? null : <span className="dot" style={{ background: v.color }} />}
                  {editable && <span className="dot-slot" />}
                  {v.text}
                </button>
                {editable && (
                  <button
                    className="dot-input"
                    aria-label={`Color of ${v.text}`}
                    style={{ background: v.color }}
                    onClick={() =>
                      setPicker({ title: `Color of ${v.text}`, value: v.color, onChange: (c) => setValueColor(colorScheme.field.key, v.raw, c) })
                    }
                  />
                )}
              </span>
            ))}
          {filter && (
            <button className="filter" onClick={() => setFilter(null)}>
              Only {icon(filter.key)}{filter.label}: {filter.text} ✕
            </button>
          )}
          {/* Hidden values of other columns are not in the legend: one pill per column keeps the bar short. */}
          {hiddenGroups
            .filter((g) => g.key !== colorScheme?.field.key)
            .map((g) => (
              <button className="filter" key={g.key} onClick={() => saveHidden(hidden.filter((h) => h.key !== g.key))}>
                {icon(g.key)}{g.label}: {g.count} hidden ✕
              </button>
            ))}
          {hidden.length > 1 && (
            <button className="filter" onClick={() => saveHidden([])}>
              Show all
            </button>
          )}
        </div>
      )}

      {showColumns && sheetId && (
        <ColumnsPage
          sheetId={sheetId}
          fields={fields}
          tasks={tasks}
          icons={colIcons}
          onIcon={setColumnIcon}
          onShown={setColumnShown}
          onKeys={onColumnKeys}
          onClose={() => setShowColumns(false)}
          onApplied={() => {
            setShowColumns(false)
            void saving.current.then(() => load(false)) // columns changed in the Sheet (and their board settings saved): read everything again
          }}
        />
      )}

      {zoneDetailId && zones.find((z) => z.id === zoneDetailId) && (
        <ZonePanel
          zone={zones.find((z) => z.id === zoneDetailId)!}
          count={notesInZone(zones, zones.find((z) => z.id === zoneDetailId)!, tasks).length}
          onClose={() => setZoneDetailId(null)}
          onTitle={onZoneTitle}
          onStatus={onZoneStatus}
          onTitleSize={onZoneTitleSize}
          onColor={(id, c) => onZoneColor(c, id)}
          onLimit={onZoneLimit}
          onDelete={deleteZone}
          onMoreColors={() => {
            const id = zoneDetailId
            setPicker({ title: 'Zone color', value: zones.find((z) => z.id === id)?.color ?? ZONE_COLORS[0], onChange: (c) => onZoneColor(c, id) })
          }}
        />
      )}

      {(() => {
        const noteIds = multiDetail ? multi.filter((i) => i.kind === 'note').map((i) => i.id) : detailId ? [detailId] : []
        const shown = noteIds.flatMap((id) => tasks.find((t) => t.id === id) ?? [])
        if (!shown.length) return null
        const idSet = new Set(shown.map((t) => t.id))
        const first = shown[0]
        return (
          <DetailPanel
            tasks={shown}
            fields={fields}
            zoneNames={zones.map((z) => z.name).filter(Boolean)}
            editable={editable}
            onClose={() => (multiDetail ? setMultiDetail(false) : setDetailId(null))}
            onTitle={onRename}
            onDescription={onDescription}
            onStatus={onStatus}
            onValue={onValue}
            parentId={parents[first.id] ?? null}
            parentDiffers={shown.some((t) => (parents[t.id] ?? null) !== (parents[first.id] ?? null))}
            icons={colIcons}
            colorOf={(key, value) => pillColors.get(`${key}|${rawOf(value)}`)}
            parentChoices={tasks.filter((t) => !idSet.has(t.id) && shown.every((c) => !wouldCycle(parents, c.id, t.id))).map((t) => ({ id: t.id, title: t.title }))}
            onParent={setParentMany}
            subtasks={(stackKids.get(first.id) ?? []).length}
            links={shown.length === 1 ? linksOf(first.id) : []}
            onRemoveLink={(id) => removeLinks([id])}
          />
        )
      })()}

      {stampMenu && (() => {
        const ids = new Set(stampTargets())
        const targets = tasks.filter((t) => ids.has(t.id))
        const all = new Set(targets.length ? (targets[0].stamps ?? []).filter((id) => targets.every((t) => t.stamps?.includes(id))) : [])
        const some = new Set(targets.flatMap((t) => t.stamps ?? []))
        return <StampPicker title={targets.length > 1 ? `Stamps for ${targets.length} notes` : 'Stamps'} active={all} some={some} onToggle={toggleStamp} onClose={() => setStampMenu(false)} />
      })()}

      {picker && (
        <ColorPicker
          title={picker.title}
          value={picker.value}
          boardColors={byFrequency([...tasks.map((t) => t.board.color), ...zones.map((z) => z.color), ...Object.values(colorRules).map((r) => r.color)])}
          onChange={picker.onChange}
          onClose={() => setPicker(null)}
        />
      )}

      <div className={`badge${save.kind === 'error' ? ' badge-error' : ''}`}>
        {save.kind === 'error' ? (
          <>
            {save.message} <button onClick={() => void flush()}>Retry</button>
          </>
        ) : save.kind === 'saving' ? (
          'Saving…'
        ) : save.kind === 'saved' ? (
          'Saved ✓'
        ) : editable ? (
          'Edit mode'
        ) : (
          'Read-only'
        )}
      </div>

      {status.kind === 'ready' && tasks.length === 0 && (
        <div className="empty-hint">No tasks yet. Add rows with an id and a title in the Sheet, then refresh.</div>
      )}

      {warnings.length > 0 && (
        <div className="warnings">
          {warnings.join(' ')}
          {sheetId && missingIds.rows.length > 0 && (
            <button onClick={() => void giveIds()}>Give them an id</button>
          )}
        </div>
      )}

      {status.kind !== 'ready' && (
        <div className="overlay">
          <div className="card">
            {status.kind === 'loading' && <p>Loading sheet…</p>}
            {status.kind === 'signin' && (
              <>
                <p>Sign in with Google to open this Sheet.</p>
                <button className="primary" onClick={onSignIn}>
                  Sign in with Google
                </button>
              </>
            )}
            {status.kind === 'error' && (
              <>
                <p className="error">{status.message}</p>
                <div className="row">
                  {status.fix?.kind === 'pick' ? (
                    <button className="primary" onClick={() => void onPick()}>
                      Choose this Sheet
                    </button>
                  ) : (
                    status.fix && (
                      <button className="primary" onClick={() => void onFix(status.fix!)}>
                        {FIX_LABEL[status.fix.kind]}
                      </button>
                    )
                  )}
                  <button onClick={() => void load(false)}>Retry</button>
                  <a className="button" href="#/">
                    Back
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
