// Spec 024: GTFS feeds in VS Code. A .zip opens with Open With; a folder of text files opens through
// "Open in Spatial Explorer" (on the folder, or on one of its tables). The extension host reads the
// geometry with GDAL (gdal3.js in a child process) and the webview queries the rest.
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { openAndWait, run } from './query.test'

const fixtures = path.resolve(__dirname, '../../fixtures')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 90000
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string; errorMessage?: string } | null
    if (s?.loadState === 'ready') return
    assert.ok(s?.loadState !== 'error', s?.errorMessage ?? 'load failed')
    assert.ok(Date.now() < deadline, `not ready: ${JSON.stringify(s)}`)
    await sleep(200)
  }
}

/** The open layer is the routes; the stops are their own table in the feed's schema. */
async function networkCounts(schema = 'gtfs_mini'): Promise<{ routes: number; stops: number }> {
  const routes = (await run('SELECT * FROM layer'))?.rowCount
  const stops = (await run(`SELECT * FROM ${schema}.stops`))?.rowCount
  return { routes: routes ?? -1, stops: stops ?? -1 }
}

suite('Spec 024: GTFS in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('a GTFS zip opens as two layers, routes (the open layer) and stops', async function () {
    this.timeout(180000)
    await openAndWait('gtfs-mini.zip', 'spatialExplorer.editorOption')
    assert.deepStrictEqual(await networkCounts(), { routes: 3, stops: 5 })
    // The feed's tables and its stops layer are queryable by name.
    assert.strictEqual((await run('SELECT * FROM gtfs_mini.stop_times'))?.rowCount, 8)
    assert.strictEqual((await run(`SELECT * FROM gtfs_mini.stops WHERE routes IS NULL`))?.rowCount, 1)
  })

  test('a folder of text files opens through "Open in Spatial Explorer", and so does one of its tables', async function () {
    this.timeout(180000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', vscode.Uri.file(path.join(fixtures, 'gtfs-mini')))
    await waitReady()
    assert.deepStrictEqual(await networkCounts(), { routes: 3, stops: 5 })
    // It is named after the folder.
    assert.strictEqual((await run('SELECT * FROM gtfs_mini.routes'))?.rowCount, 3)

    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', vscode.Uri.file(path.join(fixtures, 'gtfs-mini', 'routes.txt')))
    await waitReady()
    assert.deepStrictEqual(await networkCounts(), { routes: 3, stops: 5 })
  })

  test('a folder that is not a feed says so and opens nothing', async function () {
    this.timeout(60000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'se-notgtfs-'))
    fs.writeFileSync(path.join(folder, 'stops.txt'), 'a,b\n1,2\n')
    const before = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', vscode.Uri.file(folder))
    await sleep(1500)
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, before)
  })
})

suite('Spec 024: GTFS without the GDAL reader, in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', null)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the SQL fallback draws the same two layers', async function () {
    this.timeout(180000)
    await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', { noGdal: true })
    await openAndWait('gtfs-mini.zip', 'spatialExplorer.editorOption')
    assert.deepStrictEqual(await networkCounts(), { routes: 3, stops: 5 })
    assert.strictEqual((await run('SELECT * FROM gtfs_mini.routes WHERE ST_NPoints(geom) = 3'))?.rowCount, 1)
  })

  test('a feed with no shapes at all opens, with GDAL and without it', async function () {
    this.timeout(180000)
    for (const noGdal of [false, true]) {
      await vscode.commands.executeCommand('spatialExplorer._setTestOverrides', noGdal ? { noGdal: true } : null)
      await openAndWait('gtfs-noshapes.zip', 'spatialExplorer.editorOption')
      assert.deepStrictEqual(await networkCounts('gtfs_noshapes'), { routes: 3, stops: 5 }, `noGdal=${noGdal}`)
      assert.strictEqual((await run('SELECT * FROM gtfs_noshapes.routes WHERE ST_NPoints(geom) = 2'))?.rowCount, 3, `noGdal=${noGdal}`)
    }
  })
})
