import { useEffect, useRef } from 'react'
import { NOTE_SIZE } from '../constants'
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
  onRename: (id: string, title: string) => void
  onRenameDone: () => void
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
  onRename,
  onRenameDone,
}: Props) {
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const cancelled = useRef(false)

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
    if (editing) return // let the textarea handle it
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: task.board.x, y: task.board.y, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return
    d.moved = true
    onMove(task.id, d.x + dx / zoom, d.y + dy / zoom)
  }

  const end = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.moved) onMoveEnd(task.id)
    else if (e.type === 'pointerup') onSelect(task.id)
  }

  const commit = (value: string) => {
    if (!cancelled.current) onRename(task.id, value.trim() || task.title)
    onRenameDone()
  }

  return (
    <div
      className={`note${editable ? ' editable' : ''}${selected ? ' selected' : ''}`}
      style={{
        transform: `translate(${task.board.x}px, ${task.board.y}px)`,
        width: NOTE_SIZE,
        height: NOTE_SIZE,
        background: task.board.color,
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
        task.title
      )}
      {task.drawing && task.drawing.length > 0 && (
        <svg className="note-ink" width={NOTE_SIZE} height={NOTE_SIZE}>
          {task.drawing.map((s) => (
            <path key={s.id} d={pathFor(s.p)} stroke={s.c} strokeWidth={s.w} />
          ))}
        </svg>
      )}
    </div>
  )
}
