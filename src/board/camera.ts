import type { Camera } from '../types'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Screen -> world. */
export function screenToWorld(cam: Camera, sx: number, sy: number) {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom }
}

/** Changes the zoom while keeping the world point under (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, newZoom: number): Camera {
  const zoom = clampZoom(newZoom)
  const w = screenToWorld(cam, sx, sy)
  return { zoom, x: sx - w.x * zoom, y: sy - w.y * zoom }
}

/** Camera that shows all notes, centered, never zoomed in past 100%. */
export function fitCamera(
  notes: { x: number; y: number }[],
  size: number,
  vw: number,
  vh: number,
): Camera {
  if (notes.length === 0) return { x: vw / 2, y: vh / 2, zoom: 1 }
  const minX = Math.min(...notes.map((n) => n.x))
  const minY = Math.min(...notes.map((n) => n.y))
  const maxX = Math.max(...notes.map((n) => n.x)) + size
  const maxY = Math.max(...notes.map((n) => n.y)) + size
  const w = maxX - minX
  const h = maxY - minY
  const zoom = clampZoom(Math.min(1, (vw * 0.85) / w, ((vh - 80) * 0.85) / h))
  return {
    zoom,
    x: vw / 2 - ((minX + maxX) / 2) * zoom,
    y: vh / 2 + 20 - ((minY + maxY) / 2) * zoom,
  }
}
