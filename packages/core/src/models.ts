// Data model types for spec 001 (Quick Look). See
// specs/001-quick-look/data-model.md for field-by-field rationale.

export type GeometryType = 'Point' | 'LineString' | 'Polygon' | 'Mixed'

export type Bbox = [minX: number, minY: number, maxX: number, maxY: number]

/** Default cap on how many features are loaded/rendered per layer (FR-019). */
export const DEFAULT_FEATURE_CAP = 1000

export interface CrsInfo {
  /** Human-readable identifier for display (e.g. an EPSG code or WKT-derived name). */
  label: string
  /** True when no reprojection is needed for display. */
  isWgs84: boolean
}

export interface Feature {
  /** Stable within the layer; correlates map <-> table selection. */
  id: string | number
  /** Reprojected to EPSG:4326 for display. */
  geometry: GeoJSON.Geometry | null
  attributes: Record<string, string | number | boolean | null>
}

/**
 * What the map and table display. Since spec 002 this is a query result: the
 * initial view is the result of DEFAULT_QUERY, and every later query replaces
 * it. The map, table, inspector, style panel and status bar all render from
 * this one shape.
 */
export interface Layer {
  id: string
  sourceUri: string
  sourceFormat: string
  geometryType: GeometryType
  /**
   * CRS of the displayed geometry before reprojection: the file's CRS for the
   * initial view, the resolved result CRS for queries (spec 002 FR-014).
   */
  sourceCrs: CrsInfo
  /** True when the CRS is an assumption, not read from the file (FR-015). */
  crsAssumed: boolean
  /** Rows in this result, all of them listed in the table (spec 002 plan, "Spec amendments"). */
  rowCount: number
  /** Rows drawn on the map: valid geometry. */
  featureCount: number
  /** Rows whose geometry is missing or invalid: listed in the table, not drawn (FR-014). */
  invalidGeometryCount: number
  /** True when this result is a subset: the default query's cap, or "Show first 50,000" (spec 002 FR-012). */
  truncated: boolean
  /** WGS84 extent to fit. For the initial view this is the whole file's extent, not just the loaded subset. */
  extent: Bbox | null
  /** All rows of the result. `geometry` is null when the row's geometry is missing or invalid. */
  features: Feature[]
  /**
   * The result's attribute columns (no geometry columns) with their DuckDB
   * types, in result order. Decides which columns each thematic renderer can
   * use (spec 003 research §5).
   */
  columns: Array<{ name: string; type: string }>
  /** Whole-file totals, independent of the displayed result: what metadata displays report (FR-006). */
  source: { rows: number; features: number; invalid: number }
  /**
   * The QGIS-convention style sidecar found next to the data file
   * (`<basename>.qml`), as raw text, or null. Parsed by the UI via
   * `importStyle()` and applied on open (design-plan.md §8.5).
   */
  styleSidecar: { fileName: string; text: string } | null
  /** Milliseconds per load step, for logs. Diagnostic only. */
  loadTimings?: Record<string, number>
}

// --- Spec 002: query ------------------------------------------------------------

/** The initial view's query (spec 002 FR-003); Reset restores it (FR-011). */
export const DEFAULT_QUERY = 'SELECT * FROM layer LIMIT 1000'

/** Results larger than this ask before rendering (spec 002 FR-012). */
export const LARGE_RESULT_THRESHOLD = 50_000

/** The opened file as SQL sees it (spec 002 data-model.md). */
export interface QueryableTable {
  /** Always `layer`. */
  name: 'layer'
  /** The file's base name, when it's a valid identifier (e.g. `parcels`). */
  alias: string | null
  columns: Array<{ name: string; type: string }>
  /** The file's original CRS. `geom` stays in it (FR-014). */
  crs: CrsInfo
  crsAssumed: boolean
  /** EPSG code of `crs`, or null when unknown (treated as WGS84). */
  srid: number | null
  backing: 'materialized' | 'streamed'
  totals: { rows: number; features: number; invalid: number }
  /** Whole-file WGS84 extent, and whether it's within lon/lat bounds in the source CRS (for result-CRS detection). */
  extent: Bbox | null
  sourceExtent: Bbox | null
  geometryType: GeometryType
}

export type ResultCrsSource = 'override' | 'engine' | 'detected' | 'layer'

export interface QueryHistoryEntry {
  text: string
  /** ISO 8601. */
  ranAt: string
  /** `summary` is set for temp DDL ("Created temp table `x` (N rows)"). */
  outcome: { ok: true; rows: number; summary?: string } | { ok: false; error: string }
}

export interface CatalogSnapshot {
  tables: Array<{ name: string; kind: 'table' | 'view'; columns: Array<{ name: string; type: string }> }>
  functions: Array<{ name: string; signatures: string[]; description: string; spatial: boolean }>
  keywords: string[]
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerSession {
  layer: Layer | null
  loadState: LoadState
  loadError: { message: string } | null
  basemapEnabled: boolean
  basemapAppearance: 'light' | 'dark'
  selectedFeatureId: Feature['id'] | null
  cursorCoordinates: { lon: number; lat: number } | null
}

export function createInitialViewerSession(): ViewerSession {
  return {
    layer: null,
    loadState: 'idle',
    loadError: null,
    basemapEnabled: true,
    basemapAppearance: 'light',
    selectedFeatureId: null,
    cursorCoordinates: null,
  }
}
