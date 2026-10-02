import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from './board/Board'
import { fitCamera, zoomAt } from './board/camera'
import { NOTE_SIZE } from './constants'
import { demoTasks } from './data'
import { AuthRequiredError, signIn } from './google/auth'
import { pickSheet } from './google/picker'
import { applySetupFix, fetchSheet, saveBoards, SheetError, type SetupFix } from './google/sheets'
import { rememberSheet } from './recent'
import type { Camera, Task } from './types'

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

export function BoardView({ source }: { source: Source }) {
  const isDemo = source.kind === 'demo'
  const sheetId = source.kind === 'sheet' ? source.id : null

  const [tasks, setTasks] = useState<Task[]>(() => (isDemo ? demoTasks() : []))
  const [title, setTitle] = useState(isDemo ? 'Demo' : '')
  const [warnings, setWarnings] = useState<string[]>([])
  const [status, setStatus] = useState<Status>({ kind: isDemo ? 'ready' : 'loading' })
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [editable, setEditable] = useState(false)
  const [camera, setCamera] = useState<Camera>(() =>
    fitCamera(isDemo ? demoTasks().map((t) => t.board) : [], NOTE_SIZE, window.innerWidth, window.innerHeight),
  )
  const fitted = useRef(isDemo)

  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const dirty = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const saving = useRef<Promise<void>>(Promise.resolve())

  const load = useCallback(
    async (background: boolean) => {
      if (!sheetId) return
      if (!background) setStatus({ kind: 'loading' })
      try {
        const data = await fetchSheet(sheetId)
        setTasks(data.tasks)
        setTitle(data.title)
        setWarnings(data.warnings)
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

  /** Writes pending positions to the Sheet. Calls are chained so writes never overlap. */
  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    if (!sheetId) return Promise.resolve()
    saving.current = saving.current.then(async () => {
      if (dirty.current.size === 0) return
      const ids = new Set(dirty.current)
      dirty.current.clear()
      // Also persist auto-placed notes the first time: otherwise they would jump
      // as soon as other notes get a saved position.
      const items = tasksRef.current.filter((t) => ids.has(t.id) || t.autoPlaced)
      setSave({ kind: 'saving' })
      try {
        await saveBoards(sheetId, items.map((t) => ({ id: t.id, board: t.board })))
        const saved = new Set(items.map((t) => t.id))
        setTasks((ts) => ts.map((t) => (saved.has(t.id) ? { ...t, autoPlaced: false } : t)))
        setSave({ kind: 'saved' })
      } catch (e) {
        ids.forEach((id) => dirty.current.add(id)) // keep them for the next attempt
        setSave({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })
    return saving.current
  }, [sheetId])

  const onMoveEnd = useCallback(
    (id: string) => {
      if (!sheetId) return
      dirty.current.add(id)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [sheetId, flush],
  )

  const toggleEdit = async () => {
    if (editable) {
      await flush() // do not leave edit mode (which resumes polling) with unsaved moves
      setEditable(false)
    } else {
      setSave({ kind: 'idle' })
      setEditable(true)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void flush().then(() => setEditable(false))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

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
        camera={camera}
        setCamera={setCamera}
      />

      <div className="toolbar">
        <a className="brand" href="#/" title="Back to start">
          Nassana
        </a>
        {title && <span className="sheet-title">{title}</span>}
        <span className="sep" />
        <button
          className={editable ? 'primary' : ''}
          onClick={() => void toggleEdit()}
        >
          {editable ? '✓ Done' : '✎ Edit'}
        </button>
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
