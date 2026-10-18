// T040 (spec 008 US3): files with several layers in VS Code, and the
// File Geodatabase folder command.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'
import { openAndWait, run } from './query.test'

interface TableState {
  layers: Array<{ name: string; geometryType: string | null; featureCount: number | null }>
  activeLayer: string | null
  rowCount: number | null
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const state = (): Thenable<TableState | null> => vscode.commands.executeCommand('spatialExplorer._getTableState')

async function waitFor(until: (s: TableState) => boolean, what: string): Promise<TableState> {
  const deadline = Date.now() + 30000
  for (;;) {
    const s = await state()
    if (s && until(s)) return s
    assert.ok(Date.now() < deadline, `${what}: ${JSON.stringify(s)}`)
    await sleep(150)
  }
}

suite('Spec 008 US3: layers in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('a three-layer GeoPackage lists its layers and switches between them', async function () {
    this.timeout(90000)
    await openAndWait('three-layers.gpkg', 'spatialExplorer.editor')
    const s = await waitFor((x) => x.layers.length === 3, 'layers not listed')
    assert.deepStrictEqual(
      s.layers.map((l) => [l.name, l.geometryType, l.featureCount]),
      [
        ['countries', s.layers[0].geometryType, 180],
        ['city points', 'Point', 3],
        ['lookup_table', null, 3],
      ]
    )
    assert.strictEqual(s.activeLayer, 'countries')
    await vscode.commands.executeCommand('spatialExplorer._switchLayer', 'city points')
    const after = await waitFor((x) => x.activeLayer === 'city points' && x.rowCount === 3, 'did not switch')
    assert.strictEqual(after.layers.length, 3)
  })

  // Research §16: a layer whose feature ids don't run 1..N failed with "thread constructor failed".
  test('a GeoPackage layer with ids that do not start at 1 opens, with its fid', async function () {
    this.timeout(90000)
    await openAndWait('gapped-ids.gpkg', 'spatialExplorer.editor')
    const s = await waitFor((x) => x.layers.length === 3 && x.rowCount === 12, 'zones did not open')
    assert.strictEqual(s.activeLayer, 'zones')
    assert.strictEqual((await run('SELECT * FROM layer WHERE fid BETWEEN 101 AND 123'))?.rowCount, 12)
    assert.strictEqual((await run('SELECT * FROM gapped_ids.notes WHERE fid IN (7, 9, 11)'))?.rowCount, 3)
  })

  test('a SQLite network (Cube 7 shape) opens with its node numbers and tables', async function () {
    this.timeout(90000)
    await openAndWait('cube-network.sqlite', 'spatialExplorer.editorOption')
    const s = await waitFor((x) => x.layers.length === 3 && x.rowCount === 8, 'nodes did not open')
    assert.deepStrictEqual(
      s.layers.map((l) => [l.name, l.geometryType, l.featureCount]),
      [
        ['cubedb__BY__node', 'Point', 8],
        ['cubedb__BY__link', 'LineString', 8],
        ['cubedb__BY__transit_mode', null, 3],
      ]
    )
    assert.strictEqual((await run('SELECT * FROM layer WHERE n IN (10, 105, 106)'))?.rowCount, 3)
    assert.strictEqual((await run('SELECT l.* FROM cube_network.cubedb__by__link l JOIN layer f ON f.n = l.a'))?.rowCount, 8)
  })

  // Spec 013: File Geodatabases. The folder cannot be a custom editor's document, so the command opens a table
  // file inside it; a .gdb.zip opens by Open With. The reader (gdal3.js, in a child process of the extension host)
  // is downloaded from jsDelivr the first time, like the SQL engine.
  async function waitReady(what: string): Promise<void> {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string; errorMessage?: string; rowCount?: number } | null
      if (s && s.loadState !== 'loading') {
        assert.strictEqual(s.loadState, 'ready', s.errorMessage ?? what)
        return
      }
      await sleep(200)
    }
    assert.fail(`${what} did not load`)
  }

  test('a .gdb folder opens through "Open in Spatial Explorer": its layers are listed and queryable by name', async function () {
    this.timeout(180000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', vscode.Uri.file(path.resolve(__dirname, '../../fixtures/network.gdb')))
    await waitReady('the geodatabase')
    const s = await waitFor((x) => x.layers.length === 3, 'geodatabase layers not listed')
    assert.deepStrictEqual(
      s.layers.map((l) => [l.name, l.geometryType, l.featureCount]),
      [
        ['roads', 'LineString', 6],
        ['nodes', 'Point', 5],
        ['codes', null, 3],
      ]
    )
    assert.strictEqual(s.activeLayer, 'roads')
    assert.strictEqual(s.rowCount, 6)
    // Every layer is a table in the geodatabase's schema; a layer not read yet is read by the statement that names it.
    assert.strictEqual((await run('SELECT count(*) AS n FROM network.nodes'))?.rowCount, 1)
    assert.strictEqual((await run('SELECT * FROM network.codes'))?.rowCount, 3)
    // Descriptions are display only: SQL sees the stored code.
    const classes = await run('SELECT DISTINCT class FROM network.roads ORDER BY class')
    assert.strictEqual(classes?.rowCount, 3)
  })

  test('switching layers in a geodatabase', async function () {
    this.timeout(120000)
    await vscode.commands.executeCommand('spatialExplorer._switchLayer', 'nodes')
    const s = await waitFor((x) => x.activeLayer === 'nodes' && x.rowCount === 5, 'nodes not shown')
    assert.strictEqual(s.rowCount, 5)
  })

  test('a .gdb.zip opens with Open With, and a file inside the folder opens the whole geodatabase', async function () {
    this.timeout(180000)
    await openAndWait('network.gdb.zip', 'spatialExplorer.editorOption')
    const s = await waitFor((x) => x.layers.length === 3, 'geodatabase layers not listed')
    assert.strictEqual(s.rowCount, 6)
    await openAndWait('network.gdb/a00000001.gdbtable', 'spatialExplorer.editorOption')
    const again = await waitFor((x) => x.layers.length === 3, 'geodatabase layers not listed')
    assert.strictEqual(again.activeLayer, 'roads')
  })

  test('zipped data opens like the file inside it', async function () {
    this.timeout(120000)
    await openAndWait('roads.shp.zip', 'spatialExplorer.editorOption')
    const rows = await run('SELECT count(*) AS n FROM roads')
    assert.strictEqual(rows?.rowCount, 1)
    await openAndWait('multi-layer.gpkg.zip', 'spatialExplorer.editorOption')
    const g = await waitFor((x) => x.layers.length > 1, 'zipped GeoPackage layers not listed')
    assert.ok(g.layers.length > 1)
  })

  test('another geodatabase (two.gdb, made by another tool) opens too', async function () {
    this.timeout(120000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', vscode.Uri.file(path.resolve(__dirname, '../../fixtures/two.gdb')))
    await waitReady('two.gdb')
    const s = await waitFor((x) => x.layers.length === 2, 'two.gdb layers not listed')
    assert.deepStrictEqual(s.layers.map((l) => l.name).sort(), ['cities', 'countries'])
  })

  test('the geodatabase cache can be cleared', async function () {
    this.timeout(30000)
    await vscode.commands.executeCommand('spatialExplorer.clearGdbCache')
  })
})
