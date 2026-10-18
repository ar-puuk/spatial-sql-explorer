// Spec 017: how many cells a bin will have, and which resolution to start from. Estimates only: the extent and the
// average cell area, never the data. The dialog shows them next to each resolution and uses them to decide whether
// the preview redraws at once (under PREVIEW_CELL_LIMIT) and whether to warn first (over CELL_LIMIT).
import type { Bbox } from '../models.js'
import type { GridSystem } from './gridSystems.js'

/** Results over this many cells are drawn from engine tiles, so the dialog warns before running them (spec FR-8, plan decision 8). */
export const CELL_LIMIT = 100_000
/** Under this many estimated cells, changing the resolution redraws after a short pause; above it the user presses Run. */
export const PREVIEW_CELL_LIMIT = 5_000
/** The cell count a new bin aims for. */
export const TARGET_CELLS = 2_000

const EARTH_RADIUS_KM = 6371.0088

/** The area of a longitude/latitude box on the sphere, in km². */
export function extentAreaKm2(extent: Bbox): number {
  const [west, south, east, north] = extent
  const lon = (Math.abs(east - west) * Math.PI) / 180
  const lat = Math.abs(Math.sin((north * Math.PI) / 180) - Math.sin((south * Math.PI) / 180))
  return EARTH_RADIUS_KM * EARTH_RADIUS_KM * lon * lat
}

/**
 * About how many cells a bin at `res` has: the extent's area over the average cell area (plus the cells along its
 * edge), never more than the rows, never fewer than one. Without an extent, only the rows are known.
 */
export function estimateCells(system: GridSystem, res: number, extent: Bbox | null, rows: number): number {
  const area = system.cellAreaKm2[res]
  if (area === undefined) return 0
  const byArea = extent ? extentAreaKm2(extent) / area + 1 : Number.POSITIVE_INFINITY
  return Math.max(1, Math.round(Math.min(byArea, rows)))
}

/**
 * The resolution a new bin starts from: the finest one whose area-based estimate stays within TARGET_CELLS (fewer
 * for a small layer, so a hundred points do not become a hundred one-point cells), inside the system's range.
 */
export function suggestResolution(system: GridSystem, extent: Bbox | null, rows: number): number {
  const target = Math.min(TARGET_CELLS, Math.max(25, Math.round(rows / 20)))
  if (!extent) {
    // Nothing known about where the data is: a cell of about a thousand square kilometers.
    let best = system.minRes
    for (let r = system.minRes; r <= system.maxRes; r++) {
      if (Math.abs(Math.log(system.cellAreaKm2[r] / 1000)) < Math.abs(Math.log(system.cellAreaKm2[best] / 1000))) best = r
    }
    return best
  }
  const total = extentAreaKm2(extent)
  let pick = system.minRes
  for (let r = system.minRes; r <= system.maxRes; r++) {
    if (total / system.cellAreaKm2[r] + 1 <= target) pick = r
    else break
  }
  return pick
}
