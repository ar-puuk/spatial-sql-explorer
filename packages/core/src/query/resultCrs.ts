// Which CRS a query result's geometry is in (spec 002 FR-014; research §4).
// DuckDB v1.4.3 (DuckDB-WASM 1.32.0) types GEOMETRY without a CRS and has no
// ST_SRID, so the engine can't say. Precedence:
//   1. the user's override (Result CRS chip);
//   2. a CRS the engine reports in the type, e.g. GEOMETRY('EPSG:3857'),
//      which newer DuckDB versions do, so an upgrade gets this for free;
//   3. detection: a projected layer whose result now fits lon/lat bounds
//      while the layer's own extent doesn't was transformed to EPSG:4326 (the
//      common ST_Transform(geom, …, 'EPSG:4326') case);
//   4. the layer's CRS.
// The chip always states which one applied, so a wrong guess is visible and
// correctable.
import { resolveCrsInfo } from '../crs.js'
import type { Bbox, CrsInfo, ResultCrsSource } from '../models.js'

export interface ResolvedResultCrs {
  crs: CrsInfo
  srid: number | null
  source: ResultCrsSource
}

export interface ResultCrsInput {
  override: number | null
  engineType: string
  resultExtent: Bbox | null
  layerSrid: number | null
  /** The layer's extent in its own CRS. */
  layerExtent: Bbox | null
}

const withinLonLat = (b: Bbox | null): boolean => b !== null && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90

const resolved = (srid: number | null, source: ResultCrsSource): ResolvedResultCrs => ({ crs: resolveCrsInfo(srid).crs, srid, source })

export function resolveResultCrs(input: ResultCrsInput): ResolvedResultCrs {
  if (input.override !== null) return resolved(input.override, 'override')
  const typed = /EPSG:(\d{4,6})/i.exec(input.engineType)
  if (typed) return resolved(Number(typed[1]), 'engine')
  const projectedLayer = input.layerSrid !== null && input.layerSrid !== 4326
  if (projectedLayer && withinLonLat(input.resultExtent) && !withinLonLat(input.layerExtent)) return resolved(4326, 'detected')
  return resolved(input.layerSrid, 'layer')
}
