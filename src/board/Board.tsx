import { useEffect, useMemo, useRef, useState } from 'react'
import { NOTE_SIZE } from '../constants'
import type { Chip } from '../fields'
import type { Camera, Stroke, Task, Zone } from '../types'
import { clampZoom, screenToWorld, zoomAt } from './camera'
import { hitsStroke } from './ink'
import { Ink, type Clip } from './Ink'
import { StickyNote } from './StickyNote'
import { zoneOfNote } from './zones'
import { ZoneView } from './ZoneView'

export type Tool = 'none' | 'pen' | 'eraser' | 'zone'

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
  /** How a note looks: its pills, whether it is filtered out, and its color. */
  noteView: (t: Task) => { chips: Chip[]; dim: boolean; color: string }
  onChip: (chip: Chip) => void
  /** A tap on a note while not editing (opens its details). */
  onNoteOpen: (id: string) => void
  zones: Zone[]
  selectedZoneId: string | null
  editingZoneId: string | null
  /** The zone a dragged note is currently over. */
  highlightZoneId: string | null
  onZoneSelect: (id: string) => void
  onZoneDragStart: (id: string) => void
  onZoneDrag: (id: string, x: number, y: number) => void
  onZoneDragEnd: (id: string) => void
  onZoneResize: (id: string, w: number, h: number) => void
  onZoneResizeEnd: (id: string) => void
  onZoneRename: (id: string, name: string) => void
  onZoneRenameDone: () => void
  /** Called when the user finishes dragging out a new zone (world coordinates). */
  onZoneDraw: (rect: { x: number; y: number; w: number; h: number }) => void
  strokes: Stroke[]
  tool: Tool
  penColor: string
  /** Pen width in screen pixels (converted to world units when the stroke starts). */
  penWidth: number
  /**
   * Called with the finished stroke's points (flat x,y list, world coordinates) and width.
   * `noteId` is the note the stroke started on (it then belongs to that note), or null.
   */
  onStroke: (points: number[], width: number, noteId: string | null) => void
  /** Called while erasing, with the strokes just touched (`noteId` set for strokes drawn on a note). */
  onErase: (hits: { id: string; noteId?: string }[]) => void
  onEraseEnd: () => void
  camera: Camera
  setCamera: React.Dispatch<React.SetStateAction<Camera>>
}

const GRID = 40
const TAP_SLOP = 4
const ERASER_RADIUS = 12 // screen px

type Mode = 'idle' | 'pan' | 'draw' | 'erase' | 'pinch' | 'zone'

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
  noteView,
  onChip,
  onNoteOpen,
  zones,
  selectedZoneId,
  editingZoneId,
  highlightZoneId,
  onZoneSelect,
  onZoneDragStart,
  onZoneDrag,
  onZoneDragEnd,
  onZoneResize,
  onZoneResizeEnd,
  onZoneRename,
  onZoneRenameDone,
  onZoneDraw,
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
  const tap = useRef({ x: 0, y: 0, moved: false, noteId: null as string | null })
  const live = useRef<{ pts: number[]; width: number; noteId: string | null } | null>(null)
  const [liveClip, setLiveClip] = useState<Clip | null>(null)
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null)
  const zoneStart = useRef<{ x: number; y: number } | null>(null)
  const [liveZone, setLiveZone] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [panning, setPanning] = useState(false)

  // The handlers below read the latest camera/strokes without being re-created on every change.
  const camRef = useRef(camera)
  camRef.current = camera
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

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
    const note = l?.noteId ? tasksRef.current.find((t) => t.id === l.noteId) : null
    setLiveClip(note ? { x: note.board.x, y: note.board.y, size: NOTE_SIZE } : null)
  }

  /** The topmost note under a world point, if any. */
  const noteAt = (x: number, y: number) =>
    [...tasksRef.current]
      .reverse()
      .find((t) => x >= t.board.x && x <= t.board.x + NOTE_SIZE && y >= t.board.y && y <= t.board.y + NOTE_SIZE)

  const erase = (e: { clientX: number; clientY: number }) => {
    const w = world(e)
    const r = ERASER_RADIUS / camRef.current.zoom
    const hits: { id: string; noteId?: string }[] = strokesRef.current
      .filter((s) => hitsStroke(s, w.x, w.y, r))
      .map((s) => ({ id: s.id }))
    for (const t of tasksRef.current) {
      const lx = w.x - t.board.x
      const ly = w.y - t.board.y
      if (!t.drawing?.length || lx < -r || ly < -r || lx > NOTE_SIZE + r || ly > NOTE_SIZE + r) continue
      for (const s of t.drawing) if (hitsStroke(s, lx, ly, r)) hits.push({ id: s.id, noteId: t.id })
    }
    if (hits.length) onErase(hits)
  }

  const cancelGesture = () => {
    if (mode.current === 'erase') onEraseEnd()
    zoneStart.current = null
    setLiveZone(null)
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

    tap.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      noteId: (e.target as Element).closest?.('[data-note-id]')?.getAttribute('data-note-id') ?? null,
    }
    // Mouse: middle/right button always pans, so you can move around while a tool is active.
    if (e.button !== 0) mode.current = 'pan'
    else if (tool === 'pen') {
      const w = world(e)
      live.current = {
        pts: [w.x, w.y],
        width: Math.max(0.5, penWidth / camRef.current.zoom),
        noteId: noteAt(w.x, w.y)?.id ?? null, // starting on a note means drawing on that note
      }
      mode.current = 'draw'
      showLive()
    } else if (tool === 'eraser') {
      mode.current = 'erase'
      erase(e)
    } else if (tool === 'zone') {
      zoneStart.current = world(e)
      mode.current = 'zone'
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
    } else if (mode.current === 'zone' && zoneStart.current) {
      const a = zoneStart.current
      const w = world(e)
      setLiveZone({ x: Math.min(a.x, w.x), y: Math.min(a.y, w.y), w: Math.abs(w.x - a.x), h: Math.abs(w.y - a.y) })
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
      onStroke(live.current.pts, live.current.width, live.current.noteId)
    } else if (mode.current === 'erase') {
      onEraseEnd()
    } else if (mode.current === 'zone') {
      // Ignore accidental taps: a zone must be at least ~40 screen pixels each way.
      const min = 40 / camRef.current.zoom
      if (finished && liveZone && liveZone.w >= min && liveZone.h >= min) onZoneDraw(liveZone)
      zoneStart.current = null
      setLiveZone(null)
    } else if (mode.current === 'pan' && finished && !tap.current.moved) {
      // A tap on a note opens its details; a tap on the empty background deselects.
      if (tap.current.noteId) onNoteOpen(tap.current.noteId)
      else onSelect(null)
    }
    live.current = null
    showLive()
    mode.current = 'idle'
    setPanning(false)
  }

  const gridSize = GRID * camera.zoom
  const level = camera.zoom < 0.45 ? 0 : camera.zoom < 0.8 ? 1 : 2
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks) {
      const z = zoneOfNote(zones, t)
      if (z) m.set(z.id, (m.get(z.id) ?? 0) + 1)
    }
    return m
  }, [tasks, zones])

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
        {zones.map((z) => (
          <ZoneView
            key={z.id}
            zone={z}
            zoom={camera.zoom}
            editable={editable && tool === 'none'}
            selected={z.id === selectedZoneId}
            editing={z.id === editingZoneId}
            highlight={z.id === highlightZoneId}
            count={counts.get(z.id) ?? 0}
            onSelect={onZoneSelect}
            onDragStart={onZoneDragStart}
            onDrag={onZoneDrag}
            onDragEnd={onZoneDragEnd}
            onResize={onZoneResize}
            onResizeEnd={onZoneResizeEnd}
            onRename={onZoneRename}
            onRenameDone={onZoneRenameDone}
          />
        ))}
        {liveZone && (
          <div
            className="zone live"
            style={{ transform: `translate(${liveZone.x}px, ${liveZone.y}px)`, width: liveZone.w, height: liveZone.h }}
          />
        )}
        {tasks.map((t) => {
          const v = noteView(t)
          return (
          <StickyNote
            key={t.id}
            chips={v.chips}
            dim={v.dim}
            color={v.color}
            level={level}
            tooling={tool !== 'none'}
            onChip={onChip}
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
          )
        })}
        <Ink strokes={strokes} live={liveStroke} liveClip={liveClip} />
      </div>
    </div>
  )
}
