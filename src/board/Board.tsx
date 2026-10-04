import { useEffect, useMemo, useRef, useState } from 'react'
import { GRID, NOTE_SIZE } from '../constants'
import type { Chip } from '../fields'
import type { Camera, Link, Stroke, Task, Zone } from '../types'
import { clampZoom, screenToWorld, zoomAt } from './camera'
import { hitsStroke } from './ink'
import { Ink, type Clip } from './InkLayer'
import { LinksLayer, type LinkItem, type LiveLink } from './LinksLayer'
import { distToSeg, segmentBetween, segmentToPoint } from './links'
import { StickyNote } from './StickyNote'
import { stampColumns, stampEmoji } from '../stamps'
import { zoneOfNote } from './zones'
import { ZoneView } from './ZoneView'

export type Tool = 'none' | 'pen' | 'eraser' | 'zone' | 'move' | 'link' | 'select'

/** One member of a multi-selection. */
export interface SelItem {
  kind: 'note' | 'zone' | 'stroke'
  id: string
}
export const selKey = (i: SelItem) => `${i.kind[0]}:${i.id}`

/** A stroke on the board (no noteId) or on a note. */
export interface StrokeRef {
  id: string
  noteId?: string
}

interface Props {
  tasks: Task[]
  /** Draw the links between notes (the lines to sub-tasks are always drawn). */
  showLinks: boolean
  editable: boolean
  onMove: (id: string, x: number, y: number) => void
  onMoveEnd: (id: string) => void
  selectedId: string | null
  editingId: string | null
  onSelect: (id: string | null, additive?: boolean) => void
  /** Multi-selection: keys (`n:`, `z:`, `s:` + id) of the selected items, a toggle, and a rectangle pick. */
  multiKeys: ReadonlySet<string>
  onToggleSel: (item: SelItem) => void
  onSelectRect: (items: SelItem[], additive: boolean) => void
  onRename: (id: string, title: string) => void
  onRenameDone: () => void
  /** How a note looks: its pills, whether it is filtered out, and its color. */
  noteView: (t: Task) => { chips: Chip[]; dim: boolean; hidden: boolean; color: string; ink: string }
  onChip: (chip: Chip) => void
  /** Stacks of notes: which notes are tucked under another, how many sub-tasks each note has, which stacks are open. */
  stack: { tucked: Map<string, string>; kids: Map<string, string[]>; open: Set<string>; animating: boolean; onToggle: (id: string) => void; dropTarget: string | null }
  /** A tap on a note while not editing (opens its details). */
  onNoteOpen: (id: string) => void
  links: Link[]
  selectedLinkId: string | null
  /** Tap on a link's line (Edit mode). */
  onLinkSelect: (id: string) => void
  /** The user dragged from note `from` and let go on note `to`. */
  onLinkCreate: (from: string, to: string) => void
  zones: Zone[]
  selectedZoneId: string | null
  editingZoneId: string | null
  /** The zone a dragged note is currently over. */
  highlightZoneId: string | null
  onZoneSelect: (id: string, additive?: boolean) => void
  onZoneOpen: (id: string) => void
  onZoneDragStart: (id: string) => void
  onZoneDrag: (id: string, x: number, y: number) => void
  onZoneDragEnd: (id: string) => void
  onZoneResize: (id: string, w: number, h: number) => void
  onZoneResizeEnd: (id: string) => void
  onZoneRename: (id: string, name: string) => void
  onZoneRenameDone: () => void
  /** Called when the user finishes dragging out a new zone (world coordinates). */
  onZoneDraw: (rect: { x: number; y: number; w: number; h: number }) => void
  /** The stroke picked with the move tool (only meaningful while that tool is active). */
  selectedStroke: StrokeRef | null
  onStrokeSelect: (ref: StrokeRef | null, additive?: boolean) => void
  /** While dragging: the stroke's new points, in the coordinates of its owner (board or note). */
  onStrokeMove: (ref: StrokeRef, points: number[]) => void
  onStrokeMoveEnd: (ref: StrokeRef) => void
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

const TAP_SLOP = 4
const ERASER_RADIUS = 12 // screen px

type Mode = 'idle' | 'pan' | 'draw' | 'erase' | 'pinch' | 'zone' | 'move' | 'link' | 'select'

export function Board({
  tasks,
  showLinks,
  editable,
  onMove,
  onMoveEnd,
  selectedId,
  editingId,
  onSelect,
  multiKeys,
  onToggleSel,
  onSelectRect,
  onRename,
  onRenameDone,
  noteView,
  stack,
  onChip,
  onNoteOpen,
  links,
  selectedLinkId,
  onLinkSelect,
  onLinkCreate,
  zones,
  selectedZoneId,
  editingZoneId,
  highlightZoneId,
  onZoneSelect,
  onZoneOpen,
  onZoneDragStart,
  onZoneDrag,
  onZoneDragEnd,
  onZoneResize,
  onZoneResizeEnd,
  onZoneRename,
  onZoneRenameDone,
  onZoneDraw,
  selectedStroke,
  onStrokeSelect,
  onStrokeMove,
  onStrokeMoveEnd,
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
  /** Counts the pinch gestures started so far. */
  const epoch = useRef(0)
  const gesture = () => ({ multi: pointers.current.size >= 2, epoch: epoch.current })
  const pinch = useRef({ dist: 1, cx: 0, cy: 0 })
  const tap = useRef({ x: 0, y: 0, moved: false, noteId: null as string | null })
  const live = useRef<{ pts: number[]; width: number; noteId: string | null } | null>(null)
  const [liveClip, setLiveClip] = useState<Clip | null>(null)
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null)
  const moving = useRef<{
    ref: StrokeRef
    orig: number[]
    sx: number
    sy: number
    /** Allowed offsets (note strokes must keep a part inside their note, or they would vanish). */
    min: { x: number; y: number }
    max: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const linkFrom = useRef<string | null>(null)
  const [liveLink, setLiveLink] = useState<LiveLink | null>(null)
  const zoneStart = useRef<{ x: number; y: number } | null>(null)
  const selStart = useRef<{ x: number; y: number } | null>(null)
  const [liveSel, setLiveSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [liveZone, setLiveZone] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [panning, setPanning] = useState(false)

  // The handlers below read the latest camera/strokes without being re-created on every change.
  const camRef = useRef(camera)
  camRef.current = camera
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const noteViewRef = useRef(noteView)
  noteViewRef.current = noteView
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  /** Notes that are not hidden: the only ones that can be drawn on, linked or hit. */
  const visibleNotes = () => tasksRef.current.filter((t) => !noteViewRef.current(t).hidden)

  // A finger that lifts always stops counting, even if the element it was on is gone by then
  // (otherwise the board would think two fingers are still down and refuse to drag anything).
  useEffect(() => {
    const drop = (e: PointerEvent) => void pointers.current.delete(e.pointerId)
    window.addEventListener('pointerup', drop, true)
    window.addEventListener('pointercancel', drop, true)
    return () => {
      window.removeEventListener('pointerup', drop, true)
      window.removeEventListener('pointercancel', drop, true)
    }
  }, [])

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

  /** The topmost stroke near a world point, with its points: board strokes first, then notes' (topmost note first). */
  const strokeAt = (x: number, y: number): { ref: StrokeRef; p: number[] } | null => {
    const r = 14 / camRef.current.zoom // generous: it has to work with a fingertip
    const board = [...strokesRef.current].reverse().find((s) => hitsStroke(s, x, y, r))
    if (board) return { ref: { id: board.id }, p: board.p }
    for (const t of visibleNotes().reverse()) {
      const lx = x - t.board.x
      const ly = y - t.board.y
      if (!t.drawing?.length || lx < -r || ly < -r || lx > NOTE_SIZE + r || ly > NOTE_SIZE + r) continue
      const s = [...t.drawing].reverse().find((st) => hitsStroke(st, lx, ly, r))
      if (s) return { ref: { id: s.id, noteId: t.id }, p: s.p }
    }
    return null
  }

  /** Updates the dotted line being pulled out of the source note. */
  const updateLive = (x: number, y: number) => {
    const src = tasksRef.current.find((t) => t.id === linkFrom.current)
    if (!src) return setLiveLink(null)
    const over = noteAt(x, y)
    const target = over && over.id !== src.id ? over : null
    setLiveLink({
      seg: target ? segmentBetween(src, target) : segmentToPoint(src, x, y),
      target: target ? { x: target.board.x, y: target.board.y } : null,
    })
  }

  const showLive = () => {
    const l = live.current
    setLiveStroke(l ? { id: 'live', c: penColor, w: l.width, p: l.pts } : null)
    const note = l?.noteId ? tasksRef.current.find((t) => t.id === l.noteId) : null
    setLiveClip(note ? { x: note.board.x, y: note.board.y, size: NOTE_SIZE } : null)
  }

  /** The topmost note under a world point, if any. */
  const noteAt = (x: number, y: number) =>
    visibleNotes()
      .reverse()
      .find((t) => x >= t.board.x && x <= t.board.x + NOTE_SIZE && y >= t.board.y && y <= t.board.y + NOTE_SIZE)

  const erase = (e: { clientX: number; clientY: number }) => {
    const w = world(e)
    const r = ERASER_RADIUS / camRef.current.zoom
    const hits: { id: string; noteId?: string }[] = strokesRef.current
      .filter((s) => hitsStroke(s, w.x, w.y, r))
      .map((s) => ({ id: s.id }))
    for (const t of visibleNotes()) {
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
    linkFrom.current = null
    setLiveLink(null)
    if (mode.current === 'move' && moving.current?.moved) onStrokeMoveEnd(moving.current.ref)
    moving.current = null
    live.current = null
    showLive()
  }

  /**
   * Two fingers down: whatever was in progress (a stroke, a pan, a note or zone drag) is dropped
   * and the gesture becomes pan + zoom. `epoch` lets notes and zones notice it even if they
   * missed the moment (see `gesture` below).
   */
  const startPinch = () => {
    cancelGesture()
    epoch.current++
    mode.current = 'pinch'
    const [a, b] = [...pointers.current.values()]
    const l = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
    pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: l.x, cy: l.y }
  }

  /**
   * Runs before the notes' and zones' own handlers (which stop propagation to the bubble phase),
   * so a second finger is seen even when the first one is holding a note or a zone.
   */
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      ref.current!.setPointerCapture(e.pointerId)
      setPanning(true)
      startPinch()
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setPanning(true)

    if (pointers.current.size >= 2) {
      if (mode.current !== 'pinch') startPinch() // e.g. a mouse plus a finger
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
    } else if (tool === 'link') {
      // Start on a note to pull a link out of it; start on empty space to pan as usual.
      const w = world(e)
      const n = noteAt(w.x, w.y)
      if (n) {
        linkFrom.current = n.id
        mode.current = 'link'
        updateLive(w.x, w.y)
      } else mode.current = 'pan'
    } else if (tool === 'select' || (tool === 'none' && editable && e.shiftKey)) {
      // Drag a rectangle to select what it touches (Shift+drag on the background with a mouse, or the Select tool).
      selStart.current = world(e)
      mode.current = 'select'
    } else if (tool === 'move') {
      // Press on a stroke to pick it and drag it; press on empty space to drop the selection.
      const w = world(e)
      const hit = strokeAt(w.x, w.y)
      mode.current = 'move'
      if (!hit) {
        onStrokeSelect(null)
      } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
        onStrokeSelect(hit.ref, true) // Ctrl/Shift+click adds or removes it from the selection
      } else {
        onStrokeSelect(hit.ref)
        const xs = hit.p.filter((_, i) => i % 2 === 0)
        const ys = hit.p.filter((_, i) => i % 2 === 1)
        const keep = 12
        moving.current = {
          ref: hit.ref,
          orig: hit.p,
          sx: w.x,
          sy: w.y,
          min: hit.ref.noteId ? { x: keep - Math.max(...xs), y: keep - Math.max(...ys) } : { x: -Infinity, y: -Infinity },
          max: hit.ref.noteId ? { x: NOTE_SIZE - keep - Math.min(...xs), y: NOTE_SIZE - keep - Math.min(...ys) } : { x: Infinity, y: Infinity },
          moved: false,
        }
      }
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
    } else if (mode.current === 'link' && linkFrom.current) {
      const w = world(e)
      updateLive(w.x, w.y)
    } else if (mode.current === 'move' && moving.current) {
      const m = moving.current
      const w = world(e)
      const dx = Math.min(m.max.x, Math.max(m.min.x, w.x - m.sx))
      const dy = Math.min(m.max.y, Math.max(m.min.y, w.y - m.sy))
      if (!m.moved && Math.hypot(dx, dy) * camRef.current.zoom < TAP_SLOP) return
      m.moved = true
      onStrokeMove(m.ref, m.orig.map((v, i) => Math.round((v + (i % 2 === 0 ? dx : dy)) * 10) / 10))
    } else if (mode.current === 'select' && selStart.current) {
      const a = selStart.current
      const w = world(e)
      setLiveSel({ x: Math.min(a.x, w.x), y: Math.min(a.y, w.y), w: Math.abs(w.x - a.x), h: Math.abs(w.y - a.y) })
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
    } else if (mode.current === 'link') {
      const from = linkFrom.current
      const w = world(e)
      const to = noteAt(w.x, w.y)
      if (finished && from && to && to.id !== from) onLinkCreate(from, to.id)
      linkFrom.current = null
      setLiveLink(null)
    } else if (mode.current === 'move') {
      if (moving.current?.moved) onStrokeMoveEnd(moving.current.ref)
      moving.current = null
    } else if (mode.current === 'select') {
      const r = liveSel
      selStart.current = null
      setLiveSel(null)
      const min = 8 / camRef.current.zoom
      if (finished && r && r.w >= min && r.h >= min) {
        const items: SelItem[] = []
        const hidden = (t: Task) => noteViewRef.current(t).hidden || stack.tucked.has(t.id)
        for (const t of tasks) {
          if (!hidden(t) && t.board.x < r.x + r.w && t.board.x + NOTE_SIZE > r.x && t.board.y < r.y + r.h && t.board.y + NOTE_SIZE > r.y) items.push({ kind: 'note', id: t.id })
        }
        for (const z of zones) if (z.x >= r.x && z.y >= r.y && z.x + z.w <= r.x + r.w && z.y + z.h <= r.y + r.h) items.push({ kind: 'zone', id: z.id })
        for (const st of strokesRef.current) {
          for (let i = 0; i < st.p.length; i += 2) {
            if (st.p[i] >= r.x && st.p[i] <= r.x + r.w && st.p[i + 1] >= r.y && st.p[i + 1] <= r.y + r.h) {
              items.push({ kind: 'stroke', id: st.id })
              break
            }
          }
        }
        onSelectRect(items, e.shiftKey)
      } else if (finished && tool === 'select') {
        // A tap with the Select tool: toggles the note or zone under it, or clears the selection.
        const target = e.target as Element | null
        const zoneId = target?.closest?.('.zone-header')?.parentElement?.getAttribute('data-zone-id')
        if (tap.current.noteId) onToggleSel({ kind: 'note', id: tap.current.noteId })
        else if (zoneId) onToggleSel({ kind: 'zone', id: zoneId })
        else onSelectRect([], false)
      }
    } else if (mode.current === 'zone') {
      // Ignore accidental taps: a zone must be at least ~40 screen pixels each way.
      const min = 40 / camRef.current.zoom
      if (finished && liveZone && liveZone.w >= min && liveZone.h >= min) onZoneDraw(liveZone)
      zoneStart.current = null
      setLiveZone(null)
    } else if (mode.current === 'pan' && finished && !tap.current.moved) {
      // A tap on a note opens its details; a tap on the empty background deselects.
      if (tap.current.noteId) {
        onSelect(tap.current.noteId) // a right click (or tap) selects the note as well as opening its details
        onNoteOpen(tap.current.noteId)
      }      else {
        const w = world(e)
        const hit = editable && tool === 'none' ? linkItems.find((it) => distToSeg(it.seg, w.x, w.y) <= 14 / camRef.current.zoom) : undefined
        if (hit && !hit.link.id.startsWith('stack:')) onLinkSelect(hit.link.id)
        else onSelect(null)
      }
    }
    live.current = null
    showLive()
    mode.current = 'idle'
    setPanning(false)
  }

  const gridSize = GRID * camera.zoom
  const level = camera.zoom < 0.45 ? 0 : camera.zoom < 0.8 ? 1 : 2
  const linkItems = useMemo<LinkItem[]>(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const explicit = (showLinks ? links : []).flatMap((link) => {
      const a = byId.get(link.from)
      const b = byId.get(link.to)
      const seg = a && b ? segmentBetween(a, b) : null
      return a && b && seg && !stack.tucked.has(a.id) && !stack.tucked.has(b.id)
        ? [{ link, seg, dim: noteView(a).dim || noteView(b).dim || noteView(a).hidden || noteView(b).hidden }]
        : []
    })
    // Spread-open stacks: a dotted line from each parent to its sub-tasks (derived, never stored).
    for (const [parentId, kids] of stack.kids) {
      const a = byId.get(parentId)
      if (!a || !stack.open.has(parentId) || stack.tucked.has(parentId)) continue
      for (const kid of kids) {
        const b = byId.get(kid)
        const seg = b ? segmentBetween(a, b) : null
        if (!b || !seg || stack.tucked.has(kid)) continue
        explicit.push({ link: { id: `stack:${kid}`, from: parentId, to: kid, arrow: 'none' }, seg, dim: noteView(a).dim || noteView(b).dim || noteView(a).hidden || noteView(b).hidden })
      }
    }
    return explicit
  }, [links, showLinks, tasks, noteView, stack])

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
        backgroundImage: gridSize < 12 ? 'none' : undefined, // dots closer than that only shimmer
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={`world${camera.zoom < 0.25 ? ' far' : ''}`}
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          // Lets the CSS keep selection outlines and handles the same size on screen at any zoom.
          ['--zoom' as string]: camera.zoom,
        }}
      >
        {zones.map((z) => (
          <ZoneView
            key={z.id}
            zone={z}
            zoom={camera.zoom}
            editable={editable && tool === 'none'}
            selected={z.id === selectedZoneId || multiKeys.has(`z:${z.id}`)}
            editing={z.id === editingZoneId}
            highlight={z.id === highlightZoneId}
            count={counts.get(z.id) ?? 0}
            onSelect={onZoneSelect}
            onOpen={onZoneOpen}
            gesture={gesture}
            onDragStart={onZoneDragStart}
            onDrag={onZoneDrag}
            onDragEnd={onZoneDragEnd}
            onResize={onZoneResize}
            onResizeEnd={onZoneResizeEnd}
            onRename={onZoneRename}
            onRenameDone={onZoneRenameDone}
          />
        ))}
        {liveSel && (
          <div className="sel-rect" style={{ transform: `translate(${liveSel.x}px, ${liveSel.y}px)`, width: liveSel.w, height: liveSel.h }} />
        )}
        {liveZone && (
          <div
            className="zone live"
            style={{ transform: `translate(${liveZone.x}px, ${liveZone.y}px)`, width: liveZone.w, height: liveZone.h }}
          />
        )}
        <LinksLayer items={linkItems} selectedId={selectedLinkId} live={liveLink} zoom={camera.zoom} />
        {tasks.map((t) => {
          // The post-its peeking out from under a closed stack.
          const n = stack.kids.get(t.id)?.length ?? 0
          const v = noteView(t)
          if (!n || v.hidden || stack.tucked.has(t.id)) return null
          return (
            <div
              key={`cards-${t.id}`}
              className={`stack-cards${stack.open.has(t.id) ? ' open' : ''}${v.dim ? ' dim' : ''}`}
              style={{ transform: `translate(${t.board.x}px, ${t.board.y}px)`, width: NOTE_SIZE, height: NOTE_SIZE }}
            >
              <i style={{ background: v.color }} />
              <i style={{ background: v.color }} />
            </div>
          )
        })}
        {tasks.map((t) => {
          const v = noteView(t)
          const anchor = stack.tucked.get(t.id)
          const home = anchor ? tasks.find((n) => n.id === anchor)?.board : undefined
          const kids = stack.kids.get(t.id)?.length ?? 0
          return (
          <StickyNote
            key={t.id}
            chips={v.chips}
            ghost={v.hidden}
            tuckedInto={home ?? null}
            subtasks={kids}
            dropTarget={stack.dropTarget === t.id}
            stackOpen={stack.open.has(t.id)}
            gliding={stack.animating}
            onStack={stack.onToggle}
            dim={v.dim}
            color={v.color}
            ink={v.ink}
            level={level}
            tooling={tool !== 'none'}
            selectedStrokeId={tool === 'move' && selectedStroke?.noteId === t.id ? selectedStroke.id : null}
            onChip={onChip}
            task={t}
            zoom={camera.zoom}
            editable={editable && tool === 'none'}
            selected={t.id === selectedId || multiKeys.has(`n:${t.id}`)}
            editing={t.id === editingId}
            onMove={onMove}
            onMoveEnd={onMoveEnd}
            onSelect={onSelect}
            onOpen={onNoteOpen}
            gesture={gesture}
            onRename={onRename}
            onRenameDone={onRenameDone}
          />
          )
        })}
        {tasks.map((t) => {
          // Stamps: stacked at the top right, sticking out; more than three go into a new column to the left.
          const cols = stampColumns(t.stamps ?? [])
          const v = noteView(t)
          if (!cols.length || v.hidden || stack.tucked.has(t.id)) return null
          return (
            <div key={`stamps-${t.id}`} className={`stamps${v.dim ? ' dim' : ''}`} style={{ transform: `translate(${t.board.x + NOTE_SIZE}px, ${t.board.y}px)` }}>
              {cols.map((col, ci) => (
                <div key={ci} className="stamp-col" style={{ left: -30 - ci * 34 }}>
                  {col.map((id) => (
                    <span key={id} className="stamp">
                      {stampEmoji(id)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )
        })}
        <Ink strokes={strokes} live={liveStroke} liveClip={liveClip} selected={new Set([...(tool === 'move' && selectedStroke && !selectedStroke.noteId ? [selectedStroke.id] : []), ...[...multiKeys].filter((k) => k.startsWith('s:')).map((k) => k.slice(2))])} />
      </div>
    </div>
  )
}
