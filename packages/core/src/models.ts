// Data model types for spec 001 (Quick Look). See
// specs/001-quick-look/data-model.md for field-by-field rationale.

export type GeometryType = 'Point' | 'LineString' | 'Polygon' | 'Mixed'

export type Bbox = [minX: number, minY: number, maxX: number, maxY: number]

export interface CrsInfo {
  /** Human-readable identifier for display (e.g. an EPSG code or WKT-derived name). */
  label: string
  /** True when no reprojection is needed for display. */
  isWgs84: boolean
  /** Spec 026: the EPSG code when the file declares one (a raster's card shows it). */
  code?: number
  /** Spec 026: the unit of the coordinates in this system. */
  units?: CrsUnits
}

export type CrsUnits = 'degrees' | 'metres' | 'feet' | 'other'

export interface Feature {
  /** Stable within the layer; correlates map <-> table selection. */
  id: string | number
  /** Reprojected to EPSG:4326 for display. */
  geometry: GeoJSON.Geometry | null
  attributes: Record<string, string | number | boolean | null>
  /** PMTiles (US5): the archive layer the feature came from, shown by the inspector. */
  sourceLayer?: string
}

/**
 * What the map and table display. Since spec 002 this is a query result: the
 * initial view is the result of DEFAULT_QUERY, and every later query replaces
 * it. The map, table, inspector, style panel and status bar all render from
 * this one shape.
 */
export interface Layer {
  /** Spec 013: a File Geodatabase layer's coded domains (column to code to description), for display only. */
  columnDomains?: Record<string, Record<string, string>>
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
  /** Rows in the complete result: more than `rowCount` when truncated ("Showing 1,000 of N"). */
  totalRows: number
  /** WGS84 extent to fit. For the initial view this is the whole file's extent, not just the loaded subset. */
  extent: Bbox | null
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
  /** Spec 024: the style a format of its own starts with (a GTFS feed), used when there is no sidecar. */
  defaultStyle?: import('./style/model.js').LayerStyle
  /** Milliseconds per load step, for logs. Diagnostic only. */
  loadTimings?: Record<string, number>
  /** Whole-file facts, never derived from what's on screen (spec 007 FR-001). */
  facts?: DatasetFacts
  /**
   * Spec 026: set when the open layer is a raster (GeoTIFF or COG). Then `geometryType` is a neutral
   * 'Mixed', `columns` is empty, `rowCount` and `featureCount` are 0, `extent` is the raster's WGS84
   * bounds, and nothing that reads rows (SQL, table, filters, selection) applies: see `capabilities`.
   */
  raster?: import('./raster/types.js').RasterFacts
}

// --- Spec 007: large files and viewport loading ------------------------------------

/** How the engine reaches a file (research §4). `tiles`: the map reads it, not the engine. */
export type ReadModeKind = 'partial' | 'whole' | 'tiles'

/** Where map views get feature bounding boxes. */
export type SpatialIndexKind = 'covering' | 'built' | 'building' | 'file' | 'rtree' | 'none'

/** Whole-file facts shown at once (FR-001). */
export interface DatasetFacts {
  /**
   * Spec 008 US3: every layer of a file holding more than one (GeoPackage),
   * in file order; absent for single-layer files. `activeLayer` names the
   * one opened as `layer`.
   */
  /** `sqlName`: what a query names the layer by (`us_boundaries.counties`). */
  layers?: Array<{ name: string; geometryType: GeometryType | null; featureCount: number | null; sqlName?: string; /** Spec 013: the geodatabase's feature dataset holding the layer. */ group?: string | null }>
  activeLayer?: string
  /** Spec 013: the file is a geodatabase read through the experimental reader. */
  experimental?: boolean
  rows: number
  /** True only while a count is still pending. */
  rowsEstimated: boolean
  /** Rows with missing or invalid geometry, when known without a full scan (null = unknown). */
  invalid: number | null
  extent: Bbox | null
  crs: CrsInfo
  crsAssumed: boolean
  srid: number | null
  geometryType: GeometryType
  columns: Array<{ name: string; type: string }>
  readMode: ReadModeKind
  spatialIndex: SpatialIndexKind
  /** Why the whole file is being read, when partial reads failed (FR-015). */
  fallback: string | null
  /** Spec 024: a caveat about how the file was drawn (a GTFS feed), shown once over the map. */
  notice?: string
  /** Spec 024: the file's layers share one style (a GTFS feed's routes and stops are drawn together with it), so switching layer keeps it. */
  sharedStyle?: boolean
  /**
   * FlatGeobuf read in parts (T044): the map works, but queries, the table,
   * thematic styles and export wait until the user loads the whole file.
   */
  /** PMTiles (US5): the archive's zoom range and vector layers, from its header and metadata. */
  tiles?: { minZoom: number; maxZoom: number; layers: string[] }
}

export interface TablePageRequest {
  offset: number
  limit: number
  sort: { column: string; dir: 'asc' | 'desc' } | null
}

export interface TablePage {
  offset: number
  rows: Array<{ id: number; attributes: Feature['attributes']; invalidGeometry: boolean }>
}

/** The input to classification, computed in SQL over the whole result (research §11). */
export interface StyleStats {
  column: string
  rows: number
  nulls: number
  categories?: Array<{ value: string | number | boolean | null; count: number }>
  otherCount?: number
  min?: number
  max?: number
  quantiles?: number[]
  /** Natural-breaks input: every value, or a deterministic sample when `sampled`. */
  values?: number[]
  sampled?: boolean
  /** Exact, after breaks are known. */
  classCounts?: number[]
}

/** The open pipeline's visible phases (data-model.md OpenPhase). */
export type OpenPhase = 'registering' | 'converting' | 'facts' | 'announce' | 'reading' | 'indexing' | 'ready' | 'cancelled' | 'failed'

// --- Spec 002: query ------------------------------------------------------------

/**
 * The initial view's query (spec 002 FR-003); Reset restores it (FR-011).
 * Spec 007 FR-009: no LIMIT. The whole file is the result; the map draws it
 * by view and the table pages it.
 */
export const DEFAULT_QUERY = 'SELECT * FROM layer'

/** The opened file as SQL sees it (spec 002 data-model.md). */
export interface QueryableTable {
  /** Always `layer`. */
  name: 'layer'
  /**
   * The file's own name in SQL (fileSqlNames): `us_counties`, `"2020_tracts"`,
   * or `us_boundaries.counties` for a layer of a multi-layer file. Null: only `layer`.
   */
  alias: string | null
  /** The schema holding a multi-layer file's layers (as SQL), or null. */
  schema?: string | null
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
  /** `schema`: set for a multi-layer file's layers (`us_boundaries.counties`); absent for `main` and temp objects. */
  tables: Array<{ name: string; schema?: string; kind: 'table' | 'view'; columns: Array<{ name: string; type: string }> }>
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
  cursorCoordinates: { lon: number; lat: number; elevation?: number | null } | null
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
