// CRS handling for spec 001: reproject for display (EPSG:4326), but always
// report the *original* source CRS to the user (FR-007), and disclose when
// WGS84 had to be assumed because the file had no CRS information (FR-015).

import type { CrsInfo } from './models.js'

export const WGS84: CrsInfo = { label: 'EPSG:4326 (WGS84)', isWgs84: true }

/**
 * Builds the `ST_Transform`-to-4326 expression DuckDB spatial needs to
 * reproject a geometry column for display, given the column's source SRID.
 * Returns the column expression unchanged when the source is already WGS84.
 *
 * `always_xy := true` is required, not optional: confirmed via a real
 * `duckdb` CLI spike that without it, `ST_Transform` treats a *geographic*
 * source CRS like EPSG:4326 in authority-defined [lat, lon] axis order, while
 * DuckDB spatial's `GEOMETRY` type always stores coordinates as [lon, lat]
 * internally — the mismatch silently produces `POINT (inf inf)` instead of
 * erroring. `always_xy := true` forces [lon, lat] (= [easting, northing]) on
 * both ends, matching how every geometry in this codebase is stored.
 */
export function reprojectToWgs84Sql(geometryColumn: string, sourceSrid: number | null): string {
  if (sourceSrid === null || sourceSrid === 4326) {
    return geometryColumn
  }
  return `ST_Transform(${geometryColumn}, 'EPSG:${sourceSrid}', 'EPSG:4326', always_xy := true)`
}

/**
 * Resolves the CrsInfo to report to the user for a given detected source
 * SRID. A `null` srid means the file had no CRS information — WGS84 is
 * assumed, but `crsAssumed: true` must be surfaced by the caller (FR-015)
 * rather than presenting this as if it were read from the file.
 */
export function resolveCrsInfo(sourceSrid: number | null): { crs: CrsInfo; assumed: boolean } {
  if (sourceSrid === null) {
    return { crs: WGS84, assumed: true }
  }
  if (sourceSrid === 4326) {
    return { crs: WGS84, assumed: false }
  }
  return { crs: { label: `EPSG:${sourceSrid}`, isWgs84: false }, assumed: false }
}
