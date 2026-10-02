import { useRef } from 'react'
import type { Task } from '../types'

export const NOTE_SIZE = 180

interface Props {
  task: Task
  zoom: number
  editable: boolean
  onMove: (id: string, x: number, y: number) => void
  /** Appelé à la fin d'un déplacement (c'est là qu'on sauvegardera dans le Sheet). */
  onMoveEnd: (id: string) => void
}

export function StickyNote({ task, zoom, editable, onMove, onMoveEnd }: Props) {
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || e.button !== 0) return // en lecture : on laisse remonter -> pan du board
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: task.board.x, y: task.board.y }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    onMove(task.id, d.x + (e.clientX - d.px) / zoom, d.y + (e.clientY - d.py) / zoom)
  }

  const end = () => {
    if (!drag.current) return
    drag.current = null
    onMoveEnd(task.id)
  }

  return (
    <div
      className={`note${editable ? ' editable' : ''}`}
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
      {task.title}
    </div>
  )
}
