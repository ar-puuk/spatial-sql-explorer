// Spec 017: how many cells a bin will have, and which resolution to start from. Estimates only: the extent and the
// average cell area, never the data. The dialog shows them next to each resolution and uses them to decide whether
// the preview redraws at once (under PREVIEW_CELL_LIMIT) and whether to warn first (over CELL_LIMIT).
import { formatArea, formatLength, type UnitSystem } from '../draw/geodesy.js'
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

/** The fewest cells a resolution should give over the layer to be offered first (a few cells is not a summary). */
export const MIN_USEFUL_CELLS = 4

/** What the resolution picker shows for one resolution. */
export interface ResolutionChoice {
  res: number
  /** The average edge length in the reader's units ("9.9 km", "6.1 mi"). */
  edge: string
  /** The average cell area ("253 km²"). */
  area: string
  /** About how many cells the layer gets at this resolution (never more than its rows). */
  estimate: number
  /** Offered first: at least a few cells, and no more than the drawing limit. The rest are behind "All resolutions". */
  inRange: boolean
  /** More cells than are drawn without asking. */
  overLimit: boolean
}

/** Every resolution of `system` with its size and estimate, coarse to fine. */
export function resolutionChoices(system: GridSystem, extent: Bbox | null, rows: number, units: UnitSystem): ResolutionChoice[] {
  const total = extent ? extentAreaKm2(extent) : null
  const out: ResolutionChoice[] = []
  for (let res = system.minRes; res <= system.maxRes; res++) {
    const byArea = total === null ? null : total / system.cellAreaKm2[res] + 1
    const estimate = estimateCells(system, res, extent, rows)
    out.push({
      res,
      edge: formatLength(system.edgeKm[res] * 1000, units),
      area: formatArea(system.cellAreaKm2[res] * 1_000_000, units),
      estimate,
      // Without an extent nothing is known, so every resolution is offered.
      inRange: byArea === null || (byArea >= MIN_USEFUL_CELLS && byArea <= CELL_LIMIT),
      overLimit: estimate > CELL_LIMIT,
    })
  }
  return out
}

/** The resolutions offered first, as a range the slider can use; the whole range when none qualifies (a layer smaller than the coarsest cell). */
export function usableRange(choices: readonly ResolutionChoice[]): { min: number; max: number } {
  const inside = choices.filter((c) => c.inRange)
  if (inside.length === 0) return { min: choices[0].res, max: choices[choices.length - 1].res }
  return { min: inside[0].res, max: inside[inside.length - 1].res }
}
