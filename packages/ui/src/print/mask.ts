// Adapted from GeoLibre (opengeos/GeoLibre, MIT, © 2026 Qiusheng Wu): apps/geolibre-desktop/src/lib/print-atlas-camera.ts
// (paintAtlasMask). The atlas dims everything outside the page's polygon feature; here that is painted onto the
// capture, not drawn on the map as a layer.

/**
 * Paints the atlas mask, a translucent white over everything outside a polygon feature, onto a capture.
 *
 * @param context - The capture's 2D context.
 * @param feature - A Polygon or MultiPolygon feature.
 * @param project - Geographic position to viewport CSS pixels.
 * @param scale - Capture pixels per CSS pixel.
 */
export function paintAtlasMask(context: CanvasRenderingContext2D, feature: GeoJSON.Feature, project: (position: [number, number]) => { x: number; y: number }, scale: number): void {
  const geometry = feature.geometry
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
  if (!polygons.length) return
  const { width, height } = context.canvas
  context.save()
  context.beginPath()
  context.rect(0, 0, width, height)
  // Even-odd: the feature's rings cut it out, and its holes stay masked.
  for (const polygon of polygons) {
    for (const ring of polygon) {
      // Each ring starts its own subpath at its first vertex that projects.
      let started = false
      for (const position of ring) {
        let point: { x: number; y: number }
        try {
          point = project([position[0], position[1]])
        } catch {
          continue
        }
        if (started) context.lineTo(point.x * scale, point.y * scale)
        else context.moveTo(point.x * scale, point.y * scale)
        started = true
      }
      if (started) context.closePath()
    }
  }
  context.fillStyle = 'rgba(255, 255, 255, 0.7)'
  context.fill('evenodd')
  context.restore()
}
