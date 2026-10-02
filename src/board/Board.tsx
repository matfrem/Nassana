import { useCallback, useEffect, useRef, useState } from 'react'
import type { Camera, Task } from '../types'
import { clampZoom, zoomAt } from './camera'
import { StickyNote } from './StickyNote'

interface Props {
  tasks: Task[]
  editable: boolean
  onMove: (id: string, x: number, y: number) => void
  onMoveEnd: (id: string) => void
  camera: Camera
  setCamera: React.Dispatch<React.SetStateAction<Camera>>
}

const GRID = 40

export function Board({ tasks, editable, onMove, onMoveEnd, camera, setCamera }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number } | null>(null)
  const [panning, setPanning] = useState(false)

  // Wheel: zoom centered on the cursor (non-passive listener so we can preventDefault).
  useEffect(() => {
    const el = ref.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // ctrl+wheel = trackpad pinch: smaller deltas, so amplify.
      const speed = e.ctrlKey ? 0.01 : 0.0015
      const factor = Math.exp(-e.deltaY * speed)
      setCamera((c) => zoomAt(c, e.clientX - rect.left, e.clientY - rect.top, c.zoom * factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setCamera])

  const onPointerDown = (e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) }
    }
    setPanning(true)
  }

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId)
      if (!prev) return
      const cur = { x: e.clientX, y: e.clientY }
      pointers.current.set(e.pointerId, cur)
      const rect = ref.current!.getBoundingClientRect()

      if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const ratio = dist / pinch.current.dist
        pinch.current.dist = dist
        const cx = (a.x + b.x) / 2 - rect.left
        const cy = (a.y + b.y) / 2 - rect.top
        setCamera((c) => zoomAt(c, cx, cy, clampZoom(c.zoom * ratio)))
      } else if (pointers.current.size === 1) {
        const dx = cur.x - prev.x
        const dy = cur.y - prev.y
        setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
      }
    },
    [setCamera],
  )

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) setPanning(false)
  }

  const gridSize = GRID * camera.zoom

  return (
    <div
      ref={ref}
      className="viewport"
      style={{
        cursor: panning ? 'grabbing' : 'grab',
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {tasks.map((t) => (
          <StickyNote
            key={t.id}
            task={t}
            zoom={camera.zoom}
            editable={editable}
            onMove={onMove}
            onMoveEnd={onMoveEnd}
          />
        ))}
      </div>
    </div>
  )
}
