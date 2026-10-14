// Spec 011: what a style draws on the snapshot layer, as plain JSON: the
// resolved classes (without spec 011's `channels`), paint, layout, filter and
// marker icons. Used to compare an imported sidecar before and after 011.
import { layoutFor, markerIconIds, paintFor, resolveStyle, visibilityFilter, type LayerStyle } from '@spatial-explorer/core'
import { snapshotLayer011 } from './pre-011-styles'

export function drawnAfterImport(style: LayerStyle): unknown {
  const layer = snapshotLayer011()
  const r = resolveStyle(style, layer) as ReturnType<typeof resolveStyle> & { channels?: unknown }
  const { channels: _c, ...resolved } = r
  void _c
  return JSON.parse(JSON.stringify({ resolved, paint: paintFor(style, r, '#f59e0b', 40), layout: layoutFor(style, r), filter: visibilityFilter(style, r), icons: markerIconIds(style, r) }))
}
