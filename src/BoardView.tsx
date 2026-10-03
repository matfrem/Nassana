import { useCallback, useEffect, useRef, useState } from 'react'
import { Board, type Tool } from './board/Board'
import { encodeNoteDrawing, encodeStroke, simplify } from './board/ink'
import { applyZones, centerOf, encodeZone, notesInZone, zoneAt } from './board/zones'
import { fitCamera, fitRect, screenToWorld, zoomAt } from './board/camera'
import { INK_COLORS, NOTE_COLORS, NOTE_SIZE, PEN_WIDTHS, ZONE_COLORS } from './constants'
import { demoTasks } from './data'
import { AuthRequiredError, signIn } from './google/auth'
import { pickSheet } from './google/picker'
import {
  appendBoardRow,
  appendTask,
  appendStroke,
  applySetupFix,
  deleteBoardRows,
  deleteTask,
  fetchBoardData,
  fetchSheet,
  saveTasks,
  SheetError,
  type SetupFix,
  type TaskPatch,
  updateBoardRows,
} from './google/sheets'
import { rememberSheet } from './recent'
import type { Camera, Stroke, Task, Zone } from './types'

export type Source = { kind: 'demo' } | { kind: 'sheet'; id: string }

type Status =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'error'; message: string; fix?: SetupFix }
  | { kind: 'ready' }

const POLL_MS = 30_000
const SAVE_DELAY_MS = 800

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
  const [zones, setZones] = useState<Zone[]>([])
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  /** Zones whose geometry/name/color still has to be written to the Sheet. */
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
  const [tool, setTool] = useState<Tool>('none')
  const [penColor, setPenColor] = useState(INK_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS.thin)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  /** Strokes drawn in this session, newest last, for undo. */
  const undoStack = useRef<{ id: string; noteId?: string }[]>([])
  /** Strokes erased during the current eraser gesture, deleted from the Sheet when it ends. */
  const erased = useRef(new Set<string>())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [camera, setCamera] = useState<Camera>(() =>
    fitCamera(isDemo ? demoTasks().map((t) => t.board) : [], NOTE_SIZE, window.innerWidth, window.innerHeight),
  )
  const fitted = useRef(isDemo)

  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  /** Which cells of which tasks still have to be written to the Sheet. */
  const dirty = useRef(new Map<string, { title?: boolean; board?: boolean; drawing?: boolean; status?: boolean }>())
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const saving = useRef<Promise<void>>(Promise.resolve())

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
        setTitle(data.title)
        if (board) {
          setStrokes(board.strokes)
          setZones(board.zones)
        }
        setWarnings(board ? data.warnings : [...data.warnings, 'Could not load the drawing and zones.'])
        setUpdatedAt(new Date())
        setStatus({ kind: 'ready' })
        rememberSheet({ id: sheetId, title: data.title })
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

  const onMove = useCallback((id: string, x: number, y: number) => {
    setDraggingId(id)
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, board: { ...t.board, x, y } } : t)))
  }, [])

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
        })
      }
      dirty.current.clear()
      const zoneIds = new Set(dirtyZones.current)
      dirtyZones.current.clear()
      const strokeIds = new Set(dirtyStrokes.current)
      dirtyStrokes.current.clear()
      if (patches.length === 0 && zoneIds.size === 0 && strokeIds.size === 0) return
      setSave({ kind: 'saving' })
      try {
        await saveTasks(sheetId, patches)
        await updateBoardRows(sheetId, [
          ...zonesRef.current.filter((z) => zoneIds.has(z.id)).map((z) => ({ id: z.id, data: encodeZone(z) })),
          ...strokesRef.current.filter((st) => strokeIds.has(st.id)).map((st) => ({ id: st.id, data: encodeStroke(st, 0.3) })),
        ])
        const saved = new Set(patches.map((p) => p.id))
        setTasks((ts) => ts.map((t) => (saved.has(t.id) ? { ...t, autoPlaced: false } : t)))
        setSave({ kind: 'saved' })
      } catch (e) {
        for (const [id, d] of pending) dirty.current.set(id, { ...dirty.current.get(id), ...d }) // retry later
        zoneIds.forEach((id) => dirtyZones.current.add(id))
        strokeIds.forEach((id) => dirtyStrokes.current.add(id))
        fail(e)
      }
    })
  }, [sheetId, enqueue])

  const markDirty = useCallback(
    (id: string, field: 'title' | 'board' | 'drawing' | 'status') => {
      if (!sheetId) return
      dirty.current.set(id, { ...dirty.current.get(id), [field]: true })
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
    (id: string) => {
      setDraggingId(null)
      markDirty(id, 'board')
      const task = tasksRef.current.find((t) => t.id === id)
      if (!task) return
      const c = centerOf(task)
      const zone = zoneAt(zonesRef.current, c.x, c.y)
      if (zone && task.status !== zone.name) {
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: zone.name } : t)))
        markDirty(id, 'status')
      }
    },
    [markDirty],
  )

  /** Every note inside the zone takes its name as status (after a rename, resize or new zone). */
  const syncStatuses = (zone: Zone, all: Zone[]) => {
    const inZone = notesInZone(all, zone, tasksRef.current).filter((t) => t.status !== zone.name)
    if (inZone.length === 0) return
    const ids = new Set(inZone.map((t) => t.id))
    setTasks((ts) => ts.map((t) => (ids.has(t.id) ? { ...t, status: zone.name } : t)))
    ids.forEach((id) => markDirty(id, 'status'))
  }

  const patchZone = (id: string, patch: Partial<Zone>) =>
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)))

  const onZoneDragStart = (id: string) => {
    const z = zonesRef.current.find((zz) => zz.id === id)
    if (!z) return
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

  const onZoneRename = (id: string, name: string) => {
    const z = zonesRef.current.find((zz) => zz.id === id)
    if (!z || z.name === name) return
    const renamed = { ...z, name }
    const all = zonesRef.current.map((zz) => (zz.id === id ? renamed : zz))
    setZones(all)
    markZoneDirty(id)
    syncStatuses(renamed, all)
  }

  const onZoneColor = (color: string) => {
    if (!selectedZoneId) return
    patchZone(selectedZoneId, { color })
    markZoneDirty(selectedZoneId)
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
    const [z] = createZones([{ ...rect, name: 'New zone', color: ZONE_COLORS[1] }])
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

  const deleteSelectedZone = () => {
    const zone = zones.find((z) => z.id === selectedZoneId)
    if (!zone) return
    if (!window.confirm(`Delete the zone "${zone.name}"? Its notes stay where they are.`)) return
    setZones((zs) => zs.filter((z) => z.id !== zone.id))
    setSelectedZoneId(null)
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

  const addNote = () => {
    const c = screenToWorld(camera, window.innerWidth / 2, window.innerHeight / 2)
    const { x, y } = freeSpot(tasksRef.current, c.x - NOTE_SIZE / 2, c.y - NOTE_SIZE / 2)
    const task: Task = {
      id: crypto.randomUUID().slice(0, 8),
      title: 'New note',
      board: { x, y, color: NOTE_COLORS[0] },
    }
    setTasks((ts) => [...ts, task])
    setSelectedId(task.id)
    setEditingId(task.id)
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

  const deleteSelected = () => {
    const task = tasks.find((t) => t.id === selectedId)
    if (!task) return
    const label = task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title
    const where = sheetId ? ' and its row in the Sheet' : ''
    if (!window.confirm(`Delete "${label}"${where}?`)) return
    setTasks((ts) => ts.filter((t) => t.id !== task.id))
    setSelectedId(null)
    dirty.current.delete(task.id)
    if (!sheetId) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await deleteTask(sheetId, task.id)
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
      undoStack.current.push({ id: stroke.id, noteId: note.id })
      markDirty(note.id, 'drawing')
      return
    }

    const stroke: Stroke = { ...base, p: simplify(points, eps).map(round1) }
    setStrokes((ss) => [...ss, stroke])
    undoStack.current.push({ id: stroke.id })
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
    undoStack.current = undoStack.current.filter((u) => !gone.has(u.id))
  }

  const removeNoteStrokes = (noteId: string, ids: string[]) => {
    const gone = new Set(ids)
    setTasks((ts) => ts.map((t) => (t.id === noteId ? { ...t, drawing: (t.drawing ?? []).filter((s) => !gone.has(s.id)) } : t)))
    undoStack.current = undoStack.current.filter((u) => !gone.has(u.id))
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

  const onErase = (hits: { id: string; noteId?: string }[]) => {
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
    deleteStrokeRows(ids)
  }

  const undoStroke = () => {
    const last = undoStack.current[undoStack.current.length - 1]
    if (!last) return
    if (last.noteId) return removeNoteStrokes(last.noteId, [last.id])
    removeStrokes([last.id])
    deleteStrokeRows([last.id])
  }

  const toggleEdit = async () => {
    if (editable) {
      setEditingId(null)
      setSelectedId(null)
      setSelectedZoneId(null)
      setEditingZoneId(null)
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
      if (e.key === 'Escape') void toggleEditRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const zoomTo = (f: number | 'reset') =>
    setCamera((c) =>
      zoomAt(c, window.innerWidth / 2, window.innerHeight / 2, f === 'reset' ? 1 : c.zoom * f),
    )

  return (
    <>
      <Board
        tasks={tasks}
        editable={editable}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        selectedId={editable ? selectedId : null}
        editingId={editingId}
        onSelect={(id) => {
          setSelectedId(id)
          setSelectedZoneId(null)
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
        onZoneSelect={(id) => {
          setSelectedZoneId(id)
          setSelectedId(null)
        }}
        onZoneDragStart={onZoneDragStart}
        onZoneDrag={onZoneDrag}
        onZoneDragEnd={onZoneDragEnd}
        onZoneResize={(id, w, h) => patchZone(id, { w, h })}
        onZoneResizeEnd={onZoneResizeEnd}
        onZoneRename={onZoneRename}
        onZoneRenameDone={() => setEditingZoneId(null)}
        onZoneDraw={onZoneDraw}
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
          <button onClick={addNote} aria-label="Add note">
            ＋<span className="label"> Note</span>
          </button>
        )}
        {editable && (
          <button
            className={tool === 'pen' || tool === 'eraser' ? 'primary' : ''}
            aria-label="Draw"
            onClick={() => {
              setSelectedId(null)
              setSelectedZoneId(null)
              setEditingId(null)
              setTool((t) => (t === 'pen' || t === 'eraser' ? 'none' : 'pen'))
            }}
          >
            ✏<span className="label"> Draw</span>
          </button>
        )}
        {editable && (
          <button
            className={tool === 'zone' ? 'primary' : ''}
            aria-label="Zone"
            onClick={() => {
              setSelectedId(null)
              setSelectedZoneId(null)
              setEditingId(null)
              setTool((t) => (t === 'zone' ? 'none' : 'zone'))
            }}
          >
            ▭<span className="label"> Zone</span>
          </button>
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
        <span className="sep" />
        <button onClick={() => zoomTo(1 / 1.25)} aria-label="Zoom out">−</button>
        <button onClick={() => zoomTo('reset')}>{Math.round(camera.zoom * 100)}%</button>
        <button onClick={() => zoomTo(1.25)} aria-label="Zoom in">+</button>
      </div>

      {editable && tool === 'none' && selectedId && !editingId && (
        <div className="selection-bar">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => onColor(c)}
            />
          ))}
          <span className="sep" />
          <button onClick={() => setEditingId(selectedId)}>✎ Rename</button>
          <button className="danger" onClick={deleteSelected}>
            🗑 Delete
          </button>
        </div>
      )}

      {editable && (tool === 'pen' || tool === 'eraser') && (
        <div className="selection-bar draw-bar">
          <button className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')} aria-label="Pen">
            ✏
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
          <button aria-label="Undo" onClick={undoStroke}>
            ↶
          </button>
        </div>
      )}

      {editable && tool === 'zone' && (
        <div className="selection-bar zone-bar">
          <span>Drag on the board to draw a zone</span>
          {zones.length === 0 && <button onClick={addScrumZones}>Add Backlog / In progress / Done</button>}
          <button onClick={() => setTool('none')}>Cancel</button>
        </div>
      )}

      {editable && tool === 'none' && selectedZoneId && !editingZoneId && (
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
          <span className="sep" />
          <button onClick={() => setEditingZoneId(selectedZoneId)}>✎ Rename</button>
          <button className="danger" onClick={deleteSelectedZone}>
            🗑 Delete
          </button>
        </div>
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

      {warnings.length > 0 && <div className="warnings">{warnings.join(' ')}</div>}

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
