// What an export will do, decided before anything runs (spec 005
// contracts/export-core.md, data-model.md ExportPlan). Pure: the dialog shows
// the plan, and the runner executes its SQL.
import { visibleColumns } from '../source/layerSql.js'
import { reprojectSql } from '../crs.js'
import type { GeometryType, Layer } from '../models.js'
import type { ResultFacts } from '../query/session.js'
import { quoteIdent } from '../query/util.js'
import { EXPORT_FORMATS, exportFormat, XLSX_MAX_ROWS, type ExportFormatId } from './formats.js'
import { dbfRenames } from './dbfNames.js'

/** The table holding the complete result of the last query (spec 002). */
const RESULT_TABLE = '__se_result'

/** Marks GeoJSON columns that hold JSON text to embed as values (nested types). */
export const GEOJSON_JSON_PREFIX = '__se_json__'

export interface ExportRequest {
  format: ExportFormatId
  /** The result's CRS, WGS84, or (spec 008) another EPSG code, `crsCode`. */
  crs: 'result' | 'wgs84' | 'custom'
  /** Spec 008: the EPSG code for `crs: 'custom'` (checked by the engine before export, QuerySession.describeCrs). */
  crsCode?: number
  /** CSV only; 'xy' only for point layers. */
  csvGeometry: 'wkt' | 'xy'
  /**
   * Spec 008 FR-014: every row of the result, the rows matching the table
   * filters, or the selected rows. Default 'all'; a scope that doesn't apply
   * falls back to 'all'.
   */
  scope?: ExportScope
  /**
   * Spec 008 FR-019: write the geometry. By default on when the result has
   * one, unless the format holds attributes only. Off lists the attribute
   * formats (CSV, Parquet, Excel, JSON).
   */
  includeGeometry?: boolean
  /** Spec 008 (user request): the output file name without its extension; empty or absent: `<source>-export`. */
  fileName?: string
}

export type ExportScope = 'all' | 'filtered' | 'selected'

export interface ExportPlanContext {
  /** File name of the opened source, for the default output name. */
  sourceName: string
  layer: Pick<Layer, 'rowCount' | 'invalidGeometryCount' | 'columns'> & { geometryType: GeometryType }
  facts: ResultFacts
  /** Spec 008: row counts of the narrower scopes, when they apply (filters active, rows selected). */
  scopes?: { filtered: number | null; selected: number | null }
}

export interface ExportPlan {
  /** 'layer': the whole file (the default view); 'result': `__se_result`. */
  source: 'layer' | 'result'
  rowCount: number
  formats: Array<{ id: ExportFormatId; available: boolean; reason?: string }>
  /** Set when nothing can be exported (e.g. a DESCRIBE result). */
  blocked: string | null
  /** The format actually used (the request's, or the first available). */
  format: ExportFormatId
  crs: {
    output: 'result' | 'wgs84' | 'custom'
    label: string
    srid: number | null
    forced: boolean
    reason?: string
    /** The result's own CRS, whatever is chosen. */
    resultLabel: string
    resultSrid: number | null
  }
  csvGeometry: 'wkt' | 'xy'
  xyAvailable: boolean
  geometryColumn: string | null
  notices: string[]
  /** The statement the export runs: `SELECT <select> FROM <the source>`, for the 'all' scope. */
  sql: string
  /** Spec 008: the SELECT list of `sql`, so a narrower scope can run it over its own rows. */
  select: string
  /** Spec 008 FR-014: the rows written (QuerySession narrows the source to it). */
  scope: ExportScope
  /** Spec 008 FR-019: whether the geometry is written (false when the result has none). */
  includeGeometry: boolean
  /** Spec 008: the columns JS writers receive, with their source types (geometry excluded). */
  writerColumns: Array<{ name: string; type: string }>
  /** Spec 008: the geometry types written (Shapefile splits a mixed result into one part per type). */
  geometryType: GeometryType | null
  /** Scopes offered, with their row counts (only those that apply). */
  scopes: Array<{ id: ExportScope; rows: number }>
  fileName: string
  /** The file name without its extension (the default, or the user's). */
  fileBase: string
  /** The dataset name inside the file (GeoPackage table, Shapefile parts, KML document): the source's name. */
  layerName: string
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

/**
 * Spec 008: a typed output name, made safe for a file name: no folders,
 * no characters Windows refuses, and without the format's extension if typed
 * (it is added back). Empty when nothing usable is left.
 */
export function exportFileBase(typed: string, extension: string): string {
  let s = Array.from(typed)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .trim()
  s = s.split(/[\\/]/).pop() ?? ''
  for (const ext of [extension, '.' + (extension.split('.').pop() ?? '')]) {
    if (ext.length > 1 && s.toLowerCase().endsWith(ext.toLowerCase())) s = s.slice(0, -ext.length)
  }
  return s
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
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

  // Spec 008 FR-019: with geometry, the spatial formats; without, the attribute formats.
  const includeGeometry = hasGeometry && (request.includeGeometry ?? EXPORT_FORMATS.find((f) => f.id === request.format)?.group !== 'attributes')
  const formats = EXPORT_FORMATS.map((f) => {
    if (blocked) return { id: f.id, available: false, reason: blocked }
    if (f.group === 'spatial' && !hasGeometry) return { id: f.id, available: false, reason: `${f.label} needs a geometry column; this result has none.` }
    if (f.group === 'spatial' && !includeGeometry) return { id: f.id, available: false, reason: `${f.label} holds geometry: it is listed under "With geometry".` }
    if (f.group === 'attributes' && includeGeometry) return { id: f.id, available: false, reason: `${f.label} holds attributes only: it is listed under "Attributes only".` }
    return { id: f.id, available: true }
  })
  const format = formats.find((f) => f.id === request.format && f.available)?.id ?? formats.find((f) => f.available)?.id ?? request.format
  const fmt = exportFormat(format)
  const fileBase = exportFileBase(request.fileName ?? '', fmt.extension) || `${baseName(ctx.sourceName)}-export`

  // Rows (spec 007 FR-009): nothing is display-limited any more; export writes the whole result.
  const source: ExportPlan['source'] = facts.defaultView ? 'layer' : 'result'
  const allRows = facts.defaultView ? layer.rowCount : facts.totalRows
  const scopes: ExportPlan['scopes'] = [{ id: 'all', rows: allRows }]
  if (ctx.scopes?.filtered !== null && ctx.scopes?.filtered !== undefined) scopes.push({ id: 'filtered', rows: ctx.scopes.filtered })
  if (ctx.scopes?.selected !== null && ctx.scopes?.selected !== undefined) scopes.push({ id: 'selected', rows: ctx.scopes.selected })
  const scope = scopes.find((s) => s.id === (request.scope ?? 'all'))?.id ?? 'all'
  const rowCount = scopes.find((s) => s.id === scope)?.rows ?? allRows

  // CRS (FR-006).
  const resultCrs = facts.resultCrs
  const resultIsWgs84 = !resultCrs || resultCrs.srid === null || resultCrs.srid === 4326
  const forced = fmt.crs === 'wgs84-only'
  const customCode = request.crs === 'custom' && Number.isInteger(request.crsCode) && (request.crsCode ?? 0) > 0 ? (request.crsCode as number) : null
  const output: 'result' | 'wgs84' | 'custom' = forced ? 'wgs84' : request.crs === 'custom' ? (customCode ? 'custom' : 'result') : request.crs
  const targetSrid = output === 'wgs84' ? 4326 : output === 'custom' ? (customCode as number) : (resultCrs?.srid ?? null)
  const crs: ExportPlan['crs'] = {
    output,
    resultLabel: resultCrs?.label ?? 'EPSG:4326 (WGS84)',
    resultSrid: resultCrs?.srid ?? null,
    label: output === 'wgs84' ? 'EPSG:4326 (WGS84)' : output === 'custom' ? `EPSG:${customCode}` : (resultCrs?.label ?? 'EPSG:4326 (WGS84)'),
    srid: targetSrid,
    forced,
    reason: forced ? (format === 'kml' ? 'KML is always WGS84 (longitude, latitude).' : `${fmt.label} is always WGS84 (longitude, latitude), as RFC 7946 requires.`) : undefined,
  }

  // Columns and geometry.
  const notices: string[] = []
  const xyAvailable = hasGeometry && layer.geometryType === 'Point'
  const csvGeometry = request.csvGeometry === 'xy' && xyAvailable ? 'xy' : 'wkt'
  // GeoJSON values must survive the trip through JS, which loses column types:
  // convert in SQL (research §4). Nested values come back as JSON text,
  // marked so the writer embeds them as JSON values.
  const jsWriter = fmt.writer === 'js'
  const column = (c: { name: string; type: string }): string => {
    const id = quoteIdent(c.name)
    if (!jsWriter) return id
    const type = c.type.trim()
    if (NESTED.test(type)) return `to_json(${id}) AS ${quoteIdent(GEOJSON_JSON_PREFIX + c.name)}`
    if (DATE_TIME.test(type)) return `CAST(${id} AS VARCHAR) AS ${id}`
    if (BINARY.test(type)) return `base64(${id}) AS ${id}`
    if (/^(HUGEINT|UHUGEINT)$/i.test(type)) return `CAST(${id} AS VARCHAR) AS ${id}`
    if (/^(DECIMAL|NUMERIC)/i.test(type)) return `CAST(${id} AS DOUBLE) AS ${id}`
    return id
  }
  // Hidden engine columns (__se_rowid, bbox) are never exported (spec 007).
  const columns = visibleColumns(layer.columns)
  const select: string[] = columns.map(column)
  const writerColumns = columns.map((c) => ({ name: c.name, type: c.type }))
  if (includeGeometry) {
    for (const other of facts.otherGeometryColumns) {
      select.push(`ST_AsText(${quoteIdent(other)}) AS ${quoteIdent(other)}`)
      writerColumns.push({ name: other, type: 'VARCHAR' })
    }
    if (facts.otherGeometryColumns.length) notices.push(`Other geometry columns are written as WKT text: ${facts.otherGeometryColumns.join(', ')}.`)
  } else if (hasGeometry) notices.push('The geometry is left out: the file holds the attributes only.')

  const g = facts.geometryColumn
  if (g && includeGeometry) {
    const col = quoteIdent(g)
    const projected = output === 'result' || targetSrid === null ? col : reprojectSql(col, resultCrs?.srid ?? null, targetSrid)
    const valid = (expr: string) => `CASE WHEN ${col} IS NOT NULL AND ST_IsValid(${col}) THEN ${expr} END`
    if (format === 'geoparquet') select.push(`${valid(`ST_AsWKB(${projected})::BLOB`)} AS ${col}`)
    else if (format === 'geojson' || jsWriter) select.push(`${valid(`ST_AsGeoJSON(${projected})`)} AS "__se_geojson"`)
    else if (format === 'csv' && csvGeometry === 'xy') {
      const taken = new Set(columns.map((c) => c.name.toLowerCase()))
      const [x, y] = taken.has('x') || taken.has('y') ? [`${g}_x`, `${g}_y`] : ['x', 'y']
      select.push(`${valid(`ST_X(${projected})`)} AS ${quoteIdent(x)}, ${valid(`ST_Y(${projected})`)} AS ${quoteIdent(y)}`)
    } else select.push(`${valid(`ST_AsText(${projected})`)} AS ${col}`)

    if (output === 'custom' && customCode !== (resultCrs?.srid ?? 4326)) notices.push(`Coordinates are reprojected from ${resultCrs?.label ?? 'EPSG:4326 (WGS84)'} to EPSG:${customCode}.`)
    if (fmt.crs === 'wgs84-only' && !resultIsWgs84) notices.push(`${fmt.label} is always WGS84 (longitude, latitude): coordinates are reprojected from ${resultCrs?.label}.`)
    if (format === 'shapefile') {
      if (layer.geometryType === 'Mixed') notices.push('A Shapefile holds one geometry type: points, lines and polygons are written as separate Shapefiles in the zip.')
      notices.push('Shapefile text values longer than 254 characters are cut.')
    }
    if (resultCrs?.assumed) notices.push('The CRS is assumed to be WGS84: the file has none.')
    const invalidShown = layer.invalidGeometryCount
    if (invalidShown > 0) {
      notices.push(`${invalidShown} ${invalidShown === 1 ? 'row has' : 'rows have'} no valid geometry: written with an empty geometry.`)
    }
  }
  notices.push(...typeNotices(format, columns))
  // Spec 008 FR-021: what each new format forces, before anything is written.
  if (format === 'shapefile') {
    const renames = dbfRenames(writerColumns.map((c) => c.name))
    if (renames.length) notices.push(`Shapefile field names are 10 characters at most: ${renames.map((r) => `${r.from} → ${r.to}`).join(', ')}.`)
  }
  if (format === 'xlsx' && rowCount > XLSX_MAX_ROWS - 1) notices.push(`Excel holds ${(XLSX_MAX_ROWS - 1).toLocaleString('en-US')} rows: the first ${(XLSX_MAX_ROWS - 1).toLocaleString('en-US')} are written.`)
  if (format === 'geopackage') notices.push('A GeoPackage is built in memory: very large results (over 1.5 GB) stop with a message; use GeoParquet for those.')

  const from = source === 'layer' ? quoteIdent('layer') : RESULT_TABLE
  // GeoJSONSeq is written by the engine (COPY ... FORMAT JSON, one object per
  // line): each row is shaped as a Feature in SQL (spec 008, DuckDB first).
  const selectList =
    format === 'geojsonseq'
      ? `'Feature' AS "type", ${columns.length ? `struct_pack(${columns.map((c) => `${quoteIdent(c.name)} := ${quoteIdent(c.name)}`).join(', ')})` : 'NULL'} AS properties, ${
          g ? `CASE WHEN ${quoteIdent(g)} IS NOT NULL AND ST_IsValid(${quoteIdent(g)}) THEN ST_AsGeoJSON(${output === 'result' || targetSrid === null ? quoteIdent(g) : reprojectSql(quoteIdent(g), resultCrs?.srid ?? null, targetSrid)})::JSON END` : 'NULL'
        } AS geometry`
      : select.join(', ') || '*'
  const sql = `SELECT ${selectList} FROM ${from}`

  return {
    source,
    rowCount,
    formats,
    blocked,
    format,
    crs,
    csvGeometry,
    xyAvailable,
    geometryColumn: g,
    notices,
    sql,
    select: selectList,
    scope,
    scopes,
    includeGeometry,
    writerColumns,
    geometryType: includeGeometry ? layer.geometryType : null,
    fileName: `${fileBase}${fmt.extension}`,
    fileBase,
    layerName: baseName(ctx.sourceName) || 'export',
  }
}
