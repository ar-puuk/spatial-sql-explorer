// Open-file -> parse pipeline (T024). HostAdapter.getFileSource -> DuckDB
// ST_Read/read_parquet -> populate Layer/Feature, per data-model.md.
//
// Format detection is by file extension for spec 001 (simple, adequate for
// the MVP; content-sniffing can be added later if needed). Per FR-018
// (research.md §1 "T006 resolution"), only formats genuinely verified
// readable against the real eh-bundle WASM build are handled here: GeoJSON,
// CSV (coordinate columns), GeoParquet, FlatGeobuf, GeoPackage, Shapefile,
// GML. Shapefile needs its sidecar files (.shx/.dbf/.prj) — see
// HostAdapter.getFileSource's multi-file FileSource shape.

import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { HostAdapter, OpenedFileRef } from './hostAdapter.js'
import { getDuckDb, resetDuckDb, type DuckDbAssetUrls } from './duckdbService.js'
import { isOutOfMemory, outOfMemoryMessage } from './outOfMemory.js'
import { registerSource, type RegisteredSource } from './source/register.js'
import { formatFromFileName, readModeFor, testOverrides } from './source/readModes.js'
import { extentToWgs84, flatGeobufFacts, parquetFacts } from './source/facts.js'
import { FGB_PREFIX_BYTES, fgbHeaderSize, parseFgbHeader } from './source/fgbHeader.js'
import { internalLayerViewSql, publicLayerViewSql, visibleColumns } from './source/layerSql.js'
import { reprojectToWgs84Sql, resolveCrsInfo } from './crs.js'
import type { Bbox, DatasetFacts, Layer, OpenPhase, QueryableTable, ReadModeKind, SpatialIndexKind } from './models.js'
import { QuerySession, SOURCE_TABLE, type LayerViewInfo } from './query/session.js'
import { geometryTypeOf, QueryCancelledError, quoteIdent, singleRow, streamRows } from './query/util.js'

export interface OpenFileDeps {
  hostAdapter: HostAdapter
  duckdbAssets: DuckDbAssetUrls
}

type ReadStrategy = 'st_read' | 'parquet' | 'csv' | 'unsupported'

function detectStrategy(fileName: string): ReadStrategy {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.parquet') || lower.endsWith('.geoparquet')) return 'parquet'
  if (lower.endsWith('.csv')) return 'csv'
  if (
    lower.endsWith('.geojson') ||
    lower.endsWith('.json') ||
    lower.endsWith('.fgb') ||
    lower.endsWith('.flatgeobuf') ||
    lower.endsWith('.gpkg') ||
    lower.endsWith('.shp') ||
    lower.endsWith('.gml')
  ) {
    return 'st_read'
  }
  return 'unsupported'
}

interface FromExpr {
  fromExpr: string
  /** SQL yielding a GEOMETRY in the source CRS. */
  geomExpr: string
  /** The source column holding geometry, excluded from attributes. */
  geometryColumn: string | null
  /** Source CRS when the strategy itself knows it (GeoParquet); undefined = ask ST_Read_Meta. */
  srid?: number | null
  /** Source column names from the one DESCRIBE each open runs (every ST_Read bind re-ingests the file). */
  columns: string[]
}

async function describeColumns(conn: AsyncDuckDBConnection, fromExpr: string): Promise<Array<{ name: string; type: string }>> {
  const res = await conn.query(`DESCRIBE SELECT * FROM ${fromExpr}`)
  return res.toArray().map((r) => {
    const row = r.toJSON() as { column_name: string; column_type: string }
    return { name: String(row.column_name), type: String(row.column_type) }
  })
}

/** `EPSG:<code>` from a DuckDB GEOMETRY type (`GEOMETRY('EPSG:4326')`) or a PROJJSON `id`. */
function epsgFrom(text: string | null | undefined): number | null {
  const m = /EPSG[:"\s,]*(?:code"?\s*:\s*)?(\d{4,6})/i.exec(text ?? '')
  return m ? Number(m[1]) : null
}

/**
 * GeoParquet (https://geoparquet.org): the `geo` key-value metadata names the
 * primary geometry column and its CRS (PROJJSON; absent = OGC:CRS84, i.e.
 * WGS84 lon/lat). With the spatial extension loaded, current DuckDB already
 * decodes that column to GEOMETRY, typed with its CRS: calling
 * ST_GeomFromWKB on it fails, which broke every real GeoParquet file until
 * this was fixed (research.md §9). Plain Parquet with a WKB BLOB column
 * still goes through ST_GeomFromWKB.
 */
async function geoParquetFromExpr(conn: AsyncDuckDBConnection, vfsPath: string, materialize: boolean): Promise<FromExpr> {
  const fromExpr = await readerSource(conn, `read_parquet('${vfsPath}')`, materialize)
  const columns = await describeColumns(conn, fromExpr)

  let primary: string | null = null
  let metaSrid: number | null | undefined
  try {
    const meta = await conn.query(`SELECT decode(value) AS geo FROM parquet_kv_metadata('${vfsPath}') WHERE decode(key) = 'geo'`)
    const raw = meta.toArray()[0]?.toJSON().geo as string | undefined
    if (raw) {
      const geo = JSON.parse(raw) as { primary_column?: string; columns?: Record<string, { crs?: unknown }> }
      primary = geo.primary_column ?? null
      const crs = primary ? geo.columns?.[primary]?.crs : undefined
      // GeoParquet: an absent crs means OGC:CRS84 (WGS84 lon/lat), stated, not assumed.
      metaSrid = crs === undefined ? 4326 : crs === null ? null : epsgFrom(JSON.stringify((crs as { id?: unknown }).id ?? crs))
    }
  } catch {
    // Not GeoParquet metadata we can read; fall back to column types.
  }

  const pick =
    columns.find((c) => c.name === primary) ??
    columns.find((c) => c.type.toUpperCase().startsWith('GEOMETRY')) ??
    columns.find((c) => c.name.toLowerCase() === 'geometry' || c.name.toLowerCase() === 'geom')
  if (!pick) throw new Error('This Parquet file has no geometry column (no GeoParquet metadata, GEOMETRY column, or WKB "geometry" column).')

  const col = quoteIdent(pick.name)
  const names = columns.map((c) => c.name)
  if (pick.type.toUpperCase().startsWith('GEOMETRY')) {
    return { fromExpr, geomExpr: col, geometryColumn: pick.name, srid: epsgFrom(pick.type) ?? metaSrid ?? null, columns: names }
  }
  if (pick.type.toUpperCase() === 'BLOB') {
    return { fromExpr, geomExpr: `ST_GeomFromWKB(${col})`, geometryColumn: pick.name, srid: metaSrid ?? null, columns: names }
  }
  throw new Error(`The Parquet column "${pick.name}" (${pick.type}) is not a geometry or WKB column.`)
}

/** The reader's raw output, parsed once while a whole-read file opens; dropped after (spec 007 T048). */
const RAW_TABLE = '__se_raw'

/**
 * Every ST_Read bind re-ingests the whole file (GDAL parses e.g. GeoJSON
 * completely on open), and an open needs several passes (DESCRIBE, the
 * indexed table). Whole-read files are therefore parsed exactly once into
 * RAW_TABLE, and everything else reads that (spec 007 research §4). The
 * former streamed mode for files over 64 MB re-parsed the file on every map
 * view; with the 3.1 GiB engine limit (research §1) parsing once is both
 * faster and affordable (325 MB of GeoJSON holds 140 MB in the engine).
 */
async function readerSource(conn: AsyncDuckDBConnection, reader: string, materialize: boolean): Promise<string> {
  if (!materialize) return reader
  // A regular table, not TEMP: DuckDB temp tables are visible only to the
  // connection that created them, and queries run on the session's own
  // connection (spec 002).
  await conn.query(`CREATE OR REPLACE TABLE ${RAW_TABLE} AS SELECT * FROM ${reader}`)
  return RAW_TABLE
}

/** Builds the SQL FROM-source expression for a given read strategy. */
async function buildFromExpr(conn: AsyncDuckDBConnection, strategy: ReadStrategy, vfsPath: string, materialize: boolean): Promise<FromExpr> {
  switch (strategy) {
    case 'st_read': {
      // ST_Read keeps the source's geometry field name: `geom` for most
      // drivers, but e.g. GML exposes `geometryProperty` (a hard-coded `geom`
      // broke every GML file; research.md §9). Use the GEOMETRY-typed column.
      const fromExpr = await readerSource(conn, `ST_Read('${vfsPath}')`, materialize)
      const columns = await describeColumns(conn, fromExpr)
      const geometry = columns.find((c) => c.type.toUpperCase().startsWith('GEOMETRY'))
      if (!geometry) throw new Error('This file has no geometry column.')
      // Current DuckDB types the column with its CRS (`GEOMETRY('EPSG:4326')`),
      // which saves the ST_Read_Meta call, itself another full ingest of the
      // file. A plain GEOMETRY type falls back to ST_Read_Meta.
      const typed = epsgFrom(geometry.type)
      return {
        fromExpr,
        geomExpr: quoteIdent(geometry.name),
        geometryColumn: geometry.name,
        columns: columns.map((c) => c.name),
        ...(typed !== null ? { srid: typed } : {}),
      }
    }
    case 'parquet':
      return geoParquetFromExpr(conn, vfsPath, materialize)
    case 'csv': {
      // Heuristic column detection, per spec.md's assumption ("CSV with
      // coordinate columns or WKT"). Tries common lon/lat name variants
      // first, then a WKT column. Must pick ONE geomExpr referencing only
      // columns that actually exist: a real browser run surfaced "Referenced
      // column 'longitude' not found" — DuckDB binds every column named in a
      // CASE/COALESCE expression at bind time regardless of which branch
      // would execute, so a single static expression referencing all three
      // naming variants fails outright on a CSV that only has `lon`/`lat`.
      const fromExpr = await readerSource(conn, `read_csv_auto('${vfsPath}')`, materialize)
      const names = (await describeColumns(conn, fromExpr)).map((c) => c.name)
      const columns = new Set(names.map((n) => n.toLowerCase()))
      if (columns.has('lon') && columns.has('lat')) {
        return { fromExpr, geomExpr: 'ST_Point(lon, lat)', geometryColumn: null, srid: null, columns: names }
      }
      if (columns.has('longitude') && columns.has('latitude')) {
        return { fromExpr, geomExpr: 'ST_Point(longitude, latitude)', geometryColumn: null, srid: null, columns: names }
      }
      if (columns.has('wkt')) {
        return { fromExpr, geomExpr: 'ST_GeomFromText(wkt)', geometryColumn: null, srid: null, columns: names }
      }
      throw new Error('CSV file has no recognized coordinate columns (lon/lat, longitude/latitude, or wkt).')
    }
    case 'unsupported':
      throw new Error('Unsupported file format')
  }
}

/**
 * Reads the source CRS's EPSG code for `st_read`-backed formats (GeoJSON,
 * FlatGeobuf, GeoPackage, Shapefile, GML) via `ST_Read_Meta`'s nested
 * `layers[1].geometry_fields[1].crs` struct, selecting only its scalar
 * `auth_name`/`auth_code` leaves (a real `duckdb` CLI spike confirmed: this
 * is populated and correct for every `st_read` format spec 001 supports,
 * contradicting an earlier, mistaken assumption that it wasn't — see
 * research.md §5). `layers[1]`/`geometry_fields[1]` match this project's
 * existing "first layer only" scope decision, consistent with `buildFromExpr`
 * calling `ST_Read` without an explicit `layer=` argument.
 *
 * GeoParquet's CRS comes from its own metadata instead (geoParquetFromExpr);
 * CSV has none. A non-EPSG authority (rare, e.g. an ESRI-only WKID) can't be
 * fed back into `ST_Transform`'s `'EPSG:<code>'` source-CRS argument, so it
 * falls back to `null` (WGS84 assumed, disclosed via `crsAssumed`), the same
 * honest fallback FR-015 already requires when a file truly has no CRS.
 */
async function detectSourceSrid(conn: AsyncDuckDBConnection, vfsPath: string, strategy: ReadStrategy): Promise<number | null> {
  if (strategy !== 'st_read') return null
  const metaRes = await conn.query(`
    SELECT layers[1].geometry_fields[1].crs.auth_name AS auth_name,
           layers[1].geometry_fields[1].crs.auth_code AS auth_code
    FROM ST_Read_Meta('${vfsPath}')
  `)
  const row = metaRes.toArray()[0]?.toJSON() as { auth_name: string | null; auth_code: string | null } | undefined
  if (!row || row.auth_name !== 'EPSG' || !row.auth_code) return null
  const srid = Number(row.auth_code)
  return Number.isFinite(srid) ? srid : null
}

/**
 * Whole-read files up to this size are fetched into memory first (faster than
 * many small handle or HTTP reads), and small Parquet files read in parts
 * count their invalid geometries up front.
 */
const MATERIALIZE_MAX_BYTES = 64 * 1024 * 1024

/** A file name usable as an unquoted SQL alias for `layer` (e.g. `parcels`). */
async function aliasFor(conn: AsyncDuckDBConnection, primaryFileName: string): Promise<string | null> {
  const base = primaryFileName.replace(/\.[^.]+$/, '')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) return null
  const lower = base.toLowerCase()
  if (lower === 'layer' || lower.startsWith('__se_')) return null
  const kw = await conn.query(`SELECT count(*) AS n FROM duckdb_keywords() WHERE keyword_name = '${lower}'`)
  return Number(kw.toArray()[0]?.toJSON().n ?? 0) > 0 ? null : base
}

/** How to open (spec 007 T044). */
export interface OpenOptions {
  /**
   * Load a file normally read in parts (FlatGeobuf) whole into memory, so
   * queries, the table, styles and export work on it. The user asked for it
   * ("Load"), so the whole-read confirmation is skipped.
   */
  loadWhole?: boolean
}

/** Progress and cancellation for an open (spec 007 FR-002, contracts/core-data-access.md). */
export interface OpenHooks {
  /** Reports each visible phase (OpenProgress). */
  onPhase?(phase: OpenPhase, detail?: { readMode?: ReadModeKind; sizeBytes?: number; format?: string }): void
  /** Whole-file facts, as soon as they're known, before the first view (FR-001). */
  onFacts?(facts: DatasetFacts): void
  /** Whole-read files over the threshold wait for this (FR-004); false cancels the open. */
  confirmWholeRead?(sizeBytes: number, format: string): Promise<boolean>
  /** Receives a function that interrupts the engine statement in flight (FR-002: Cancel within 3 s). */
  onCancelHandle?(interrupt: () => Promise<void>): void
  /** Polled between steps; true stops the open with QueryCancelledError. */
  isCancelled?(): boolean
}

export interface OpenedFile {
  /** The initial view: DEFAULT_QUERY's result, fitted to the whole file. */
  layer: Layer
  /** The viewer's query session over the `layer` view (spec 002). */
  session: QuerySession
}

/**
 * Opens a file as the queryable `layer` view (spec 002 FR-002) and returns
 * the initial view, which is DEFAULT_QUERY run through the same pipeline as
 * every user query (FR-003, SC-002).
 *
 * `layer` is a VIEW so the engine itself refuses writes to it (research §2):
 * - its geometry column is `geom`, in the file's ORIGINAL CRS (FR-014);
 * - GDAL's synthetic OGC_FID is dropped and GeoPackage `fid` is kept (spec 001
 *   attribute rules).
 * It reads a table materialized once (files up to 64 MB) or the reader
 * directly (larger files, which stay readable under the lockdown's
 * allowed_directories).
 */
export async function openFile(ref: OpenedFileRef, deps: OpenFileDeps, hooks: OpenHooks = {}, options: OpenOptions = {}): Promise<OpenedFile> {
  // Cancel within 3 s (FR-002, SC-005): the engine is asked to stop; a GDAL
  // parse doesn't check for that (a 325 MB GeoJSON took 10.5 s to stop), so
  // if the open hasn't ended within CANCEL_GRACE_MS the engine is terminated
  // and the next open starts a fresh one (research.md US4 outcomes).
  let abort: (err: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    abort = reject
  })
  aborted.catch(() => {})
  const opening: Promise<OpenedFile> = openFileOnce(ref, deps, {
    ...hooks,
    onCancelHandle: (interrupt) =>
      hooks.onCancelHandle?.(async () => {
        const settled = opening.then(
          () => true,
          () => true
        )
        // Not awaited: the interrupt message itself waits behind a busy worker.
        void interrupt().catch(() => {})
        const stopped = await Promise.race([settled, new Promise<boolean>((r) => setTimeout(() => r(false), CANCEL_GRACE_MS))])
        if (stopped) return
        await resetDuckDb()
        abort(new QueryCancelledError())
      }),
  }, options)
  opening.catch(() => {})
  return Promise.race([opening, aborted])
}

/** How long a cancelled open may take to stop before the engine is reset. */
const CANCEL_GRACE_MS = 2000

async function openFileOnce(ref: OpenedFileRef, deps: OpenFileDeps, hooks: OpenHooks, options: OpenOptions): Promise<OpenedFile> {
  const { hostAdapter, duckdbAssets } = deps
  const checkCancelled = (): void => {
    if (hooks.isCancelled?.()) throw new QueryCancelledError()
  }
  hooks.onPhase?.('registering')
  let source = await hostAdapter.getFileSource(ref)
  checkCancelled()
  const strategy = detectStrategy(source.name)
  const format = formatFromFileName(source.name)
  if (strategy === 'unsupported' || format === null || format === 'pmtiles') {
    throw new Error(
      `"${ref.displayName}" is not a supported format. Spatial Explorer supports GeoJSON, CSV, GeoParquet, FlatGeobuf, GeoPackage, Shapefile, and GML.`
    )
  }

  // How the engine reaches this file (research §4); a whole-transfer fallback
  // means partial reads aren't available in this window (FR-015).
  const fallback = source.kind === 'bytes' ? (source.fallbackReason ?? null) : null
  const chosen = readModeFor(format, source.size, { partialReads: fallback === null })
  const mode = options.loadWhole && chosen.mode === 'partial-view' ? { ...chosen, mode: 'whole' as const } : chosen
  // Whole reads from memory: small files read faster from memory than through
  // many small handle/HTTP reads (10 MB GeoJSON: 1.6 s vs 2.1 s warm), and
  // FlatGeobuf is ~1,500x faster from memory (research §4).
  if (mode.mode === 'whole' && source.kind !== 'bytes' && (format === 'flatgeobuf' || source.size <= (testOverrides().wholeBytes ?? MATERIALIZE_MAX_BYTES))) {
    source = await hostAdapter.getFileSource(ref, { whole: true })
  }

  const styleSidecar = source.styleSidecar
  const db = await getDuckDb(duckdbAssets)
  const conn: AsyncDuckDBConnection = await db.connect()
  hooks.onCancelHandle?.(async () => {
    await conn.cancelSent().catch(() => false)
  })
  let registered: RegisteredSource | null = null
  let session: QuerySession | null = null
  let keepRegistered = true
  const detail = { readMode: mode.mode, sizeBytes: source.size, format }

  // Per-step timings, surfaced in the VS Code output channel.
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (): number => {
    const now = performance.now()
    const ms = Math.round(now - mark)
    mark = now
    return ms
  }

  try {
    if (mode.mode === 'whole' && !options.loadWhole && source.size > mode.wholeReadThresholdBytes && hooks.confirmWholeRead) {
      hooks.onPhase?.('announce', detail)
      if (!(await hooks.confirmWholeRead(source.size, format))) throw new QueryCancelledError()
    }
    checkCancelled()
    registered = await registerSource(db, source, () => hostAdapter.getFileSource(ref, { whole: true }))
    await testDelay(checkCancelled)
    const ctx: ModeContext = { conn, path: registered.primaryPath, name: source.name, hostAdapter, ref, hooks, detail, checkCancelled, isCancelled: () => hooks.isCancelled?.() ?? false }

    let opened: OpenedTable
    if (mode.mode === 'partial') opened = await openParquetInParts(ctx)
    else if (mode.mode === 'partial-view') opened = await openFlatGeobufInParts(ctx)
    else {
      opened = await openWhole(ctx, strategy)
      keepRegistered = false
    }
    timings.prepare = lap()
    checkCancelled()
    const { table } = opened
    hooks.onFacts?.(factsOf(table, opened, mode.mode, fallback))
    hooks.onPhase?.('facts', detail)

    // The initial view IS the default query's result (FR-003, SC-002).
    session = new QuerySession(db, await db.connect(), table, keepRegistered ? registered.paths : [], hostAdapter.log?.bind(hostAdapter))
    session.setLayerView({ ...opened.view, allValid: opened.invalid === 0 })
    if (keepRegistered && registered) session.setSourceRecovery(registered.reRegister)
    const initial = await session.runDefault()
    timings.rows = lap()

    const layer: Layer = {
      ...initial.layer,
      id: ref.id,
      sourceUri: ref.id,
      sourceFormat: strategy,
      // Spec 001 behavior: fit and type describe the whole file, not just
      // the first 1,000 rows, and "Showing 1,000 of N" is a truncation.
      extent: table.extent,
      geometryType: table.geometryType,
      sourceCrs: table.crs,
      crsAssumed: table.crsAssumed,
      truncated: table.totals.rows > initial.layer.rowCount,
      totalRows: table.totals.rows,
      source: table.totals,
      styleSidecar,
      loadTimings: timings,
      facts: factsOf(table, opened, mode.mode, fallback),
    }
    hooks.onPhase?.('ready', detail)
    return { layer, session }
  } catch (err) {
    await session?.dispose().catch(() => {})
    // A failed or cancelled whole read leaves nothing behind.
    await conn.query(`DROP TABLE IF EXISTS ${RAW_TABLE}`).catch(() => {})
    if (!session) await conn.query(`DROP TABLE IF EXISTS ${SOURCE_TABLE}`).catch(() => {})
    keepRegistered = false
    if (isOutOfMemory(err)) {
      // FR-014: a clear message; the engine itself survives (research §1).
      const limit = await conn
        .query(`SELECT current_setting('memory_limit') AS m`)
        .then((r) => String(r.toArray()[0]?.toJSON().m ?? '') || null)
        .catch(() => null)
      throw new Error(outOfMemoryMessage(mode.mode === 'whole' ? 'open-whole' : 'open', limit), { cause: err })
    }
    throw err
  } finally {
    await conn.close().catch(() => {})
    // Materialized files' bytes are no longer needed: the engine keeps only
    // the table. Files read in parts stay registered until the session ends.
    if (!keepRegistered) await registered?.drop()
  }
}

interface ModeContext {
  conn: AsyncDuckDBConnection
  path: string
  name: string
  hostAdapter: HostAdapter
  ref: OpenedFileRef
  hooks: OpenHooks
  detail: { readMode: ReadModeKind; sizeBytes: number; format: string }
  checkCancelled: () => void
  isCancelled: () => boolean
}

interface OpenedTable {
  table: QueryableTable
  /** How map views reach `__se_layer` (spec 007 research §6). */
  view: LayerViewInfo
  spatialIndex: SpatialIndexKind
  /** Rows with missing or invalid geometry, when known (null: not scanned). */
  invalid: number | null
}

function factsOf(table: QueryableTable, opened: OpenedTable, readMode: ReadModeKind, fallback: string | null): DatasetFacts {
  return {
    rows: table.totals.rows,
    rowsEstimated: false,
    invalid: opened.invalid,
    extent: table.extent,
    crs: table.crs,
    crsAssumed: table.crsAssumed,
    srid: table.srid,
    geometryType: table.geometryType,
    columns: visibleColumns(table.columns),
    readMode,
    spatialIndex: opened.spatialIndex,
    fallback,
    needsLoad: readMode === 'partial-view',
  }
}

/** e2e only (`slowParse=1`): a 3 s pause that stays cancellable, for the Cancel tests. */
async function testDelay(checkCancelled: () => void): Promise<void> {
  const slow = testOverrides().slowParse
  if (!slow) return
  if (slow === 'stuck') {
    // Like a GDAL parse: the engine's cancel isn't checked (T050's reset path).
    await new Promise((r) => setTimeout(r, 8000))
    checkCancelled()
    return
  }
  for (let i = 0; i < 60; i++) {
    checkCancelled()
    await new Promise((r) => setTimeout(r, 50))
  }
  checkCancelled()
}

async function describeLayer(conn: AsyncDuckDBConnection): Promise<QueryableTable['columns']> {
  const described = await conn.query('DESCRIBE layer')
  return described.toArray().map((r) => {
    const j = r.toJSON() as { column_name: string; column_type: string }
    return { name: String(j.column_name), type: String(j.column_type) }
  })
}

async function createAlias(conn: AsyncDuckDBConnection, name: string): Promise<string | null> {
  const alias = await aliasFor(conn, name)
  if (alias) await conn.query(`CREATE OR REPLACE VIEW ${quoteIdent(alias)} AS SELECT * FROM layer`)
  return alias
}

/** The geometry column's name in `layer`: `geom`, unless an attribute already uses it. */
const geomNameFor = (columns: string[], geometryColumn: string | null): string => (columns.includes('geom') && geometryColumn !== 'geom' ? 'geometry' : 'geom')

/**
 * GeoParquet / Parquet read in parts (research §2): facts from the footer
 * and `geo` metadata, `layer` a view over the reader, views through the
 * bbox covering column, or a bbox index built once (6.9 s for 4M rows).
 */
async function openParquetInParts(ctx: ModeContext): Promise<OpenedTable> {
  const { conn } = ctx
  const pf = await parquetFacts(conn, ctx.path, ctx.isCancelled)
  ctx.checkCancelled()
  const names = pf.columns.map((c) => c.name)
  const geomName = geomNameFor(names, pf.geometryColumn)
  const attrs = names.filter((c) => c !== pf.geometryColumn && c !== pf.covering)
  const src = { kind: 'parquet' as const, path: ctx.path, attrs, geomExpr: pf.geomExpr, geomName, covering: pf.covering }
  await conn.query(internalLayerViewSql(src))
  await conn.query(publicLayerViewSql(src))
  const alias = await createAlias(conn, ctx.name)
  const crs = resolveCrsInfo(pf.srid)

  let sourceExtent = pf.sourceExtent
  let spatialIndex: SpatialIndexKind = pf.covering ? 'covering' : 'building'
  if (!pf.covering) {
    // One scan, then every view is an index lookup (research §4: 4M rows in 6.9 s).
    ctx.hooks.onPhase?.('indexing', ctx.detail)
    await streamRows(
      conn,
      `CREATE OR REPLACE TABLE __se_bbox AS SELECT file_row_number AS rn, ST_XMin(g) AS xmin, ST_YMin(g) AS ymin, ST_XMax(g) AS xmax, ST_YMax(g) AS ymax
       FROM (SELECT file_row_number, ${pf.geomExpr} AS g FROM read_parquet('${ctx.path.replace(/'/g, "''")}', file_row_number := true))`,
      ctx.isCancelled
    )
    spatialIndex = 'built'
    if (!sourceExtent) {
      const e = await singleRow<{ x0: number | null; y0: number | null; x1: number | null; y1: number | null }>(
        conn,
        'SELECT min(xmin) AS x0, min(ymin) AS y0, max(xmax) AS x1, max(ymax) AS y1 FROM __se_bbox',
        ctx.isCancelled
      )
      if (e.x0 !== null && e.y0 !== null && e.x1 !== null && e.y1 !== null) sourceExtent = [e.x0, e.y0, e.x1, e.y1]
    }
  }
  const extent = await extentToWgs84(conn, sourceExtent, pf.srid, ctx.isCancelled)
  // Invalid geometry needs a full scan: cheap for small files, so they get
  // exact feature counts (spec 001); large files report rows (FR-016).
  const invalid = ctx.detail.sizeBytes <= MATERIALIZE_MAX_BYTES ? await invalidCount(conn, quoteIdent(geomName), ctx.isCancelled) : null
  const table: QueryableTable = {
    name: 'layer',
    alias,
    columns: await describeLayer(conn),
    crs: crs.crs,
    crsAssumed: crs.assumed,
    srid: pf.srid,
    backing: 'streamed',
    totals: { rows: pf.rows, features: pf.rows - (invalid ?? 0), invalid: invalid ?? 0 },
    extent,
    sourceExtent,
    geometryType: pf.geometryTypes.length ? geometryTypeOf(pf.geometryTypes) : 'Polygon',
  }
  return { table, spatialIndex, invalid, view: { index: pf.covering ? 'columns' : 'bbox-table', geom: quoteIdent(geomName), attrs: attrs.filter((a) => !isGeometryColumn(table, a)) } }
}

/** Rows of `layer` whose geometry is missing or invalid (one full scan). */
async function invalidCount(conn: AsyncDuckDBConnection, g: string, isCancelled: () => boolean): Promise<number> {
  const r = await singleRow<{ n: bigint | number }>(conn, `SELECT count(*) FILTER (WHERE ${g} IS NULL OR NOT ST_IsValid(${g})) AS n FROM layer`, isCancelled)
  return Number(r.n)
}

/**
 * FlatGeobuf larger than the whole-read threshold, read in parts (research
 * §4): facts from the header (ST_Read_Meta plus the envelope parsed from the
 * first bytes), views through its spatial index (spatial_filter_box).
 * Whole-file work needs it loaded into memory first (loadWhole).
 */
async function openFlatGeobufInParts(ctx: ModeContext): Promise<OpenedTable> {
  const { conn } = ctx
  const ff = await flatGeobufFacts(conn, ctx.path, ctx.isCancelled)
  const prefix = await ctx.hostAdapter.readRange(ctx.ref, 0, FGB_PREFIX_BYTES)
  const header = parseFgbHeader(await ctx.hostAdapter.readRange(ctx.ref, 0, FGB_PREFIX_BYTES + fgbHeaderSize(prefix)))
  ctx.checkCancelled()
  const geometry = ff.columns.find((c) => c.type.toUpperCase().startsWith('GEOMETRY'))
  if (!geometry) throw new Error('This file has no geometry column.')
  const names = ff.columns.map((c) => c.name)
  const geomName = geomNameFor(names, geometry.name)
  const attrs = names.filter((c) => c !== geometry.name && c !== 'OGC_FID')
  // GDAL's OGC_FID when exposed; DuckDB-WASM 1.4.3's ST_Read doesn't, so the
  // feature id is a hash of its geometry (stable, within the JS safe-integer range).
  const rowidExpr = names.includes('OGC_FID') ? '"OGC_FID"' : `(hash(ST_AsWKB(${quoteIdent(geometry.name)})) % 9007199254740991)::BIGINT`
  const src = { kind: 'st_read' as const, path: ctx.path, attrs, geomExpr: quoteIdent(geometry.name), geomName, rowidExpr }
  await conn.query(internalLayerViewSql(src))
  await conn.query(publicLayerViewSql(src))
  const alias = await createAlias(conn, ctx.name)
  const srid = epsgFrom(geometry.type) ?? ff.srid
  const crs = resolveCrsInfo(srid)
  const rows = header.featuresCount ?? ff.rows
  const table: QueryableTable = {
    name: 'layer',
    alias,
    columns: await describeLayer(conn),
    crs: crs.crs,
    crsAssumed: crs.assumed,
    srid,
    backing: 'streamed',
    totals: { rows, features: rows, invalid: 0 },
    extent: await extentToWgs84(conn, header.envelope, srid, ctx.isCancelled),
    sourceExtent: header.envelope,
    geometryType: geometryTypeOf([ff.geometryType]),
  }
  return { table, spatialIndex: header.indexNodeSize > 0 ? 'file' : 'none', invalid: null, view: { index: 'fgb', path: ctx.path, geom: quoteIdent(geometry.name), attrs, rowidExpr, extent: header.envelope } }
}

/**
 * Whole-read formats (research §4): parsed once (a table for files up to
 * 64 MB, the reader otherwise), then one scan for totals, extent and types.
 */
async function openWhole(ctx: ModeContext, strategy: ReadStrategy): Promise<OpenedTable> {
  const { conn } = ctx
  ctx.hooks.onPhase?.('reading', ctx.detail)
  const read = await buildFromExpr(conn, strategy, ctx.path, true)
  const srid = read.srid !== undefined ? read.srid : await detectSourceSrid(conn, ctx.path, strategy)
  const crs = resolveCrsInfo(srid)
  ctx.checkCancelled()

  // `__se_layer` (internal, with the hidden row id and bbox) and `layer`
  // (what users query): attributes, then the geometry as `geom` in the
  // source CRS (spec 002 FR-014; spec 007 research §9).
  const exclude = [read.geometryColumn, strategy === 'st_read' && read.columns.includes('OGC_FID') ? 'OGC_FID' : null].filter(
    (c): c is string => c !== null && read.columns.includes(c)
  )
  const geomName = geomNameFor(read.columns, read.geometryColumn)
  const attrs = read.columns.filter((c) => !exclude.includes(c))
  // The indexed table (spec 007 T048): stable row ids in read order and
  // stored bbox columns. Views filter those columns: 1-3 ms for a city view
  // over 1M polygons in the WASM build, the same as an R-tree, without its
  // build time or memory (research.md US4 outcomes).
  const g0 = quoteIdent(geomName)
  await conn.query(
    `CREATE OR REPLACE TABLE ${SOURCE_TABLE} AS SELECT *, ST_XMin(${g0}) AS __se_xmin, ST_YMin(${g0}) AS __se_ymin, ST_XMax(${g0}) AS __se_xmax, ST_YMax(${g0}) AS __se_ymax
     FROM (SELECT ${attrs.map(quoteIdent).join(', ')}${attrs.length ? ', ' : ''}${read.geomExpr} AS ${g0}, rowid AS __se_rowid FROM ${read.fromExpr})`
  )
  await conn.query(`DROP TABLE IF EXISTS ${RAW_TABLE}`)
  ctx.checkCancelled()
  const src = { kind: 'table' as const, table: SOURCE_TABLE, attrs, geomExpr: g0, geomName }
  await conn.query(internalLayerViewSql(src))
  await conn.query(publicLayerViewSql(src))
  const alias = await createAlias(conn, ctx.name)

  // Whole-file metadata in one scan (FR-006): totals, extent in the source
  // CRS (for result-CRS detection) and in WGS84 (for the initial fit), and
  // the geometry type mix.
  const g = quoteIdent(geomName)
  const wgs = reprojectToWgs84Sql(g, srid)
  const stats = await singleRow<{
    n: bigint | number
    valid: bigint | number
    sx0: number | null; sy0: number | null; sx1: number | null; sy1: number | null
    wx0: number | null; wy0: number | null; wx1: number | null; wy1: number | null
    gtypes: unknown
  }>(
    conn,
    `SELECT count(*) AS n, count(*) FILTER (WHERE ok) AS valid,
       min(ST_XMin(${g})) FILTER (WHERE ok) AS sx0, min(ST_YMin(${g})) FILTER (WHERE ok) AS sy0,
       max(ST_XMax(${g})) FILTER (WHERE ok) AS sx1, max(ST_YMax(${g})) FILTER (WHERE ok) AS sy1,
       min(ST_XMin(w)) FILTER (WHERE ok) AS wx0, min(ST_YMin(w)) FILTER (WHERE ok) AS wy0,
       max(ST_XMax(w)) FILTER (WHERE ok) AS wx1, max(ST_YMax(w)) FILTER (WHERE ok) AS wy1,
       list(DISTINCT ST_GeometryType(${g})::VARCHAR) FILTER (WHERE ok) AS gtypes
     FROM (SELECT ${g}, CASE WHEN ok THEN ${wgs} END AS w, ok
           FROM (SELECT ${g}, (${g} IS NOT NULL AND ST_IsValid(${g})) AS ok FROM layer))`,
    ctx.isCancelled
  )
  const box = (a: number | null, b: number | null, c: number | null, d: number | null): Bbox | null =>
    a === null || b === null || c === null || d === null ? null : [a, b, c, d]
  const rows = Number(stats.n)
  const features = Number(stats.valid)
  const table: QueryableTable = {
    name: 'layer',
    alias,
    columns: await describeLayer(conn),
    crs: crs.crs,
    crsAssumed: crs.assumed,
    srid,
    backing: 'materialized',
    totals: { rows, features, invalid: rows - features },
    extent: box(stats.wx0, stats.wy0, stats.wx1, stats.wy1),
    sourceExtent: box(stats.sx0, stats.sy0, stats.sx1, stats.sy1),
    geometryType: geometryTypeOf(stats.gtypes),
  }
  return { table, spatialIndex: 'built', invalid: rows - features, view: { index: 'columns', geom: quoteIdent(geomName), attrs: attrs.filter((a) => !isGeometryColumn(table, a)) } }
}

/** Other geometry columns stay out of map attributes (they're shown as text in the table). */
function isGeometryColumn(table: QueryableTable, name: string): boolean {
  return table.columns.some((c) => c.name === name && c.type.toUpperCase().startsWith('GEOMETRY'))
}
