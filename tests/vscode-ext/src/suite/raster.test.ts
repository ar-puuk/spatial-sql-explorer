// Spec 026: a GeoTIFF or COG opens in VS Code through the real custom editor (the default editor for .tif and .tiff),
// is read over the loopback range server, and is drawn. The raster engine (two wasm files, a third only for a striped
// file) is downloaded once from its pinned URL, hash-checked and kept by hash. Fixtures: scripts/fixtures-026.mjs.
// The webview is observed through `spatialExplorer._getLoadState` (its `raster` summary) like the other open tests.
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const fixture = (name: string): string => path.resolve(__dirname, '../../fixtures/raster', name)

interface LoadState {
  loadState: string
  errorMessage?: string
  featureCount?: number
  sourceCrsLabel?: string
  mapCanvasRect?: { width: number; height: number } | null
  raster?: { width: number; height: number; bands: number; dataType: string; epsg: number | null; origin: string; ready: boolean } | null
}
interface SourceStats {
  bytes: number
  requests: number
  size: number
  chunksSent: boolean
}
const engine = () => vscode.commands.executeCommand('spatialExplorer._getEngineDownloads') as Thenable<{ dir: string; downloaded: string[] }>

async function openAndWait(file: string, viewType = 'spatialExplorer.editor'): Promise<LoadState> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), viewType)
  const deadline = Date.now() + 120000
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as LoadState | null
    // `ready` and `error` are final; a raster summary means this editor has reported (the report of the editor closed just before is replaced).
    if (s && (s.loadState === 'error' || s.raster || s.loadState === 'ready')) return s
    assert.ok(Date.now() < deadline, `${path.basename(file)} did not report a load state`)
    await sleep(250)
  }
}

suite('Spec 026: raster view in VS Code', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'spatial-explorer')
    assert.ok(ext, 'extension not found')
    await ext.activate()
  })
  teardown(async () => {
    await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', false)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('.tif and .tiff are claimed by the default editor (VS Code\'s Image Preview does not claim them)', () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'spatial-explorer')!
    const editors = ext.packageJSON.contributes.customEditors as Array<{ viewType: string; priority: string; selector: Array<{ filenamePattern: string }> }>
    const main = editors.find((e) => e.viewType === 'spatialExplorer.editor')!
    assert.strictEqual(main.priority, 'default')
    const patterns = main.selector.map((s) => s.filenamePattern)
    assert.ok(patterns.includes('*.tif') && patterns.includes('*.tiff'), patterns.join(', '))
  })

  test('a float DEM opens as a raster: facts, a drawn map, only parts of the file read', async function () {
    this.timeout(150000)
    const s = await openAndWait(fixture('dem-utm12.tif'))
    assert.strictEqual(s.loadState, 'ready', s.errorMessage ?? '')
    assert.ok(s.raster, 'the webview reports a raster')
    assert.deepStrictEqual({ w: s.raster!.width, h: s.raster!.height, bands: s.raster!.bands, type: s.raster!.dataType, epsg: s.raster!.epsg, origin: s.raster!.origin }, { w: 428, h: 450, bands: 1, type: 'float32', epsg: 32612, origin: 'file' })
    assert.strictEqual(s.raster!.ready, true, 'its tiles in view are drawn')
    assert.ok(s.mapCanvasRect && s.mapCanvasRect.width > 50 && s.mapCanvasRect.height > 50, 'the map has a size')
    assert.match(s.sourceCrsLabel ?? '', /EPSG:32612/)
    const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as SourceStats
    assert.strictEqual(stats.chunksSent, false, 'no whole-file transfer through the bridge')
    assert.ok(stats.requests > 0, `read over the loopback server (${stats.requests} requests)`)
    assert.strictEqual(stats.size, fs.statSync(fixture('dem-utm12.tif')).size)
  })

  test('a colour image opens, from the default editor too', async function () {
    this.timeout(150000)
    const s = await openAndWait(fixture('ortho-rgb.tif'))
    assert.strictEqual(s.loadState, 'ready', s.errorMessage ?? '')
    assert.deepStrictEqual({ bands: s.raster?.bands, type: s.raster?.dataType, ready: s.raster?.ready }, { bands: 3, type: 'uint8', ready: true })
  })

  test('the raster engine is kept by hash, and the converter is only fetched for a striped file', async function () {
    this.timeout(240000)
    await openAndWait(fixture('dem-utm12.tif'))
    const { dir } = await engine()
    const kept = () => fs.readdirSync(dir).filter((f) => !f.endsWith('.part'))
    for (const name of ['whitebox_wasm_bg.wasm', 'cog_tiler_wasm_bg.wasm']) assert.ok(kept().some((f) => /^[0-9a-f]{64}-/.test(f) && f.endsWith(`-${name}`)), `${name} is kept (${kept().join(', ')})`)
    const before = (await engine()).downloaded.length
    await openAndWait(fixture('ortho-rgb.tif'))
    assert.strictEqual((await engine()).downloaded.length, before, 'a second raster downloads nothing')
    // A striped file brings the converter, once.
    const s = await openAndWait(fixture('striped.tif'))
    assert.strictEqual(s.loadState, 'ready', s.errorMessage ?? '')
    assert.strictEqual(s.raster?.origin, 'converted')
    assert.ok(kept().some((f) => /^[0-9a-f]{64}-/.test(f) && f.endsWith('-geolibre_wasm_bg.wasm')), 'the converter is kept')
  })

  test('a file with no georeferencing says so in plain words', async function () {
    this.timeout(150000)
    const s = await openAndWait(fixture('not-georeferenced.tif'))
    assert.strictEqual(s.loadState, 'error')
    assert.match(s.errorMessage ?? '', /not-georeferenced\.tif has no georeferencing, so it cannot be placed on the map\./)
  })

  test('a raster is never read whole: when the window cannot read in parts, the open is refused with the reason', async function () {
    this.timeout(150000)
    await vscode.commands.executeCommand('spatialExplorer._forceBytesFallback', true)
    const s = await openAndWait(fixture('dem-utm12.tif'))
    assert.strictEqual(s.loadState, 'error')
    assert.match(s.errorMessage ?? '', /cannot be read in parts here \(forced by a test\).*too large to read whole/)
    const stats = (await vscode.commands.executeCommand('spatialExplorer._getSourceStats')) as SourceStats | null
    assert.ok(!stats || stats.chunksSent === false, 'the file was not sent whole')
  })
})
