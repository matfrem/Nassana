import { useEffect, useRef } from 'react'
import { ZONE_MIN_SIZE, ZONE_TITLE_SIZE } from '../constants'
import { headerHeight, zoneLabel } from './zones'
import type { Zone } from '../types'

const TAP_SLOP = 4

interface Props {
  zone: Zone
  zoom: number
  editable: boolean
  selected: boolean
  editing: boolean
  /** A note is being dragged over this zone. */
  highlight: boolean
  /** Number of notes inside. */
  count: number
  onSelect: (id: string) => void
  /** Double tap/click on the title strip: open the zone's details. */
  onOpen: (id: string) => void
  /** Multi-touch state from the board: while two fingers are down (or after a pinch began), nothing may move. */
  gesture: () => { multi: boolean; epoch: number }
  onDragStart: (id: string) => void
  onDrag: (id: string, x: number, y: number) => void
  onDragEnd: (id: string) => void
  onResize: (id: string, w: number, h: number) => void
  onResizeEnd: (id: string) => void
  onRename: (id: string, name: string) => void
  onRenameDone: () => void
}

type Gesture = { px: number; py: number; a: number; b: number; moved: boolean; epoch: number }

export function ZoneView({
  zone,
  zoom,
  editable,
  selected,
  editing,
  highlight,
  count,
  onSelect,
  onOpen,
  gesture,
  onDragStart,
  onDrag,
  onDragEnd,
  onResize,
  onResizeEnd,
  onRename,
  onRenameDone,
}: Props) {
  const move = useRef<Gesture | null>(null)
  const size = useRef<Gesture | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (editing) {
      cancelled.current = false
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])

  // Title strip: tap selects, drag moves the zone (and the notes inside it).
  const headerDown = (e: React.PointerEvent) => {
    if (!editable || e.button !== 0 || editing) return // read-only: bubble up -> board pan
    e.stopPropagation()
    if (gesture().multi) return // a second finger never starts a drag
    e.currentTarget.setPointerCapture(e.pointerId)
    move.current = { px: e.clientX, py: e.clientY, a: zone.x, b: zone.y, moved: false, epoch: gesture().epoch }
    onDragStart(zone.id)
  }
  /** A second finger arrived: stop dragging this gesture (keeping what was already moved). */
  const stale = (g: Gesture, end: () => void): boolean => {
    const now = gesture()
    if (!now.multi && now.epoch === g.epoch) return false
    if (g.moved) end()
    return true
  }

  const headerMove = (e: React.PointerEvent) => {
    const g = move.current
    if (!g) return
    if (stale(g, () => onDragEnd(zone.id))) {
      move.current = null
      return
    }
    const dx = e.clientX - g.px
    const dy = e.clientY - g.py
    if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return
    g.moved = true
    onDrag(zone.id, g.a + dx / zoom, g.b + dy / zoom)
  }
  const headerEnd = (e: React.PointerEvent) => {
    const g = move.current
    if (!g) return
    move.current = null
    if (stale(g, () => onDragEnd(zone.id))) return
    if (g.moved) onDragEnd(zone.id)
    else if (e.type === 'pointerup') {
      const prev = lastTap.current
      if (prev && Date.now() - prev.t < 350 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
        lastTap.current = null
        onOpen(zone.id)
      } else {
        lastTap.current = { t: Date.now(), x: e.clientX, y: e.clientY }
        onSelect(zone.id)
      }
    }
  }

  // Corner handle: resize.
  const handleDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (gesture().multi) return
    e.currentTarget.setPointerCapture(e.pointerId)
    size.current = { px: e.clientX, py: e.clientY, a: zone.w, b: zone.h, moved: false, epoch: gesture().epoch }
  }
  const handleMove = (e: React.PointerEvent) => {
    const g = size.current
    if (!g) return
    if (stale(g, () => onResizeEnd(zone.id))) {
      size.current = null
      return
    }
    g.moved = true
    onResize(
      zone.id,
      Math.max(ZONE_MIN_SIZE, g.a + (e.clientX - g.px) / zoom),
      Math.max(ZONE_MIN_SIZE, g.b + (e.clientY - g.py) / zoom),
    )
  }
  const handleEnd = () => {
    const g = size.current
    size.current = null
    if (g && !stale(g, () => onResizeEnd(zone.id)) && g.moved) onResizeEnd(zone.id)
  }

  const commit = (value: string) => {
    if (!cancelled.current) onRename(zone.id, value.trim())
    onRenameDone()
  }

  return (
    <div
      className={`zone${selected ? ' selected' : ''}${highlight ? ' drop' : ''}`}
      style={{
        transform: `translate(${zone.x}px, ${zone.y}px)`,
        width: zone.w,
        height: zone.h,
        background: zone.color + (highlight ? '40' : '1f'),
        borderColor: zone.color,
      }}
    >
      <div
        className={`zone-header${editable ? ' editable' : ''}`}
        style={{ height: headerHeight(zone), fontSize: zone.titleSize ?? ZONE_TITLE_SIZE, background: zone.color + '55' }}
        onPointerDown={headerDown}
        onPointerMove={headerMove}
        onPointerUp={headerEnd}
        onPointerCancel={headerEnd}
      >
        {editing ? (
          <input
            ref={input}
            defaultValue={zone.title ?? zone.name}
            placeholder="Title"
            maxLength={60}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') {
                e.stopPropagation()
                cancelled.current = true
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <>
            {zoneLabel(zone) || 'Untitled zone'}
            <span className={`zone-count${zone.limit && count > zone.limit ? ' over' : ''}`}>
              {zone.limit ? `${count}/${zone.limit}` : count}
            </span>
          </>
        )}
      </div>
      {editable && selected && (
        <div
          className="zone-handle"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleEnd}
          onPointerCancel={handleEnd}
        />
      )}
    </div>
  )
}
