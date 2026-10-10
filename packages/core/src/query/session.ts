// QuerySession: one per viewer (spec 002, contracts/query-service.md). It
// owns a dedicated query connection, separate from the one that opened the
// file, so a cancel can never touch file loading. Temp tables are
// per-connection in DuckDB, so user temp objects and __se_result live here.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { DEFAULT_QUERY, LARGE_RESULT_THRESHOLD, type QueryableTable } from '../models.js'
import { buildQueryResult, layerCrs, RESULT_TABLE, type BuildContext, type BuiltResult } from './run.js'
import { quoteIdent, streamRows } from './util.js'

/** Internal objects every viewer creates: hidden from users and protected from DDL. */
export const SOURCE_TABLE = '__se_source'

export class QuerySession {
  readonly defaultQuery = DEFAULT_QUERY
  private inFlight: Promise<unknown> | null = null
  private cancelRequested = false
  private disposed = false

  constructor(
    private readonly db: AsyncDuckDB,
    /** @internal used by the run pipeline */
    readonly conn: AsyncDuckDBConnection,
    readonly table: QueryableTable,
    /** Registered source files still needed (streamed backing); dropped on dispose. */
    private readonly liveFiles: string[]
  ) {}

  /** Names users can't replace or drop (statement policy). */
  get protectedNames(): string[] {
    return ['layer', ...(this.table.alias ? [this.table.alias] : [])]
  }

  get running(): boolean {
    return this.inFlight !== null
  }

  /** @internal Runs `work` single-flight with cancellation plumbing. */
  async exclusive<T>(work: (isCancelled: () => boolean) => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('This viewer was closed.')
    if (this.inFlight) throw new Error('A query is already running.')
    this.cancelRequested = false
    const isCancelled = (): boolean => this.cancelRequested
    const promise = work(isCancelled)
    this.inFlight = promise
    try {
      return await promise
    } finally {
      this.inFlight = null
    }
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
    return this.exclusive((isCancelled) => buildQueryResult(this.buildContext(isCancelled), this.defaultQuery))
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
    await drop(`DROP TABLE IF EXISTS ${SOURCE_TABLE}`)
    await this.conn.close().catch(() => {})
    for (const path of this.liveFiles) await this.db.dropFile(path).catch(() => {})
  }
}

export { LARGE_RESULT_THRESHOLD }
