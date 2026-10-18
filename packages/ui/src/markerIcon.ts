// Marker icons for shapes other than the circle (MapLibre's circle layer
// draws only circles). Each icon is drawn once per look, from its id
// (core `markerIconId`), when the map asks for it. Icons are drawn at 2x (or
// the screen's ratio, if higher) so a 2x map image stays sharp.
import { markerExtent, markerPath, parseMarkerIconId } from '@spatial-explorer/core'

export const ICON_PIXEL_RATIO = (): number => Math.max(2, Math.ceil(globalThis.devicePixelRatio || 1))

/** The icon for `id`, or null when the id isn't one of ours. The outline is centered on the shape's edge, as in QGIS. */
export function drawMarkerIcon(id: string, pixelRatio = ICON_PIXEL_RATIO()): { image: ImageData; pixelRatio: number } | null {
  const m = parseMarkerIconId(id)
  if (!m) return null
  const half = m.radius * markerExtent(m.shape) + m.strokeWidth / 2 + 1
  const size = Math.max(1, Math.ceil(half * 2 * pixelRatio))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(pixelRatio, pixelRatio)
  const c = size / pixelRatio / 2
  const path = new Path2D(markerPath(m.shape, m.radius, c, c))
  ctx.globalAlpha = m.fillOpacity
  ctx.fillStyle = m.fillColor
  ctx.fill(path)
  if (m.strokeWidth > 0) {
    ctx.globalAlpha = m.strokeOpacity
    ctx.strokeStyle = m.strokeColor
    ctx.lineWidth = m.strokeWidth
    ctx.lineJoin = 'miter'
    ctx.stroke(path)
  }
  return { image: ctx.getImageData(0, 0, size, size), pixelRatio }
}

/**
 * Spec 019: the arrowhead for direction arrows on lines, a white chevron pointing right (along the line). The map
 * tints it (an SDF image: only its shape matters), so one image serves every color.
 */
export function drawArrowIcon(pixelRatio = ICON_PIXEL_RATIO()): { image: ImageData; pixelRatio: number } | null {
  const size = 16 * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(pixelRatio, pixelRatio)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(2.5, 2)
  ctx.lineTo(14, 8)
  ctx.lineTo(2.5, 14)
  ctx.lineTo(5.5, 8)
  ctx.closePath()
  ctx.fill()
  return { image: ctx.getImageData(0, 0, size, size), pixelRatio }
}
