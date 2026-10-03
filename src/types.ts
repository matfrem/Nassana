/** Content of the `board` column of the Sheet (JSON). */
export interface BoardInfo {
  x: number
  y: number
  color: string
}

export interface Task {
  id: string
  title: string
  board: BoardInfo
  /** True when the Sheet had no position for this task and we picked one. */
  autoPlaced?: boolean
}

export interface Camera {
  /** Top-left corner of the visible world, in screen pixels. */
  x: number
  y: number
  zoom: number
}

/** A freehand stroke, in world coordinates. */
export interface Stroke {
  id: string
  /** Ink color. */
  c: string
  /** Line width in world units. */
  w: number
  /** Flat list of points: x0, y0, x1, y1, ... */
  p: number[]
}
