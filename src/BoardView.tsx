import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from './board/Board'
import { fitCamera, zoomAt } from './board/camera'
import { NOTE_SIZE } from './constants'
import { demoTasks } from './data'
import { AuthRequiredError, signIn } from './google/auth'
import { applySetupFix, fetchSheet, SheetError, type SetupFix } from './google/sheets'
import { rememberSheet } from './recent'
import type { Camera, Task } from './types'

export type Source = { kind: 'demo' } | { kind: 'sheet'; id: string }

type Status =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'error'; message: string; fix?: SetupFix }
  | { kind: 'ready' }

const POLL_MS = 30_000

const FIX_LABEL: Record<SetupFix['kind'], string> = {
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
      await signIn(true) // asks for edit permission; must run inside the click
      await applySetupFix(sheetId, fix)
      await load(false)
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        setStatus({ kind: 'error', message: 'Edit permission was not granted.', fix })
      } else {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  const onMove = useCallback((id: string, x: number, y: number) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, board: { ...t.board, x, y } } : t)))
  }, [])

  // Later: write the `board` column to the Sheet.
  const onMoveEnd = useCallback((_id: string) => {}, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditable(false)
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
          disabled={!isDemo}
          title={isDemo ? undefined : 'Saving to the Sheet is not available yet'}
          onClick={() => setEditable((v) => !v)}
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

      <div className="badge">{editable ? 'Edit mode' : 'Read-only'}</div>

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
                <p>Sign in with Google to read this Sheet.</p>
                <button className="primary" onClick={onSignIn}>
                  Sign in with Google
                </button>
              </>
            )}
            {status.kind === 'error' && (
              <>
                <p className="error">{status.message}</p>
                <div className="row">
                  {status.fix && (
                    <button className="primary" onClick={() => void onFix(status.fix!)}>
                      {FIX_LABEL[status.fix.kind]}
                    </button>
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
