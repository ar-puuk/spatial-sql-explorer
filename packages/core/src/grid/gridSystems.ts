// Spec 017: the grid systems the Bin into cells action offers (H3 and A5), as data: a row per system with its
// resolution range, its average cell sizes, how its SQL functions take coordinates, and the SQL that turns a
// cell into an id and a polygon. Adding a system is adding a row. The two extensions are loaded by the engine
// (step 1, duckdbService.ts); the sizes are the engine's own numbers (specs/017-grid-cells/research.md §4).
import { GRID_SIZES as sizes } from './gridSizes.js'

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
   * SQL for the cell's outline as a polygon in longitude/latitude, from the SQL expression `cell` at `res`. A cell
   * across the date line comes back as one continuous ring that runs past 180 or -180 (see `splitDateLineSql`).
   */
  ringSql(cell: string, res: number): string
  /**
   * Spec 021: SQL for the list of cells (UBIGINT[]) a geometry touches, from the SQL expression `geom` (a GEOMETRY in
   * longitude/latitude) at `res`: every cell a polygon overlaps, the cells along a line, the cell of a point.
   */
  coverSql(geom: string, res: number): string
  /**
   * Spec 021: SQL for the cell and its neighbors within `rings` steps (UBIGINT[]), from the SQL expression `cell`. Absent
   * when the system has no neighbor function that can be relied on: A5's `a5_grid_disk` returns 3 cells for one ring and 11
   * for two (a pentagon has 5 edge neighbors), so smoothing is offered for H3 only.
   */
  diskSql?(cell: string, rings: number): string
}

/** The `x y` pairs of a cell's boundary, from `h3_cell_to_boundary_wkt` (closing vertex included). */
const H3_VERTICES = "regexp_extract_all(h3_cell_to_boundary_wkt(CELL), '-?[0-9]+[.]?[0-9]*[ ]-?[0-9]+[.]?[0-9]*')"

/**
 * H3 returns its ring wrapped (179.84 then -179.68). Each vertex is moved to the longitude nearest the cell's centre
 * (`lon + 360 * round((centre - lon) / 360)`), so a cell across the date line becomes one continuous ring that
 * extends past 180 or -180. Written as one expression (no subquery), which keeps it usable inside TRY().
 *
 * The two cells that contain a pole cannot be unwrapped (their ring goes all the way round it): each is drawn as a
 * cap instead. Its vertices are wrapped into [-180, 180) and sorted by longitude; the outline then runs along the
 * date line at the latitude interpolated between the last and first vertex, up to the pole and back (research §4).
 */
function h3Ring(cell: string, res: number): string {
  const vertices = H3_VERTICES.replace('CELL', cell)
  const centre = `h3_cell_to_lng(${cell})`
  const x = `CAST(split_part(p, ' ', 1) AS DOUBLE)`
  const unwrapped = `${x} + 360 * round((${centre} - ${x}) / 360)`
  const ring = `'POLYGON((' || list_aggr(list_transform(${vertices}, p -> (${unwrapped}) || ' ' || split_part(p, ' ', 2)), 'string_agg', ',') || '))'`
  const wrapped = `((CAST(split_part(p, ' ', 1) AS DOUBLE) + 540) % 360) - 180`
  const sorted = `list_sort(list_transform(list_slice(${vertices}, 1, -2), p -> {'x': ${wrapped}, 'y': CAST(split_part(p, ' ', 2) AS DOUBLE)}))`
  const edge = '(s[-1].y + (s[1].y - s[-1].y) * (180 - s[-1].x) / (s[1].x + 360 - s[-1].x))'
  const pole = `CASE WHEN h3_cell_to_lat(${cell}) > 0 THEN 90 ELSE -90 END`
  const cap = `list_transform([${sorted}], s -> 'POLYGON((-180 ' || ${edge} || ',' || list_aggr(list_transform(s, q -> q.x || ' ' || q.y), 'string_agg', ',') || ',180 ' || ${edge} || ',180 ' || (${pole}) || ',-180 ' || (${pole}) || ',-180 ' || ${edge} || '))')[1]`
  return `ST_GeomFromText(CASE WHEN ${cell} IN (h3_latlng_to_cell(90, 0, ${res}), h3_latlng_to_cell(-90, 0, ${res})) THEN ${cap} ELSE ${ring} END)`
}

/** Most sample points taken along one line (a longer one is sampled more coarsely). */
const MAX_LINE_POINTS = 20_000
/** Most sample points taken inside one polygon (a bigger one is sampled more coarsely). */
const MAX_INTERIOR_POINTS = 100_000

/**
 * The cells of the points taken along a line (a SQL expression for a LINESTRING), at most a quarter of an edge apart: a degree of
 * longitude is never longer than a degree of latitude on the ground, so the planar length in degrees never under-counts.
 */
function lineCells(line: string, edgeKm: number, cellAt: (lon: string, lat: string) => string): string {
  const stepDeg = edgeKm / 111.32 / 4
  const along = `1.0 / greatest(1, least(${MAX_LINE_POINTS}, ceil(ST_Length(${line}) / ${stepDeg})))`
  const at = (pt: string) => cellAt(`ST_X(${pt})`, `ST_Y(${pt})`)
  // The vertices too: a corner is where a cell can hold only a sliver of the line.
  return `list_transform(ST_Dump(ST_LineInterpolatePoints(${line}, ${along}, true)), _q -> ${at('_q.geom')}) || list_transform(ST_Dump(ST_Points(${line})), _v -> ${at('_v.geom')})`
}

/**
 * A polygon's cells for a system with no usable polygon function (A5's `a5_geometry_to_cells` finds only a few of a
 * polygon's cells): the cells along its boundary (every cell that crosses it) and the cells of a grid of points inside
 * it, a third of an edge apart on the ground (the longitude step widens with the latitude's cosine, taken at the box's
 * edge nearest the equator, so it never under-samples). Most points: MAX_INTERIOR_POINTS.
 */
function sampledPolygonCells(part: string, edgeKm: number, cellAt: (lon: string, lat: string) => string): string {
  // A5's cells are irregular pentagons: half an edge missed thin slivers of them.
  const stepDeg = edgeKm / 111.32 / 3
  const at = (pt: string) => cellAt(`ST_X(${pt})`, `ST_Y(${pt})`)
  const boundary = `flatten(list_transform(ST_Dump(ST_Boundary(${part})), _b -> ${lineCells('_b.geom', edgeKm, cellAt)}))`
  const box = `{'x0': ST_XMin(${part}), 'y0': ST_YMin(${part}), 'w': ST_XMax(${part}) - ST_XMin(${part}), 'h': ST_YMax(${part}) - ST_YMin(${part})}`
  const cos = `greatest(0.05, cos(radians(CASE WHEN _s.y0 <= 0 AND _s.y0 + _s.h >= 0 THEN 0 ELSE least(abs(_s.y0), abs(_s.y0 + _s.h)) END)))`
  const raw = `((_s.w / (${stepDeg} / ${cos}) + 1) * (_s.h / ${stepDeg} + 1))`
  const grid = `{'x0': _s.x0, 'y0': _s.y0, 'dx': ${stepDeg} / ${cos} * greatest(1, sqrt(${raw} / ${MAX_INTERIOR_POINTS})), 'dy': ${stepDeg} * greatest(1, sqrt(${raw} / ${MAX_INTERIOR_POINTS})), 'w': _s.w, 'h': _s.h}`
  const points = `ST_Point(_gr.x0 + (_k % (CAST(ceil(_gr.w / _gr.dx) AS BIGINT) + 1)) * _gr.dx, _gr.y0 + (_k // (CAST(ceil(_gr.w / _gr.dx) AS BIGINT) + 1)) * _gr.dy)`
  const interior = `list_transform(list_filter(list_transform(range((CAST(ceil(_gr.w / _gr.dx) AS BIGINT) + 1) * (CAST(ceil(_gr.h / _gr.dy) AS BIGINT) + 1)), _k -> ${points}), _pt -> ST_Contains(${part}, _pt)), _pt -> ${at('_pt')})`
  return `list_distinct(${boundary} || list_transform(list_transform([${box}], _s -> ${grid}), _gr -> ${interior})[1])`
}

/**
 * The cells a geometry touches, written once for both systems. The parts of a multi-part geometry are covered one by one
 * (`ST_Dump`). A polygon is covered by `polygon` (given a single polygon); if that gives no cell (a polygon smaller than a
 * cell) it takes the cell of its center. A line is covered by `lineCells`. A point is in its own cell.
 */
function coverOf(geom: string, edgeKm: number, polygon: (part: string) => string, cellAt: (lon: string, lat: string) => string): string {
  const at = (pt: string) => cellAt(`ST_X(${pt})`, `ST_Y(${pt})`)
  const poly = `CASE WHEN len(${polygon('_d.geom')}) > 0 THEN ${polygon('_d.geom')} ELSE [${at('ST_Centroid(_d.geom)')}] END`
  return `list_distinct(flatten(list_transform(ST_Dump(${geom}), _d -> CASE ST_GeometryType(_d.geom)::VARCHAR WHEN 'POLYGON' THEN ${poly} WHEN 'LINESTRING' THEN ${lineCells('_d.geom', edgeKm, cellAt)} ELSE [${at('_d.geom')}] END)))`
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
    // `overlap`: every cell the polygon touches (the plain function keeps cells whose center is inside).
    coverSql: (geom, res) =>
      coverOf(geom, sizes.h3.edgeKm[res], (part) => `h3_polygon_wkt_to_cells_experimental(ST_AsText(${part}), ${res}, 'overlap')`, (lon, lat) => `h3_latlng_to_cell(${lat}, ${lon}, ${res})`),
    diskSql: (cell, rings) => `h3_grid_disk(${cell}, ${rings})`,
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
    coverSql: (geom, res) => {
      const cellAt = (lon: string, lat: string) => `a5_lonlat_to_cell(${lon}, ${lat}, ${res})`
      return coverOf(geom, sizes.a5.edgeKm[res], (part) => sampledPolygonCells(part, sizes.a5.edgeKm[res], cellAt), cellAt)
    },
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
