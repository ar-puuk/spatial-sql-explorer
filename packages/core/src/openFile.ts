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

import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { HostAdapter, OpenedFileRef } from './hostAdapter.js'
import { getDuckDb, resetDuckDb, type DuckDbAssetUrls } from './duckdbService.js'
import { loadSqlWasm } from './engineAssets.js'
import { isOutOfMemory, outOfMemoryMessage } from './outOfMemory.js'
import { registerSource, type RegisteredSource } from './source/register.js'
import { formatFromFileName, readModeFor, testOverrides } from './source/readModes.js'
import { epsgFrom, extentToWgs84, parquetFacts } from './source/facts.js'
import { internalLayerViewSql, publicLayerViewSql, visibleColumns } from './source/layerSql.js'
import { reprojectToWgs84Sql, resolveCrsInfo } from './crs.js'
import type { Bbox, DatasetFacts, Layer, OpenPhase, QueryableTable, ReadModeKind, SpatialIndexKind } from './models.js'
import { QuerySession, SOURCE_TABLE, type LayerViewInfo } from './query/session.js'
import { geometryTypeOf, QueryCancelledError, quoteIdent, singleRow, streamRows } from './query/util.js'
import { planSqliteSource } from './source/sqlite.js'
import { fileSqlNames, RESERVED_NAMES_SQL, type FileSqlNames } from './sql/names.js'
import { activeLayerOf, isFileGeodatabase, listLayers, mayHaveLayers, readLayerSql, type FileLayer } from './source/layers.js'
import { chooseDataset, extractDataset, inspectZip, isZipName, ZipChoiceError, type ZipDataset } from './source/zip.js'
import { convertedViewSql, openGeodatabaseLayer, placeholderViewSql, type GdbOpened } from './gdb/open.js'
import { GdbError, type GdbLayerInfo, type GdbProgress } from './gdb/types.js'
import type { FileSource } from './hostAdapter.js'

export interface OpenFileDeps {
  hostAdapter: HostAdapter
  duckdbAssets: DuckDbAssetUrls
}

type ReadStrategy = 'st_read' | 'parquet' | 'csv' | 'xlsx' | 'unsupported'

function detectStrategy(fileName: string): ReadStrategy {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.parquet') || lower.endsWith('.geoparquet')) return 'parquet'
  if (lower.endsWith('.csv')) return 'csv'
  // Spec 010 (research.md S9): the excel extension reads workbooks; they open like CSV.
  if (lower.endsWith('.xlsx')) return 'xlsx'
  if (
    lower.endsWith('.geojson') ||
    lower.endsWith('.json') ||
    lower.endsWith('.fgb') ||
    lower.endsWith('.flatgeobuf') ||
    lower.endsWith('.gpkg') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.db') ||
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
async function buildFromExpr(conn: AsyncDuckDBConnection, strategy: ReadStrategy, vfsPath: string, materialize: boolean, layer: string | null = null, reader?: string): Promise<FromExpr> {
  switch (strategy) {
    case 'st_read': {
      // ST_Read keeps the source's geometry field name: `geom` for most
      // drivers, but e.g. GML exposes `geometryProperty` (a hard-coded `geom`
      // broke every GML file; research.md §9). Use the GEOMETRY-typed column.
      // Spec 008 US3: one named layer of a file holding several. GeoPackage
      // and SQLite layers come with their own reader (research §16).
      const fromExpr = await readerSource(conn, reader ?? (layer === null ? `ST_Read('${vfsPath}')` : readLayerSql(vfsPath, layer)), materialize)
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
    case 'csv':
    case 'xlsx': {
      // Heuristic column detection, per spec.md's assumption ("CSV with
      // coordinate columns or WKT"). Tries common lon/lat name variants
      // first, then a WKT column. Must pick ONE geomExpr referencing only
      // columns that actually exist: a real browser run surfaced "Referenced
      // column 'longitude' not found" — DuckDB binds every column named in a
      // CASE/COALESCE expression at bind time regardless of which branch
      // would execute, so a single static expression referencing all three
      // naming variants fails outright on a CSV that only has `lon`/`lat`.
      const reader = strategy === 'xlsx' ? `read_xlsx('${vfsPath}')` : `read_csv_auto('${vfsPath}')`
      const fromExpr = await readerSource(conn, reader, materialize)
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
      throw new Error(`${strategy === 'xlsx' ? 'Excel workbook' : 'CSV file'} has no recognized coordinate columns (lon/lat, longitude/latitude, or wkt).`)
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

/** The file's SQL names (user decision 2026-10-14): `us_counties`, or `us_boundaries.counties` per layer. */
async function sqlNamesFor(conn: AsyncDuckDBConnection, fileName: string, layers: readonly FileLayer[] | null, active: FileLayer | null): Promise<FileSqlNames> {
  const res = await conn.query(RESERVED_NAMES_SQL)
  const reserved = new Set(res.toArray().map((r) => String(r.toJSON().k).toLowerCase()))
  return fileSqlNames(fileName, layers ? layers.map((l) => l.name) : null, active?.name ?? null, reserved)
}

/** How to open (spec 007 T044). */
export interface OpenOptions {
  /**
   * Spec 008 US3: the layer of a multi-layer file to open as `layer`.
   * Default: the first layer with geometry. A layer without geometry can't be
   * `layer`; query it by name instead.
   */
  layer?: string
  /** Spec 013: the dataset of a zip holding several to open. */
  dataset?: string
}

/** Progress and cancellation for an open (spec 007 FR-002, contracts/core-data-access.md). */
export interface OpenHooks {
  /** Reports each visible phase (OpenProgress). */
  onPhase?(phase: OpenPhase, detail?: { readMode?: ReadModeKind; sizeBytes?: number; format?: string; note?: string }): void
  /** Whole-file facts, as soon as they're known, before the first view (FR-001). */
  onFacts?(facts: DatasetFacts): void
  /** Whole-read files over the threshold wait for this (FR-004); false cancels the open. */
  confirmWholeRead?(sizeBytes: number, format: string): Promise<boolean>
  /** Receives a function that interrupts the engine statement in flight (FR-002: Cancel within 3 s). */
  onCancelHandle?(interrupt: () => Promise<void>): void
  /** Spec 013: a geodatabase layer that records no coordinate system asks for one: an EPSG code, null to go on without (WGS84 is assumed, and said), undefined cancels the open. */
  chooseCrs?(layerName: string): Promise<number | null | undefined>
  /** Spec 013: a zip holding several datasets asks which to open; null cancels the open. */
  chooseDataset?(datasets: Array<{ name: string; size: number }>): Promise<string | null>
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
  // Spec 013: a File Geodatabase (a folder, a .gdb.zip, or a zip holding one) is read by the shell's
  // reader into a FlatGeobuf, which then opens like any file; a zip of ordinary data is unzipped here.
  const abort = new AbortController()
  hooks.onCancelHandle?.(async () => abort.abort())
  let gdb: GdbOpened | null = null
  let source: FileSource
  if (isFileGeodatabase(ref.displayName)) {
    gdb = await openGdb(ref, deps, hooks, options, abort.signal)
    source = gdb.converted.source
  } else if (isZipName(ref.displayName)) {
    const zip = await hostAdapter.getFileSource(ref, { whole: true })
    checkCancelled()
    if (zip.kind !== 'bytes') throw new Error('The zip could not be read into memory.')
    const contents = inspectZip(zip.bytes)
    if (contents.kind === 'gdb') {
      gdb = await openGdb(ref, deps, hooks, options, abort.signal)
      source = gdb.converted.source
    } else if (contents.kind === 'datasets') {
      let dataset: ZipDataset
      try {
        dataset = chooseDataset(contents.datasets, options.dataset)
      } catch (err) {
        // Several datasets: the person chooses (the shell's dialog), or there is nobody to ask.
        if (!(err instanceof ZipChoiceError) || !hooks.chooseDataset) throw err
        const picked = await hooks.chooseDataset(err.datasets.map((d) => ({ name: d.name, size: d.size })))
        if (picked === null) throw new QueryCancelledError()
        dataset = chooseDataset(contents.datasets, picked)
      }
      source = extractDataset(zip.bytes, dataset)
    } else {
      throw new Error(`"${ref.displayName}" holds no data Spatial Explorer can open (GeoJSON, Shapefile, GeoPackage, FlatGeobuf, GeoParquet, CSV, GML, SQLite, Excel or a File Geodatabase).`)
    }
  } else {
    source = await hostAdapter.getFileSource(ref)
  }
  checkCancelled()
  const strategy = detectStrategy(source.name)
  const format = formatFromFileName(source.name)
  if (strategy === 'unsupported' || format === null || format === 'pmtiles') {
    throw new Error(
      `"${ref.displayName}" is not a supported format. Spatial Explorer supports GeoJSON, CSV, GeoParquet, FlatGeobuf, GeoPackage, SQLite/SpatiaLite, Shapefile, GML and PMTiles (view only).`
    )
  }

  // How the engine reaches this file (research §4); a whole-transfer fallback
  // means partial reads aren't available in this window (FR-015).
  // The same file again, whole: the geodatabase's converted layer, or the picked file.
  const refetchWhole = (): Promise<FileSource> => (gdb ? gdbWhole(ref, deps, gdb.active, gdb.assumedCrs) : hostAdapter.getFileSource(ref, { whole: true }))
  const fallback = source.kind === 'bytes' ? (source.fallbackReason ?? null) : null
  const mode = readModeFor(format, source.size, { partialReads: fallback === null })
  // Whole reads from memory: small files read faster from memory than through
  // many small handle/HTTP reads (10 MB GeoJSON: 1.6 s vs 2.1 s warm), and
  // FlatGeobuf is ~1,500x faster from memory (research §4).
  if (mode.mode === 'whole' && source.kind !== 'bytes' && (format === 'flatgeobuf' || source.size <= (testOverrides().wholeBytes ?? MATERIALIZE_MAX_BYTES))) {
    source = await refetchWhole()
  }

  const styleSidecar = source.styleSidecar
  const db = await getDuckDb(duckdbAssets)
  const conn: AsyncDuckDBConnection = await db.connect()
  hooks.onCancelHandle?.(async () => {
    await conn.cancelSent().catch(() => false)
  })
  let registered: RegisteredSource | null = null
  /** Files registered beside the source (a GeoPackage read as plain SQLite, research §16). */
  let extraPaths: string[] = []
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
    if (mode.mode === 'whole' && source.size > mode.wholeReadThresholdBytes && hooks.confirmWholeRead) {
      hooks.onPhase?.('announce', detail)
      if (!(await hooks.confirmWholeRead(source.size, gdb ? 'geodatabase' : format))) throw new QueryCancelledError()
    }
    checkCancelled()
    // Research §16: a GeoPackage layer GDAL can't stream is read from a plain
    // SQLite copy; a file already in memory is copied before the engine takes
    // it, which is much faster than fetching it again.
    let sqliteBytes: Uint8Array | null = format === 'geopackage' && source.kind === 'bytes' ? source.bytes.slice() : null
    registered = await registerSource(db, source, refetchWhole)
    await testDelay(checkCancelled)
    // Spec 008 US3: a file holding several layers is listed (its catalog only), and one is opened.
    let layers: FileLayer[] = gdb ? gdb.catalog.layers : strategy === 'st_read' && mayHaveLayers(format) ? await listLayers(conn, registered.primaryPath) : []
    // Research §16: how each GeoPackage / SQLite layer is read.
    let readers = new Map<string, string>()
    if (layers.length && (format === 'geopackage' || format === 'sqlite')) {
      const plan = await planSqliteSource({
        db,
        conn,
        format,
        path: registered.primaryPath,
        layers,
        wholeBytes: async () => {
          const kept = sqliteBytes
          sqliteBytes = null
          if (kept) return kept
          const whole = await hostAdapter.getFileSource(ref, { whole: true })
          if (whole.kind !== 'bytes') throw new Error('The file could not be read into memory.')
          return whole.bytes
        },
        log: hostAdapter.log?.bind(hostAdapter),
      })
      layers = plan.layers
      readers = plan.readers
      extraPaths = plan.paths
      timings.layers = lap()
    }
    checkCancelled()
    const multi = layers.length > 1
    const active = gdb ? gdb.active : layers.length ? activeLayerOf(layers.filter((l) => l.geometryType !== null), options.layer) : null
    if (multi && !active) throw new Error('This file has no layer with geometry. Its tables can be queried by name.')
    const names = await sqlNamesFor(conn, gdb ? gdb.fileName : source.name, multi ? layers : null, active)
    const ctx: ModeContext = {
      conn,
      path: registered.primaryPath,
      names,
      hostAdapter,
      ref,
      hooks,
      detail,
      checkCancelled,
      isCancelled: () => hooks.isCancelled?.() ?? false,
      // A converted geodatabase layer is a file of its own: read plainly, not by layer name.
      layer: gdb ? null : active,
      reader: active ? readers.get(active.name) : undefined,
    }

    let opened: OpenedTable
    if (mode.mode === 'partial') opened = await openParquetInParts(ctx)
    else {
      opened = await openWhole(ctx, strategy)
      // A multi-layer file stays registered: its other layers are views over it (FR-017).
      keepRegistered = multi && !gdb
    }
    timings.prepare = lap()
    checkCancelled()
    const { table } = opened
    hooks.onFacts?.(factsOf(table, opened, mode.mode, fallback))
    hooks.onPhase?.('facts', detail)

    // The initial view IS the default query's result (FR-003, SC-002).
    session = new QuerySession(db, await db.connect(), table, keepRegistered ? [...registered.paths, ...extraPaths] : [], hostAdapter.log?.bind(hostAdapter))
    session.setLayerView({ ...opened.view, allValid: opened.invalid === 0 })
    session.setExportAssets({ loadSqlWasm: () => loadSqlWasm(duckdbAssets) })
    // Spec 010: a big file's default view is drawn as tiles whatever its rows (TILE_BYTES).
    session.setFileBytes(source.size)
    if (keepRegistered && registered) session.setSourceRecovery(registered.reRegister)
    if (gdb && multi) await setUpGeodatabaseLayers(session, db, gdb, names, ref, deps, hooks)
    else if (multi && registered) await createLayerViews(session.conn, registered.primaryPath, layers, active, names, readers)
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
      ...(gdb && Object.keys(gdb.converted.domains).length ? { columnDomains: gdb.converted.domains } : {}),
      loadTimings: timings,
      facts: {
        ...factsOf(table, opened, mode.mode, fallback),
        ...(multi && active ? { layers: layers.map((l) => ({ name: l.name, geometryType: l.geometryType, featureCount: l.featureCount, sqlName: names.layers.get(l.name), ...(gdb ? { group: (l as GdbLayerInfo).featureDataset } : {}) })), activeLayer: active.name } : {}),
        ...(gdb ? { experimental: true } : {}),
      },
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
    if (!keepRegistered) {
      await registered?.drop()
      for (const p of extraPaths) await db.dropFile(p).catch(() => {})
    }
  }
}

/** Spec 013: the shell's reader lists the geodatabase and converts the layer to open. */
async function openGdb(ref: OpenedFileRef, deps: OpenFileDeps, hooks: OpenHooks, options: OpenOptions, signal: AbortSignal): Promise<GdbOpened> {
  hooks.onPhase?.('converting', { note: 'Reading the geodatabase…' })
  try {
    return await openGeodatabaseLayer(ref, deps.hostAdapter.gdb, {
      layer: options.layer,
      signal,
      onProgress: (step) => hooks.onPhase?.('converting', { note: gdbNote(step) }),
      chooseCrs: hooks.chooseCrs,
    })
  } catch (err) {
    if (signal.aborted || (err instanceof GdbError && err.code === 'cancelled')) throw new QueryCancelledError()
    throw err
  }
}

/** The converted layer again, as bytes (FlatGeobuf "load for queries", and re-registering after an out-of-memory). */
async function gdbWhole(ref: OpenedFileRef, deps: OpenFileDeps, layer: GdbLayerInfo, assumeCrs?: number): Promise<FileSource> {
  const host = deps.hostAdapter.gdb
  if (!host) throw new GdbError('The geodatabase reader is not available.', 'unreadable')
  return (await host.convert(ref, layer, { whole: true, ...(assumeCrs !== undefined ? { assumeCrs } : {}) })).source
}

const mb = (n: number): string => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)
function gdbNote(step: GdbProgress): string {
  switch (step.phase) {
    case 'download':
      return `Downloading the geodatabase reader (first use only)… ${mb(step.loaded)} of ${mb(step.total)} MB`
    case 'list':
      return 'Reading the geodatabase…'
    case 'copy':
      return `Reading layer ${step.layer}…`
    case 'convert':
      return `Converting layer ${step.layer}…`
    case 'cache':
      return `Saving layer ${step.layer}…`
  }
}

/**
 * Spec 013 FR-004: every other layer is a view in the geodatabase's schema with
 * its columns and no rows; the first statement that names one converts it,
 * registers its FlatGeobuf and replaces the view (QuerySession's lazy layers).
 */
async function setUpGeodatabaseLayers(session: QuerySession, db: AsyncDuckDB, gdb: GdbOpened, names: FileSqlNames, ref: OpenedFileRef, deps: OpenFileDeps, hooks: OpenHooks): Promise<void> {
  const lazy = new Map<string, string>()
  for (const l of gdb.catalog.layers) {
    const sqlName = names.layers.get(l.name)
    if (l.name === gdb.active.name || !sqlName) continue
    await session.conn.query(placeholderViewSql(sqlName, l))
    lazy.set(l.name, sqlName)
  }
  session.setLazyLayers({
    names: lazy,
    async load(layerName, signal) {
      const info = gdb.catalog.layers.find((l) => l.name === layerName)
      const sqlName = lazy.get(layerName)
      const host = deps.hostAdapter.gdb
      if (!info || !sqlName || !host) throw new GdbError(`The layer "${layerName}" could not be found in the geodatabase.`, 'unreadable')
      const converted = await host.convert(ref, info, { signal, onProgress: (step) => hooks.onPhase?.('converting', { note: gdbNote(step) }) })
      const registered = await registerSource(db, converted.source)
      session.adoptPaths(registered.paths)
      await session.conn.query(convertedViewSql(sqlName, registered.primaryPath, info.spatial))
    },
  })
}

interface ModeContext {
  conn: AsyncDuckDBConnection
  path: string
  /** What queries name the file by. */
  names: FileSqlNames
  hostAdapter: HostAdapter
  ref: OpenedFileRef
  hooks: OpenHooks
  detail: { readMode: ReadModeKind; sizeBytes: number; format: string }
  checkCancelled: () => void
  isCancelled: () => boolean
  /** Spec 008 US3: the layer being opened, or null (a format without a layer list). */
  layer?: FileLayer | null
  /** How that layer is read, when not a plain ST_Read (research §16). */
  reader?: string
}

/**
 * Spec 008 FR-017: every other layer of the file as a view in the file's
 * schema (`us_boundaries.states`), read only when a query uses it.
 */
async function createLayerViews(conn: AsyncDuckDBConnection, path: string, layers: readonly FileLayer[], active: FileLayer | null, names: FileSqlNames, readers: ReadonlyMap<string, string>): Promise<void> {
  for (const l of layers) {
    const name = names.layers.get(l.name)
    if (l === active || !name) continue
    // DuckDB 1.5's ST_Read returns GDAL's synthetic OGC_FID; `layer` drops it (openWhole), and so do these.
    await conn.query(`CREATE OR REPLACE VIEW ${name} AS SELECT COLUMNS(c -> c <> 'OGC_FID') FROM ${readers.get(l.name) ?? readLayerSql(path, l.name)}`)
  }
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

/** The file's own name for `layer` (in its schema, for a multi-layer file). */
async function createAlias(conn: AsyncDuckDBConnection, names: FileSqlNames): Promise<string | null> {
  if (names.schema) await conn.query(`CREATE SCHEMA IF NOT EXISTS ${names.schema}`)
  if (names.alias) await conn.query(`CREATE OR REPLACE VIEW ${names.alias} AS SELECT * FROM layer`)
  return names.alias
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
  const alias = await createAlias(conn, ctx.names)
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
    schema: ctx.names.schema,
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
 * Whole-read formats (research §4): parsed once (a table for files up to
 * 64 MB, the reader otherwise), then one scan for totals, extent and types.
 */
async function openWhole(ctx: ModeContext, strategy: ReadStrategy): Promise<OpenedTable> {
  const { conn } = ctx
  ctx.hooks.onPhase?.('reading', ctx.detail)
  const read = await buildFromExpr(conn, strategy, ctx.path, true, ctx.layer?.name ?? null, ctx.reader)
  // A listed layer knows its CRS already (ST_Read_Meta); otherwise ask for the first layer's.
  const srid = read.srid !== undefined ? read.srid : ctx.layer ? ctx.layer.srid : await detectSourceSrid(conn, ctx.path, strategy)
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
  const alias = await createAlias(conn, ctx.names)

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
    schema: ctx.names.schema,
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
