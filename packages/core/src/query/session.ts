// QuerySession: one per viewer (spec 002, contracts/query-service.md). It
// owns a dedicated query connection, separate from the one that opened the
// file, so a cancel can never touch file loading. Temp tables are
// per-connection in DuckDB, so user temp objects and __se_result live here.
import { extrusionHighSql, flatCountSql, type Extrusion } from '../style/extrusion.js'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { exportErrorMessage, runExport, type ExportAssets, type ExportHooks, type ExportResult } from '../export/run.js'
import { projjsonFor } from '../export/projjson.js'
import type { ExportPlan } from '../export/plan.js'
import { DEFAULT_QUERY, type Feature, type Layer, type QueryableTable, type TablePage, type TablePageRequest } from '../models.js'
import { parseEngineError } from '../sql/errors.js'
import { classifyStatement } from '../sql/policy.js'
import { statementToRun } from '../sql/scanner.js'
import { pathLiterals, rewritePaths, type Rewritten } from '../sql/workspacePaths.js'
import { registerSource, type RegisteredSource } from '../source/register.js'
import type { WorkspaceResolution } from '../hostAdapter.js'
import { buildQueryResult, CTAS_PREFIX, defaultResult, layerCrs, RESULT_TABLE, ResultDeclinedError, type BuildContext, type BuiltResult } from './run.js'
import { isDefaultQuery } from './resultModel.js'
import { defaultQueryFor } from '../sql/names.js'
import { PageCache, pageSql, type PageTarget } from '../view/pages.js'
import { RESULT_STAGING } from './resultModel.js'
import { isOutOfMemory, OutOfMemoryError, outOfMemoryMessage } from '../outOfMemory.js'
import {
  categoryTotalsSql,
  classCountsSql,
  cellCountsSql,
  columnsValuesSql,
  multiTotalsSql,
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
  invalidColorsSql,
} from '../view/stats.js'
import { isNumericType, measureColumns, resolveStyle as resolveStyleFrom, sizeDataKey, type ColumnData, type ResolveInput } from '../style/resolve.js'
import { EXPRESSION_VALUE_COLUMN, HEATMAP_METERS, type HeatmapRenderer, type BivariateRenderer, type GraduatedMethod, type LayerStyle, type ResolvedStyle, type RulesRenderer, type SizeChannel } from '../style/model.js'
import { legacyView, rendererOf, sizeOf } from '../style/legacy.js'
import { CHANNEL_ORDER, isColorChannel, type ChannelId, type ConditionsScale } from '../style/channels.js'
import { isGenericChannel } from '../style/resolve.js'
import { checkExpression, expressionTypeSql, expressionValueSql, ruleCountsSql, withComputedSql, type ComputedColumn, type ExpressionPurpose } from '../style/sqlExpression.js'
import type { RuleSuggestions } from '../style/edit.js'
import { resolveResultCrs } from './resultCrs.js'
import { loadCatalog } from './catalog.js'
import type { CatalogSnapshot } from '../models.js'
import { isTemporalType, QueryCancelledError, quoteIdent, sanitizeAttributes, singleRow, streamRows } from './util.js'
import { filtersToSql, parseFilter, type ColumnFilter } from './filters.js'
import { selectionExtentSqlFor, selectionPredicate, selectionTableSql, type Selection } from './selection.js'
import { INTERNAL_LAYER, visibleColumns } from '../source/layerSql.js'
import { jenksSample, testOverrides } from '../source/readModes.js'
import { clampWgs84, recordByIdSql, viewBoxSql, type ViewTarget } from '../view/viewport.js'
import { drawModeFor, type DrawMode } from '../view/drawMode.js'
import { allFeaturesSql } from '../view/features.js'
import { heatmapPeakSql, mercatorRadius } from '../view/heat.js'
import { searchValuesSql, type SearchHit } from '../view/search.js'
import { featureCollector, type MapData } from '../view/featureBatches.js'
import { tileBoundsWgs84, tileSql, type TileAttr, type TileClusters } from '../view/tiles.js'

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
function toEngineError(err: unknown, statement: ExecutedStatement, editorText: string, wrapped: boolean, rewritten?: Rewritten): EngineError {
  const text = err instanceof Error ? err.message : String(err)
  if (rewritten && rewritten.text !== statement.text) {
    // The engine saw the rewritten statement (workspace paths): place the error there, then map it back.
    const info = parseEngineError(text, {
      editorText: rewritten.text,
      statementOffset: 0,
      ctasLineOffset: wrapped ? 1 : 0,
      ctasPrefixLength: wrapped ? CTAS_PREFIX.length : 0,
    })
    if (info.position) {
      const offset = statement.editorOffset + rewritten.toOriginal(info.position.offset)
      const before = editorText.slice(0, offset)
      info.position = { line: before.split('\n').length, column: offset - (before.lastIndexOf('\n') + 1) + 1, offset }
    }
    return info
  }
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
  /** The open counted no invalid geometry: views skip ST_IsValid. */
  allValid?: boolean
  /** Quoted geometry column of `__se_layer`. */
  geom: string
  attrs: string[]
}

/** A tile that couldn't be built because a query or export holds the engine; the map asks again after. */
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
 * - `tile`: one vector tile of a big result (spec 010), the same as a view;
 * - `background`: table pages, style statistics, a feature by id; interrupted by user work;
 * - `work`: user work (a query, an export) and everything else; never interrupted.
 */
export type EngineWorkKind = 'view' | 'tile' | 'background' | 'work'

/** A record row (attributes, `__se_rowid`, `__se_geojson`) as a Feature (featureById). */
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
  private inFlight: Promise<unknown> | null = null
  /** What holds the engine (EngineWorkKind). */
  private inFlightKind: EngineWorkKind | null = null
  /** User work waiting for in-flight views or tiles to stop (spec 010: they don't start meanwhile). */
  private workWaiting = 0
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
  /**
   * Spec 008: checks an EPSG code against the engine's PROJ database (for
   * exporting to a CRS the user types), and returns its name.
   */
  async describeCrs(srid: number): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
    if (!Number.isInteger(srid) || srid <= 0) return { ok: false, reason: 'Enter an EPSG code, e.g. 26912.' }
    return this.exclusive(async (isCancelled) => {
      try {
        const p = (await projjsonFor(this.db, this.conn, srid, isCancelled)) as { name?: string }
        return { ok: true as const, name: p.name ?? `EPSG:${srid}` }
      } catch {
        return { ok: false as const, reason: `EPSG:${srid} is not a known CRS.` }
      }
    }, 'background')
  }

  /** Spec 008: assets JS export writers need (sql.js's wasm). */
  private exportAssets: ExportAssets = {}
  setExportAssets(assets: ExportAssets): void {
    this.exportAssets = assets
  }
  /** Spec 008 FR-013 "Show selected only": the selection's predicate, or null. */
  private selectedOnlyWhere: string | null = null

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
    const policy = classifyStatement(span.text, this.protectedNames)
    if (!policy.allowed) {
      this.log?.(`[query] refused: ${policy.reason} — ${oneLine(span.text)}`)
      return { kind: 'refused', reason: policy.reason, statement }
    }
    // Spec 010 phase 9: other workspace files the statement names, registered and rewritten.
    const prepared = await this.prepareWorkspace(span.text)
    if ('refused' in prepared) {
      this.log?.(`[query] refused: ${prepared.refused} — ${oneLine(span.text)}`)
      return { kind: 'refused', reason: prepared.refused, statement }
    }
    const rewritten = prepared.rewritten
    const sql = rewritten.text

    const started = performance.now()
    const elapsed = (): number => Math.round(performance.now() - started)
    let outcome: RunOutcome
    try {
      outcome = await this.exclusive(async (isCancelled): Promise<RunOutcome> => {
        if (policy.kind === 'query') {
          // The default query reads `layer` directly (spec 007 research §9): no copy, no scan.
          if ((isDefaultQuery(span.text, this.defaultQuery) || isDefaultQuery(span.text, DEFAULT_QUERY)) && request.crsOverride === null) {
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
            sql
          )
          this.facts = resultFacts(result, this.table, false)
          this.resultChanged()
          return { kind: 'result', result, durationMs: elapsed(), statement }
        }
        if (policy.kind === 'utility') {
          const result = await this.utilityResult(sql, isCancelled)
          this.facts = { ...resultFacts(result, this.table, false), exportable: false }
          this.resultChanged()
          return { kind: 'result', result, durationMs: elapsed(), statement }
        }
        // Temp DDL: execute, then summarize.
        await streamRows(this.conn, sql, isCancelled)
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
            : { kind: 'error', error: toEngineError(err, statement, request.editorText, policy.kind === 'query', rewritten), durationMs: elapsed(), statement }
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

  /** Spec 010 phase 9: reaches other workspace files (HostAdapter.resolveWorkspaceFiles), or null. */
  private workspaceResolver: ((paths: string[]) => Promise<WorkspaceResolution[]>) | null = null
  /** Workspace files registered with the engine, by path. */
  private wsRegistered = new Map<string, RegisteredSource>()

  /** Set by the store from the host: lets a query name other workspace files. */
  setWorkspace(resolver: ((paths: string[]) => Promise<WorkspaceResolution[]>) | null): void {
    this.workspaceResolver = resolver
  }

  /**
   * Registers the workspace files a statement names (once each) and rewrites
   * their literals to the engine paths. A path used as a file (ST_Read('x.shp'),
   * FROM 'x.parquet') that can't be read refuses the statement with the host's
   * reason; any other literal that happens to look like a file name is left alone.
   */
  private async prepareWorkspace(text: string): Promise<{ rewritten: Rewritten } | { refused: string }> {
    const literals = pathLiterals(text)
    const unchanged = { rewritten: { text, toOriginal: (o: number) => o } }
    if (!literals.length || !this.workspaceResolver) return unchanged
    const wanted = [...new Set(literals.map((l) => l.path))].filter((p) => !this.wsRegistered.has(p))
    if (wanted.length) {
      let resolved: WorkspaceResolution[]
      try {
        resolved = await this.workspaceResolver(wanted)
      } catch (err) {
        return { refused: `Workspace files could not be listed: ${err instanceof Error ? err.message : String(err)}` }
      }
      for (const r of resolved) {
        if ('source' in r) {
          try {
            this.wsRegistered.set(r.path, await registerSource(this.db, r.source))
            this.log?.(`[query] workspace file: ${r.path}`)
          } catch (err) {
            return { refused: `${r.path} could not be read: ${err instanceof Error ? err.message : String(err)}` }
          }
        } else if (literals.some((l) => l.path === r.path && l.asFile)) {
          return { refused: r.error }
        }
      }
    }
    return { rewritten: rewritePaths(text, new Set(this.wsRegistered.keys())) }
  }

  /** The query showing the whole file, by the file's own name (`SELECT * FROM us_counties`). */
  get defaultQuery(): string {
    return defaultQueryFor(this.table.alias)
  }

  /** Names users can't replace or drop (statement policy). */
  get protectedNames(): string[] {
    const alias = this.table.alias && !this.table.schema ? [this.table.alias.replace(/^"|"$/g, '')] : []
    return ['layer', ...alias]
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
    const interruptible = (): boolean => this.inFlightKind === 'view' || this.inFlightKind === 'tile' || (kind === 'work' && this.inFlightKind === 'background')
    // Spec 010: user work waiting for the engine goes first. A tile that retried as soon as the
    // engine went idle would otherwise start again before the work, and be cancelled again, forever.
    if ((kind === 'view' || kind === 'tile') && this.workWaiting > 0) throw new ViewSkippedError()
    // The same for background work: retried at once, it restarted while the user work was still
    // cancelling it, was preempted again, and the page never left the microtask queue (a hang).
    if (kind === 'background' && this.workWaiting > 0) throw new WorkPreemptedError()
    if (kind === 'work') this.workWaiting++
    try {
      while (this.inFlight && interruptible()) {
        this.preemptInFlight?.()
        await this.cancel()
      }
    } finally {
      if (kind === 'work') this.workWaiting--
    }
    if (this.inFlight) {
      if (kind === 'view' || kind === 'tile') throw new ViewSkippedError()
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
   * Filters clear with a new result.
   */
  setFilters(filters: readonly ColumnFilter[]): ColumnFilter[] {
    const columns = this.facts?.columns ?? []
    const types = new Map(columns.map((c) => [c.name, c.type]))
    const parsed = filters.map((f) => parseFilter(f, types.get(f.column) ?? ''))
    const where = this.utilityRows ? null : filtersToSql(parsed, columns)
    this.filters = parsed
    if (where !== this.filterWhere) {
      this.filterWhere = where
      this.matchingRows = null
      this.pages.clear()
      this.dataVersion++
    }
    return parsed
  }

  get activeFilters(): readonly ColumnFilter[] {
    return this.filters
  }

  /** The WHERE body narrowing the displayed result, or null. */
  private restriction(): string | null {
    const parts = [this.filterWhere, this.selectedOnlyWhere].filter((p): p is string => !!p)
    return parts.length ? parts.map((p) => `(${p})`).join(' AND ') : null
  }

  /**
   * "Show selected only" (FR-013): narrows the displayed rows to `selection`
   * (on top of the filters), or shows every matching row again with null.
   * Large id selections go through a temporary table.
   */
  async setShowSelectedOnly(selection: Selection | null): Promise<void> {
    if (selection) {
      const fill = selectionTableSql(selection)
      if (fill) {
        await this.exclusive(async () => {
          for (const sql of fill) await this.conn.query(sql)
        })
      }
    }
    const where = selection ? selectionPredicate(selection) : null
    if (where !== this.selectedOnlyWhere) {
      this.selectedOnlyWhere = where
      this.matchingRows = null
      this.pages.clear()
      this.dataVersion++
    }
  }

  /**
   * The WGS84 extent of the selected rows among those displayed (FR-013
   * "Zoom to selection"), or null when none has geometry.
   */
  async selectionExtent(selection: Selection): Promise<[number, number, number, number] | null> {
    const fill = selectionTableSql(selection)
    return this.exclusive(async (isCancelled) => {
      if (fill) for (const sql of fill) await this.conn.query(sql)
      const target = this.pageTarget()
      if (!target?.geom) return null
      const where = selectionPredicate(selection)
      const rel = this.narrowed(target.relation)
      const relation = where ? `(SELECT * FROM ${rel} WHERE ${where})` : rel
      const srid = this.facts?.defaultView ? this.table.srid : (this.facts?.resultCrs?.srid ?? null)
      const b = await singleRow<{ x0: number | null; y0: number | null; x1: number | null; y1: number | null }>(this.conn, selectionExtentSqlFor(relation, target.geom, srid), isCancelled)
      return b.x0 === null || b.y0 === null || b.x1 === null || b.y1 === null ? null : [Number(b.x0), Number(b.y0), Number(b.x1), Number(b.y1)]
    }, 'background')
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
    const out = await this.withConditionChannels(style, await this.withGenericChannels(style, await this.resolveColorAndSize(style)))
    // Spec 011 US6: an expression label is checked by the engine (any type is shown as text).
    const l = style.labels
    if (!l?.enabled || l.source.kind !== 'expression' || !this.facts || this.utilityRows) return out
    const why = await this.expressionError(this.statsRelation(), l.source.expression, 'text')
    return why ? { ...out, labelError: why } : out
  }

  private conditionsCache: { key: string; ruleCountsByChannel: Partial<Record<ChannelId, Map<number, number>>>; ruleErrorsByChannel: Partial<Record<ChannelId, Record<string, string>>> } | null = null

  /**
   * Spec 011 US4: properties by conditions (spec 010's rules, per property):
   * each condition checked by the engine, then the features per rule in one
   * pass, each property's rules counted by the first that holds.
   */
  private async withConditionChannels(style: LayerStyle, out: ResolvedStyle): Promise<ResolvedStyle> {
    const facts = this.facts
    const ids = CHANNEL_ORDER.filter((id) => id !== 'color' && style.channels?.[id]?.scale.kind === 'conditions')
    if (!facts || !ids.length || this.utilityRows) return out
    const relation = this.statsRelation()
    // Cached by what the counts read: the data and each property's conditions (not outputs or labels).
    const key = `${this.dataVersion}\u0000${relation}\u0000${JSON.stringify(ids.map((id) => [id, (style.channels?.[id]?.scale as ConditionsScale).rules.map((r) => [r.id, r.where])]))}`
    let ruleCountsByChannel: Partial<Record<ChannelId, Map<number, number>>> = {}
    let ruleErrorsByChannel: Partial<Record<ChannelId, Record<string, string>>> = {}
    if (this.conditionsCache?.key === key) ({ ruleCountsByChannel, ruleErrorsByChannel } = this.conditionsCache)
    else for (const id of ids) {
      const scale = style.channels?.[id]?.scale
      if (scale?.kind !== 'conditions') continue
      const errors: Record<string, string> = {}
      for (const rule of scale.rules) {
        const why = await this.expressionError(relation, rule.where, 'condition')
        if (why) errors[rule.id] = why
      }
      const usable = new Set(scale.rules.filter((x) => !errors[x.id]).map((x) => x.id))
      ruleCountsByChannel[id] = await this.exclusive(async (isCancelled) => {
        const counts = new Map<number, number>()
        await streamRows(this.conn, ruleCountsSql(relation, scale.rules, usable), isCancelled, (batch) => {
          for (const row of batch) counts.set(Number(row.cls), Number(row.n))
        })
        return counts
      }, 'background')
      ruleErrorsByChannel[id] = errors
    }
    this.conditionsCache = { key, ruleCountsByChannel, ruleErrorsByChannel }
    const again = resolveStyleFrom(style, { ...(this.styleInput ?? { columns: facts.columns, rowCount: facts.totalRows }), ruleCountsByChannel, ruleErrorsByChannel })
    const channels = { ...out.channels }
    for (const id of ids) if (again.channels?.[id]) channels[id] = again.channels[id]
    return { ...out, channels }
  }

  /** Spec 011: the engine's data for properties set by a column other than color and size, cached by what they read. */
  private genericCache: { key: string; data: Record<string, ColumnData> } | null = null

  /**
   * Spec 011: properties with categories or classes other than color and
   * size (outline, shape, pattern, opacity, rotation…): their columns'
   * values (small results) or statistics (big ones, with exact class counts),
   * then those channels resolved on top of the color and size result.
   */
  private async withGenericChannels(style: LayerStyle, out: ResolvedStyle): Promise<ResolvedStyle> {
    const facts = this.facts
    const enc = style.channels
    if (!facts || !enc || this.utilityRows) return out
    const columns = facts.columns
    const wanted = CHANNEL_ORDER.flatMap((id) => {
      const e = enc[id]
      if (!e || !isGenericChannel(id, e) || e.source.kind !== 'column') return []
      const column = e.source.column
      if (!columns.some((c) => c.name === column)) return []
      return [{ id, column, scale: e.scale }]
    })
    if (!wanted.length) return out
    const relation = this.statsRelation()
    const shape = wanted.map((w) =>
      w.scale.kind === 'classes' ? [w.column, 'classes', w.scale.method, w.scale.classCount, w.scale.method === 'manual' ? w.scale.classes : []] : [w.column, w.scale.kind, w.scale.kind === 'categories' && w.scale.manual ? w.scale.categories.map((c) => c.value) : []]
    )
    const key = `${this.dataVersion}\u0000${relation}\u0000${JSON.stringify(shape)}`
    let data = this.genericCache?.key === key ? this.genericCache.data : null
    if (!data) {
      data = await this.exclusive(async (isCancelled) => {
        const got: Record<string, ColumnData> = {}
        const n = this.restriction() ? Number((await singleRow<{ n: bigint | number }>(this.conn, `SELECT count(*) AS n FROM ${relation}`, isCancelled)).n) : facts.totalRows
        const cap = jenksSample()
        const unique = [...new Set(wanted.map((w) => w.column))]
        if (n <= cap) {
          const values = unique.map(() => [] as Array<Feature['attributes'][string]>)
          await streamRows(this.conn, columnsValuesSql(relation, unique), isCancelled, (batch) => {
            for (const row of batch) unique.forEach((_, k) => values[k].push(sanitizeAttributes({ v: row[`v${k}`] }).v))
          })
          unique.forEach((column, k) => (got[column] = { kind: 'values', column, values: values[k] }))
          return got
        }
        for (const w of wanted) {
          if (got[w.column]) continue
          // Spec 011 US4: continuous and as-is numbers need the minimum and maximum (and nulls).
          if (w.scale.kind === 'continuous' || (w.scale.kind === 'identity' && !isColorChannel(w.id))) {
            const t = await singleRow<{ n: bigint | number; nulls: bigint | number; min: number | null; max: number | null }>(this.conn, numberTotalsSql(relation, w.column), isCancelled)
            const sample = t.min === null || t.max === null ? [] : [Number(t.min), Number(t.max)]
            got[w.column] = { kind: 'numbers', column: w.column, sample, n: Number(t.n), nulls: Number(t.nulls) }
            continue
          }
          if (w.scale.kind === 'categories' || w.scale.kind === 'identity') {
            const top: Array<{ value: string; count: number }> = []
            await streamRows(this.conn, topCategoriesSql(relation, w.column, w.scale.kind === 'categories' && w.scale.manual ? w.scale.categories.map((c) => c.value) : []), isCancelled, (batch) => {
              for (const row of batch) top.push({ value: String(row.cat), count: Number(row.n) })
            })
            const totals = await singleRow<{ distinct_n: bigint | number; non_null: bigint | number; nulls: bigint | number }>(this.conn, categoryTotalsSql(relation, w.column), isCancelled)
            // Spec 011 US4: as-is colors also count the values that aren't colors.
            const invalid = w.scale.kind === 'identity' ? Number((await singleRow<{ bad: bigint | number }>(this.conn, invalidColorsSql(relation, w.column), isCancelled)).bad) : undefined
            got[w.column] = { kind: 'categories', column: w.column, top, distinct: Number(totals.distinct_n), nonNull: Number(totals.non_null), nulls: Number(totals.nulls), ...(invalid !== undefined ? { invalid } : {}) }
          } else if (w.scale.kind === 'classes') {
            const totals = await singleRow<Record<string, bigint | number | null>>(this.conn, multiTotalsSql(relation, [w.column]), isCancelled)
            const count = Number(totals.n_0)
            const nulls = Number(totals.nulls_0)
            const even = evenPositions(count, cap)
            const around = w.scale.method === 'quantile' ? quantilePositions(count, w.scale.classCount) : []
            const atPos = new Map<number, number>()
            if (count > 0) {
              await streamRows(this.conn, orderStatisticsSql(relation, w.column, [...even, ...around]), isCancelled, (batch) => {
                for (const row of batch) atPos.set(Number(row.pos), Number(row.v))
              })
            }
            const sample = even.map((pos) => atPos.get(pos)).filter((v): v is number => v !== undefined)
            got[w.column] = { kind: 'numbers', column: w.column, sample, n: count, nulls, quantileStats: Object.fromEntries(around.map((pos) => [pos, atPos.get(pos) ?? 0])) }
          }
        }
        return got
      }, 'background')
      this.genericCache = { key, data }
    }
    const input: ResolveInput = { ...(this.styleInput ?? { columns, rowCount: facts.totalRows }), dataByColumn: { ...(this.styleInput?.dataByColumn ?? {}), ...data } }
    const again = resolveStyleFrom(style, input)
    const channels = { ...out.channels }
    for (const w of wanted) {
      const rc = again.channels?.[w.id]
      if (!rc) continue
      // Big results: exact counts per class (the classification above used a sample).
      if (rc.status === 'ok' && w.scale.kind === 'classes' && data[w.column]?.kind === 'numbers') {
        const ranges = rc.classes.filter((c) => c.kind === 'range').map((c) => ({ lower: c.lower ?? 0, upper: c.upper ?? 0 }))
        const byClass = new Map<number, number>()
        await this.exclusive(
          (isCancelled) =>
            streamRows(this.conn, classCountsSql(relation, w.column, ranges), isCancelled, (batch) => {
              for (const row of batch) byClass.set(Number(row.cls), Number(row.n))
            }),
          'background'
        )
        let k = 0
        channels[w.id] = {
          ...rc,
          classes: rc.classes
            .map((c) => (c.kind === 'range' ? { ...c, count: byClass.get(k++) ?? 0 } : c.kind === 'other' ? { ...c, count: byClass.get(-1) ?? 0 } : c.kind === 'noValue' ? { ...c, count: byClass.get(-2) ?? 0 } : c))
            .filter((c) => c.kind !== 'other' || c.count > 0),
        }
      } else channels[w.id] = rc
    }
    return { ...out, channels }
  }

  /** The color and size channels resolved against the whole displayed result (spec 007–010). */
  private async resolveColorAndSize(style: LayerStyle): Promise<ResolvedStyle> {
    const facts = this.facts
    const base: ResolveInput = { columns: facts?.columns ?? [], rowCount: facts?.totalRows ?? 0 }
    const r = rendererOf(style)
    // Spec 010: rules and graduated expressions are evaluated by the engine.
    if (facts && !this.utilityRows && (r.kind === 'rules' || (r.kind === 'graduated' && r.expression))) return this.resolveSqlStyle(style, base)
    // A heatmap with automatic intensity: its peak density from the engine first.
    if (facts && !this.utilityRows && r.kind === 'heatmap' && r.autoIntensity && r.radiusUnit === 'm') return this.resolveHeatmapAuto(style, r, base)
    const has = (c: string | undefined): c is string => !!c && base.columns.some((x) => x.name === c)
    // Spec 009: every channel column the style classifies.
    // A heatmap's weight column is read for its largest value only.
    const colorColumn = (r.kind === 'categorized' || r.kind === 'graduated') && has(r.column) ? r.column : r.kind === 'heatmap' && has(r.weight) ? r.weight : null
    const sizeChannel = sizeOf(style)
    const size = sizeChannel && r.kind !== 'bivariate' && r.kind !== 'heatmap' && r.kind !== 'clusters' && has(sizeChannel.column) ? sizeChannel : null
    const axes = r.kind === 'bivariate' && has(r.x.column) && has(r.y.column) && r.x.column !== r.y.column ? r : null
    if (!facts || (!colorColumn && !size && !axes) || this.utilityRows) {
      return resolveStyleFrom(style, this.utilityRows ? { ...base, features: this.utilityRows } : base)
    }
    const relation = this.statsRelation()
    // A change that only recolors (a ramp, a palette, a class color) reuses the data and the
    // exact counts: hovering ramps in the picker re-ran the whole classification for each one.
    const key = `${this.dataVersion}\u0000${relation}\u0000${styleDataKey(style)}`
    const hit = this.styleCache
    if (hit?.key === key) return withCounts(resolveStyleFrom(style, hit.input), hit.resolved)
    this.styleInput = null
    const out = await (axes ? this.resolveBivariate(style, axes, base, relation) : this.resolveClassified(style, r, base, relation, colorColumn, size))
    if (this.styleInput && out.status === 'ok') this.styleCache = { key, input: this.styleInput, resolved: out }
    return out
  }

  /**
   * Spec 010: rules (each condition checked, then one count per rule) and
   * graduated expressions (checked, then classified as a column of a derived
   * relation, size channel included). Cached like the other renderers.
   */
  private async resolveSqlStyle(style: LayerStyle, base: ResolveInput): Promise<ResolvedStyle> {
    const r = rendererOf(style)
    const relation = this.statsRelation()
    const key = `${this.dataVersion}\u0000${relation}\u0000${styleDataKey(style)}`
    const hit = this.styleCache
    if (hit?.key === key) return withCounts(resolveStyleFrom(style, hit.input), hit.resolved)
    this.styleInput = null
    let out: ResolvedStyle
    if (r.kind === 'rules') out = await this.resolveRules(style, r, base, relation)
    else if (r.kind === 'graduated' && r.expression) {
      const why = await this.expressionError(relation, r.expression, 'value')
      if (why) return resolveStyleFrom(style, { ...base, expressionError: why })
      const derived = `(SELECT *, ${expressionValueSql(r.expression)} AS ${EXPRESSION_VALUE_COLUMN} FROM ${relation})`
      const withValue: ResolveInput = { ...base, columns: [...base.columns, { name: EXPRESSION_VALUE_COLUMN, type: 'DOUBLE' }] }
      const has = (c: string | undefined): c is string => !!c && withValue.columns.some((x) => x.name === c)
      const sizeChannel = sizeOf(style)
      const size = sizeChannel && has(sizeChannel.column) ? sizeChannel : null
      out = await this.resolveClassified(style, r, withValue, derived, EXPRESSION_VALUE_COLUMN, size)
    } else return resolveStyleFrom(style, base)
    if (this.styleInput && out.status === 'ok') this.styleCache = { key, input: this.styleInput, resolved: out }
    return out
  }

  /**
   * Heatmap, automatic intensity: the peak density of the drawn points
   * (view/heat.ts), then the weight column's largest value as usual. Cached
   * like the other renderers (the radius in meters and the weight are data).
   */
  private async resolveHeatmapAuto(style: LayerStyle, r: HeatmapRenderer, base: ResolveInput): Promise<ResolvedStyle> {
    const relation = this.statsRelation()
    const key = `${this.dataVersion}\u0000${relation}\u0000${styleDataKey(style)}`
    const hit = this.styleCache
    if (hit?.key === key) return withCounts(resolveStyleFrom(style, hit.input), hit.resolved)
    this.styleInput = null
    const target = this.viewTarget()
    const numeric = base.columns.find((c) => c.name === r.weight && isNumericType(c.type))
    let input: ResolveInput = base
    if (target) {
      const radius = mercatorRadius(r.radiusMeters ?? HEATMAP_METERS.default, r.latitude ?? 0)
      const row = await this.exclusive((isCancelled) => singleRow<{ peak: number | null }>(this.conn, heatmapPeakSql(target, radius, numeric ? r.weight : null), isCancelled), 'background')
      const peak = Number(row.peak)
      if (Number.isFinite(peak) && peak > 0) input = { ...base, heatPeak: peak }
    }
    let out: ResolvedStyle
    if (numeric) out = await this.resolveClassified(style, r, input, relation, r.weight, null)
    else out = resolveStyleFrom(style, (this.styleInput = input))
    if (this.styleInput && out.status === 'ok') this.styleCache = { key, input: this.styleInput, resolved: out }
    return out
  }

  /** Engine answers about style expressions, by relation, purpose and text (a type or an error). */
  private expressionChecks = new Map<string, string | null>()

  /**
   * Why a style expression can't be used over `relation`, or null: refused
   * words first (checkExpression), then the engine's type for it (a condition
   * must be true/false; a value, a number). No rows are read.
   */
  private async expressionError(relation: string, expression: string, purpose: ExpressionPurpose): Promise<string | null> {
    const early = checkExpression(expression, purpose)
    if (early) return early
    const key = `${this.dataVersion}\u0000${relation}\u0000${purpose}\u0000${expression}`
    const known = this.expressionChecks.get(key)
    if (known !== undefined) return known
    const why = await this.exclusive(async (isCancelled) => {
      try {
        const row = await singleRow<{ column_type: string }>(this.conn, expressionTypeSql(relation, expression), isCancelled)
        const type = String(row.column_type ?? '')
        if (purpose === 'condition' && !/^BOOL/i.test(type)) return `This gives ${type.toLowerCase() || 'a value'}, not true or false. Compare it, like pop > 1000.`
        if (purpose === 'value' && !isNumericType(type)) return `This gives ${type.toLowerCase() || 'a value'}, not a number.`
        return null
      } catch (err) {
        if (err instanceof QueryCancelledError) throw err
        const info = parseEngineError(err instanceof Error ? err.message : String(err), { editorText: expression, statementOffset: 0, ctasLineOffset: 0 })
        // The engine's wording ("not found in FROM clause! Candidate bindings: …") in plain words.
        const missing = /Referenced column "([^"]+)" not found/i.exec(info.message)
        const close = [...(info.hints.find((h) => /Candidate bindings/i.test(h)) ?? info.message).matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((c) => c !== missing?.[1])
        if (missing) return `No column "${missing[1]}" in this layer.${close.length ? ` Closest: ${close.slice(0, 4).join(', ')}.` : ''}`
        return info.message
      }
    }, 'background')
    if (this.expressionChecks.size > 200) this.expressionChecks.clear()
    this.expressionChecks.set(key, why)
    return why
  }

  /** Spec 010 rules: each condition checked, then features per rule in one pass. */
  private async resolveRules(style: LayerStyle, r: RulesRenderer, base: ResolveInput, relation: string): Promise<ResolvedStyle> {
    const ruleErrors: Record<string, string> = {}
    for (const rule of r.rules) {
      const why = await this.expressionError(relation, rule.where, 'condition')
      if (why) ruleErrors[rule.id] = why
    }
    const usable = new Set(r.rules.filter((x) => !ruleErrors[x.id]).map((x) => x.id))
    const ruleCounts = await this.exclusive(async (isCancelled) => {
      const counts = new Map<number, number>()
      await streamRows(this.conn, ruleCountsSql(relation, r.rules, usable), isCancelled, (batch) => {
        for (const row of batch) counts.set(Number(row.cls), Number(row.n))
      })
      return counts
    }, 'background')
    return resolveStyleFrom(style, (this.styleInput = { ...base, ruleCounts, ruleErrors }))
  }

  /**
   * Spec 010: what the data suggests for first rules: the first measure
   * column's median, and the most common value of the first text column
   * whose values repeat.
   */
  async ruleSuggestions(): Promise<RuleSuggestions> {
    const facts = this.facts
    if (!facts || this.utilityRows) return {}
    const relation = this.statsRelation()
    const numeric = measureColumns(facts.columns)[0]?.name
    const texts = facts.columns.filter((c) => /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM)/i.test(c.type)).map((c) => c.name).slice(0, 6)
    return this.exclusive(async (isCancelled) => {
      const out: RuleSuggestions = {}
      if (numeric) {
        const m = await singleRow<{ m: number | null }>(this.conn, `SELECT median(TRY_CAST(${quoteIdent(numeric)} AS DOUBLE)) AS m FROM ${relation}`, isCancelled)
        if (m.m !== null && Number.isFinite(Number(m.m))) out.numeric = { column: numeric, median: Number(m.m) }
      }
      for (const column of texts) {
        const v = `CAST(${quoteIdent(column)} AS VARCHAR)`
        const rows: Array<{ v: string; n: number }> = []
        await streamRows(this.conn, `SELECT ${v} AS v, count(*) AS n FROM ${relation} WHERE nullif(${v}, '') IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT 1`, isCancelled, (batch) => {
          for (const row of batch) rows.push({ v: String(row.v), n: Number(row.n) })
        })
        if (rows[0] && rows[0].n > 1) {
          out.text = { column, value: rows[0].v }
          break
        }
      }
      return out
    }, 'background')
  }

  /** The input the last engine classification used (the cache's data). */
  private styleInput: ResolveInput | null = null
  private styleCache: { key: string; input: ResolveInput; resolved: ResolvedStyle } | null = null

  /** Categorized, graduated and size channels: the engine's data, then the pure classification. */
  private resolveClassified(
    style: LayerStyle,
    r: ReturnType<typeof rendererOf>,
    base: ResolveInput,
    relation: string,
    colorColumn: string | null,
    size: SizeChannel | null
  ): Promise<ResolvedStyle> {
    const columns = [...new Set([colorColumn, size?.column].filter((c): c is string => !!c))]
    return this.exclusive(async (isCancelled) => {
      const n = this.restriction() ? Number((await singleRow<{ n: bigint | number }>(this.conn, `SELECT count(*) AS n FROM ${relation}`, isCancelled)).n) : (base.rowCount ?? 0)
      const cap = jenksSample()
      const dataByColumn: Record<string, ColumnData> = {}
      if (n <= cap) {
        // Small results: every needed column's values in one pass, classified exactly as spec 003 did.
        const values = columns.map(() => [] as Array<Feature['attributes'][string]>)
        await streamRows(this.conn, columnsValuesSql(relation, columns), isCancelled, (batch) => {
          for (const row of batch) columns.forEach((_, k) => values[k].push(sanitizeAttributes({ v: row[`v${k}`] }).v))
        })
        columns.forEach((column, k) => (dataByColumn[column] = { kind: 'values', column, values: values[k] }))
        return resolveStyleFrom(style, (this.styleInput = { ...base, data: colorColumn ? dataByColumn[colorColumn] : null, dataByColumn }))
      }
      if (r.kind === 'categorized' && colorColumn) {
        const top: Array<{ value: string; count: number }> = []
        await streamRows(this.conn, topCategoriesSql(relation, colorColumn, r.manual ? r.classes.map((c) => c.value) : []), isCancelled, (batch) => {
          for (const row of batch) top.push({ value: String(row.cat), count: Number(row.n) })
        })
        const totals = await singleRow<{ distinct_n: bigint | number; non_null: bigint | number; nulls: bigint | number }>(this.conn, categoryTotalsSql(relation, colorColumn), isCancelled)
        dataByColumn[colorColumn] = { kind: 'categories', column: colorColumn, top, distinct: Number(totals.distinct_n), nonNull: Number(totals.non_null), nulls: Number(totals.nulls) }
      }
      // Numeric channels: one totals pass for all, then the order statistics each classification
      // needs (natural breaks' own sample, exact quantile positions). A proportional size needs only
      // min and max. A size channel on the categorized color column gets its own numbers.
      const numeric: Array<{ key: string; column: string; method?: GraduatedMethod; classCount?: number }> = []
      if (r.kind === 'graduated' && colorColumn) numeric.push({ key: colorColumn, column: colorColumn, method: r.method, classCount: r.classCount })
      if (r.kind === 'heatmap' && colorColumn) numeric.push({ key: colorColumn, column: colorColumn })
      if (size && !(r.kind === 'graduated' && size.column === colorColumn && size.mode === 'proportional')) {
        const key = sizeDataKey(size.column, size.column === colorColumn)
        numeric.push(size.mode === 'classed' ? { key, column: size.column, method: size.method, classCount: size.classCount } : { key, column: size.column })
      }
      if (numeric.length) {
        const totals = await singleRow<Record<string, bigint | number | null>>(this.conn, multiTotalsSql(relation, numeric.map((c) => c.column)), isCancelled)
        for (const [k, c] of numeric.entries()) {
          const count = Number(totals[`n_${k}`])
          const nulls = Number(totals[`nulls_${k}`])
          if (!c.method) {
            const ends = count > 0 ? [Number(totals[`min_${k}`]), Number(totals[`max_${k}`])] : []
            dataByColumn[c.key] = { kind: 'numbers', column: c.column, sample: ends, n: count, nulls }
            continue
          }
          const even = evenPositions(count, cap)
          const around = c.method === 'quantile' ? quantilePositions(count, c.classCount ?? 0) : []
          const atPos = new Map<number, number>()
          if (count > 0) {
            await streamRows(this.conn, orderStatisticsSql(relation, c.column, [...even, ...around]), isCancelled, (batch) => {
              for (const row of batch) atPos.set(Number(row.pos), Number(row.v))
            })
          }
          const sample = even.map((pos) => atPos.get(pos)).filter((v): v is number => v !== undefined)
          const quantileStats = Object.fromEntries(around.map((pos) => [pos, atPos.get(pos) ?? 0]))
          dataByColumn[c.key] = { kind: 'numbers', column: c.column, sample, n: count, nulls, quantileStats }
        }
      }
      const resolved = resolveStyleFrom(style, (this.styleInput = { ...base, data: colorColumn ? dataByColumn[colorColumn] : null, dataByColumn }))
      // Exact class counts, filled in after classifying (as graduated has since spec 007).
      const counted = async (column: string, classes: ResolvedStyle['classes']): Promise<ResolvedStyle['classes']> => {
        const ranges = classes.filter((c) => c.kind === 'range').map((c) => ({ lower: c.lower ?? 0, upper: c.upper ?? 0 }))
        const byClass = new Map<number, number>()
        await streamRows(this.conn, classCountsSql(relation, column, ranges), isCancelled, (batch) => {
          for (const row of batch) byClass.set(Number(row.cls), Number(row.n))
        })
        let k = 0
        return classes
          .map((c) => {
            if (c.kind === 'range') return { ...c, count: byClass.get(k++) ?? 0 }
            if (c.kind === 'other') return { ...c, count: byClass.get(-1) ?? 0 }
            if (c.kind === 'noValue') return { ...c, count: byClass.get(-2) ?? 0 }
            return c
          })
          .filter((c) => c.kind !== 'other' || c.count > 0)
      }
      let out: ResolvedStyle = resolved
      if (r.kind === 'graduated' && colorColumn && resolved.status === 'ok') out = { ...out, classes: await counted(colorColumn, resolved.classes) }
      if (size && size.mode === 'classed' && out.size?.status === 'ok') out = { ...out, size: { ...out.size, classes: await counted(size.column, out.size.classes) } }
      return out
    }, 'background')
  }

  /**
   * Spec 009 US4 (research §4): bivariate statistics. Small results: both
   * columns' values in one pass (counts from the rows). Big ones: one totals
   * pass for both axes, each axis's order statistics, then exact cell counts
   * from one GROUP BY.
   */
  private resolveBivariate(style: LayerStyle, r: BivariateRenderer, base: ResolveInput, relation: string): Promise<ResolvedStyle> {
    const columns = [r.x.column, r.y.column]
    return this.exclusive(async (isCancelled) => {
      const n = this.restriction() ? Number((await singleRow<{ n: bigint | number }>(this.conn, `SELECT count(*) AS n FROM ${relation}`, isCancelled)).n) : (this.facts?.totalRows ?? 0)
      const cap = jenksSample()
      const dataByColumn: Record<string, ColumnData> = {}
      if (n <= cap) {
        const values = columns.map(() => [] as Array<Feature['attributes'][string]>)
        await streamRows(this.conn, columnsValuesSql(relation, columns), isCancelled, (batch) => {
          for (const row of batch) columns.forEach((_, k) => values[k].push(sanitizeAttributes({ v: row[`v${k}`] }).v))
        })
        columns.forEach((column, k) => (dataByColumn[column] = { kind: 'values', column, values: values[k] }))
        return resolveStyleFrom(style, (this.styleInput = { ...base, dataByColumn }))
      }
      const totals = await singleRow<Record<string, bigint | number | null>>(this.conn, multiTotalsSql(relation, columns), isCancelled)
      for (const [k, axis] of [r.x, r.y].entries()) {
        const count = Number(totals[`n_${k}`])
        const even = evenPositions(count, cap)
        const around = axis.method === 'quantile' ? quantilePositions(count, 3) : []
        const atPos = new Map<number, number>()
        if (count > 0) {
          await streamRows(this.conn, orderStatisticsSql(relation, axis.column, [...even, ...around]), isCancelled, (batch) => {
            for (const row of batch) atPos.set(Number(row.pos), Number(row.v))
          })
        }
        const sample = even.map((pos) => atPos.get(pos)).filter((v): v is number => v !== undefined)
        const quantileStats = Object.fromEntries(around.map((pos) => [pos, atPos.get(pos) ?? 0]))
        dataByColumn[axis.column] = { kind: 'numbers', column: axis.column, sample, n: count, nulls: Number(totals[`nulls_${k}`]), quantileStats }
      }
      const resolved = resolveStyleFrom(style, (this.styleInput = { ...base, dataByColumn }))
      if (resolved.status !== 'ok' || !resolved.grid) return resolved
      const counts = new Map<string, number>()
      let noValue = 0
      await streamRows(this.conn, cellCountsSql(relation, r.x.column, resolved.grid.x.ranges, r.y.column, resolved.grid.y.ranges), isCancelled, (batch) => {
        for (const row of batch) {
          const cx = Number(row.cx)
          const cy = Number(row.cy)
          if (cx < 0 || cy < 0) noValue += Number(row.n)
          else counts.set(`${cx}-${cy}`, Number(row.n))
        }
      })
      const classes = resolved.classes
        .map((c) => (c.kind === 'cell' ? { ...c, count: counts.get(`${c.col}-${c.row}`) ?? 0 } : c.kind === 'noValue' ? { ...c, count: noValue } : c))
        .filter((c) => c.kind !== 'noValue' || c.count > 0)
      return { ...resolved, classes }
    }, 'background')
  }

  /**
   * The value distribution of a numeric column of the displayed result
   * (spec 008 FR-003): exact, in two aggregation passes over the whole
   * result, as background work. Null when the column has no numbers, or the
   * result has no rows to read.
   */
  /** Spec 008 US6: rows drawn flat by the extrusion (missing, zero or negative height). */
  async extrusionFlatCount(e: Extrusion): Promise<number | null> {
    const facts = this.facts
    if (!facts || e.source.kind !== 'column') return null
    const column = e.source.column
    if (!facts.columns.some((c) => c.name === column)) return null
    if (this.utilityRows) return this.utilityRows.filter((f) => !(Number(f.attributes[column]) * e.scale > 0)).length
    const sql = flatCountSql(this.statsRelation(), e)
    if (!sql) return null
    return this.exclusive(async (isCancelled) => Number((await singleRow<{ n: bigint | number }>(this.conn, sql, isCancelled)).n), 'background')
  }

  /** Spec 008 US6: the height column's typical high value (95th percentile of positives), for the auto scale. */
  async extrusionHigh(column: string): Promise<number | null> {
    const facts = this.facts
    if (!facts || !facts.columns.some((c) => c.name === column)) return null
    if (this.utilityRows) {
      const values = this.utilityRows.map((f) => Number(f.attributes[column])).filter((v) => v > 0).sort((a, b) => a - b)
      return values.length ? values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] : null
    }
    return this.exclusive(async (isCancelled) => {
      const v = (await singleRow<{ v: number | null }>(this.conn, extrusionHighSql(this.statsRelation(), column), isCancelled)).v
      return v === null ? null : Number(v)
    }, 'background')
  }

  async valueHistogram(column: string, expression?: string): Promise<ValueHistogram | null> {
    const facts = this.facts
    // Spec 010: a graduated expression's values, from a relation that computes them (checked first).
    if (expression && facts && !this.utilityRows) {
      const plain = this.statsRelation()
      if (await this.expressionError(plain, expression, 'value')) return null
      return this.histogramOf(`(SELECT ${expressionValueSql(expression)} AS ${EXPRESSION_VALUE_COLUMN} FROM ${plain})`, EXPRESSION_VALUE_COLUMN)
    }
    if (!facts || !facts.columns.some((c) => c.name === column)) return null
    if (this.utilityRows) {
      const values = this.utilityRows.map((f) => Number(f.attributes[column])).filter((v) => Number.isFinite(v))
      if (!values.length) return null
      const min = Math.min(...values)
      const max = Math.max(...values)
      const n = max > min ? HISTOGRAM_BINS : 1
      const rows = values.map((v) => ({ b: Math.min(n - 1, Math.floor(((v - min) / (max - min || 1)) * n)), n: 1 }))
      return histogramFrom(min, max, rows)
    }
    return this.histogramOf(this.statsRelation(), column)
  }

  private histogramOf(relation: string, column: string): Promise<ValueHistogram | null> {
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
    if (!facts || !textual.length || this.utilityRows) return {}
    const relation = this.statsRelation()
    const select = textual.map((c, i) => `count(DISTINCT nullif(CAST(${quoteIdent(c.name)} AS VARCHAR), '')) AS d${i}`).join(', ')
    return this.exclusive(async (isCancelled) => {
      const row = await singleRow<Record<string, bigint | number>>(this.conn, `SELECT ${select} FROM (SELECT * FROM ${relation} LIMIT ${STYLE_VALUES_CAP})`, isCancelled)
      return Object.fromEntries(textual.map((c, i) => [c.name, Number(row[`d${i}`])]))
    }, 'background')
  }

  private searchSeq = 0

  /**
   * Spec 010 phase 10: the displayed result's text values containing `q`
   * (filters applied), one hit per column and value, best first. A search
   * overtaken by a newer one before it runs returns nothing.
   */
  async searchValues(q: string, limit = 8): Promise<SearchHit[]> {
    const seq = ++this.searchSeq
    const target = this.pageTarget()
    if (!target || this.utilityRows) return []
    const sql = searchValuesSql(this.narrowed(target.relation), target.columns, q, limit)
    if (!sql) return []
    return this.exclusive(async (isCancelled) => {
      if (seq !== this.searchSeq) return []
      const hits: SearchHit[] = []
      await streamRows(this.conn, sql, isCancelled, (batch) => {
        for (const r of batch) hits.push({ id: Number(r.id), column: String(r.col), value: String(r.value), count: Number(r.n) })
      })
      return hits
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

  /**
   * Resolves when nothing holds the engine and no user work is waiting for it
   * (a skipped view or preempted background work waits for this, then asks again).
   */
  async whenIdle(): Promise<void> {
    for (;;) {
      if (this.inFlight) {
        const held = this.inFlight
        await held.catch(() => {})
        // Settled but still holding the engine (recovering from out of memory): wait on a timer.
        // Looping on the settled promise is microtasks only, and the recovery's engine replies never arrive.
        if (this.inFlight === held) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      // User work cancelling what held the engine: wait on a timer, not a microtask, so it can run.
      else if (this.workWaiting > 0) await new Promise((resolve) => setTimeout(resolve, 10))
      else return
    }
  }

  /** Called once by openFile: how views reach `layer`. */
  setLayerView(info: LayerViewInfo): void {
    this.layerView = info
  }

  /** The relation the map draws: `layer`, or the last query's result with hidden columns added. */
  private viewTarget(): ViewTarget | null {
    const facts = this.facts
    if (!facts || facts.defaultView) {
      const lv = this.layerView
      if (!lv) return null
      const narrow = !!this.restriction()
      const textAttrs = this.table.columns.filter((c) => isTemporalType(c.type) && lv.attrs.includes(c.name)).map((c) => c.name)
      return { relation: narrow ? this.narrowed(INTERNAL_LAYER) : INTERNAL_LAYER, index: lv.index, geom: lv.geom, srid: this.table.srid, attrs: lv.attrs, textAttrs, allValid: lv.allValid, narrowed: narrow }
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
      textAttrs: facts.columns.filter((c) => isTemporalType(c.type)).map((c) => c.name),
    }
  }

  // --- Spec 010: how the map draws the displayed result ------------------------

  /** The opened file's size (openFile): a big file's default view is drawn as tiles. */
  private fileBytes: number | null = null
  /** "Load all": draw this result as GeoJSON whatever its size (reset by a new result). */
  private loadAll = false
  /** Bumps whenever the drawn rows change (result, filters, show selected only, Load all): tile URLs and refetches key on it. */
  dataVersion = 0

  setFileBytes(n: number | null): void {
    this.fileBytes = n
  }

  setLoadAll(on: boolean): void {
    if (on === this.loadAll) return
    this.loadAll = on
    this.dataVersion++
  }

  /** Rows of the displayed result, narrowed by the filters once counted (else the whole result's). */
  private displayedRowsKnown(): number {
    const total = this.facts?.totalRows ?? 0
    return this.restriction() && this.matchingRows !== null ? this.matchingRows : total
  }

  /** GeoJSON (once, from memory) or engine tiles (spec 010, drawMode.ts). */
  drawMode(): DrawMode {
    return drawModeFor({ rows: this.displayedRowsKnown(), fileBytes: this.fileBytes, defaultView: !!this.facts?.defaultView, loadAll: this.loadAll })
  }

  /**
   * Spec 010 GeoJSON mode: every mappable row of the displayed result, as one FeatureCollection.
   * `attrs` undefined: all visible attributes (GeoLibre does this; style changes then never refetch).
   * Background work: user work preempts it, and the caller asks again.
   */
  async allFeatures(attrs: string[] | undefined, onProgress?: (n: number) => void, computed: readonly ComputedColumn[] = []): Promise<MapData> {
    return this.exclusive(async (isCancelled) => {
      // Spec 010: columns the style needs computed (a rule index, an expression's value) ride along.
      const target = withComputed(this.viewTarget(), computed)
      if (!target) return { type: 'FeatureCollection', features: [], dots: [] }
      const wanted = attrs ? target.attrs.filter((a) => attrs.includes(a) || computed.some((c) => c.name === a)) : target.attrs
      const collector = featureCollector()
      await streamRows(this.conn, allFeaturesSql(target, wanted, (target.textAttrs ?? []).filter((a) => wanted.includes(a))), isCancelled, async (batch) => {
        await collector.add(batch)
        onProgress?.(collector.features.length)
      })
      return { type: 'FeatureCollection', features: collector.features, dots: collector.dots }
    }, 'background')
  }

  /** Spec 010 tiles mode: one MVT tile of the displayed result. Empty tiles are a 0-byte array. */
  async tile(z: number, x: number, y: number, attrs: string[], computed: readonly ComputedColumn[] = [], cluster: TileClusters | null = null): Promise<Uint8Array> {
    return this.exclusive(async (isCancelled) => {
      const delay = testOverrides().slowTileMs
      if (delay) await new Promise((r) => setTimeout(r, delay))
      const target = withComputed(this.viewTarget(), computed)
      if (!target) return new Uint8Array(0)
      let box = tileBoundsWgs84(z, x, y)
      const boxSql = viewBoxSql(clampWgs84(box), target.srid)
      if (boxSql) {
        const b = await singleRow<{ x0: number; y0: number; x1: number; y1: number }>(this.conn, boxSql, isCancelled)
        box = [b.x0, b.y0, b.x1, b.y1]
      }
      const columns = this.facts?.columns ?? this.table.columns
      const typeOf = (name: string): string => computed.find((c) => c.name === name)?.type ?? columns.find((c) => c.name === name)?.type ?? 'VARCHAR'
      const typed: TileAttr[] = attrs.filter((a) => target.attrs.includes(a)).map((name) => ({ name, type: typeOf(name) }))
      const row = await singleRow<{ tile: Uint8Array | null }>(this.conn, tileSql(target, z, x, y, box, typed, cluster), isCancelled)
      return row.tile ?? new Uint8Array(0)
    }, 'tile')
  }

  /** One feature by its stable id, wherever it is (selection outside the drawn set, FR-008). */
  async featureById(id: number): Promise<Feature | null> {
    return this.exclusive(async (isCancelled) => {
      const target = this.viewTarget()
      if (!target) return null
      const rows: Record<string, unknown>[] = []
      // Spec 008: the inspector's full record, dates and times as text.
      await streamRows(this.conn, recordByIdSql(target, id), isCancelled, (batch) => {
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
    this.selectedOnlyWhere = null
    if (this.facts?.exportable !== false) this.utilityRows = null
    this.loadAll = false
    this.dataVersion++
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
    const typeOf = (name: string) => facts.columns.find((c) => c.name === name)?.type ?? 'VARCHAR'
    const columns = [...facts.attrs.map((name) => ({ name, type: typeOf(name) })), ...facts.otherGeometryColumns.map((name) => ({ name, type: 'GEOMETRY' }))]
    return { relation: `(SELECT *, ${rowid} AS __se_rowid FROM ${RESULT_TABLE})`, columns, geom: g }
  }

  /**
   * One page of the displayed result (spec 007 FR-011): any row reachable,
   * sorted in SQL over the whole result. Cached per result and sort.
   */
  async page(req: TablePageRequest): Promise<TablePage> {
    const cached = this.pages.get(req)
    if (cached) return cached
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
  async exportData(plan: ExportPlan, hooks: ExportHooks = {}, selection?: Selection): Promise<ExportResult> {
    const started = performance.now()
    try {
      const fill = plan.scope === 'selected' && selection ? selectionTableSql(selection) : null
      const result = await this.exclusive(async (isCancelled) => {
        if (fill) for (const sql of fill) await this.conn.query(sql)
        return runExport(this.db, this.conn, this.scopedExport(plan, selection), isCancelled, hooks, this.exportAssets)
      })
      this.log?.(`[export] ${plan.format}: ${nf.format(result.rows)} rows, ${nf.format(result.bytes.length)} bytes · ${Math.round(performance.now() - started)} ms`)
      return result
    } catch (err) {
      this.log?.(`[export] ${plan.format}: ${err instanceof QueryCancelledError ? 'cancelled' : exportErrorMessage(err)}`)
      throw err
    }
  }

  /**
   * Spec 008 FR-014: the plan run over its scope's rows. 'all' is the plan
   * as built (every row of the result, whatever the table shows); 'filtered'
   * and 'selected' read the result with row ids, narrowed by the filters
   * (and the selection), with the same columns.
   */
  private scopedExport(plan: ExportPlan, selection?: Selection): ExportPlan {
    if (plan.scope === 'all') return plan
    const target = this.pageTarget()
    if (!target) return plan
    const parts = [this.filterWhere, plan.scope === 'selected' && selection ? selectionPredicate(selection) : null].filter((p): p is string => !!p)
    const rel = parts.length ? `(SELECT * FROM ${target.relation} WHERE ${parts.map((p) => `(${p})`).join(' AND ')})` : target.relation
    const select = plan.select === '*' ? "COLUMNS(c -> NOT starts_with(c, '__se_'))" : plan.select
    return { ...plan, sql: `SELECT ${select} FROM ${rel}` }
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
    for (const r of this.wsRegistered.values()) await r.drop()
    this.wsRegistered.clear()
    const drop = async (sql: string): Promise<void> => {
      await this.conn.query(sql).catch(() => {})
    }
    await drop(`DROP TABLE IF EXISTS ${RESULT_TABLE}`)
    await drop(`DROP VIEW IF EXISTS ${RESULT_TABLE}`)
    await drop(`DROP TABLE IF EXISTS ${RESULT_STAGING}`)
    if (this.table.schema) await drop(`DROP SCHEMA IF EXISTS ${this.table.schema} CASCADE`)
    else if (this.table.alias) await drop(`DROP VIEW IF EXISTS ${this.table.alias}`)
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

/** A draw target with the style's computed columns added (spec 010), or null. */
function withComputed(t: ViewTarget | null, computed: readonly ComputedColumn[]): ViewTarget | null {
  if (!t || !computed.length) return t
  return { ...t, relation: withComputedSql(t.relation, computed), attrs: [...t.attrs, ...computed.map((c) => c.name)] }
}

/** Fields that only change how classes look, never which classes there are or their counts. */
const PRESENTATION_KEYS = new Set([
  'color', 'ramp', 'palette', 'label', 'visible', 'hidden', 'fillColor', 'strokeColor', 'fillOpacity', 'strokeOpacity',
  'strokeWidth', 'pointRadius', 'layerOpacity', 'markerShape', 'lineDash', 'sizeMin', 'sizeMax', 'extrusion',
  // Spec 010 rules: the "Everything else" row's look.
  'elseColor', 'elseLabel', 'elseVisible',
  // Heatmap: how the density is drawn.
  'radius', 'intensity',
])

/** The style without its presentation: two styles with the same key classify the same data the same way. */
export function styleDataKey(style: LayerStyle): string {
  // Spec 011 slice 1: keyed on the pre-011 shape. A channel map has keys named
  // like presentation fields (`color`), so it can't go through the filter as is.
  const { channels: _c, labels: _l, ...legacy } = legacyView(style)
  void _c
  void _l
  return JSON.stringify(legacy, (k, v) => (PRESENTATION_KEYS.has(k) ? undefined : v))
}

/** A fresh classification's classes, with the exact counts the engine found for the same classes. */
export function withCounts(fresh: ResolvedStyle, counted: ResolvedStyle): ResolvedStyle {
  const merge = (now: ResolvedStyle['classes'], before: ResolvedStyle['classes']): ResolvedStyle['classes'] => {
    const seen = new Map<string, number>()
    const keyOf = (c: ResolvedStyle['classes'][number]): string => {
      const n = (seen.get(c.kind) ?? 0) + 1
      seen.set(c.kind, n)
      return `${c.kind}#${n}`
    }
    const counts = new Map(before.map((c) => [keyOf(c), c.count]))
    seen.clear()
    const hadOther = before.some((c) => c.kind === 'other')
    return now.map((c) => ({ ...c, count: counts.get(keyOf(c)) ?? c.count })).filter((c) => c.kind !== 'other' || hadOther)
  }
  const out: ResolvedStyle = { ...fresh, classes: merge(fresh.classes, counted.classes) }
  if (fresh.size && counted.size) out.size = { ...fresh.size, classes: merge(fresh.size.classes, counted.size.classes) }
  return out
}
