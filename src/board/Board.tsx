import { useEffect, useRef, useState } from 'react'
import type { Camera, Stroke, Task } from '../types'
import { clampZoom, screenToWorld, zoomAt } from './camera'
import { hitsStroke } from './ink'
import { Ink } from './Ink'
import { StickyNote } from './StickyNote'

export type Tool = 'none' | 'pen' | 'eraser'

interface Props {
  tasks: Task[]
  editable: boolean
  onMove: (id: string, x: number, y: number) => void
  onMoveEnd: (id: string) => void
  selectedId: string | null
  editingId: string | null
  onSelect: (id: string | null) => void
  onRename: (id: string, title: string) => void
  onRenameDone: () => void
  strokes: Stroke[]
  tool: Tool
  penColor: string
  /** Pen width in screen pixels (converted to world units when the stroke starts). */
  penWidth: number
  /** Called with the finished stroke's points (flat x,y list, world coordinates) and width. */
  onStroke: (points: number[], width: number) => void
  /** Called while erasing, with the ids of the strokes just touched. */
  onErase: (ids: string[]) => void
  onEraseEnd: () => void
  camera: Camera
  setCamera: React.Dispatch<React.SetStateAction<Camera>>
}

const GRID = 40
const TAP_SLOP = 4
const ERASER_RADIUS = 12 // screen px

type Mode = 'idle' | 'pan' | 'draw' | 'erase' | 'pinch'

export function Board({
  tasks,
  editable,
  onMove,
  onMoveEnd,
  selectedId,
  editingId,
  onSelect,
  onRename,
  onRenameDone,
  strokes,
  tool,
  penColor,
  penWidth,
  onStroke,
  onErase,
  onEraseEnd,
  camera,
  setCamera,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const mode = useRef<Mode>('idle')
  const pinch = useRef({ dist: 1, cx: 0, cy: 0 })
  const tap = useRef({ x: 0, y: 0, moved: false })
  const live = useRef<{ pts: number[]; width: number } | null>(null)
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null)
  const [panning, setPanning] = useState(false)

  // The handlers below read the latest camera/strokes without being re-created on every change.
  const camRef = useRef(camera)
  camRef.current = camera
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes

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

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const world = (e: { clientX: number; clientY: number }) => {
    const l = local(e)
    return screenToWorld(camRef.current, l.x, l.y)
  }

  const showLive = () => {
    const l = live.current
    setLiveStroke(l ? { id: 'live', c: penColor, w: l.width, p: l.pts } : null)
  }

  const erase = (e: { clientX: number; clientY: number }) => {
    const w = world(e)
    const r = ERASER_RADIUS / camRef.current.zoom
    const hit = strokesRef.current.filter((s) => hitsStroke(s, w.x, w.y, r)).map((s) => s.id)
    if (hit.length) onErase(hit)
  }

  const cancelGesture = () => {
    if (mode.current === 'erase') onEraseEnd()
    live.current = null
    showLive()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setPanning(true)

    if (pointers.current.size >= 2) {
      // Second finger: whatever was in progress (a stroke, a pan) becomes a pinch/pan gesture.
      cancelGesture()
      mode.current = 'pinch'
      const [a, b] = [...pointers.current.values()]
      const l = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: l.x, cy: l.y }
      return
    }

    tap.current = { x: e.clientX, y: e.clientY, moved: false }
    // Mouse: middle/right button always pans, so you can move around while a tool is active.
    if (e.button !== 0) mode.current = 'pan'
    else if (tool === 'pen') {
      const w = world(e)
      live.current = { pts: [w.x, w.y], width: Math.max(0.5, penWidth / camRef.current.zoom) }
      mode.current = 'draw'
      showLive()
    } else if (tool === 'eraser') {
      mode.current = 'erase'
      erase(e)
    } else mode.current = 'pan'
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)

    if (mode.current === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const ratio = dist / pinch.current.dist
      const c = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      const dx = c.x - pinch.current.cx
      const dy = c.y - pinch.current.cy
      pinch.current = { dist, cx: c.x, cy: c.y }
      // Two fingers do both at once: the midpoint drags the board, the spread zooms around it.
      setCamera((cam) => zoomAt({ ...cam, x: cam.x + dx, y: cam.y + dy }, c.x, c.y, clampZoom(cam.zoom * ratio)))
      return
    }
    if (pointers.current.size !== 1) return // a finger left a pinch: ignore the other until all lift

    if (Math.hypot(cur.x - tap.current.x, cur.y - tap.current.y) > TAP_SLOP) tap.current.moved = true

    if (mode.current === 'draw' && live.current) {
      const w = world(e)
      const pts = live.current.pts
      const last = pts.length - 2
      // Skip points closer than 1 screen pixel: they only add noise and size.
      if (Math.hypot(w.x - pts[last], w.y - pts[last + 1]) * camRef.current.zoom >= 1) {
        live.current = { ...live.current, pts: [...pts, w.x, w.y] }
        showLive()
      }
    } else if (mode.current === 'erase') {
      erase(e)
    } else if (mode.current === 'pan') {
      const dx = cur.x - prev.x
      const dy = cur.y - prev.y
      setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) return // still fingers down: the gesture is not over
    const finished = e.type === 'pointerup'

    if (mode.current === 'draw' && live.current && finished) {
      onStroke(live.current.pts, live.current.width)
    } else if (mode.current === 'erase') {
      onEraseEnd()
    } else if (mode.current === 'pan' && finished && !tap.current.moved) {
      onSelect(null) // a press on the empty background deselects the current note
    }
    live.current = null
    showLive()
    mode.current = 'idle'
    setPanning(false)
  }

  const gridSize = GRID * camera.zoom

  return (
    <div
      ref={ref}
      className="viewport"
      style={{
        cursor: tool !== 'none' ? 'crosshair' : panning ? 'grabbing' : 'grab',
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
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
            editable={editable && tool === 'none'}
            selected={t.id === selectedId}
            editing={t.id === editingId}
            onMove={onMove}
            onMoveEnd={onMoveEnd}
            onSelect={onSelect}
            onRename={onRename}
            onRenameDone={onRenameDone}
          />
        ))}
        <Ink strokes={strokes} live={liveStroke} />
      </div>
    </div>
  )
}
