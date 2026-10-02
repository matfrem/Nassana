/** Contenu de la colonne `board` du Sheet (JSON). */
export interface BoardInfo {
  x: number
  y: number
  color: string
}

export interface Task {
  id: string
  title: string
  board: BoardInfo
}

export interface Camera {
  /** Top-left corner of the visible world, in screen pixels. */
  x: number
  y: number
  zoom: number
}
