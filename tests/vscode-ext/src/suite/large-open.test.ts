// Spec 007 (large files) in the VS Code extension. T019: US1 (facts first,
// read in parts over the loopback server, the FR-015 fallback, parity with
// the web build). Later tasks add views, queries, whole-read formats and PMTiles.
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Rows of parcels-10k with value > 1,000,000 (the web paging test asserts the same). */
const FILTERED_ROWS = 4958

const fixture = (name: string): string => path.resolve(__dirname, '../../fixtures', name)

interface OpenState {
  phase: string
  facts: { rows: number; readMode: string; spatialIndex: string; crs: { label: string }; geometryType: string; fallback: string | null } | null
}
interface SourceStats {
  bytes: number
  requests: number
  size: number
  chunksSent: boolean
}

/** Opens a fixture in the given viewer and waits until it's ready. */
export async function openReady(name: string, viewType = 'spatialExplorer.editorOption'): Promise<OpenState> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(fixture(name)), viewType)
  const deadline = Date.now() + 60000
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getOpenState')) as OpenState | null
    if (s?.phase === 'ready' && s.facts) return s
    assert.ok(Date.now() < deadline, `${name} did not open: ${JSON.stringify(s)}`)
    await sleep(200)
  }
}

suite('Spec 007 US1: large files open in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', false)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('GeoParquet opens over the loopback server, read in parts, with whole-file facts', async function () {
    this.timeout(90000)
    const s = await openReady('parcels-10k.parquet')
    assert.deepStrictEqual(
      { rows: s.facts?.rows, readMode: s.facts?.readMode, spatialIndex: s.facts?.spatialIndex, crs: s.facts?.crs.label, fallback: s.facts?.fallback },
      { rows: 10000, readMode: 'partial', spatialIndex: 'covering', crs: 'EPSG:4326 (WGS84)', fallback: null }
    )
    const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as SourceStats
    assert.strictEqual(stats.chunksSent, false, 'no whole-file transfer')
    assert.ok(stats.requests > 1, `range requests were made (${stats.requests})`)
    // The 10k fixture is one row group, so it is read through; reading a small
    // part of a large file is measured on tests/.large-data (T060).
    assert.strictEqual(fs.statSync(fixture('parcels-10k.parquet')).size, stats.size)
  })

  test('FlatGeobuf over the loopback server: facts from the header', async function () {
    this.timeout(90000)
    const s = await openReady('parcels-10k.fgb', 'spatialExplorer.editor')
    // 3.6 MB is under the whole-read threshold: loaded into memory, where FlatGeobuf is fast.
    assert.strictEqual(s.facts?.rows, 10000)
    assert.strictEqual(s.facts?.crs.label, 'EPSG:4326 (WGS84)')
  })

  test('when partial reads fail, the whole file is read instead, and the viewer says why (FR-015)', async function () {
    this.timeout(90000)
    await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', true)
    try {
      const s = await openReady('parcels-10k.parquet')
      assert.strictEqual(s.facts?.rows, 10000)
      assert.strictEqual(s.facts?.readMode, 'whole')
      assert.match(s.facts?.fallback ?? '', /Partial reads aren't available in this window \(forced by a test\)\./)
      const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as SourceStats
      assert.strictEqual(stats.chunksSent, true)
    } finally {
      await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', false)
    }
  })
})

interface ViewState {
  generation: number
  drawn: number
  inView: number
  thinned: boolean
}

async function viewAfter(generation: number): Promise<ViewState> {
  const deadline = Date.now() + 30000
  for (;;) {
    const v = (await vscode.commands.executeCommand('spatialExplorer._getMapView')) as ViewState | null
    if (v && v.generation > generation) return v
    assert.ok(Date.now() < deadline, `no view after generation ${generation}: ${JSON.stringify(v)}`)
    await sleep(150)
  }
}

// T031 (spec 007 US2): the same map views in the VS Code webview.
suite('Spec 007 US2: map views in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', null)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the full extent is a capped, thinned subset; a city view draws everything in it', async function () {
    this.timeout(120000)
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', { cap: 1000 })
    await openReady('parcels-10k.parquet')
    const overview = await viewAfter(0)
    assert.strictEqual(overview.thinned, true)
    assert.ok(overview.drawn <= 1000 && overview.drawn > 900, `drawn ${overview.drawn}`)
    assert.strictEqual(overview.inView, 10000)
    await vscode.commands.executeCommand('spatialExplorer._jumpTo', -112.6, 37.4, 13)
    const city = await viewAfter(overview.generation)
    assert.strictEqual(city.thinned, false)
    assert.strictEqual(city.drawn, city.inView)
    assert.ok(city.drawn > 0)
  })
})

/** Runs SQL through the test hook and waits for it to finish (spec 002 hooks). */
async function run(sql: string): Promise<{ phase: string; rowCount?: number; errorMessage?: string; refusedReason?: string } | null> {
  type State = { phase: string; runCount: number; rowCount?: number; errorMessage?: string; refusedReason?: string } | null
  const state = (): Thenable<State> => vscode.commands.executeCommand('spatialExplorer._getQueryState')
  const before = (await state())?.runCount ?? 0
  await vscode.commands.executeCommand('spatialExplorer._runQuery', sql)
  const deadline = Date.now() + 60000
  for (;;) {
    const s = await state()
    if (s && s.runCount > before && ['succeeded', 'failed', 'cancelled', 'refused'].includes(s.phase)) return s
    assert.ok(Date.now() < deadline, `query did not finish: ${sql}`)
    await sleep(150)
  }
}

/** Exports the displayed result to `target` through the spec 005 hooks and waits for the outcome. */
async function runExport(request: object, target: string): Promise<{ outcome: { kind: string; rows?: number } | null }> {
  type State = { phase: string; outcome: { kind: string; rows?: number } | null } | null
  await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', target)
  await vscode.commands.executeCommand('spatialExplorer._runExport', request)
  const deadline = Date.now() + 60000
  await sleep(200)
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getExportState')) as State
    if (s && s.phase !== 'running' && s.outcome) return s
    assert.ok(Date.now() < deadline, `export did not finish: ${JSON.stringify(s)}`)
    await sleep(150)
  }
}

// T043 (US3): queries, counts and export on the whole data, as in the web build
// (tests/web/specs/paging.spec.ts asserts the same count).
suite('Spec 007 US3: whole-result queries in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the default query, an exact filtered count, and an export of every row', async function () {
    this.timeout(120000)
    await openReady('parcels-10k.parquet')
    const initial = (await vscode.commands.executeCommand('spatialExplorer._getQueryState')) as { queryText?: string } | null
    assert.strictEqual(initial?.queryText, 'SELECT * FROM layer')

    const s = await run('SELECT * FROM layer WHERE value > 1000000')
    assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? s?.refusedReason ?? '')
    assert.strictEqual(s?.rowCount, FILTERED_ROWS)

    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-007-')), 'filtered.parquet')
    const e = await runExport({ format: 'geoparquet', crs: 'result' }, out)
    assert.strictEqual(e.outcome?.kind, 'saved', JSON.stringify(e.outcome))
    assert.strictEqual(e.outcome?.rows, FILTERED_ROWS)
    assert.strictEqual(fs.readFileSync(out).subarray(0, 4).toString('latin1'), 'PAR1')
  })
})

// T047/T052 (US4): formats read whole, over the loopback server (wholeBytes: 0
// skips the small-file memory fetch so the URL path is the one tested).
suite('Spec 007 US4: formats read whole in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', null)
    await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', false)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('GeoJSON is parsed once over the loopback server, into an indexed table', async function () {
    this.timeout(90000)
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', { wholeBytes: 0 })
    const s = await openReady('parcels-10k.geojson')
    assert.deepStrictEqual({ rows: s.facts?.rows, readMode: s.facts?.readMode, spatialIndex: s.facts?.spatialIndex }, { rows: 10000, readMode: 'whole', spatialIndex: 'built' })
    const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as SourceStats
    assert.strictEqual(stats.chunksSent, false, 'no whole-file transfer through the bridge')
    assert.ok(stats.requests > 0, `read over the loopback server (${stats.requests} requests)`)
  })

  test('a shapefile and its sidecars are served by name', async function () {
    this.timeout(90000)
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', { wholeBytes: 0 })
    const s = await openReady('sample.shp', 'spatialExplorer.editor')
    assert.strictEqual(s.facts?.rows, 180)
    assert.strictEqual(s.facts?.crs.label, 'EPSG:4326 (WGS84)')
    const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as SourceStats
    assert.strictEqual(stats.chunksSent, false)
  })

  test('forced fallback: GeoJSON still opens, and says why (FR-015)', async function () {
    this.timeout(90000)
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', { wholeBytes: 0 })
    await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', true)
    try {
      const s = await openReady('parcels-10k.geojson')
      assert.strictEqual(s.facts?.rows, 10000)
      assert.match(s.facts?.fallback ?? '', /Partial reads aren't available in this window/)
    } finally {
      await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', false)
    }
  })
})

// T054 (US5): PMTiles opens with the default custom editor, view-only, drawn from its tiles.
suite('Spec 007 US5: PMTiles in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('sample.pmtiles opens in Spatial Explorer by default, read mode tiles, and renders', async function () {
    this.timeout(90000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    // `vscode.open` (not openWith): the custom editor's default priority is what picks the viewer.
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fixture('sample.pmtiles')))
    const deadline = Date.now() + 60000
    type TilesOpenState = { phase: string; facts: { readMode: string; tiles?: { minZoom: number; maxZoom: number; layers: string[] } } | null } | null
    let s: TilesOpenState = null
    for (;;) {
      s = (await vscode.commands.executeCommand('spatialExplorer._getOpenState')) as TilesOpenState
      if (s?.phase === 'ready' && s.facts?.readMode === 'tiles') break
      assert.ok(Date.now() < deadline, `sample.pmtiles did not open: ${JSON.stringify(s)}`)
      await sleep(200)
    }
    assert.deepStrictEqual(s?.facts?.tiles, { minZoom: 4, maxZoom: 10, layers: ['parcels-10k-nobbox'] })
    let rendered = 0
    for (let i = 0; i < 100 && rendered === 0; i++) {
      const load = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { renderedFeatureCount?: number | null } | null
      rendered = load?.renderedFeatureCount ?? 0
      if (rendered === 0) await sleep(300)
    }
    assert.ok(rendered > 0, `rendered ${rendered}`)
  })
})
