// Spec 010 phase 9 (T063): a query names other workspace files by their path
// relative to the workspace root (the fixtures folder in these tests), and the
// extension serves them to the engine (research.md S4: rewritten to /se-source/ws/).
import * as assert from 'assert'
import * as vscode from 'vscode'
import { openAndWait, run } from './query.test'

suite('Spec 010: SQL over workspace files', function () {
  this.timeout(120000)

  suiteTeardown(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'))

  suiteSetup(async () => {
    await openAndWait('sample.geojson')
  })

  test('ST_Read on a GeoPackage in the workspace', async () => {
    const s = await run("SELECT count(*) AS n FROM ST_Read('multi-layer.gpkg')")
    assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? s?.refusedReason ?? '')
    assert.strictEqual(s?.rowCount, 1)
  })

  test('a spatial join between the open layer and a Shapefile (with its sidecars)', async () => {
    const s = await run("SELECT a.* FROM layer a JOIN ST_Read('sample.shp') b ON ST_Intersects(a.geom, b.geom)")
    assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? s?.refusedReason ?? '')
    assert.ok((s?.rowCount ?? 0) > 0, 'the join matched features')
    assert.ok((s?.mappedCount ?? 0) > 0, 'the result is drawn')
  })

  test('read_parquet on a Parquet file', async () => {
    const s = await run("SELECT count(*) FROM read_parquet('sample.parquet')")
    assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? s?.refusedReason ?? '')
  })

  test('a missing file is a clear error, not an engine path', async () => {
    const s = await run("SELECT * FROM ST_Read('nope/missing.shp')")
    assert.notStrictEqual(s?.phase, 'succeeded')
    const message = s?.errorMessage ?? s?.refusedReason ?? ''
    assert.match(message, /missing\.shp/)
    assert.doesNotMatch(message, /se-source/)
  })

  test('a path outside the workspace is never served', async () => {
    const s = await run("SELECT * FROM ST_Read('../package.json')")
    assert.notStrictEqual(s?.phase, 'succeeded')
  })
})
