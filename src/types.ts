import type { Cell } from './fields'

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
  /** Strokes drawn on the note, in note coordinates (0..NOTE_SIZE). */
  drawing?: Stroke[]
  /** Free text; equals the name of the zone the note sits in, if any. */
  status?: string
  description?: string
  /** Id of the note this one is a sub-task of (the `parent` column). */
  parent?: string
  /** Custom columns (anything besides id, title, description, board, drawing, status), by column key. */
  values?: Record<string, Cell>
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

/** A rectangle on the board. Dropping a note in it sets the note's status to the zone's name. */
export interface Zone {
  id: string
  x: number
  y: number
  w: number
  h: number
  /**
   * The status this zone auto-assigns to notes dropped in it (empty: the zone only groups notes).
   * Named `name` for historical reasons: older zones used it as their title too.
   */
  name: string
  /** Shown in the zone's header; when empty, the auto-assign status is shown instead. */
  title?: string
  /** Header font size in world units (default 26). */
  titleSize?: number
  color: string
  /** Work-in-progress limit: the counter turns red above it. */
  limit?: number
}

export type ArrowMode = 'one' | 'both' | 'none'

/** A dotted line between two notes. */
export interface Link {
  id: string
  /** Task ids. The arrow, if any, points at `to`. */
  from: string
  to: string
  /** `one`: arrowhead at `to`; `both`: at both ends; `none`: plain line. */
  arrow: ArrowMode
}

/** A color the user picked for one value of a column (e.g. priority "A"), kept in the app because the
 *  Sheets API cannot read the colors of dropdown chips. */
export interface ColorRule {
  /** Column key (lowercased header) or "status". */
  key: string
  /** The value, lowercased and trimmed. */
  raw: string
  color: string
}
