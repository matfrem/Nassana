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
