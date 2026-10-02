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
  /** Position du coin haut-gauche du monde visible, en pixels écran. */
  x: number
  y: number
  zoom: number
}
