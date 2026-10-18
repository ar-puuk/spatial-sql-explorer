// Spec 017: the query behind "Bin into cells". Pure text: it needs the layer's facts (geometry column, CRS,
// columns), never the engine. The query is the product (contracts/bin-cells.md): it is put in the query panel,
// where the user can read, edit and rerun it, and its result is an ordinary query result.
import type { Bbox, GeometryType } from '../models.js'
import { quoteIdent } from '../query/util.js'
import { isNumericType } from '../style/resolve.js'
import { getGridSystem, splitDateLineSql, type GridSystem, type GridSystemId } from './gridSystems.js'

export type BinMeasureKind = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median'

export type BinMeasure = { kind: 'count' } | { kind: Exclude<BinMeasureKind, 'count'>; column: string }

export interface BinSpec {
  system: GridSystemId
  resolution: number
  measure: BinMeasure
  /** Only the rows the user has selected (read from `BinLayerFacts.selectedSource`). */
  selectedOnly?: boolean
  /**
   * Spec 021: how a line or polygon is assigned. 'center' (absent): to the cell of its center point. 'cover': to every
   * cell it touches (a polygon's cells, a line's cells), so a feature counts once in each; a point is in one cell either way.
   */
  assign?: 'center' | 'cover'
  /**
   * Spec 021: each cell also takes in its neighbors within this many steps (a whole number, 1 to `MAX_SMOOTH_RINGS`), so the value is
   * that of the neighborhood and the cells spread past the data. Absent or 0: the cell alone. Not for the median.
   */
  smooth?: number
}

/** The most rings of neighbors (user decision 2026-10-17: a quick-look summary, not advanced analysis). A disk has 3k(k+1)+1 cells. */
export const MAX_SMOOTH_RINGS = 10
/** More rings than this draws a warning in the dialog (each cell becomes a disk of 3k(k+1)+1 cells, and the work grows with it). */
export const SMOOTH_WARN_RINGS = 5

/** What the SQL needs to know about the open layer. */
export interface BinLayerFacts {
  /** The geometry column as SQL (quoted), as the layer view names it. */
  geom: string
  /** EPSG code of the layer's geometry; null (unknown) is read as WGS84. */
  srid: number | null
  columns: ReadonlyArray<{ name: string; type: string }>
  /** The WHERE text for the rows the layer currently shows (column filters and shape filter), or null. */
  where?: string | null
  /** The table holding the selected rows (SELECTED_ROWS_TABLE), read instead of `layer` when the spec asks for the selected rows only. */
  selectedSource?: string | null
}

/** The temporary table "selected rows only" reads: the rows the user selected, with the layer's columns. */
export const SELECTED_ROWS_TABLE = 'selected_rows'

/** What the dialog needs to know about the open layer (QuerySession.layerFactsForBin). */
export interface BinLayerInfo {
  geometryType: GeometryType
  /** The layer's WGS84 extent, or null when unknown. */
  extent: Bbox | null
  /** Rows in the layer. */
  rows: number
  /** Columns a measure can use. */
  numericColumns: string[]
  /** Filters are active on a query result, whose columns are not the layer's: the bin reads the whole layer and says so. */
  filtersIgnored: boolean
  /** Spec 021: the average size of a feature's box (km² and its width plus height in km), for estimating how many cells covering gives; null when not measured. */
  featureSize?: FeatureSize | null
}

export interface FeatureSize {
  areaKm2: number
  spanKm: number
}

/**
 * Spec 021: SQL for the average box of the layer's features (the first 5,000 rows), as `area_km2` and `span_km`. In degrees a box
 * is turned into kilometers at its latitude; in any other coordinate system the units are taken to be meters.
 */
export function featureSizeSql(geom: string, srid: number | null): string {
  const w = `(ST_XMax(${geom}) - ST_XMin(${geom}))`
  const h = `(ST_YMax(${geom}) - ST_YMin(${geom}))`
  const geographic = srid === null || srid === 4326
  const kmX = geographic ? `${w} * 111.32 * cos(radians((ST_YMax(${geom}) + ST_YMin(${geom})) / 2))` : `${w} / 1000.0`
  const kmY = geographic ? `${h} * 111.32` : `${h} / 1000.0`
  return `SELECT avg(x * y) AS area_km2, avg(x + y) AS span_km FROM (SELECT ${kmX} AS x, ${kmY} AS y FROM layer WHERE ${geom} IS NOT NULL AND NOT ST_IsEmpty(${geom}) LIMIT 5000)`
}

export interface BinQuery {
  sql: string
  /** What `value` means, for the legend and the table ("Number of features", "Average of population"). */
  valueLabel: string
}

export const MEASURE_LABELS: Readonly<Record<BinMeasureKind, string>> = Object.freeze({
  count: 'Number of features',
  sum: 'Sum of',
  avg: 'Average of',
  min: 'Minimum of',
  max: 'Maximum of',
  median: 'Median of',
})

export function measureLabel(measure: BinMeasure): string {
  return measure.kind === 'count' ? MEASURE_LABELS.count : `${MEASURE_LABELS[measure.kind]} ${measure.column}`
}

/** Why a spec cannot be turned into SQL, or null when it can. */
export function binSpecProblem(spec: BinSpec, facts: Pick<BinLayerFacts, 'columns'>): string | null {
  const system = getGridSystem(spec.system)
  if (!system) return `Unknown grid system ${spec.system}.`
  if (!Number.isInteger(spec.resolution) || spec.resolution < system.minRes || spec.resolution > system.maxRes) {
    return `${system.label} resolutions go from ${system.minRes} to ${system.maxRes}.`
  }
  if (spec.assign !== undefined && spec.assign !== 'center' && spec.assign !== 'cover') return `Unknown way to assign features to cells: ${String(spec.assign)}.`
  if (spec.smooth !== undefined && (!Number.isInteger(spec.smooth) || spec.smooth < 0 || spec.smooth > MAX_SMOOTH_RINGS)) {
    return `Smoothing takes 0 to ${MAX_SMOOTH_RINGS} rings of neighbors.`
  }
  if (spec.smooth && !system.diskSql) return `${system.label} has no neighbor function that can be relied on, so smoothing is for H3 only.`
  if (spec.smooth && spec.assign === 'cover') return 'Smoothing and covering cannot be combined: a feature would count once for every cell it touches, in every neighborhood.'
  if (spec.smooth && spec.measure.kind === 'median') return "A median can't be combined across neighbors: choose another measure to smooth."
  const measure = spec.measure
  if (measure.kind !== 'count') {
    const column = facts.columns.find((c) => c.name === measure.column)
    if (!column) return `There is no column ${measure.column}.`
    if (!isNumericType(column.type)) return `${measure.column} is not a number column.`
  }
  return null
}

/** The aggregate producing `value`, over the carried `v` column. */
function aggregateSql(measure: BinMeasure): string {
  switch (measure.kind) {
    case 'count':
      return 'count(*)::DOUBLE'
    case 'sum':
      return 'sum(v)::DOUBLE'
    case 'avg':
      return 'avg(v)::DOUBLE'
    case 'min':
      return 'min(v)::DOUBLE'
    case 'max':
      return 'max(v)::DOUBLE'
    case 'median':
      return 'median(v)::DOUBLE'
  }
}

/** The point each row is assigned by, in longitude/latitude: the geometry itself for a point, the centroid for lines and polygons. */
function pointSql(geom: string, srid: number | null): string {
  const centre = `ST_Centroid(${geom})`
  return srid === null || srid === 4326 ? centre : `ST_Transform(${centre}, 'EPSG:${Math.floor(srid)}', 'EPSG:4326', always_xy := true)`
}

/** The relation to bin: `layer`, or the selected rows. */
function sourceOf(spec: BinSpec, facts: BinLayerFacts): string {
  return spec.selectedOnly && facts.selectedSource ? facts.selectedSource : 'layer'
}

/** The WHERE clause for the rows to bin (the filters the layer currently shows), or ''. */
function whereSql(facts: BinLayerFacts): string {
  return facts.where ? `\n      WHERE (${facts.where})` : ''
}

/** A location a grid can use: a point inside the world. */
const USABLE_POINT = 'p IS NOT NULL AND NOT ST_IsEmpty(p) AND ST_X(p) BETWEEN -180 AND 180 AND ST_Y(p) BETWEEN -90 AND 90'

/** Covering: the whole geometry in longitude/latitude, and a usable one lies inside the world. */
const USABLE_GEOMETRY = 'g IS NOT NULL AND NOT ST_IsEmpty(g) AND ST_XMin(g) >= -180 AND ST_XMax(g) <= 180 AND ST_YMin(g) >= -90 AND ST_YMax(g) <= 90'

/** The whole geometry in longitude/latitude (covering reads all of it, not the center). */
function wholeGeometrySql(geom: string, srid: number | null): string {
  return srid === null || srid === 4326 ? geom : `ST_Transform(${geom}, 'EPSG:${Math.floor(srid)}', 'EPSG:4326', always_xy := true)`
}

const covers = (spec: BinSpec): boolean => spec.assign === 'cover'

/** How many of the rows to bin have no usable location (and so are left out of the cells); null for a spec that is not valid. */
export function binSkippedSql(spec: BinSpec, facts: BinLayerFacts): string | null {
  if (binSpecProblem(spec, facts) !== null) return null
  if (covers(spec)) return `SELECT count(*) AS skipped FROM (SELECT ${wholeGeometrySql(facts.geom, facts.srid)} AS g FROM ${sourceOf(spec, facts)}${whereSql(facts)}) WHERE NOT coalesce(${USABLE_GEOMETRY}, false)`
  return `SELECT count(*) AS skipped FROM (SELECT ${pointSql(facts.geom, facts.srid)} AS p FROM ${sourceOf(spec, facts)}${whereSql(facts)}) WHERE NOT coalesce(${USABLE_POINT}, false)`
}

/** What a smoothed measure is made of, per cell, and how neighborhoods combine them into `value`. */
function smoothParts(measure: BinMeasure): { perCell: string; combine: string; carried: string } {
  switch (measure.kind) {
    case 'count':
      return { perCell: '', combine: 'sum(n)::DOUBLE', carried: '' }
    case 'sum':
      return { perCell: ', sum(v) AS s', combine: 'sum(s)::DOUBLE', carried: ', s' }
    case 'avg':
      return { perCell: ', sum(v) AS s, count(v) AS c', combine: '(sum(s) / nullif(sum(c), 0))::DOUBLE', carried: ', s, c' }
    case 'min':
      return { perCell: ', min(v) AS mn', combine: 'min(mn)::DOUBLE', carried: ', mn' }
    case 'max':
      return { perCell: ', max(v) AS mx', combine: 'max(mx)::DOUBLE', carried: ', mx' }
    case 'median':
      return { perCell: '', combine: 'NULL::DOUBLE', carried: '' } // refused by binSpecProblem
  }
}

/**
 * The query for `spec` over the layer (`layer`), or null when the spec is not valid for these facts. Output columns:
 * `cell_id`, `resolution`, `value`, `n`, `geom` (data-model.md). Rows without a usable location are left out.
 * Spec 021: `assign: 'cover'` puts each feature in every cell it touches; `smooth` spreads each cell over its neighbors.
 */
export function binQuerySql(spec: BinSpec, facts: BinLayerFacts): BinQuery | null {
  if (binSpecProblem(spec, facts) !== null) return null
  const system: GridSystem = getGridSystem(spec.system)!
  const carried = spec.measure.kind === 'count' ? '' : `, TRY_CAST(${quoteIdent(spec.measure.column)} AS DOUBLE) AS v`
  const carriedUp = spec.measure.kind === 'count' ? '' : ', v'
  // The relation of cells, one row per feature and cell: `cell` (and `v`).
  const rows = covers(spec)
    ? [
        `    SELECT unnest(${system.coverSql('g', spec.resolution)}) AS cell${carriedUp}`,
        '    FROM (',
        `      SELECT ${wholeGeometrySql(facts.geom, facts.srid)} AS g${carried}`,
        `      FROM ${sourceOf(spec, facts)}${whereSql(facts)}`,
        '    )',
        `    WHERE ${USABLE_GEOMETRY}`,
      ]
    : [
        `    SELECT ${system.cellSql('ST_X(p)', 'ST_Y(p)', spec.resolution)} AS cell${carriedUp}`,
        '    FROM (',
        `      SELECT ${pointSql(facts.geom, facts.srid)} AS p${carried}`,
        `      FROM ${sourceOf(spec, facts)}${whereSql(facts)}`,
        '    )',
        `    WHERE ${USABLE_POINT}`,
      ]
  const rings = spec.smooth ?? 0
  const smooth = smoothParts(spec.measure)
  const cells =
    rings > 0
      ? [
          `  SELECT ${system.idSql('cell')} AS cell_id, ${spec.resolution} AS resolution, ${smooth.combine} AS value, sum(n)::BIGINT AS n,`,
          `    ${system.ringSql('cell', spec.resolution)} AS ring`,
          '  FROM (',
          `    SELECT unnest(${system.diskSql!('cell', rings)}) AS cell, n${smooth.carried}`,
          '    FROM (',
          `      SELECT cell, count(*) AS n${smooth.perCell}`,
          '      FROM (',
          ...rows.map((r) => `    ${r}`),
          '      )',
          '      GROUP BY cell',
          '    )',
          '  )',
          '  GROUP BY cell',
        ]
      : [
          `  SELECT ${system.idSql('cell')} AS cell_id, ${spec.resolution} AS resolution, ${aggregateSql(spec.measure)} AS value, count(*) AS n,`,
          `    ${system.ringSql('cell', spec.resolution)} AS ring`,
          '  FROM (',
          ...rows,
          '  )',
          '  GROUP BY cell',
        ]
  const sql = ['SELECT cell_id, resolution, value, n,', `  ST_SetCRS(${splitDateLineSql('ring')}, 'EPSG:4326') AS geom`, 'FROM (', ...cells, ')'].join('\n')
  const label = measureLabel(spec.measure)
  return { sql, valueLabel: rings > 0 ? `${label}, with neighbors within ${rings} ${rings === 1 ? 'ring' : 'rings'}` : label }
}
