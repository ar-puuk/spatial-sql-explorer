// QuerySession: one per viewer (spec 002, contracts/query-service.md). It
// owns a dedicated query connection, separate from the one that opened the
// file, so a cancel can never touch file loading. Temp tables are
// per-connection in DuckDB, so user temp objects and __se_result live here.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { exportErrorMessage, runExport, type ExportHooks, type ExportResult } from '../export/run.js'
import type { ExportPlan } from '../export/plan.js'
import { DEFAULT_QUERY, type Bbox, type Feature, type Layer, type QueryableTable, type TablePage, type TablePageRequest, type ViewFeatures, type ViewRequest } from '../models.js'
import { parseEngineError } from '../sql/errors.js'
import { classifyStatement } from '../sql/policy.js'
import { statementToRun } from '../sql/scanner.js'
import { buildQueryResult, CTAS_PREFIX, defaultResult, layerCrs, RESULT_TABLE, ResultDeclinedError, type BuildContext, type BuiltResult } from './run.js'
import { isDefaultQuery } from './resultModel.js'
import { PageCache, pageSql, type PageTarget } from '../view/pages.js'
import { RESULT_STAGING } from './resultModel.js'
import type { FgbReader } from '../source/fgbReader.js'
import { isOutOfMemory, OutOfMemoryError, outOfMemoryMessage } from '../outOfMemory.js'
import {
  categoryTotalsSql,
  classCountsSql,
  columnValuesSql,
  evenPositions,
  numberTotalsSql,
  HISTOGRAM_BINS,
  histogramSql,
  histogramFrom,
  type ValueHistogram,
  orderStatisticsSql,
  quantilePositions,
  STYLE_VALUES_CAP,
  topCategoriesSql,
} from '../view/stats.js'
import { resolveStyle as resolveStyleFrom, type ResolveInput } from '../style/resolve.js'
import { rendererOf, type LayerStyle, type ResolvedStyle } from '../style/model.js'
import { resolveResultCrs } from './resultCrs.js'
import { loadCatalog } from './catalog.js'
import type { CatalogSnapshot } from '../models.js'
import { QueryCancelledError, quoteIdent, sanitizeAttributes, singleRow, streamRows } from './util.js'
import { filtersToSql, parseFilter, type ColumnFilter } from './filters.js'
import { INTERNAL_LAYER, visibleColumns } from '../source/layerSql.js'
import { jenksSample, testOverrides } from '../source/readModes.js'
import {
  clampWgs84,
  fgbByIdSql,
  fgbTileSql,
  featuresByIdsSql,
  thinnedIdsSql,
  thinnedRowsSql,
  viewBoxSql,
  viewCountSql,
  viewFeaturesSql,
  viewTiles,
  tileMeetsExtent,
  type ViewTarget,
} from '../view/viewport.js'

/** contracts/query-service.md */
export interface RunRequest {
  /** Full editor text; the session picks the statement (FR-004). */
  editorText: string
  selection: { from: number; to: number }
  /** Result CRS override from the chip; null = automatic (research §4). */
  crsOverride: number | null
}

/** Spec 007 FR-009: no more large-result prompt; any result size is shown by view and page. */
export interface RunHooks {
  onProgress?(fetched: number, total: number): void
}

export interface ExecutedStatement {
  text: string
  editorOffset: number
}

export interface EngineError {
  /** 'Parser' | 'Binder' | 'Catalog' | 'Conversion' | … */
  kind: string
  message: string
  hints: string[]
  /** In editor coordinates. */
  position?: { line: number; column: number; offset: number }
}

export type RunOutcome =
  | { kind: 'result'; result: BuiltResult; durationMs: number; statement: ExecutedStatement }
  | { kind: 'ddl'; summary: string; durationMs: number; statement: ExecutedStatement }
  | { kind: 'refused'; reason: string; statement: ExecutedStatement }
  | { kind: 'error'; error: EngineError; durationMs: number; statement: ExecutedStatement }
  | { kind: 'cancelled'; durationMs: number; statement: ExecutedStatement }
  | { kind: 'empty' }

/**
 * Engine error -> EngineError with hints and an editor position (FR-008).
 * `ctasLineOffset` is 1 for queries, which run as "CREATE … AS\n" + the
 * statement (research §5/§8).
 */
function toEngineError(err: unknown, statement: ExecutedStatement, editorText: string, wrapped: boolean): EngineError {
  const text = err instanceof Error ? err.message : String(err)
  return parseEngineError(text, {
    editorText,
    statementOffset: statement.editorOffset,
    ctasLineOffset: wrapped ? 1 : 0,
    ctasPrefixLength: wrapped ? CTAS_PREFIX.length : 0,
  })
}

const nf = new Intl.NumberFormat('en-US')
const oneLine = (sql: string): string => {
  const flat = sql.replace(/\s+/g, ' ').trim()
  return flat.length > 500 ? flat.slice(0, 497) + '…' : flat
}

/** Builds the displayed Layer from a result, keeping the file's identity and whole-file totals. */
export function layerFromResult(base: Layer, built: BuiltResult): Layer {
  return { ...base, ...built.layer, loadTimings: undefined }
}

/**
 * What an export needs to know about the displayed result (spec 005 T003).
 * The complete result of the last query lives in `__se_result`; the
 * displayed rows may be fewer (the default view's LIMIT, "first 50,000").
 */
export interface ResultFacts {
  /** False for DESCRIBE / SHOW / SUMMARIZE / EXPLAIN results, which aren't materialized. */
  exportable: boolean
  geometryColumn: string | null
  otherGeometryColumns: string[]
  /** CRS of the stored geometry. `assumed`: the file had none (WGS84 assumed). */
  resultCrs: { label: string; srid: number | null; assumed: boolean } | null
  /** Rows of the complete result: the whole file for the default view. */
  totalRows: number
  /** Rows actually shown when "Show first 50,000" truncated the result. */
  truncatedTo: number | null
  /** The untouched initial view (the default query, spec 002). */
  defaultView: boolean
  /** Spec 007: `layer` (the default view), a materialized `table`, or a `view` over a big result. */
  kind: BuiltResult['kind']
  /** A big result whose pages and views re-run expensive work: the table says so once. */
  reRuns: boolean
  /** Visible non-geometry columns (spec 007: map views carry them for styling). */
  attrs: string[]
  /** The same columns with their types (styles need them). */
  columns: Array<{ name: string; type: string }>
}

export function resultFacts(built: BuiltResult, table: QueryableTable, defaultView: boolean): ResultFacts {
  return {
    exportable: true,
    geometryColumn: built.geometryColumn,
    otherGeometryColumns: built.otherGeometryColumns,
    resultCrs: built.resultCrs
      ? { label: built.resultCrs.crs.label, srid: built.resultCrs.srid, assumed: built.resultCrs.source === 'layer' && table.crsAssumed }
      : null,
    totalRows: defaultView ? table.totals.rows : built.totalRows,
    truncatedTo: built.truncatedTo,
    defaultView,
    kind: built.kind,
    reRuns: built.reRuns,
    attrs: built.layer.columns.map((c) => c.name),
    columns: built.layer.columns,
  }
}

/** How map views reach `layer` (set by openFile; spec 007 research §6). */
export interface LayerViewInfo {
  index: ViewTarget['index']
  /** FlatGeobuf read in parts: the registered path. */
  path?: string
  /** FlatGeobuf read in parts: the feature id expression. */
  rowidExpr?: string
  /** FlatGeobuf read in parts: the file's envelope, in the layer CRS. */
  extent?: Bbox | null
  /** The open counted no invalid geometry: views skip ST_IsValid. */
  allValid?: boolean
  /**
   * FlatGeobuf read in parts, in WGS84: views read the file in JS (index
   * search + batched range reads) instead of GDAL (research.md US7 outcomes).
   */
  fgbReader?: FgbReader
  /** Quoted geometry column of `__se_layer`. */
  geom: string
  attrs: string[]
}

/** What whole-file work says on a FlatGeobuf read in parts, before Load (T044, data-model.md). */
export function needsLoadMessage(sizeLabel: string): string {
  return `Load the whole file (${sizeLabel}) to query it.`
}

/** A view request that couldn't run because a query or export holds the engine; the map asks again after. */
export class ViewSkippedError extends Error {}

/** Background work (a table page, style statistics) interrupted by user work; ask again after `whenIdle()`. */
export class WorkPreemptedError extends Error {
  constructor() {
    super('Interrupted by a query or export.')
  }
}

/**
 * What holds the engine (spec 007 FR-007):
 * - `view`: a map view, interrupted by anything;
 * - `background`: table pages, style statistics, a feature by id; interrupted by user work;
 * - `work`: user work (a query, an export) and everything else; never interrupted.
 */
export type EngineWorkKind = 'view' | 'background' | 'work'

/** A view row (attributes, `__se_rowid`, `__se_geojson`) as a map Feature. */
function toViewFeature(row: Record<string, unknown>): Feature {
  const { __se_geojson, __se_rowid, ...attributes } = row
  return {
    id: Number(__se_rowid),
    geometry: __se_geojson ? (JSON.parse(String(__se_geojson)) as GeoJSON.Geometry) : null,
    attributes: sanitizeAttributes(attributes),
  }
}

/** Internal objects every viewer creates: hidden from users and protected from DDL. */
export const SOURCE_TABLE = '__se_source'

export class QuerySession {
  readonly defaultQuery = DEFAULT_QUERY
  private inFlight: Promise<unknown> | null = null
  /** What holds the engine (EngineWorkKind). */
  private inFlightKind: EngineWorkKind | null = null
  /** Marks the in-flight work as interrupted by newer work, before cancelling it. */
  private preemptInFlight: (() => void) | null = null
  /** Re-registers a source read in parts after an out-of-memory error (its handle reads as empty after). */
  private reRegisterSource: (() => Promise<void>) | null = null
  private layerView: LayerViewInfo | null = null
  private cancelRequested = false
  private disposed = false
  private catalogCache: CatalogSnapshot | null = null
  private facts: ResultFacts | null = null
  private defaultFacts: ResultFacts | null = null
  /** Spec 008 FR-010/FR-011: the table filters over the displayed result, and their WHERE body. */
  private filters: ColumnFilter[] = []
  private filterWhere: string | null = null
  /** Rows matching the filters, once counted (null: not counted, or no filters). */
  private matchingRows: number | null = null

  constructor(
    private readonly db: AsyncDuckDB,
    /** @internal used by the run pipeline */
    readonly conn: AsyncDuckDBConnection,
    readonly table: QueryableTable,
    /** Registered source files still needed (streamed backing); dropped on dispose. */
    private readonly liveFiles: string[],
    /** HostAdapter.log, when the host has one (FR-010). */
    private readonly log?: (line: string) => void
  ) {}

  /**
   * Runs the statement under the cursor (or the selection): FR-004/FR-013.
   * Never throws for engine or policy problems: they come back as outcomes,
   * and only a `result` outcome is meant to replace what's displayed.
   */
  async run(request: RunRequest, _hooks: RunHooks = {}): Promise<RunOutcome> {
    const span = statementToRun(request.editorText, request.selection)
    if (!span) return { kind: 'empty' }
    const statement: ExecutedStatement = { text: span.text, editorOffset: span.from }
    if (this.needsLoad) return { kind: 'refused', reason: 'Load the whole file to query it.', statement }
    const policy = classifyStatement(span.text, this.protectedNames)
    if (!policy.allowed) {
      this.log?.(`[query] refused: ${policy.reason} — ${oneLine(span.text)}`)
      return { kind: 'refused', reason: policy.reason, statement }
    }

    const started = performance.now()
    const elapsed = (): number => Math.round(performance.now() - started)
    let outcome: RunOutcome
    try {
      outcome = await this.exclusive(async (isCancelled): Promise<RunOutcome> => {
        if (policy.kind === 'query') {
          // The default query reads `layer` directly (spec 007 research §9): no copy, no scan.
          if (isDefaultQuery(span.text, this.defaultQuery) && request.crsOverride === null) {
            const result = defaultResult(this.table)
            this.facts = resultFacts(result, this.table, true)
            this.resultChanged()
            return { kind: 'result', result, durationMs: elapsed(), statement }
          }
          const result = await buildQueryResult(
            this.buildContext(isCancelled, {
              resolveCrs: ({ engineType, rawExtent }) =>
                resolveResultCrs({
                  override: request.crsOverride,
                  engineType,
                  resultExtent: rawExtent,
                  layerSrid: this.table.srid,
                  layerExtent: this.table.sourceExtent,
                }),
            }),
            span.text
          )
          this.facts = resultFacts(result, this.table, false)
          this.resultChanged()
          return { kind: 'result', result, durationMs: elapsed(), statement }
        }
        if (policy.kind === 'utility') {
          const result = await this.utilityResult(span.text, isCancelled)
          this.facts = { ...resultFacts(result, this.table, false), exportable: false }
          this.resultChanged()
          return { kind: 'result', result, durationMs: elapsed(), statement }
        }
        // Temp DDL: execute, then summarize.
        await streamRows(this.conn, span.text, isCancelled)
        const what = `${policy.object === 'table' ? 'temp table' : 'temp view'} \`${policy.name}\``
        let summary = `${policy.action === 'create' ? 'Created' : 'Dropped'} ${what}`
        if (policy.action === 'create' && policy.object === 'table') {
          const n = await singleRow<{ n: bigint | number }>(this.conn, `SELECT count(*) AS n FROM ${quoteIdent(policy.name)}`, isCancelled)
          const count = Number(n.n)
          summary += ` (${nf.format(count)} ${count === 1 ? 'row' : 'rows'})`
        }
        this.catalogCache = null // temp objects changed: completion must see them
        return { kind: 'ddl', summary, durationMs: elapsed(), statement }
      })
    } catch (err) {
      outcome =
        err instanceof QueryCancelledError || err instanceof ResultDeclinedError
          ? { kind: 'cancelled', durationMs: elapsed(), statement }
          : err instanceof OutOfMemoryError
            ? { kind: 'error', error: { kind: 'Out of Memory', message: err.message, hints: [] }, durationMs: elapsed(), statement }
            : { kind: 'error', error: toEngineError(err, statement, request.editorText, policy.kind === 'query'), durationMs: elapsed(), statement }
    }
    this.log?.(`[query] ${describeOutcome(outcome)} — ${oneLine(span.text)}`)
    return outcome
  }

  /**
   * Autocomplete data from the live catalog (FR-015), cached until temp DDL
   * changes it. Returns the cache (or null) instead of queuing behind a
   * running query.
   */
  async catalog(): Promise<CatalogSnapshot | null> {
    if (this.catalogCache) return this.catalogCache
    if (this.disposed) return null
    // Autocomplete's catalog is background work: a query run right after open interrupts it (spec 007).
    this.catalogCache = await this.exclusive((isCancelled) => loadCatalog(this.conn, isCancelled), 'background')
    return this.catalogCache
  }

  /** DESCRIBE / SHOW / SUMMARIZE / EXPLAIN: small, table-only results, streamed directly. */
  private async utilityResult(text: string, isCancelled: () => boolean): Promise<BuiltResult> {
    const rows: Record<string, unknown>[] = []
    await streamRows(this.conn, text, isCancelled, (batch) => {
      rows.push(...batch)
    })
    const features = rows.map((r, i) => ({ id: i, geometry: null, attributes: sanitizeAttributes(r) }))
    // Small and already in memory: the table pages these directly (spec 007).
    this.utilityRows = features
    // DESCRIBE / SHOW / SUMMARIZE / EXPLAIN return no typed schema here:
    // infer each column's type from its first non-null value.
    const names = Object.keys(features[0]?.attributes ?? {})
    const columns = names.map((name) => {
      const v = features.find((f) => f.attributes[name] !== null)?.attributes[name]
      return { name, type: typeof v === 'number' ? 'DOUBLE' : typeof v === 'boolean' ? 'BOOLEAN' : 'VARCHAR' }
    })
    return {
      layer: {
        geometryType: 'Point',
        sourceCrs: this.table.crs,
        crsAssumed: false,
        rowCount: features.length,
        featureCount: 0,
        invalidGeometryCount: 0,
        truncated: false,
        totalRows: features.length,
        extent: null,
        columns,
      },
      geometryColumn: null,
      otherGeometryColumns: [],
      resultCrs: null,
      truncatedTo: null,
      totalRows: features.length,
      kind: 'table',
      reRuns: false,
    }
  }

  /** Names users can't replace or drop (statement policy). */
  get protectedNames(): string[] {
    return ['layer', ...(this.table.alias ? [this.table.alias] : [])]
  }

  get running(): boolean {
    return this.inFlight !== null
  }

  /** @internal Runs `work` single-flight with cancellation plumbing. */
  async exclusive<T>(work: (isCancelled: () => boolean) => Promise<T>, kind: EngineWorkKind = 'work'): Promise<T> {
    if (this.disposed) throw new Error('This viewer was closed.')
    // A map view never blocks anything; background work (table pages, style
    // statistics) never blocks user work, and retries after (spec 007 FR-007).
    // Views wait for background work: they fire on every pan and the preview,
    // and would otherwise keep a style from ever finishing.
    const interruptible = (): boolean => this.inFlightKind === 'view' || (kind === 'work' && this.inFlightKind === 'background')
    while (this.inFlight && interruptible()) {
      this.preemptInFlight?.()
      await this.cancel()
    }
    if (this.inFlight) {
      if (kind === 'view') throw new ViewSkippedError()
      throw new Error('A query is already running.')
    }
    this.cancelRequested = false
    let preempted = false
    const isCancelled = (): boolean => this.cancelRequested
    const promise = work(isCancelled)
    this.inFlight = promise
    this.inFlightKind = kind
    this.preemptInFlight = () => {
      preempted = true
    }
    try {
      return await promise
    } catch (err) {
      if (preempted && kind === 'background') throw new WorkPreemptedError()
      // FR-014: recover while still holding the engine, then say what happened.
      if (isOutOfMemory(err) && !(err instanceof OutOfMemoryError)) throw new OutOfMemoryError(await this.recoverFromOom(), { cause: err })
      throw err
    } finally {
      this.inFlight = null
      this.inFlightKind = null
      this.preemptInFlight = null
    }
  }

  // --- Spec 008: table filters (FR-010/FR-011, research §9) ------------------

  /**
   * Narrows the displayed result to rows matching `filters` (AND). Pages,
   * map views, style statistics, counts and export all read the narrowed
   * rows. Returns each filter as parsed (invalid ones aren't applied).
   * Filters clear with a new result. Not for files read in parts
   * (`needsLoad`), whose table is unavailable until loaded.
   */
  setFilters(filters: readonly ColumnFilter[]): ColumnFilter[] {
    const columns = this.facts?.columns ?? []
    const types = new Map(columns.map((c) => [c.name, c.type]))
    const parsed = filters.map((f) => parseFilter(f, types.get(f.column) ?? ''))
    const where = this.needsLoad || this.utilityRows ? null : filtersToSql(parsed, columns)
    this.filters = parsed
    if (where !== this.filterWhere) {
      this.filterWhere = where
      this.matchingRows = null
      this.pages.clear()
    }
    return parsed
  }

  get activeFilters(): readonly ColumnFilter[] {
    return this.filters
  }

  /** The WHERE body narrowing the displayed result, or null. */
  private restriction(): string | null {
    return this.filterWhere
  }

  /** `rel` narrowed by the active filters (rel must carry the columns the filters use). */
  private narrowed(rel: string): string {
    const where = this.restriction()
    return where ? `(SELECT * FROM ${rel} WHERE ${where})` : rel
  }

  /** The relation style statistics read: the result itself, or its narrowed rows. */
  private statsRelation(): string {
    const facts = this.facts
    const plain = facts?.defaultView ? 'layer' : RESULT_TABLE
    if (!this.restriction()) return plain
    const target = this.pageTarget()
    return target ? this.narrowed(target.relation) : plain
  }

  /** Rows of the displayed result, narrowed by the filters when known. */
  private displayedRows(): number {
    return this.restriction() ? (this.matchingRows ?? Number.POSITIVE_INFINITY) : (this.facts?.totalRows ?? 0)
  }

  /**
   * Counts the rows matching the filters (FR-011 "N of M"), as background
   * work. `matching` equals `total` when no filter applies.
   */
  async filterCounts(): Promise<{ total: number; matching: number }> {
    const total = this.facts?.totalRows ?? 0
    const where = this.restriction()
    if (!where) return { total, matching: total }
    if (this.matchingRows !== null) return { total, matching: this.matchingRows }
    return this.exclusive(async (isCancelled) => {
      const target = this.pageTarget()
      if (!target) return { total, matching: 0 }
      const row = await singleRow<{ n: bigint | number }>(this.conn, `SELECT count(*) AS n FROM ${this.narrowed(target.relation)}`, isCancelled)
      if (this.restriction() === where) this.matchingRows = Number(row.n)
      return { total, matching: Number(row.n) }
    }, 'background')
  }

  /**
   * A style resolved against the whole displayed result (spec 007 FR-012):
   * small results classify their fetched values exactly as spec 003 did; big
   * ones from SQL statistics, with exact class counts. Runs on the exclusive
   * connection like any user work.
   */
  async resolveStyle(style: LayerStyle): Promise<ResolvedStyle> {
    const facts = this.facts
    const base: ResolveInput = { columns: facts?.columns ?? [], rowCount: facts?.totalRows ?? 0 }
    const r = rendererOf(style)
    if (!facts || r.kind === 'single' || !r.column || !base.columns.some((c) => c.name === r.column) || this.utilityRows || this.needsLoad) {
      return resolveStyleFrom(style, this.utilityRows ? { ...base, features: this.utilityRows } : base)
    }
    const relation = this.statsRelation()
    const column = r.column
    return this.exclusive(async (isCancelled) => {
      const n = this.restriction() ? Number((await singleRow<{ n: bigint | number }>(this.conn, `SELECT count(*) AS n FROM ${relation}`, isCancelled)).n) : facts.totalRows
      const cap = jenksSample()
      if (n <= cap) {
        const values: Array<Feature['attributes'][string]> = []
        await streamRows(this.conn, columnValuesSql(relation, column), isCancelled, (batch) => {
          for (const row of batch) values.push(sanitizeAttributes({ v: row.v }).v)
        })
        return resolveStyleFrom(style, { ...base, data: { kind: 'values', column, values } })
      }
      if (r.kind === 'categorized') {
        const top: Array<{ value: string; count: number }> = []
        await streamRows(this.conn, topCategoriesSql(relation, column, r.manual ? r.classes.map((c) => c.value) : []), isCancelled, (batch) => {
          for (const row of batch) top.push({ value: String(row.cat), count: Number(row.n) })
        })
        const totals = await singleRow<{ distinct_n: bigint | number; non_null: bigint | number; nulls: bigint | number }>(this.conn, categoryTotalsSql(relation, column), isCancelled)
        return resolveStyleFrom(style, {
          ...base,
          data: { kind: 'categories', column, top, distinct: Number(totals.distinct_n), nonNull: Number(totals.non_null), nulls: Number(totals.nulls) },
        })
      }
      // Graduated: natural breaks' own order statistics, exact quantile positions, then exact counts.
      const totals = await singleRow<{ n: bigint | number; nulls: bigint | number }>(this.conn, numberTotalsSql(relation, column), isCancelled)
      const count = Number(totals.n)
      const even = evenPositions(count, cap)
      const around = r.method === 'quantile' ? quantilePositions(count, r.classCount) : []
      const atPos = new Map<number, number>()
      if (count > 0) {
        await streamRows(this.conn, orderStatisticsSql(relation, column, [...even, ...around]), isCancelled, (batch) => {
          for (const row of batch) atPos.set(Number(row.pos), Number(row.v))
        })
      }
      const sample = even.map((p) => atPos.get(p)).filter((v): v is number => v !== undefined)
      const quantileStats = Object.fromEntries(around.map((p) => [p, atPos.get(p) ?? 0]))
      const resolved = resolveStyleFrom(style, { ...base, data: { kind: 'numbers', column, sample, n: count, nulls: Number(totals.nulls), quantileStats } })
      const ranges = resolved.classes.filter((c) => c.kind === 'range').map((c) => ({ lower: c.lower ?? 0, upper: c.upper ?? 0 }))
      const byClass = new Map<number, number>()
      await streamRows(this.conn, classCountsSql(relation, column, ranges), isCancelled, (batch) => {
        for (const row of batch) byClass.set(Number(row.cls), Number(row.n))
      })
      let i = 0
      const classes = resolved.classes
        .map((c) => {
          if (c.kind === 'range') return { ...c, count: byClass.get(i++) ?? 0 }
          if (c.kind === 'other') return { ...c, count: byClass.get(-1) ?? 0 }
          if (c.kind === 'noValue') return { ...c, count: byClass.get(-2) ?? 0 }
          return c
        })
        .filter((c) => c.kind !== 'other' || c.count > 0)
      return { ...resolved, classes }
    }, 'background')
  }

  /**
   * The value distribution of a numeric column of the displayed result
   * (spec 008 FR-003): exact, in two aggregation passes over the whole
   * result, as background work. Null when the column has no numbers, or the
   * result can't be read in full yet (spec 007 needsLoad).
   */
  async valueHistogram(column: string): Promise<ValueHistogram | null> {
    const facts = this.facts
    if (!facts || this.needsLoad || !facts.columns.some((c) => c.name === column)) return null
    if (this.utilityRows) {
      const values = this.utilityRows.map((f) => Number(f.attributes[column])).filter((v) => Number.isFinite(v))
      if (!values.length) return null
      const min = Math.min(...values)
      const max = Math.max(...values)
      const n = max > min ? HISTOGRAM_BINS : 1
      const rows = values.map((v) => ({ b: Math.min(n - 1, Math.floor(((v - min) / (max - min || 1)) * n)), n: 1 }))
      return histogramFrom(min, max, rows)
    }
    const relation = this.statsRelation()
    return this.exclusive(async (isCancelled) => {
      const totals = await singleRow<{ n: bigint | number; min: number | null; max: number | null }>(this.conn, numberTotalsSql(relation, column), isCancelled)
      if (!Number(totals.n) || totals.min === null || totals.max === null) return null
      const min = Number(totals.min)
      const max = Number(totals.max)
      const rows: Array<{ b: number; n: number }> = []
      await streamRows(this.conn, histogramSql(relation, column, min, max), isCancelled, (batch) => {
        for (const row of batch) rows.push({ b: Number(row.b), n: Number(row.n) })
      })
      return histogramFrom(min, max, rows)
    }, 'background')
  }

  /**
   * Distinct non-empty values per text column of the displayed result, for
   * the categorized renderer's column suggestion (spec 003). Exact up to
   * STYLE_VALUES_CAP rows; above, counted on the first that many.
   */
  async distinctCounts(): Promise<Record<string, number>> {
    const facts = this.facts
    const textual = (facts?.columns ?? []).filter((c) => /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM|BOOLEAN)/i.test(c.type))
    if (!facts || !textual.length || this.utilityRows || this.needsLoad) return {}
    const relation = this.statsRelation()
    const select = textual.map((c, i) => `count(DISTINCT nullif(CAST(${quoteIdent(c.name)} AS VARCHAR), '')) AS d${i}`).join(', ')
    return this.exclusive(async (isCancelled) => {
      const row = await singleRow<Record<string, bigint | number>>(this.conn, `SELECT ${select} FROM (SELECT * FROM ${relation} LIMIT ${STYLE_VALUES_CAP})`, isCancelled)
      return Object.fromEntries(textual.map((c, i) => [c.name, Number(row[`d${i}`])]))
    }, 'background')
  }

  /** Called once by openFile for sources read in parts. */
  setSourceRecovery(reRegister: () => Promise<void>): void {
    this.reRegisterSource = reRegister
  }

  /**
   * After an out-of-memory error (research §1): the engine survives, but a
   * source read in parts must be re-registered, and half-built objects go.
   * Returns the message for the user.
   */
  private async recoverFromOom(): Promise<string> {
    const quiet = async (sql: string): Promise<void> => {
      await this.conn.query(sql).catch(() => {})
    }
    await quiet(`DROP TABLE IF EXISTS ${RESULT_STAGING}`)
    await this.reRegisterSource?.().catch(() => {})
    this.pages.clear()
    let limit: string | null = null
    try {
      const r = await this.conn.query(`SELECT current_setting('memory_limit') AS m`)
      limit = String(r.toArray()[0]?.toJSON().m ?? '') || null
    } catch {
      // The engine didn't answer: the message still stands.
    }
    this.log?.(`[engine] out of memory; recovered (limit ${limit ?? 'unknown'})`)
    return outOfMemoryMessage('work', limit)
  }

  /** Resolves when nothing holds the engine (a skipped view waits for this, then asks again). */
  async whenIdle(): Promise<void> {
    while (this.inFlight) await this.inFlight.catch(() => {})
  }

  /** Called once by openFile: how views reach `layer`. */
  setLayerView(info: LayerViewInfo): void {
    this.layerView = info
  }

  /**
   * FlatGeobuf read in parts (T044): `layer` reads the file through
   * spatial_filter_box. Whole-file statements there read it slowly in small
   * parts and can't be interrupted midway, so queries, table pages, style
   * statistics and export are refused until the file is loaded whole.
   */
  get needsLoad(): boolean {
    return this.layerView?.index === 'fgb'
  }

  /** The relation the map draws: `layer`, or the last query's result with hidden columns added. */
  private viewTarget(): ViewTarget | null {
    const facts = this.facts
    if (!facts || facts.defaultView) {
      const lv = this.layerView
      if (!lv) return null
      const narrow = lv.index !== 'fgb' && !!this.restriction()
      return { relation: narrow ? this.narrowed(INTERNAL_LAYER) : INTERNAL_LAYER, index: lv.index, geom: lv.geom, srid: this.table.srid, attrs: lv.attrs, path: lv.path, rowidExpr: lv.rowidExpr, extent: lv.extent, allValid: lv.allValid, narrowed: narrow }
    }
    const g = facts.geometryColumn
    if (!g || !facts.exportable) return null
    const q = quoteIdent(g)
    return {
      // `rowid` (the temp table's pseudo-column) is free; a big result is a view, which has none.
      relation: this.narrowed(`(SELECT *, ${facts.kind === 'view' ? 'row_number() OVER () - 1' : 'rowid'} AS __se_rowid, ST_XMin(${q}) AS __se_xmin, ST_YMin(${q}) AS __se_ymin, ST_XMax(${q}) AS __se_xmax, ST_YMax(${q}) AS __se_ymax FROM ${RESULT_TABLE})`),
      narrowed: !!this.restriction(),
      index: 'columns',
      geom: q,
      srid: facts.resultCrs?.srid ?? null,
      attrs: facts.attrs,
    }
  }

  /**
   * The features of the displayed result in a map view (spec 007 FR-005):
   * all of them up to the cap, else one per grid cell, spread across the
   * view. A newer view or any user work interrupts it (FR-007).
   */
  async view(req: ViewRequest): Promise<ViewFeatures> {
    const started = performance.now()
    return this.exclusive(async (isCancelled) => {
      const delay = testOverrides().slowViewMs
      if (delay) await new Promise((r) => setTimeout(r, delay))
      const full = this.viewTarget()
      if (!full) return { generation: req.generation, features: [], inView: 0, thinned: false, ms: 0 }
      // Only the attributes the map needs (spec 007): a 4M-row overview read 148 MB with all of them.
      const wanted = req.attrs
      const target = wanted ? { ...full, attrs: full.attrs.filter((a) => wanted.includes(a)) } : full
      const partial = target.attrs.length < full.attrs.length
      let box = clampWgs84(req.bbox)
      const boxSql = viewBoxSql(box, target.srid)
      if (boxSql) {
        const b = await singleRow<{ x0: number; y0: number; x1: number; y1: number }>(this.conn, boxSql, isCancelled)
        box = [b.x0, b.y0, b.x1, b.y1]
      }
      const rows: Record<string, unknown>[] = []
      const collect = (batch: Record<string, unknown>[]): void => {
        rows.push(...batch)
      }
      // ~2 px in layer units: smaller features travel and draw as points.
      const minSize = req.widthPx && req.widthPx > 0 ? ((box[2] - box[0]) / req.widthPx) * 2 : undefined
      let inView: number
      let thinned = false
      const fgbReader = target.index === 'fgb' && this.facts?.defaultView !== false ? this.layerView?.fgbReader : undefined
      if (fgbReader) {
        // FlatGeobuf in parts, in JS: the features in view, or an overview from the index.
        const v = await fgbReader.view(box, req.cap, isCancelled)
        if (isCancelled()) throw new QueryCancelledError()
        const features = wanted ? v.features.map((f) => ({ ...f, attributes: Object.fromEntries(Object.entries(f.attributes).filter(([k]) => wanted.includes(k))) })) : v.features
        return {
          generation: req.generation,
          features: partial ? features.map((f) => (f.geometry?.type === 'Point' && Object.keys(f.attributes).length === 0 ? f : { ...f, partialAttributes: true })) : features,
          inView: v.inView,
          thinned: v.thinned,
          ms: Math.round(performance.now() - started),
          ...(v.exact ? {} : { inViewEstimated: true }),
        }
      } else if (target.index === 'fgb') {
        // FlatGeobuf in parts: tiles, each capped (research §4: ~0.74 ms per feature).
        const tiles = viewTiles(box)
        const per = Math.max(1, Math.ceil(req.cap / tiles.length))
        for (const tile of tiles) {
          if (!tileMeetsExtent(tile, target.extent)) continue
          const before = rows.length
          try {
            await streamRows(this.conn, fgbTileSql(target, tile, per + 1, minSize), isCancelled, collect)
          } catch (err) {
            // The engine's empty-filter bug (fgbTileSql): stale rows that don't parse. No features here.
            if (err instanceof QueryCancelledError || !/Could not parse WKB/i.test(String(err))) throw err
            rows.length = before
            continue
          }
          if (rows.length - before > per) {
            rows.length = before + per
            thinned = true
          }
        }
        inView = rows.length
      } else {
        // A result that fits under the cap needs no count: everything in view is fetched, so it IS the count.
        const resultRows = this.restriction() ? this.displayedRows() : this.facts && !this.facts.defaultView ? this.facts.totalRows : this.table.totals.rows
        if (resultRows <= req.cap) {
          await streamRows(this.conn, viewFeaturesSql(target, box, req.cap, minSize), isCancelled, collect)
          inView = rows.length
        } else {
          const n = await singleRow<{ n: bigint | number }>(this.conn, viewCountSql(target, box), isCancelled)
          inView = Number(n.n)
          thinned = inView > req.cap
        }
        if (thinned === false && resultRows <= req.cap) {
          // Fetched above.
        } else if (!thinned) {
          await streamRows(this.conn, viewFeaturesSql(target, box, req.cap, minSize), isCancelled, collect)
        } else if (target.index === 'columns') {
          // Overview: dots from bbox columns; geometry only for features large enough to see.
          await streamRows(this.conn, thinnedRowsSql(target, box, req.cap, inView), isCancelled, collect)
          const large: number[] = []
          for (const r of rows) {
            const small = minSize !== undefined && Number(r.__se_xmax) - Number(r.__se_xmin) < minSize && Number(r.__se_ymax) - Number(r.__se_ymin) < minSize
            if (small || r.__se_xmin === null) r.__se_geojson = r.__se_dotjson
            else large.push(Number(r.__se_rowid))
            delete r.__se_dotjson
            delete r.__se_xmin
            delete r.__se_ymin
            delete r.__se_xmax
            delete r.__se_ymax
          }
          if (large.length) {
            const shapes = new Map<number, unknown>()
            await streamRows(this.conn, featuresByIdsSql(target, large.join(', '), minSize), isCancelled, (batch) => {
              for (const s of batch) shapes.set(Number(s.__se_rowid), s.__se_geojson)
            })
            for (const r of rows) if (r.__se_geojson === undefined) r.__se_geojson = shapes.get(Number(r.__se_rowid)) ?? null
          }
        } else {
          await streamRows(this.conn, featuresByIdsSql(target, thinnedIdsSql(target, box, req.cap, inView), minSize), isCancelled, collect)
        }
      }
      const features = rows
        .filter((r) => r.__se_geojson !== null && r.__se_geojson !== undefined)
        .map((r) => (partial ? { ...toViewFeature(r), partialAttributes: true } : toViewFeature(r)))
      const atLeast = target.index === 'fgb' && thinned
      return { generation: req.generation, features, inView, thinned, ms: Math.round(performance.now() - started), ...(atLeast ? { inViewAtLeast: true } : {}) }
    }, 'view')
  }

  /** One feature by its stable id, wherever it is (selection outside the drawn set, FR-008). */
  async featureById(id: number): Promise<Feature | null> {
    return this.exclusive(async (isCancelled) => {
      const target = this.viewTarget()
      if (!target) return null
      const rows: Record<string, unknown>[] = []
      const sql = target.index === 'fgb' ? fgbByIdSql(target, id) : featuresByIdsSql(target, String(Math.floor(id)))
      await streamRows(this.conn, sql, isCancelled, (batch) => {
        rows.push(...batch)
      })
      return rows[0] ? toViewFeature(rows[0]) : null
    }, 'background')
  }

  /** @internal Build context with the given CRS resolution and size policy. */
  buildContext(isCancelled: () => boolean, overrides: Partial<BuildContext> = {}): BuildContext {
    return {
      conn: this.conn,
      table: this.table,
      isCancelled,
      resolveCrs: () => layerCrs(this.table),
      ...overrides,
    }
  }

  /** The initial view: `layer` itself (spec 007: no copy, no rows fetched). */
  async runDefault(): Promise<BuiltResult> {
    const built = defaultResult(this.table)
    this.facts = resultFacts(built, this.table, true)
    this.defaultFacts = this.facts
    this.resultChanged()
    return built
  }

  // --- Spec 007: the attribute table's pages ----------------------------------

  private pages = new PageCache()
  private utilityRows: Feature[] | null = null

  /** A new result: cached pages belong to the old one. */
  private resultChanged(): void {
    this.pages.clear()
    this.filters = []
    this.filterWhere = null
    this.matchingRows = null
    if (this.facts?.exportable !== false) this.utilityRows = null
  }

  /** The relation pages read: `layer` with its row ids, or the result with ids added. */
  private pageTarget(): PageTarget | null {
    const facts = this.facts
    if (!facts) return null
    if (facts.defaultView) {
      const lv = this.layerView
      return { relation: INTERNAL_LAYER, columns: visibleColumns(this.table.columns).filter((c) => !lv || quoteIdent(c.name) !== lv.geom), geom: lv?.geom ?? null, allValid: lv?.allValid }
    }
    const rowid = facts.kind === 'view' ? 'row_number() OVER () - 1' : 'rowid'
    const g = facts.geometryColumn ? quoteIdent(facts.geometryColumn) : null
    const columns = [...facts.attrs.map((name) => ({ name, type: 'VARCHAR' })), ...facts.otherGeometryColumns.map((name) => ({ name, type: 'GEOMETRY' }))]
    return { relation: `(SELECT *, ${rowid} AS __se_rowid FROM ${RESULT_TABLE})`, columns, geom: g }
  }

  /**
   * One page of the displayed result (spec 007 FR-011): any row reachable,
   * sorted in SQL over the whole result. Cached per result and sort.
   */
  async page(req: TablePageRequest): Promise<TablePage> {
    const cached = this.pages.get(req)
    if (cached) return cached
    if (this.needsLoad) return { offset: req.offset, rows: [] }
    if (this.utilityRows) {
      const rows = this.utilityRows.slice(req.offset, req.offset + req.limit).map((f) => ({ id: Number(f.id), attributes: f.attributes, invalidGeometry: false }))
      return { offset: req.offset, rows }
    }
    const result = await this.exclusive(async (isCancelled) => {
      const plain = this.pageTarget()
      if (!plain) return { offset: req.offset, rows: [] }
      const target = { ...plain, relation: this.narrowed(plain.relation) }
      const rows: TablePage['rows'] = []
      await streamRows(this.conn, pageSql(target, req), isCancelled, (batch) => {
        for (const r of batch) {
          const { __se_rowid, __se_invalid, ...attributes } = r
          rows.push({ id: Number(__se_rowid), attributes: sanitizeAttributes(attributes), invalidGeometry: __se_invalid === true })
        }
      })
      return { offset: req.offset, rows }
    }, 'background')
    this.pages.set(req, result)
    return result
  }

  /**
   * Reset (spec 002 FR-011) shows the original view again without
   * re-running it; exports must follow (spec 005). The default view exports
   * from `layer`, never from `__se_result`, which still holds the last query.
   */
  showDefaultView(): void {
    this.facts = this.defaultFacts
    this.resultChanged()
  }

  /**
   * Writes an export plan's file and returns its bytes (spec 005). Runs on
   * the exclusive connection like a query, so cancel() stops it the same way
   * and a query never interleaves with it. Never touches __se_result.
   */
  async exportData(plan: ExportPlan, hooks: ExportHooks = {}): Promise<ExportResult> {
    if (this.needsLoad) throw new Error('Load the whole file to export it.')
    const started = performance.now()
    try {
      const result = await this.exclusive((isCancelled) => runExport(this.db, this.conn, plan, isCancelled, hooks))
      this.log?.(`[export] ${plan.format}: ${nf.format(result.rows)} rows, ${nf.format(result.bytes.length)} bytes · ${Math.round(performance.now() - started)} ms`)
      return result
    } catch (err) {
      this.log?.(`[export] ${plan.format}: ${err instanceof QueryCancelledError ? 'cancelled' : exportErrorMessage(err)}`)
      throw err
    }
  }

  /** Facts about the displayed result, for export (spec 005); null before the first result. */
  get lastResult(): ResultFacts | null {
    return this.facts
  }

  /**
   * Executes SQL as-is (no statement policy), returning the rows. For the
   * web e2e hook that proves the ENGINE lockdown on its own (spec 002 T036).
   * The lockdown, not the policy, is the security boundary this exercises.
   */
  async runRaw(sql: string): Promise<Record<string, unknown>[]> {
    return this.exclusive(async (isCancelled) => {
      const rows: Record<string, unknown>[] = []
      await streamRows(this.conn, sql, isCancelled, (batch) => {
        rows.push(...batch)
      })
      return rows
    })
  }

  /**
   * Cancels the in-flight statement (research §1: streaming API +
   * cancelSent). Resolves once the in-flight work has settled.
   */
  async cancel(): Promise<void> {
    const inFlight = this.inFlight
    if (!inFlight) return
    this.cancelRequested = true
    await this.conn.cancelSent().catch(() => false)
    // The run reports its own outcome (cancelled or error); here we only
    // wait for it to settle.
    await inFlight.catch(() => {})
  }

  /** Drops this viewer's objects and files; called when the viewer reloads or closes. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.cancel()
    this.disposed = true
    const drop = async (sql: string): Promise<void> => {
      await this.conn.query(sql).catch(() => {})
    }
    await drop(`DROP TABLE IF EXISTS ${RESULT_TABLE}`)
    await drop(`DROP VIEW IF EXISTS ${RESULT_TABLE}`)
    await drop(`DROP TABLE IF EXISTS ${RESULT_STAGING}`)
    if (this.table.alias) await drop(`DROP VIEW IF EXISTS ${quoteIdent(this.table.alias)}`)
    await drop('DROP VIEW IF EXISTS layer')
    await drop('DROP VIEW IF EXISTS __se_layer')
    await drop('DROP TABLE IF EXISTS __se_bbox')
    await drop(`DROP TABLE IF EXISTS ${SOURCE_TABLE}`)
    await drop('DROP TABLE IF EXISTS __se_raw')
    await this.conn.close().catch(() => {})
    for (const path of this.liveFiles) await this.db.dropFile(path).catch(() => {})
  }
}

/** Keeps a number and its unit together when the status line wraps. */
const NBSP = '\u00a0'

/** One line for the output channel and the status line (FR-010). */
export function describeOutcome(o: RunOutcome): string {
  switch (o.kind) {
    case 'result': {
      const r = o.result
      const n = r.layer.rowCount
      const rows = `${nf.format(n)} ${n === 1 ? 'row' : 'rows'}`
      const mapped = r.geometryColumn ? `${nf.format(r.layer.featureCount)} mapped` : 'no geometry to map'
      return `✓ ${rows} · ${mapped} · ${o.durationMs}${NBSP}ms`
    }
    case 'ddl':
      return `✓ ${o.summary} · ${o.durationMs}${NBSP}ms`
    case 'refused':
      return `⛔ ${o.reason}`
    case 'error':
      return `✗ ${o.error.kind} Error: ${o.error.message} · ${o.durationMs}${NBSP}ms`
    case 'cancelled':
      return `Cancelled after ${(o.durationMs / 1000).toFixed(1)}${NBSP}s`
    case 'empty':
      return 'Nothing to run'
  }
}

