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

/** Camera that shows a world rectangle, centered, never zoomed in past 100%. */
export function fitRect(minX: number, minY: number, maxX: number, maxY: number, vw: number, vh: number): Camera {
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const zoom = clampZoom(Math.min(1, (vw * 0.85) / w, ((vh - 80) * 0.85) / h))
  return {
    zoom,
    x: vw / 2 - ((minX + maxX) / 2) * zoom,
    y: vh / 2 + 20 - ((minY + maxY) / 2) * zoom,
  }
}

/** Camera that shows all notes. */
export function fitCamera(
  notes: { x: number; y: number }[],
  size: number,
  vw: number,
  vh: number,
): Camera {
  if (notes.length === 0) return { x: vw / 2, y: vh / 2, zoom: 1 }
  return fitRect(
    Math.min(...notes.map((n) => n.x)),
    Math.min(...notes.map((n) => n.y)),
    Math.max(...notes.map((n) => n.x)) + size,
    Math.max(...notes.map((n) => n.y)) + size,
    vw,
    vh,
  )
}
