import { useCallback, useEffect, useRef, useState } from 'react'
import { Board, type Tool } from './board/Board'
import { simplify } from './board/ink'
import { fitCamera, screenToWorld, zoomAt } from './board/camera'
import { INK_COLORS, NOTE_COLORS, NOTE_SIZE, PEN_WIDTHS } from './constants'
import { demoTasks } from './data'
import { AuthRequiredError, signIn } from './google/auth'
import { pickSheet } from './google/picker'
import {
  appendTask,
  appendStroke,
  applySetupFix,
  deleteStrokes,
  deleteTask,
  fetchDrawing,
  fetchSheet,
  saveTasks,
  SheetError,
  type SetupFix,
  type TaskPatch,
} from './google/sheets'
import { rememberSheet } from './recent'
import type { Camera, Stroke, Task } from './types'

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
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [tool, setTool] = useState<Tool>('none')
  const [penColor, setPenColor] = useState(INK_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS.thin)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  /** Strokes drawn in this session, newest last, for undo. */
  const undoStack = useRef<string[]>([])
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
  const dirty = useRef(new Map<string, { title?: boolean; board?: boolean }>())
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const saving = useRef<Promise<void>>(Promise.resolve())

  const load = useCallback(
    async (background: boolean) => {
      if (!sheetId) return
      if (!background) setStatus({ kind: 'loading' })
      try {
        const [data, drawing] = await Promise.all([
          fetchSheet(sheetId),
          fetchDrawing(sheetId).catch(() => null), // a drawing problem must not hide the notes
        ])
        setTasks(data.tasks)
        setTitle(data.title)
        if (drawing) setStrokes(drawing)
        setWarnings(drawing ? data.warnings : [...data.warnings, 'Could not load the drawing.'])
        setUpdatedAt(new Date())
        setStatus({ kind: 'ready' })
        rememberSheet({ id: sheetId, title: data.title })
        if (!fitted.current) {
          fitted.current = true
          setCamera(
            fitCamera(data.tasks.map((t) => t.board), NOTE_SIZE, window.innerWidth, window.innerHeight),
          )
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
        })
      }
      dirty.current.clear()
      if (patches.length === 0) return
      setSave({ kind: 'saving' })
      try {
        await saveTasks(sheetId, patches)
        const saved = new Set(patches.map((p) => p.id))
        setTasks((ts) => ts.map((t) => (saved.has(t.id) ? { ...t, autoPlaced: false } : t)))
        setSave({ kind: 'saved' })
      } catch (e) {
        for (const [id, d] of pending) dirty.current.set(id, { ...dirty.current.get(id), ...d }) // retry later
        fail(e)
      }
    })
  }, [sheetId, enqueue])

  const markDirty = useCallback(
    (id: string, field: 'title' | 'board') => {
      if (!sheetId) return
      dirty.current.set(id, { ...dirty.current.get(id), [field]: true })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [sheetId, flush],
  )

  const onMoveEnd = useCallback((id: string) => markDirty(id, 'board'), [markDirty])

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

  const onStroke = (points: number[], width: number) => {
    // Simplify at about one screen pixel: the drawing stays smooth and fits in a Sheet cell.
    const eps = 1 / camera.zoom
    const p = simplify(points, eps).map((v) => Math.round(v * 10) / 10)
    const stroke: Stroke = { id: crypto.randomUUID().slice(0, 8), c: penColor, w: Math.round(width * 10) / 10, p }
    setStrokes((ss) => [...ss, stroke])
    undoStack.current.push(stroke.id)
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
    undoStack.current = undoStack.current.filter((id) => !gone.has(id))
  }

  const deleteStrokeRows = (ids: string[]) => {
    if (!sheetId || ids.length === 0) return
    setSave({ kind: 'saving' })
    void enqueue(async () => {
      try {
        await deleteStrokes(sheetId, ids)
        setSave({ kind: 'saved' })
      } catch (e) {
        fail(e)
        void load(true) // bring the strokes back: the Sheet still has them
      }
    })
  }

  const onErase = (ids: string[]) => {
    ids.forEach((id) => erased.current.add(id))
    removeStrokes(ids)
  }

  const onEraseEnd = () => {
    const ids = [...erased.current]
    erased.current.clear()
    deleteStrokeRows(ids)
  }

  const undoStroke = () => {
    const id = undoStack.current[undoStack.current.length - 1]
    if (!id) return
    removeStrokes([id])
    deleteStrokeRows([id])
  }

  const toggleEdit = async () => {
    if (editable) {
      setEditingId(null)
      setSelectedId(null)
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
        onSelect={setSelectedId}
        onRename={onRename}
        onRenameDone={() => setEditingId(null)}
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
            className={tool !== 'none' ? 'primary' : ''}
            aria-label="Draw"
            onClick={() => {
              setSelectedId(null)
              setEditingId(null)
              setTool((t) => (t === 'none' ? 'pen' : 'none'))
            }}
          >
            ✏<span className="label"> Draw</span>
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

      {editable && tool !== 'none' && (
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
