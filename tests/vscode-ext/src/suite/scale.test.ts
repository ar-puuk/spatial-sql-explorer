// T060 (spec 007 Polish): the scale criteria in VS Code, on the large local
// files (`npm run large-data`). Gated on SE_LARGE_DATA=1 so the normal suite
// never needs gigabytes of test data. Results are logged as SCALE lines and
// recorded in quickstart.md.
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const large = (name: string): string => path.resolve(__dirname, '../../../.large-data', name)
const enabled = process.env.SE_LARGE_DATA === '1'

interface OpenState {
  phase: string
  facts: { rows: number } | null
}
const openState = (): Thenable<OpenState | null> => vscode.commands.executeCommand('spatialExplorer._getOpenState')

async function until<T>(read: () => Thenable<T> | Promise<T>, ok: (v: T) => boolean, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await read()
    if (ok(v)) return v
    assert.ok(Date.now() < deadline, `${what}: ${JSON.stringify(v)}`)
    await sleep(100)
  }
}

suite('Spec 007 scale in VS Code (SE_LARGE_DATA=1)', function () {
  suiteSetup(function () {
    if (!enabled || !fs.existsSync(large('parcels-6m.parquet'))) this.skip()
  })
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', null)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('SC-001: 1.1 GB GeoParquet: facts, overview, and bytes read over the loopback server', async function () {
    this.timeout(180000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const t0 = Date.now()
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(large('parcels-6m.parquet')), 'spatialExplorer.editorOption')
    await until(openState, (s) => s?.facts?.rows === 6_000_000, 60000, 'facts')
    const factsMs = Date.now() - t0
    // Spec 010: 6M rows are drawn from engine tiles; the overview is there once the first tiles are built.
    await until(
      () => vscode.commands.executeCommand('spatialExplorer._getMapView') as Thenable<{ mode: string; drawCalls: number } | null>,
      (v) => v?.mode === 'tiles' && v.drawCalls > 0,
      120000,
      'overview'
    )
    const overviewMs = Date.now() - t0
    const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as { bytes: number; requests: number; size: number }
    console.log(`SCALE vscode sc001 ${JSON.stringify({ factsMs, overviewMs, servedMB: Math.round(stats.bytes / 1e6), requests: stats.requests, sizeMB: Math.round(stats.size / 1e6) })}`)
    assert.ok(factsMs <= 5000, `facts ${factsMs} ms`)
    assert.ok(overviewMs <= 10000, `overview ${overviewMs} ms`)
    // Not a whole-file read (spec 007 measured 676 MB of 1,139 MB for its thinned overview; spec 010 reads tiles).
    assert.ok(stats.bytes < stats.size, `served ${stats.bytes} of ${stats.size} bytes`)
  })

  test('SC-001: 1.45 GB FlatGeobuf: facts and overview from the index', async function () {
    this.timeout(180000)
    if (!fs.existsSync(large('parcels-4m.fgb'))) this.skip()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const t0 = Date.now()
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(large('parcels-4m.fgb')), 'spatialExplorer.editor')
    await until(openState, (s) => s?.facts?.rows === 4_000_000, 60000, 'facts')
    const factsMs = Date.now() - t0
    await until(
      () => vscode.commands.executeCommand('spatialExplorer._getMapView') as Thenable<{ drawn: number } | null>,
      (v) => (v?.drawn ?? 0) > 0,
      120000,
      'overview'
    )
    const overviewMs = Date.now() - t0
    console.log(`SCALE vscode sc001-fgb ${JSON.stringify({ factsMs, overviewMs })}`)
    assert.ok(factsMs <= 5000, `facts ${factsMs} ms`)
    assert.ok(overviewMs <= 10000, `overview ${overviewMs} ms`)
  })

  test('SC-005: Cancel during a 325 MB GeoJSON parse ends within 3 s', async function () {
    this.timeout(180000)
    if (!fs.existsSync(large('parcels-460k.geojson'))) this.skip()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', { wholeThreshold: 2_000_000_000 })
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(large('parcels-460k.geojson')), 'spatialExplorer.editorOption')
    await until(openState, (s) => s?.phase === 'reading', 60000, 'reading')
    await sleep(3000)
    const t0 = Date.now()
    await vscode.commands.executeCommand('spatialExplorer._cancelOpen')
    await until(openState, (s) => s?.phase === 'cancelled' || s?.phase === 'idle', 10000, 'cancelled')
    const cancelMs = Date.now() - t0
    console.log(`SCALE vscode sc005 ${JSON.stringify({ cancelMs })}`)
    assert.ok(cancelMs < 3000, `cancel took ${cancelMs} ms`)
  })
})
