// T016 (spec 002, US1) in the real VS Code webview, driven through the
// spatialExplorer._runQuery / _getQueryState test hooks
// (contracts/host-webview-protocol-delta.md). @vscode/test-electron can't
// type into the webview, so the hooks call the same store action as Run.
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

export type QueryState = {
  phase: string
  runCount: number
  outcome?: string
  rowCount?: number
  mappedCount?: number
  geometryColumn?: string | null
  resultCrs?: string
  resultCrsSource?: string
  errorMessage?: string
  errorPosition?: { line: number; column: number }
  refusedReason?: string
  durationMs?: number
  historyLength?: number
} | null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const queryState = (): Thenable<QueryState> => vscode.commands.executeCommand('spatialExplorer._getQueryState')

export async function openAndWait(file: string, viewType = 'spatialExplorer.editor'): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.resolve(__dirname, '../../fixtures', file)), viewType)
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string; errorMessage?: string } | null
    if (s && s.loadState !== 'loading') {
      assert.strictEqual(s.loadState, 'ready', s.errorMessage ?? '')
      return
    }
    await sleep(200)
  }
  assert.fail(`${file} did not load`)
}

/** Runs SQL via the hook and waits for a new terminal state. */
export async function run(sql: string, confirm?: 'all' | 'first' | 'cancel', terminal = ['succeeded', 'failed', 'cancelled', 'refused']): Promise<QueryState> {
  const before = (await queryState())?.runCount ?? 0
  await vscode.commands.executeCommand('spatialExplorer._runQuery', sql, confirm)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const s = await queryState()
    if (s && s.runCount > before && terminal.includes(s.phase)) return s
    await sleep(150)
  }
  assert.fail(`query did not finish: ${sql}`)
}

const DEFAULT = 'SELECT * FROM layer LIMIT 1000'

suite('Spec 002 US1: run a query in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  // SC-002: the default query matches spec 001's view for every format in the
  // spec 001 format matrix (mapped = spec 001's featureCount; invalid rows are
  // additionally listed).
  const parity: Array<{ file: string; viewType?: string; rows: number; mapped: number }> = [
    { file: 'world-boundaries.geojson', viewType: 'spatialExplorer.editorOption', rows: 180, mapped: 179 },
    { file: 'sample.fgb', rows: 180, mapped: 179 },
    { file: 'sample.shp', rows: 180, mapped: 179 },
    { file: 'sample.gml', viewType: 'spatialExplorer.editorOption', rows: 180, mapped: 179 },
    { file: 'sample.gpkg', rows: 180, mapped: 179 },
    { file: 'sample.parquet', viewType: 'spatialExplorer.editorOption', rows: 180, mapped: 179 },
    { file: 'sample-wkb.parquet', viewType: 'spatialExplorer.editorOption', rows: 180, mapped: 179 },
    { file: 'usa-utm12n.parquet', viewType: 'spatialExplorer.editorOption', rows: 1, mapped: 1 },
    { file: 'points.csv', viewType: 'spatialExplorer.editorOption', rows: 3, mapped: 3 },
    { file: 'multi-layer.gpkg', rows: 180, mapped: 179 },
  ]
  for (const c of parity) {
    test(`default query parity: ${c.file}`, async function () {
      this.timeout(90000)
      await openAndWait(c.file, c.viewType)
      const s = await run(DEFAULT)
      assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? s?.refusedReason ?? '')
      assert.strictEqual(s?.rowCount, c.rows)
      assert.strictEqual(s?.mappedCount, c.mapped)
    })
  }

  test('a filter query replaces the view', async function () {
    this.timeout(90000)
    await openAndWait('world-boundaries.geojson', 'spatialExplorer.editorOption')
    const s = await run("SELECT * FROM layer WHERE name LIKE 'U%'")
    assert.strictEqual(s?.phase, 'succeeded')
    assert.strictEqual(s?.rowCount, 8)
    assert.strictEqual(s?.mappedCount, 8)
    assert.strictEqual(s?.geometryColumn, 'geom')
  })

  test('a transform to lon/lat from a UTM layer is detected (FR-014)', async function () {
    this.timeout(90000)
    await openAndWait('usa-utm12n.gpkg')
    let s = await run('SELECT * FROM layer')
    assert.strictEqual(s?.resultCrsSource, 'layer')
    assert.strictEqual(s?.resultCrs, 'EPSG:26912')
    s = await run("SELECT ST_Transform(geom, 'EPSG:26912', 'EPSG:4326', always_xy := true) AS geom FROM layer")
    assert.strictEqual(s?.resultCrsSource, 'detected')
    assert.strictEqual(s?.resultCrs, 'EPSG:4326 (WGS84)')
  })
})

suite('Spec 002 US2: errors, refusals and cancel in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('a refused statement reports the policy reason', async function () {
    this.timeout(60000)
    await openAndWait('sample.gpkg')
    const s = await run("COPY layer TO 'x.csv'")
    assert.strictEqual(s?.phase, 'refused')
    assert.strictEqual(s?.refusedReason, "Exporting results isn't available yet.")
  })

  test('an engine error reports its position', async function () {
    this.timeout(60000)
    await openAndWait('sample.gpkg')
    const s = await run('SELECT *\nFORM layer')
    assert.strictEqual(s?.phase, 'failed')
    assert.match(s?.errorMessage ?? '', /^Parser Error: syntax error/)
    assert.deepStrictEqual(s?.errorPosition, { line: 2, column: 6 })
  })

  test('a running query is cancelled in under 3 s, and every query reached the output channel', async function () {
    this.timeout(90000)
    await openAndWait('sample.gpkg')
    const before = ((await vscode.commands.executeCommand('spatialExplorer._getLogLines')) as string[]).length
    const runCount = (await queryStateNow())?.runCount ?? 0
    await vscode.commands.executeCommand('spatialExplorer._runQuery', 'SELECT sum(a.range * b.range) FROM range(200000) a, range(200000) b')
    await sleep(1000)
    const t0 = Date.now()
    await vscode.commands.executeCommand('spatialExplorer._cancelQuery')
    let s = await queryStateNow()
    while (!(s && s.runCount > runCount) && Date.now() - t0 < 10000) {
      await sleep(100)
      s = await queryStateNow()
    }
    assert.strictEqual(s?.phase, 'cancelled')
    const cancelMs = Date.now() - t0
    console.log(`TIMING SC-004 cancel (VS Code): ${cancelMs} ms`)
    assert.ok(cancelMs < 3000, `cancel took ${cancelMs} ms`)
    const lines = (await vscode.commands.executeCommand('spatialExplorer._getLogLines')) as string[]
    const queryLines = lines.slice(before).filter((l) => l.startsWith('[query]'))
    assert.ok(queryLines.some((l) => /cancelled after/i.test(l)), queryLines.join('\n'))
  })
})

const queryStateNow = (): Thenable<QueryState> => vscode.commands.executeCommand('spatialExplorer._getQueryState')

/** History loads after the file; waits until the reported length settles. */
async function settledHistoryLength(): Promise<number> {
  let last = -1
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    await sleep(300)
    const n = (await queryStateNow())?.historyLength ?? -1
    if (n >= 0 && n === last) return n
    last = n
  }
  assert.fail('history length never settled')
}

suite('Spec 002 US5: history in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  // T047 (FR-016, SC-007): history survives closing and reopening the file.
  // globalState outlives test runs, so the queries are unique and the check
  // is relative to what was already there.
  test('two queries are still in the history after closing and reopening the file', async function () {
    this.timeout(90000)
    await openAndWait('sample.fgb')
    const before = await settledHistoryLength()
    const tag = Date.now()
    assert.strictEqual((await run(`SELECT ${tag} AS a, * FROM layer LIMIT 2`))?.phase, 'succeeded')
    assert.strictEqual((await run(`SELECT ${tag} AS b, * FROM layer LIMIT 3`))?.phase, 'succeeded')
    assert.strictEqual((await queryStateNow())?.historyLength, Math.min(20, before + 2))

    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await openAndWait('sample.fgb')
    assert.strictEqual(await settledHistoryLength(), Math.min(20, before + 2))
  })
})

/** spec 001's ~10 MB performance fixture: 22,000 parcel-like polygons, 6 attributes. */
function writeTenMegabyteGeoJson(): string {
  const features: string[] = []
  let seed = 42
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 22000; i++) {
    const cx = -112.2 + rand() * 0.8
    const cy = 40.4 + rand() * 0.8
    const r = 0.0004 + rand() * 0.0008
    const ring: string[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      ring.push(`[${(cx + Math.cos(a) * r * (0.8 + rand() * 0.4)).toFixed(6)},${(cy + Math.sin(a) * r * (0.8 + rand() * 0.4)).toFixed(6)}]`)
    }
    ring.push(ring[0])
    features.push(
      `{"type":"Feature","properties":{"parcel_id":"P-${100000 + i}","zone":"${['R1', 'R2', 'C', 'I', 'AG'][i % 5]}","acres":${(rand() * 5).toFixed(3)},"value":${Math.round(rand() * 900000)},"year_built":${1900 + (i % 124)},"owner":"Owner ${i % 997}"},"geometry":{"type":"Polygon","coordinates":[[${ring.join(',')}]]}}`
    )
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-perf-')), 'parcels-10mb.geojson')
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}`)
  return file
}

suite('Spec 002 timings in VS Code (T050)', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  // SC-001: run -> result reported by the webview (after the table and map
  // layer are updated). Polled every 25 ms through the test hook, so it is an
  // upper bound that includes the extension-host round trips.
  test('SC-001: a filtering query on the ~10 MB file finishes in under 1 s', async function () {
    this.timeout(120000)
    const file = writeTenMegabyteGeoJson()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
    const deadline = Date.now() + 60000
    for (;;) {
      const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
      if (s && s.loadState === 'ready') break
      assert.ok(Date.now() < deadline, 'the 10 MB file did not load')
      await sleep(200)
    }
    const timings: number[] = []
    for (let i = 0; i < 3; i++) {
      const before = (await queryStateNow())?.runCount ?? 0
      const t0 = Date.now()
      await vscode.commands.executeCommand('spatialExplorer._runQuery', `SELECT * FROM layer WHERE zone = 'R1' AND acres > ${2.5 + i / 10} LIMIT 1000`)
      let s = await queryStateNow()
      while (!(s && s.runCount > before && s.phase === 'succeeded')) {
        assert.ok(Date.now() - t0 < 30000, 'query did not finish')
        await sleep(25)
        s = await queryStateNow()
      }
      timings.push(Date.now() - t0)
      assert.ok((s.rowCount ?? 0) > 0 && (s.rowCount ?? 0) <= 1000)
    }
    console.log(`TIMING SC-001 filter query (VS Code): ${timings.join(', ')} ms`)
    assert.ok(Math.min(...timings) < 1000, `filter query took ${timings.join(', ')} ms`)
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  })
})
