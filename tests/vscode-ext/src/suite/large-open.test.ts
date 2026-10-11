// Spec 007 (large files) in the VS Code extension. T019: US1 (facts first,
// read in parts over the loopback server, the FR-015 fallback, parity with
// the web build). Later tasks add views, queries, whole-read formats and PMTiles.
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
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
