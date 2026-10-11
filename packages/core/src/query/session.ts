// QuerySession: one per viewer (spec 002, contracts/query-service.md). It
// owns a dedicated query connection, separate from the one that opened the
// file, so a cancel can never touch file loading. Temp tables are
// per-connection in DuckDB, so user temp objects and __se_result live here.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { exportErrorMessage, runExport, type ExportHooks, type ExportResult } from '../export/run.js'
import type { ExportPlan } from '../export/plan.js'
import { DEFAULT_QUERY, LARGE_RESULT_THRESHOLD, type Bbox, type Feature, type Layer, type QueryableTable, type ViewFeatures, type ViewRequest } from '../models.js'
import { parseEngineError } from '../sql/errors.js'
import { classifyStatement } from '../sql/policy.js'
import { statementToRun } from '../sql/scanner.js'
import { buildQueryResult, CTAS_PREFIX, layerCrs, RESULT_TABLE, ResultDeclinedError, type BuildContext, type BuiltResult } from './run.js'
import { resolveResultCrs } from './resultCrs.js'
import { loadCatalog } from './catalog.js'
import type { CatalogSnapshot } from '../models.js'
import { QueryCancelledError, quoteIdent, sanitizeAttributes, singleRow, streamRows } from './util.js'
import { INTERNAL_LAYER } from '../source/layerSql.js'
import { testOverrides } from '../source/readModes.js'
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

export interface RunHooks {
  /** FR-012: called only when the result has more than LARGE_RESULT_THRESHOLD rows. */
  confirmLargeResult(rowCount: number): Promise<'all' | 'first' | 'cancel'>
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
  /** Visible non-geometry columns (spec 007: map views carry them for styling). */
  attrs: string[]
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
    attrs: built.layer.columns.map((c) => c.name),
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
  /** Quoted geometry column of `__se_layer`. */
  geom: string
  attrs: string[]
}

/** A view request that couldn't run because a query or export holds the engine; the map asks again after. */
export class ViewSkippedError extends Error {}

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
  /** What holds the engine: a map view (preemptible) or user work. */
  private inFlightKind: 'view' | 'work' | null = null
  private layerView: LayerViewInfo | null = null
  private cancelRequested = false
  private disposed = false
  private catalogCache: CatalogSnapshot | null = null
  private facts: ResultFacts | null = null
  private defaultFacts: ResultFacts | null = null

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
  async run(request: RunRequest, hooks: RunHooks): Promise<RunOutcome> {
    const span = statementToRun(request.editorText, request.selection)
    if (!span) return { kind: 'empty' }
    const statement: ExecutedStatement = { text: span.text, editorOffset: span.from }
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
              limitRows: async (rows) => {
                if (rows <= LARGE_RESULT_THRESHOLD) return rows
                const choice = await hooks.confirmLargeResult(rows)
                return choice === 'all' ? rows : choice === 'first' ? LARGE_RESULT_THRESHOLD : null
              },
              onProgress: hooks.onProgress,
            }),
            span.text
          )
          this.facts = resultFacts(result, this.table, false)
          return { kind: 'result', result, durationMs: elapsed(), statement }
        }
        if (policy.kind === 'utility') {
          const result = await this.utilityResult(span.text, isCancelled)
          this.facts = { ...resultFacts(result, this.table, false), exportable: false }
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
    if (this.inFlight || this.disposed) return null
    this.catalogCache = await this.exclusive((isCancelled) => loadCatalog(this.conn, isCancelled))
    return this.catalogCache
  }

  /** DESCRIBE / SHOW / SUMMARIZE / EXPLAIN: small, table-only results, streamed directly. */
  private async utilityResult(text: string, isCancelled: () => boolean): Promise<BuiltResult> {
    const rows: Record<string, unknown>[] = []
    await streamRows(this.conn, text, isCancelled, (batch) => {
      rows.push(...batch)
    })
    const features = rows.map((r, i) => ({ id: i, geometry: null, attributes: sanitizeAttributes(r) }))
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
        features,
        columns,
      },
      geometryColumn: null,
      otherGeometryColumns: [],
      resultCrs: null,
      truncatedTo: null,
      totalRows: features.length,
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
  async exclusive<T>(work: (isCancelled: () => boolean) => Promise<T>, kind: 'view' | 'work' = 'work'): Promise<T> {
    if (this.disposed) throw new Error('This viewer was closed.')
    // A map view never blocks user work, or a newer view: it is interrupted (spec 007 FR-007).
    while (this.inFlight && this.inFlightKind === 'view') await this.cancel()
    if (this.inFlight) {
      if (kind === 'view') throw new ViewSkippedError()
      throw new Error('A query is already running.')
    }
    this.cancelRequested = false
    const isCancelled = (): boolean => this.cancelRequested
    const promise = work(isCancelled)
    this.inFlight = promise
    this.inFlightKind = kind
    try {
      return await promise
    } finally {
      this.inFlight = null
      this.inFlightKind = null
    }
  }

  /** Resolves when nothing holds the engine (a skipped view waits for this, then asks again). */
  async whenIdle(): Promise<void> {
    while (this.inFlight) await this.inFlight.catch(() => {})
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
      return lv ? { relation: INTERNAL_LAYER, index: lv.index, geom: lv.geom, srid: this.table.srid, attrs: lv.attrs, path: lv.path, rowidExpr: lv.rowidExpr, extent: lv.extent, allValid: lv.allValid } : null
    }
    const g = facts.geometryColumn
    if (!g || !facts.exportable) return null
    const q = quoteIdent(g)
    return {
      // `rowid` (the temp table's pseudo-column) is free; a row_number() window over a big result is not.
      relation: `(SELECT *, rowid AS __se_rowid, ST_XMin(${q}) AS __se_xmin, ST_YMin(${q}) AS __se_ymin, ST_XMax(${q}) AS __se_xmax, ST_YMax(${q}) AS __se_ymax FROM ${RESULT_TABLE})`,
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
      if (target.index === 'fgb') {
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
        const resultRows = this.facts && !this.facts.defaultView ? this.facts.totalRows : this.table.totals.rows
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
    })
  }

  /** @internal Build context with the given CRS resolution and size policy. */
  buildContext(isCancelled: () => boolean, overrides: Partial<BuildContext> = {}): BuildContext {
    return {
      conn: this.conn,
      table: this.table,
      isCancelled,
      resolveCrs: () => layerCrs(this.table),
      limitRows: async (rows) => rows,
      ...overrides,
    }
  }

  /** The initial view: DEFAULT_QUERY, with no size prompt (it is capped at 1,000 rows). */
  async runDefault(): Promise<BuiltResult> {
    const built = await this.exclusive((isCancelled) => buildQueryResult(this.buildContext(isCancelled), this.defaultQuery))
    this.facts = resultFacts(built, this.table, true)
    this.defaultFacts = this.facts
    return built
  }

  /**
   * Reset (spec 002 FR-011) shows the original view again without
   * re-running it; exports must follow (spec 005). The default view exports
   * from `layer`, never from `__se_result`, which still holds the last query.
   */
  showDefaultView(): void {
    this.facts = this.defaultFacts
  }

  /**
   * Writes an export plan's file and returns its bytes (spec 005). Runs on
   * the exclusive connection like a query, so cancel() stops it the same way
   * and a query never interleaves with it. Never touches __se_result.
   */
  async exportData(plan: ExportPlan, hooks: ExportHooks = {}): Promise<ExportResult> {
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
    if (this.table.alias) await drop(`DROP VIEW IF EXISTS ${quoteIdent(this.table.alias)}`)
    await drop('DROP VIEW IF EXISTS layer')
    await drop('DROP VIEW IF EXISTS __se_layer')
    await drop('DROP TABLE IF EXISTS __se_bbox')
    await drop(`DROP TABLE IF EXISTS ${SOURCE_TABLE}`)
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
      const rows = r.truncatedTo !== null ? `Showing first ${nf.format(n)} of ${nf.format(r.totalRows)} rows` : `${nf.format(n)} ${n === 1 ? 'row' : 'rows'}`
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

export { LARGE_RESULT_THRESHOLD }
