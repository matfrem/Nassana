import { useCallback, useEffect, useState } from 'react'
import { Board } from './board/Board'
import { zoomAt } from './board/camera'
import { demoTasks } from './data'
import type { Camera, Task } from './types'

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(demoTasks)
  const [editable, setEditable] = useState(false)
  const [camera, setCamera] = useState<Camera>(() => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    zoom: 1,
  }))

  const onMove = useCallback((id: string, x: number, y: number) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, board: { ...t.board, x, y } } : t)))
  }, [])

  // Later: write the `board` column to the Sheet.
  const onMoveEnd = useCallback((_id: string) => {}, [])

  const zoomBy = (f: number) =>
    setCamera((c) => zoomAt(c, window.innerWidth / 2, window.innerHeight / 2, c.zoom * f))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditable(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        <strong>Nassana</strong>
        <button className={editable ? 'primary' : ''} onClick={() => setEditable((v) => !v)}>
          {editable ? '✓ Done' : '✎ Edit'}
        </button>
        <span className="sep" />
        <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
        <button onClick={() => setCamera((c) => zoomAt(c, window.innerWidth / 2, window.innerHeight / 2, 1))}>
          {Math.round(camera.zoom * 100)}%
        </button>
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
      </div>
      <div className="badge">{editable ? 'Edit mode' : 'Read-only'}</div>
    </>
  )
}
