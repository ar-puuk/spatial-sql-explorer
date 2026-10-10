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

export interface Layer {
  id: string
  sourceUri: string
  sourceFormat: string
  geometryType: GeometryType
  sourceCrs: CrsInfo
  /** True when the file had no CRS information and WGS84 was assumed (FR-015). */
  crsAssumed: boolean
  /** Total count of valid features in the source — shown in metadata displays (FR-006), independent of how many are actually loaded. */
  featureCount: number
  /** Geometries skipped during rendering/parsing because they were invalid (FR-014). */
  invalidGeometryCount: number
  /** True when featureCount > DEFAULT_FEATURE_CAP and only the first DEFAULT_FEATURE_CAP were loaded into `features` (FR-019). */
  truncated: boolean
  /** Computed from the full source extent, not just the loaded subset, so fit-to-extent is correct even when truncated. */
  extent: Bbox | null
  /** The loaded/rendered subset actually held in memory — at most DEFAULT_FEATURE_CAP entries (FR-019). */
  features: Feature[]
  /**
   * The QGIS-convention style sidecar found next to the data file
   * (`<basename>.qml`), as raw text, or null. Parsed by the UI via
   * `importStyle()` and applied on open (design-plan.md §8.5).
   */
  styleSidecar: { fileName: string; text: string } | null
  /** Milliseconds per load step (prepare, scan, rows), for logs. Diagnostic only. */
  loadTimings?: Record<string, number>
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
