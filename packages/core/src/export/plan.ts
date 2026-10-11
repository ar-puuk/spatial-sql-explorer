// What an export will do, decided before anything runs (spec 005
// contracts/export-core.md, data-model.md ExportPlan). Pure: the dialog shows
// the plan, and the runner executes its SQL.
import { reprojectToWgs84Sql } from '../crs.js'
import type { GeometryType, Layer } from '../models.js'
import type { ResultFacts } from '../query/session.js'
import { quoteIdent } from '../query/util.js'
import { EXPORT_FORMATS, exportFormat, type ExportFormatId } from './formats.js'

/** The table holding the complete result of the last query (spec 002). */
const RESULT_TABLE = '__se_result'

/** Marks GeoJSON columns that hold JSON text to embed as values (nested types). */
export const GEOJSON_JSON_PREFIX = '__se_json__'

export interface ExportRequest {
  format: ExportFormatId
  /** FR-002: 'shown' only matters when the display is limited. */
  rows: 'all' | 'shown'
  crs: 'result' | 'wgs84'
  /** CSV only; 'xy' only for point layers. */
  csvGeometry: 'wkt' | 'xy'
}

export interface ExportPlanContext {
  /** File name of the opened source, for the default output name. */
  sourceName: string
  layer: Pick<Layer, 'rowCount' | 'invalidGeometryCount' | 'columns'> & { geometryType: GeometryType }
  facts: ResultFacts
}

export interface ExportPlan {
  /** 'layer': the whole file (the default view); 'result': `__se_result`. */
  source: 'layer' | 'result'
  rowCount: number
  displayLimited: { shown: number; total: number } | null
  formats: Array<{ id: ExportFormatId; available: boolean; reason?: string }>
  /** Set when nothing can be exported (e.g. a DESCRIBE result). */
  blocked: string | null
  /** The format actually used (the request's, or the first available). */
  format: ExportFormatId
  crs: { output: 'result' | 'wgs84'; label: string; srid: number | null; forced: boolean; reason?: string }
  csvGeometry: 'wkt' | 'xy'
  xyAvailable: boolean
  geometryColumn: string | null
  notices: string[]
  sql: string
  fileName: string
}

const BIG_INT = /^(BIGINT|HUGEINT|UBIGINT|UHUGEINT|INT8|LONG)$/i
const DATE_TIME = /^(DATE|TIME|TIMESTAMP|TIMESTAMP WITH TIME ZONE|TIMESTAMPTZ|TIMESTAMP_[A-Z]+|INTERVAL)\b/i
const NESTED = /(\[\]|^STRUCT\(|^MAP\(|^UNION\(|^LIST|^JSON$)/i
const BINARY = /^(BLOB|BYTEA|BINARY|VARBINARY)$/i

const quoted = (names: string[]): string => names.map((n) => `"${n}"`).join(', ')
const baseName = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** Type-driven notices: what each format does to columns it can't hold as-is (FR-009). */
function typeNotices(format: ExportFormatId, columns: Array<{ name: string; type: string }>): string[] {
  const by = (re: RegExp) => columns.filter((c) => re.test(c.type.trim())).map((c) => c.name)
  const out: string[] = []
  if (format === 'geojson') {
    const big = by(BIG_INT)
    if (big.length) out.push(`Values of ${quoted(big)} beyond 2^53 are written as text (JSON numbers can't hold them exactly).`)
    const dates = by(DATE_TIME)
    if (dates.length) out.push(`${quoted(dates)} ${dates.length === 1 ? 'is' : 'are'} written as ISO text.`)
    const nested = by(NESTED)
    if (nested.length) out.push(`${quoted(nested)} ${nested.length === 1 ? 'is' : 'are'} written as JSON values.`)
    const bin = by(BINARY)
    if (bin.length) out.push(`${quoted(bin)} ${bin.length === 1 ? 'is' : 'are'} written as base64 text.`)
  } else if (format === 'csv') {
    const nested = by(NESTED)
    if (nested.length) out.push(`${quoted(nested)} ${nested.length === 1 ? 'is' : 'are'} written as text.`)
    const bin = by(BINARY)
    if (bin.length) out.push(`${quoted(bin)} ${bin.length === 1 ? 'is' : 'are'} written as text.`)
  }
  return out
}

export function planExport(request: ExportRequest, ctx: ExportPlanContext): ExportPlan {
  const { facts, layer } = ctx
  const hasGeometry = facts.geometryColumn !== null
  const blocked = facts.exportable ? null : 'Run a query (not DESCRIBE, SHOW, SUMMARIZE or EXPLAIN) to export its result.'

  const formats = EXPORT_FORMATS.map((f) => {
    if (blocked) return { id: f.id, available: false, reason: blocked }
    if (f.geometry === 'required' && !hasGeometry) return { id: f.id, available: false, reason: `${f.label} needs a geometry column; this result has none.` }
    if (f.geometry === 'none' && hasGeometry) return { id: f.id, available: false, reason: 'For results without geometry; use GeoParquet for this one.' }
    return { id: f.id, available: true }
  })
  const format = formats.find((f) => f.id === request.format && f.available)?.id ?? formats.find((f) => f.available)?.id ?? request.format
  const fmt = exportFormat(format)

  // Rows (FR-002): display limits are the default view's cap and "Show first 50,000".
  let displayLimited: ExportPlan['displayLimited'] = null
  if (facts.defaultView && facts.totalRows > layer.rowCount) displayLimited = { shown: layer.rowCount, total: facts.totalRows }
  else if (facts.truncatedTo !== null && facts.totalRows > facts.truncatedTo) displayLimited = { shown: facts.truncatedTo, total: facts.totalRows }
  const shownOnly = displayLimited !== null && request.rows === 'shown'
  const source: ExportPlan['source'] = facts.defaultView ? 'layer' : 'result'
  const rowCount = displayLimited ? (shownOnly ? displayLimited.shown : displayLimited.total) : facts.defaultView ? layer.rowCount : facts.totalRows

  // CRS (FR-006).
  const resultCrs = facts.resultCrs
  const resultIsWgs84 = !resultCrs || resultCrs.srid === null || resultCrs.srid === 4326
  const forced = fmt.crs === 'wgs84-only'
  const output: 'result' | 'wgs84' = forced || resultIsWgs84 ? (forced ? 'wgs84' : request.crs) : request.crs
  const crs: ExportPlan['crs'] = {
    output,
    label: output === 'wgs84' ? 'EPSG:4326 (WGS84)' : (resultCrs?.label ?? 'EPSG:4326 (WGS84)'),
    srid: output === 'wgs84' ? 4326 : (resultCrs?.srid ?? null),
    forced,
    reason: forced ? 'GeoJSON is always WGS84 (longitude, latitude), as RFC 7946 requires.' : undefined,
  }

  // Columns and geometry.
  const notices: string[] = []
  const xyAvailable = hasGeometry && layer.geometryType === 'Point'
  const csvGeometry = request.csvGeometry === 'xy' && xyAvailable ? 'xy' : 'wkt'
  // GeoJSON values must survive the trip through JS, which loses column types:
  // convert in SQL (research §4). Nested values come back as JSON text,
  // marked so the writer embeds them as JSON values.
  const column = (c: { name: string; type: string }): string => {
    const id = quoteIdent(c.name)
    if (format !== 'geojson') return id
    const type = c.type.trim()
    if (NESTED.test(type)) return `to_json(${id}) AS ${quoteIdent(GEOJSON_JSON_PREFIX + c.name)}`
    if (DATE_TIME.test(type)) return `CAST(${id} AS VARCHAR) AS ${id}`
    if (BINARY.test(type)) return `base64(${id}) AS ${id}`
    if (/^(HUGEINT|UHUGEINT)$/i.test(type)) return `CAST(${id} AS VARCHAR) AS ${id}`
    if (/^(DECIMAL|NUMERIC)/i.test(type)) return `CAST(${id} AS DOUBLE) AS ${id}`
    return id
  }
  const select: string[] = layer.columns.map(column)
  for (const other of facts.otherGeometryColumns) select.push(`ST_AsText(${quoteIdent(other)}) AS ${quoteIdent(other)}`)
  if (facts.otherGeometryColumns.length) notices.push(`Other geometry columns are written as WKT text: ${facts.otherGeometryColumns.join(', ')}.`)

  const g = facts.geometryColumn
  if (g && fmt.geometry !== 'none') {
    const col = quoteIdent(g)
    const projected = output === 'wgs84' && !resultIsWgs84 ? reprojectToWgs84Sql(col, resultCrs?.srid ?? null) : col
    const valid = (expr: string) => `CASE WHEN ${col} IS NOT NULL AND ST_IsValid(${col}) THEN ${expr} END`
    if (format === 'geoparquet') select.push(`${valid(`ST_AsWKB(${projected})::BLOB`)} AS ${col}`)
    else if (format === 'geojson') select.push(`${valid(`ST_AsGeoJSON(${projected})`)} AS "__se_geojson"`)
    else if (format === 'csv' && csvGeometry === 'xy') {
      const taken = new Set(layer.columns.map((c) => c.name.toLowerCase()))
      const [x, y] = taken.has('x') || taken.has('y') ? [`${g}_x`, `${g}_y`] : ['x', 'y']
      select.push(`${valid(`ST_X(${projected})`)} AS ${quoteIdent(x)}, ${valid(`ST_Y(${projected})`)} AS ${quoteIdent(y)}`)
    } else select.push(`${valid(`ST_AsText(${projected})`)} AS ${col}`)

    if (format === 'geojson' && !resultIsWgs84) notices.push(`GeoJSON is always WGS84 (longitude, latitude): coordinates are reprojected from ${resultCrs?.label}.`)
    if (resultCrs?.assumed) notices.push('The CRS is assumed to be WGS84: the file has none.')
    const invalidShown = layer.invalidGeometryCount
    if (invalidShown > 0) {
      notices.push(
        shownOnly || !displayLimited
          ? `${invalidShown} ${invalidShown === 1 ? 'row has' : 'rows have'} no valid geometry: written with an empty geometry.`
          : 'Rows without valid geometry are written with an empty geometry (the count is reported when the export finishes).'
      )
    }
  }
  notices.push(...typeNotices(format, layer.columns))

  const from = source === 'layer' ? quoteIdent('layer') : RESULT_TABLE
  const limit = shownOnly && displayLimited ? ` LIMIT ${displayLimited.shown}` : ''
  const sql = `SELECT ${select.join(', ') || '*'} FROM ${from}${limit}`

  return {
    source,
    rowCount,
    displayLimited,
    formats,
    blocked,
    format,
    crs,
    csvGeometry,
    xyAvailable,
    geometryColumn: g,
    notices,
    sql,
    fileName: `${baseName(ctx.sourceName)}-export${fmt.extension}`,
  }
}
