// T040 (spec 008 US3): files with several layers in VS Code, and the
// File Geodatabase folder command.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'
import { openAndWait } from './query.test'

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

  test('a .gdb folder gets the "not supported" message with a conversion hint', async function () {
    this.timeout(30000)
    const gdb = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/two.gdb'))
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', gdb)
    const message = (await vscode.commands.executeCommand('spatialExplorer._getGdbMessage')) as string | null
    assert.match(message ?? '', /File Geodatabase \(\.gdb\) isn't supported yet/)
    assert.match(message ?? '', /ogr2ogr -f GPKG/)
  })
})
