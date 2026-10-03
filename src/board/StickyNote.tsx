import { useEffect, useRef, useState } from 'react'
import { GRID, NOTE_SIZE } from '../constants'
import type { BoardInfo } from '../types'
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
  /** Hidden by the legend: only a grey shape remains, so nobody drops another note on its spot. */
  ghost: boolean
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
  /** Inside a closed stack: where the note it hides under sits (it slides there and disappears). */
  tuckedInto: BoardInfo | null
  /** Number of direct sub-tasks, whether their stack is open, and the toggle. */
  subtasks: number
  /** A dragged note has been held over this one: letting go makes it a sub-task. */
  dropTarget: boolean
  stackOpen: boolean
  onStack: (id: string) => void
  /** A stack just opened/closed: animate the move. */
  gliding: boolean
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
  ghost,
  dim,
  color,
  ink,
  level,
  tooling,
  onChip,
  gesture,
  selectedStrokeId,
  tuckedInto,
  subtasks,
  dropTarget,
  stackOpen,
  onStack,
  gliding,
}: Props) {
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean; epoch: number } | null>(null)
  const [lifted, setLifted] = useState(false)
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
    setLifted(false)
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
    setLifted(true)
    // snap the top-left corner onto the background dots
    onMove(task.id, Math.round((d.x + dx / zoom) / GRID) * GRID, Math.round((d.y + dy / zoom) / GRID) * GRID)
  }

  const end = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || abortIfPinching()) return
    drag.current = null
    setLifted(false)
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
      className={`note${editable ? ' editable' : ''}${selected ? ' selected' : ''}${dim ? ' dim' : ''}${lifted ? ' lifted' : ''}${tuckedInto ? ' tucked' : ''}${dropTarget ? ' drop-target' : ''}${ghost ? ' ghost' : ''}${gliding ? ' gliding' : ''}${task.parent ? ' child' : ''}`}
      style={{
        transform: `translate(${(tuckedInto ?? task.board).x}px, ${(tuckedInto ?? task.board).y}px)`,
        // tilt and scale turn around the note's own centre (they are applied outside the translation)
        transformOrigin: `${(tuckedInto ?? task.board).x + NOTE_SIZE / 2}px ${(tuckedInto ?? task.board).y + NOTE_SIZE / 2}px`,
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
      {subtasks > 0 && !editing && (
        <button
          className="stack-badge"
          aria-label={stackOpen ? `Tuck ${subtasks} sub-tasks` : `Show ${subtasks} sub-tasks`}
          aria-expanded={stackOpen}
          style={tooling ? { pointerEvents: 'none' } : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onStack(task.id)}
        >
          {stackOpen ? '▾' : '▤'} {subtasks}
        </button>
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
