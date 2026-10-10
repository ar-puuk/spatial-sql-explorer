// Data model types for spec 001 (Quick Look). See
// specs/001-quick-look/data-model.md for field-by-field rationale.

export type GeometryType = 'Point' | 'LineString' | 'Polygon' | 'Mixed'

export type Bbox = [minX: number, minY: number, maxX: number, maxY: number]

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
  featureCount: number
  /** Geometries skipped during rendering/parsing because they were invalid (FR-014). */
  invalidGeometryCount: number
  extent: Bbox | null
  features: Feature[]
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
