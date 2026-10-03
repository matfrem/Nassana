import { useEffect, useRef } from 'react'
import { NOTE_SIZE } from '../constants'
import type { Chip } from '../fields'
import type { Task } from '../types'
import { pathFor } from './ink'

const TAP_SLOP = 4 // px of movement below which a press counts as a tap, not a drag

interface Props {
  task: Task
  zoom: number
  editable: boolean
  selected: boolean
  editing: boolean
  onMove: (id: string, x: number, y: number) => void
  /** Called when a drag ends (this is where we save to the Sheet). */
  onMoveEnd: (id: string) => void
  onSelect: (id: string) => void
  /** Double tap/click: open the details. */
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onRenameDone: () => void
  /** Pills built from the `#` columns. */
  chips: Chip[]
  /** Filtered out: shown faded. */
  dim: boolean
  /** Background color to show (the manual color, or one derived from a property). */
  color: string
  /** Text color readable on `color`. */
  ink: string
  /** 0: title only (zoomed out), 1: + pills, 2: + description. */
  level: 0 | 1 | 2
  /** A drawing tool is active: pills must not catch presses meant for drawing. */
  tooling: boolean
  onChip: (chip: Chip) => void
  /** Multi-touch state from the board: while two fingers are down (or after a pinch began), a note must not move. */
  gesture: () => { multi: boolean; epoch: number }
  /** The note's stroke picked with the move tool. */
  selectedStrokeId: string | null
}

export function StickyNote({
  task,
  zoom,
  editable,
  selected,
  editing,
  onMove,
  onMoveEnd,
  onSelect,
  onOpen,
  onRename,
  onRenameDone,
  chips,
  dim,
  color,
  ink,
  level,
  tooling,
  onChip,
  gesture,
  selectedStrokeId,
}: Props) {
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean; epoch: number } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const cancelled = useRef(false)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (editing) {
      cancelled.current = false
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || e.button !== 0) return // read-only: let the event bubble up -> board pan
    e.stopPropagation()
    if (editing || gesture().multi) return // let the textarea handle it / a second finger never starts a drag
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: task.board.x, y: task.board.y, moved: false, epoch: gesture().epoch }
  }

  /** A second finger arrived: stop dragging (keeping what was already moved). The board takes over. */
  const abortIfPinching = (): boolean => {
    const d = drag.current
    if (!d) return true
    const g = gesture()
    if (!g.multi && g.epoch === d.epoch) return false
    drag.current = null
    if (d.moved) onMoveEnd(task.id)
    return true
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || abortIfPinching()) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return
    d.moved = true
    onMove(task.id, d.x + dx / zoom, d.y + dy / zoom)
  }

  const end = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || abortIfPinching()) return
    drag.current = null
    if (d.moved) onMoveEnd(task.id)
    else if (e.type === 'pointerup') {
      const prev = lastTap.current
      if (prev && Date.now() - prev.t < 350 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
        lastTap.current = null
        onOpen(task.id)
      } else {
        lastTap.current = { t: Date.now(), x: e.clientX, y: e.clientY }
        onSelect(task.id)
      }
    }
  }

  const commit = (value: string) => {
    if (!cancelled.current) onRename(task.id, value.trim() || task.title)
    onRenameDone()
  }

  return (
    <div
      data-note-id={task.id}
      className={`note${editable ? ' editable' : ''}${selected ? ' selected' : ''}${dim ? ' dim' : ''}`}
      style={{
        transform: `translate(${task.board.x}px, ${task.board.y}px)`,
        width: NOTE_SIZE,
        height: NOTE_SIZE,
        background: color,
        color: ink,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {editing ? (
        <textarea
          ref={input}
          defaultValue={task.title}
          maxLength={500}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <div className="note-title">{task.title}</div>
      )}
      {level >= 2 && task.description && !editing && <div className="note-desc">{task.description}</div>}
      {level >= 1 && chips.length > 0 && !editing && (
        <div className="note-chips">
          {chips.map((c) => (
            <button
              key={c.key}
              className={`chip${c.tone ? ` tone-${c.tone}` : ''}`}
              title={c.label}
              style={tooling ? { pointerEvents: 'none' } : undefined}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChip(c)}
            >
              {c.icon && <span aria-hidden>{c.icon}</span>}
              {c.text}
            </button>
          ))}
        </div>
      )}
      {task.drawing && task.drawing.length > 0 && (
        <svg className="note-ink" width={NOTE_SIZE} height={NOTE_SIZE}>
          {task.drawing.map((s) => (
            <g key={s.id}>
              {s.id === selectedStrokeId && <path className="stroke-halo" d={pathFor(s.p)} style={{ strokeWidth: `calc(${s.w}px + 12px / var(--zoom, 1))` }} />}
              <path d={pathFor(s.p)} stroke={s.c} strokeWidth={s.w} />
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}
