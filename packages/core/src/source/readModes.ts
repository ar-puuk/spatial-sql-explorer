// How the engine reaches each format (spec 007, research §4). A data catalog:
// one row per format, measured in the real engine in both shells. Thresholds
// live here with the measurement that set them; tests may override them only
// through `?e2e=1` (setTestOverrides), never in production.
import type { ReadModeKind } from '../models.js'

export type FormatId = 'geoparquet' | 'flatgeobuf' | 'geojson' | 'shapefile' | 'geopackage' | 'gml' | 'csv' | 'pmtiles'

const MB = 1024 * 1024

/**
 * Most features drawn for one map view. MapLibre already drew spec 002's
 * 50,000-row results acceptably; half that keeps pans responsive. Tuned by
 * measurement in T058 (SC-003).
 */
export const VIEW_CAP = 25_000

/**
 * FlatGeobuf read in parts costs ~0.74 ms per feature through a handle or
 * HTTP (research §4: 50,000 features in 37 s), so ~2,500 keeps a view under
 * 2 s (SC-003).
 */
export const PARTIAL_VIEW_CAP = 2_500

/**
 * Whole-read formats are announced above this size: ~70 ms/MB measured for
 * GeoJSON (325 MB in 22.7 s, research §4), so about 7 s of reading. FlatGeobuf
 * up to this size is simply loaded into memory (a 158 MB scan took 232 ms).
 */
export const WHOLE_READ_THRESHOLD_BYTES = 100 * MB

/** Query results up to this many rows are materialized with an R-tree; larger ones stay views (research §9). */
export const MATERIALIZE_CAP = 500_000

/** Natural breaks runs on at most this many values; larger results use a deterministic sample (research §11). */
export const JENKS_SAMPLE = 50_000

export interface ReadModeRow {
  format: FormatId
  mode: ReadModeKind
  /** File extensions (lower case) that select this format. */
  extensions: readonly string[]
}

/** The catalog. GeoPackage is whole-read until a spike shows otherwise (research §4). */
export const READ_MODES: readonly ReadModeRow[] = [
  { format: 'geoparquet', mode: 'partial', extensions: ['.parquet', '.geoparquet'] },
  { format: 'flatgeobuf', mode: 'partial-view', extensions: ['.fgb', '.flatgeobuf'] },
  { format: 'geojson', mode: 'whole', extensions: ['.geojson', '.json'] },
  { format: 'shapefile', mode: 'whole', extensions: ['.shp'] },
  { format: 'geopackage', mode: 'whole', extensions: ['.gpkg'] },
  { format: 'gml', mode: 'whole', extensions: ['.gml'] },
  { format: 'csv', mode: 'whole', extensions: ['.csv'] },
  { format: 'pmtiles', mode: 'tiles', extensions: ['.pmtiles'] },
]

export function formatFromFileName(name: string): FormatId | null {
  const lower = name.toLowerCase()
  return READ_MODES.find((r) => r.extensions.some((ext) => lower.endsWith(ext)))?.format ?? null
}

export interface ReadMode {
  format: FormatId
  mode: ReadModeKind
  viewCap: number
  wholeReadThresholdBytes: number
}

/**
 * The read mode for one file on one platform. `partialReads: false` (the VS
 * Code fallback, FR-015) reads every engine format whole; PMTiles never
 * involves the engine. FlatGeobuf up to the threshold is loaded into memory,
 * where it's fast (research §4).
 */
export function readModeFor(format: FormatId, sizeBytes: number, platform: { partialReads: boolean }): ReadMode {
  const o = overrides
  const wholeReadThresholdBytes = o.wholeThreshold ?? WHOLE_READ_THRESHOLD_BYTES
  const row = READ_MODES.find((r) => r.format === format)
  if (!row) throw new Error(`Unknown format: ${format}`)
  let mode = row.mode
  if (mode !== 'tiles' && !platform.partialReads) mode = 'whole'
  else if (mode === 'partial-view' && sizeBytes <= wholeReadThresholdBytes) mode = 'whole'
  const viewCap = o.cap ?? (mode === 'partial-view' ? PARTIAL_VIEW_CAP : VIEW_CAP)
  return { format, mode, viewCap, wholeReadThresholdBytes }
}

// --- Test overrides (e2e only) ------------------------------------------------

export interface TestOverrides {
  cap?: number
  wholeThreshold?: number
  materializeCap?: number
  jenksSample?: number
  memoryLimit?: string
  slowViewMs?: number
  slowParse?: boolean
}

/** Query-string keys honored with `e2e=1` (documented in tests/web/specs/helpers.ts). */
export const TEST_OVERRIDE_KEYS = ['cap', 'wholeThreshold', 'materializeCap', 'jenksSample', 'memoryLimit', 'slowViewMs', 'slowParse'] as const

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
  const num = (key: 'cap' | 'wholeThreshold' | 'materializeCap' | 'jenksSample' | 'slowViewMs'): void => {
    const v = params.get(key)
    if (v !== null && /^\d+$/.test(v)) out[key] = Number(v)
  }
  num('cap')
  num('wholeThreshold')
  num('materializeCap')
  num('jenksSample')
  const mem = params.get('memoryLimit')
  if (mem && /^\d+(\.\d+)?\s*(KB|MB|GB|KiB|MiB|GiB)$/i.test(mem)) out.memoryLimit = mem
  num('slowViewMs')
  if (params.get('slowParse') === '1') out.slowParse = true
  return out
}

/** The materialize cap in effect (MATERIALIZE_CAP unless overridden in a test). */
export function materializeCap(): number {
  return overrides.materializeCap ?? MATERIALIZE_CAP
}

/** The natural-breaks sample size in effect. */
export function jenksSample(): number {
  return overrides.jenksSample ?? JENKS_SAMPLE
}
