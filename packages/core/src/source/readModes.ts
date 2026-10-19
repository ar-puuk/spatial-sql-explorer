// How the engine reaches each format (spec 007, research §4). A data catalog:
// one row per format, measured in the real engine in both shells. Thresholds
// live here with the measurement that set them; tests may override them only
// through `?e2e=1` (setTestOverrides), never in production.
import type { ReadModeKind } from '../models.js'
import { TILE_ROWS } from '../view/drawMode.js'

export type FormatId = 'geoparquet' | 'flatgeobuf' | 'geojson' | 'shapefile' | 'geopackage' | 'sqlite' | 'gml' | 'csv' | 'xlsx' | 'pmtiles'

const MB = 1024 * 1024

/**
 * Whole-read formats are announced above this size: ~70 ms/MB measured for
 * GeoJSON (325 MB in 22.7 s, research §4), so about 7 s of reading. FlatGeobuf
 * up to this size is simply loaded into memory (a 158 MB scan took 232 ms).
 */
export const WHOLE_READ_THRESHOLD_BYTES = 100 * MB

/** Query results up to this many rows are materialized with an R-tree; larger ones stay views (research §9). */
export const MATERIALIZE_CAP = 500_000

/**
 * Styles fetch and classify at most this many values; above, natural breaks
 * runs on this many evenly spaced order statistics (spec 003's own sampling,
 * so breaks match spec 003 exactly; research.md US3 outcomes). Counts stay exact.
 */
export const JENKS_SAMPLE = 200_000

export interface ReadModeRow {
  format: FormatId
  mode: ReadModeKind
  /** File extensions (lower case) that select this format. */
  extensions: readonly string[]
}

/** The catalog. GeoPackage is whole-read until a spike shows otherwise (research §4). */
export const READ_MODES: readonly ReadModeRow[] = [
  { format: 'geoparquet', mode: 'partial', extensions: ['.parquet', '.geoparquet'] },
  // Spec 010: read whole (engine tiles draw big files; reading in parts existed for per-pan views).
  { format: 'flatgeobuf', mode: 'whole', extensions: ['.fgb', '.flatgeobuf'] },
  { format: 'geojson', mode: 'whole', extensions: ['.geojson', '.json'] },
  { format: 'shapefile', mode: 'whole', extensions: ['.shp'] },
  { format: 'geopackage', mode: 'whole', extensions: ['.gpkg'] },
  // SQLite / SpatiaLite databases, e.g. Bentley Cube 7 networks (research §16).
  { format: 'sqlite', mode: 'whole', extensions: ['.sqlite', '.db'] },
  { format: 'gml', mode: 'whole', extensions: ['.gml'] },
  { format: 'csv', mode: 'whole', extensions: ['.csv'] },
  // Spec 010: the first sheet of a workbook, with lon/lat or WKT columns, like CSV.
  { format: 'xlsx', mode: 'whole', extensions: ['.xlsx'] },
  { format: 'pmtiles', mode: 'tiles', extensions: ['.pmtiles'] },
]

export function formatFromFileName(name: string): FormatId | null {
  const lower = name.toLowerCase()
  return READ_MODES.find((r) => r.extensions.some((ext) => lower.endsWith(ext)))?.format ?? null
}

export interface ReadMode {
  format: FormatId
  mode: ReadModeKind
  wholeReadThresholdBytes: number
}

/**
 * The read mode for one file on one platform. `partialReads: false` (the VS
 * Code fallback, FR-015) reads every engine format whole; PMTiles never
 * involves the engine. The size no longer picks a mode (spec 010: FlatGeobuf
 * is always read whole); whole reads over the threshold are announced.
 */
export function readModeFor(format: FormatId, _sizeBytes: number, platform: { partialReads: boolean }): ReadMode {
  const o = overrides
  const wholeReadThresholdBytes = o.wholeThreshold ?? WHOLE_READ_THRESHOLD_BYTES
  const row = READ_MODES.find((r) => r.format === format)
  if (!row) throw new Error(`Unknown format: ${format}`)
  let mode = row.mode
  if (mode !== 'tiles' && !platform.partialReads) mode = 'whole'
  return { format, mode, wholeReadThresholdBytes }
}

// --- Test overrides (e2e only) ------------------------------------------------

export interface TestOverrides {
  wholeThreshold?: number
  /** Whole-read files up to this many bytes are fetched into memory first (default 64 MB); 0 tests the handle/URL path. */
  wholeBytes?: number
  materializeCap?: number
  jenksSample?: number
  memoryLimit?: string
  /** Spec 010: an artificial delay before each engine tile (loading-cue tests). */
  slowTileMs?: number
  /** Spec 010: results with at least this many rows are drawn as tiles (TILE_ROWS). */
  tileRows?: number
  /** `true`: a 3 s cancellable pause in the open; `'stuck'`: an 8 s pause that ignores Cancel, like a GDAL parse. */
  slowParse?: boolean | 'stuck'
  /** Spec 024: a GTFS feed is read without the GDAL reader (the SQL fallback). */
  noGdal?: boolean
}

/** Query-string keys honored with `e2e=1` (documented in tests/web/specs/helpers.ts). */
export const TEST_OVERRIDE_KEYS = ['wholeThreshold', 'wholeBytes', 'materializeCap', 'jenksSample', 'memoryLimit', 'slowParse', 'tileRows', 'slowTileMs', 'noGdal'] as const

let overrides: TestOverrides = {}

export function setTestOverrides(next: TestOverrides): void {
  overrides = { ...next }
}

export function testOverrides(): TestOverrides {
  return overrides
}

/** Parses the overrides from a query string; empty unless `e2e=1` is present. */
export function parseTestOverrides(search: string): TestOverrides {
  const params = new URLSearchParams(search)
  if (!params.has('e2e')) return {}
  const out: TestOverrides = {}
  const num = (key: 'wholeThreshold' | 'wholeBytes' | 'materializeCap' | 'jenksSample' | 'tileRows' | 'slowTileMs'): void => {
    const v = params.get(key)
    if (v !== null && /^\d+$/.test(v)) out[key] = Number(v)
  }
  num('wholeThreshold')
  num('wholeBytes')
  num('materializeCap')
  num('jenksSample')
  num('tileRows')
  num('slowTileMs')
  const mem = params.get('memoryLimit')
  if (mem && /^\d+(\.\d+)?\s*(KB|MB|GB|KiB|MiB|GiB)$/i.test(mem)) out.memoryLimit = mem
  if (params.get('noGdal') === '1') out.noGdal = true
  if (params.get('slowParse') === '1') out.slowParse = true
  else if (params.get('slowParse') === 'stuck') out.slowParse = 'stuck'
  return out
}

/** The materialize cap in effect (MATERIALIZE_CAP unless overridden in a test). */
export function materializeCap(): number {
  return overrides.materializeCap ?? MATERIALIZE_CAP
}

/** Spec 010: the row count from which results are drawn as tiles (TILE_ROWS unless overridden in a test). */
export function tileRows(): number {
  return overrides.tileRows ?? TILE_ROWS
}

/** The natural-breaks sample size in effect. */
export function jenksSample(): number {
  return overrides.jenksSample ?? JENKS_SAMPLE
}
