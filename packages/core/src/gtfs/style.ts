// Spec 024: how a GTFS feed looks until the person restyles it, after GTFS-X's decisions (specs/024-gtfs/research.md §4;
// its code is AGPL and never used). Routes are lines in their own `route_color`, three pixels wide with round caps and a
// direction arrow every 80 px; stops are dots in the color of the route that serves them, with a white outline. Names
// show from zoom 13: the route's along its line, the stop's beside it. Both read the `color` column of the network
// result (gtfs/sql.ts), which already holds `#rrggbb` with GTFS-X's grey where the feed gives no color.
import { DEFAULT_ARROWS, sanitizeStyle, type LayerStyle } from '../style/model.js'

/** The columns the default style reads from the network result. */
export const GTFS_COLOR_COLUMN = 'color'
export const GTFS_NAME_COLUMN = 'name'

/** GTFS-X's greys, for a route or a stop with no color. */
export const GTFS_ROUTE_FALLBACK = '#888888'
export const GTFS_STOP_FALLBACK = '#8b7e74'
/** GTFS-X's label color, and the zoom its names start at. */
export const GTFS_LABEL_COLOR = '#3d2e22'
export const GTFS_LABEL_MIN_ZOOM = 13

export function gtfsDefaultStyle(): LayerStyle {
  return sanitizeStyle({
    fillColor: GTFS_STOP_FALLBACK,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWidth: 1,
    pointRadius: 3.5,
    lineWidth: 3,
    channels: {
      color: { source: { kind: 'column', column: GTFS_COLOR_COLUMN }, scale: { kind: 'identity', noValue: {} } },
    },
    arrows: { ...DEFAULT_ARROWS, size: 0.6 },
    labels: {
      enabled: true,
      source: { kind: 'column', column: GTFS_NAME_COLUMN },
      size: 12,
      color: GTFS_LABEL_COLOR,
      halo: { enabled: true, color: '#ffffff', width: 2 },
      placement: { kind: 'point', anchor: 'above', offset: 6 },
      minZoom: GTFS_LABEL_MIN_ZOOM,
    },
  })
}
