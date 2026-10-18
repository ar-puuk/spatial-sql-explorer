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
  /** Only the rows the user has selected (the selection predicate is in `BinLayerFacts.selectedWhere`). */
  selectedOnly?: boolean
}

/** What the SQL needs to know about the open layer. */
export interface BinLayerFacts {
  /** The geometry column as SQL (quoted), as the layer view names it. */
  geom: string
  /** EPSG code of the layer's geometry; null (unknown) is read as WGS84. */
  srid: number | null
  columns: ReadonlyArray<{ name: string; type: string }>
  /** The WHERE text for the rows the layer currently shows (column filters and shape filter), or null. */
  where?: string | null
  /** The WHERE text for the selected rows, used with `selectedOnly`. */
  selectedWhere?: string | null
}

/** What the dialog needs to know about the open layer (QuerySession.layerFactsForBin). */
export interface BinLayerInfo {
  geometryType: GeometryType
  /** The layer's WGS84 extent, or null when unknown. */
  extent: Bbox | null
  /** Rows in the layer. */
  rows: number
  /** Columns a measure can use. */
  numericColumns: string[]
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

/** The WHERE clause for the rows to bin, or ''. */
function whereSql(spec: BinSpec, facts: BinLayerFacts): string {
  const parts = [facts.where, spec.selectedOnly ? facts.selectedWhere : null].filter((p): p is string => !!p)
  return parts.length ? `\n    WHERE ${parts.map((p) => `(${p})`).join(' AND ')}` : ''
}

/**
 * The query for `spec` over the layer (`layer`), or null when the spec is not valid for these facts. Output columns:
 * `cell_id`, `resolution`, `value`, `n`, `geom` (data-model.md). Rows without a usable location are left out.
 */
export function binQuerySql(spec: BinSpec, facts: BinLayerFacts): BinQuery | null {
  if (binSpecProblem(spec, facts) !== null) return null
  const system: GridSystem = getGridSystem(spec.system)!
  const carried = spec.measure.kind === 'count' ? '' : `, TRY_CAST(${quoteIdent(spec.measure.column)} AS DOUBLE) AS v`
  const carriedUp = spec.measure.kind === 'count' ? '' : ', v'
  const cell = system.cellSql('ST_X(p)', 'ST_Y(p)', spec.resolution)
  const sql = [
    'SELECT cell_id, resolution, value, n,',
    `  ST_SetCRS(${splitDateLineSql('ring')}, 'EPSG:4326') AS geom`,
    'FROM (',
    `  SELECT ${system.idSql('cell')} AS cell_id, ${spec.resolution} AS resolution, ${aggregateSql(spec.measure)} AS value, count(*) AS n,`,
    `    ${system.ringSql('cell', spec.resolution)} AS ring`,
    '  FROM (',
    `    SELECT ${cell} AS cell${carriedUp}`,
    '    FROM (',
    `      SELECT ${pointSql(facts.geom, facts.srid)} AS p${carried}`,
    `      FROM layer${whereSql(spec, facts)}`,
    '    )',
    '    WHERE p IS NOT NULL AND NOT ST_IsEmpty(p) AND ST_X(p) BETWEEN -180 AND 180 AND ST_Y(p) BETWEEN -90 AND 90',
    '  )',
    '  GROUP BY cell',
    ')',
  ].join('\n')
  return { sql, valueLabel: measureLabel(spec.measure) }
}
