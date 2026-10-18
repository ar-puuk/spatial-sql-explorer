// Spec 017: the grid systems the Bin into cells action offers (H3 and A5), as data: a row per system with its
// resolution range, its average cell sizes, how its SQL functions take coordinates, and the SQL that turns a
// cell into an id and a polygon. Adding a system is adding a row. The two extensions are loaded by the engine
// (step 1, duckdbService.ts); the sizes are the engine's own numbers (specs/017-grid-cells/research.md §4).
import sizes from './gridSizes.json'

export type GridSystemId = 'h3' | 'a5'

export interface GridSystem {
  id: GridSystemId
  label: string
  /** One line for the dialog. */
  summary: string
  minRes: number
  maxRes: number
  /** Average cell area (km²) and edge length (km), indexed by resolution. */
  cellAreaKm2: readonly number[]
  edgeKm: readonly number[]
  /** The order the system's functions take coordinates: H3 latitude first, A5 longitude first. Never shown to the user. */
  argumentOrder: 'latlng' | 'lonlat'
  /** Every cell has the same area (A5), so densities compare across latitudes. */
  equalArea: boolean
  /** SQL for the cell (an unsigned 64-bit id) containing longitude `lon`, latitude `lat` (SQL expressions) at `res`. */
  cellSql(lon: string, lat: string, res: number): string
  /** SQL for the cell's text id, from the SQL expression `cell`. */
  idSql(cell: string): string
  /**
   * SQL for the cell's outline as a polygon in longitude/latitude, from the SQL expression `cell`: the date line is
   * not yet handled here (see `splitDateLineSql`), so a cell across it can come back with a ring that jumps.
   */
  ringSql(cell: string): string
}

/**
 * H3 returns its ring wrapped (179.84 then -179.68). Each vertex is moved to the longitude nearest the cell's centre
 * (`lon + 360 * round((centre - lon) / 360)`), so a cell across the date line becomes one continuous ring that
 * extends past 180 or -180. Written as one expression (no subquery), which keeps it usable inside TRY().
 */
function h3Ring(cell: string): string {
  const centre = `h3_cell_to_lng(${cell})`
  const x = `CAST(split_part(p, ' ', 1) AS DOUBLE)`
  const unwrapped = `${x} + 360 * round((${centre} - ${x}) / 360)`
  return `ST_GeomFromText('POLYGON((' || list_aggr(list_transform(regexp_extract_all(h3_cell_to_boundary_wkt(${cell}), '-?[0-9]+[.]?[0-9]*[ ]-?[0-9]+[.]?[0-9]*'), p -> (${unwrapped}) || ' ' || split_part(p, ' ', 2)), 'string_agg', ',') || '))')`
}

export const GRID_SYSTEMS: readonly GridSystem[] = [
  {
    id: 'h3',
    label: 'H3',
    summary: 'Hexagons. Sizes differ with latitude.',
    minRes: 0,
    maxRes: 15,
    cellAreaKm2: sizes.h3.areaKm2,
    edgeKm: sizes.h3.edgeKm,
    argumentOrder: 'latlng',
    equalArea: false,
    cellSql: (lon, lat, res) => `h3_latlng_to_cell(${lat}, ${lon}, ${res})`,
    idSql: (cell) => `h3_h3_to_string(${cell})`,
    ringSql: h3Ring,
  },
  {
    id: 'a5',
    label: 'A5',
    summary: 'Pentagons of equal area everywhere.',
    // Resolution 0 (twelve cells that each cover a pentagon of the globe) fails the date-line split in the engine
    // (research §4), and is not a useful summary of anything. Resolutions 1 and up are offered.
    minRes: 1,
    maxRes: 30,
    cellAreaKm2: sizes.a5.areaKm2,
    edgeKm: sizes.a5.edgeKm,
    argumentOrder: 'lonlat',
    equalArea: true,
    cellSql: (lon, lat, res) => `a5_lonlat_to_cell(${lon}, ${lat}, ${res})`,
    idSql: (cell) => `a5_u64_to_hex(${cell})`,
    // A5 returns a ring already continuous across the date line (longitudes past 180 or below -180).
    ringSql: (cell) => `a5_cell_to_geometry(${cell})`,
  },
]

export function getGridSystem(id: string): GridSystem | null {
  return GRID_SYSTEMS.find((s) => s.id === id) ?? null
}

/**
 * Cuts a ring that runs past the date line into the part inside [-180, 180] and the part beyond it moved back by
 * 360, as one MULTIPOLYGON; a ring inside the range is returned as it is. `ring` is a SQL expression or column.
 */
export function splitDateLineSql(ring: string): string {
  const world = 'ST_MakeEnvelope(-180, -90, 180, 90)'
  const part = (west: number, east: number, shift: number) => `ST_Affine(ST_Intersection(${ring}, ST_MakeEnvelope(${west}, -90, ${east}, 90)), 1, 0, 0, 1, ${shift}, 0)`
  return `CASE WHEN ST_XMax(${ring}) > 180 THEN ST_Union(ST_Intersection(${ring}, ${world}), ${part(180, 540, -360)}) WHEN ST_XMin(${ring}) < -180 THEN ST_Union(ST_Intersection(${ring}, ${world}), ${part(-540, -180, 360)}) ELSE ${ring} END`
}
