// Spec 008 research §15: the extension host keeps a local copy of the SQL
// engine (downloaded once from the pinned URLs, hash-checked), so later
// starts don't download, and a damaged copy is replaced.
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const engine = () => vscode.commands.executeCommand('spatialExplorer._getEngineDownloads') as Thenable<{ dir: string; downloaded: string[] }>
const FIXTURE = path.resolve(__dirname, '../../fixtures/sample.geojson')

async function openAndWaitReady(file: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
  const deadline = Date.now() + 90000
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
    if (s?.loadState === 'ready') return
    assert.ok(Date.now() < deadline, `${path.basename(file)} did not load`)
    await sleep(200)
  }
}

suite('Spec 008: the engine’s local copy in VS Code', () => {
  test('the engine files are kept by hash; opening again downloads nothing', async function () {
    this.timeout(180000)
    await openAndWaitReady(FIXTURE)
    const { dir, downloaded } = await engine()
    const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.part')).sort()
    for (const name of ['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm', 'spatial.duckdb_extension.wasm', 'parquet.duckdb_extension.wasm', 'json.duckdb_extension.wasm', 'excel.duckdb_extension.wasm', 'sqlite_scanner.duckdb_extension.wasm', 'fts.duckdb_extension.wasm', 'h3.duckdb_extension.wasm', 'a5.duckdb_extension.wasm']) {
      assert.ok(files.some((f) => /^[0-9a-f]{64}-/.test(f) && f.endsWith(`-${name}`)), `${name} is kept (${files.join(', ')})`)
    }
    const before = downloaded.length
    await openAndWaitReady(FIXTURE)
    assert.strictEqual((await engine()).downloaded.length, before, 'a second open downloads nothing')
  })

  test('a damaged local copy is downloaded again', async function () {
    this.timeout(180000)
    await openAndWaitReady(FIXTURE)
    const { dir } = await engine()
    const wasm = fs.readdirSync(dir).find((f) => f.endsWith('-duckdb-eh.wasm'))!
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    fs.writeFileSync(path.join(dir, wasm), 'damaged')
    const before = (await engine()).downloaded.length
    await openAndWaitReady(FIXTURE)
    const after = await engine()
    assert.deepStrictEqual(after.downloaded.slice(before), ['duckdb-eh.wasm'])
    assert.ok(fs.statSync(path.join(dir, wasm)).size > 30_000_000, 'the copy is whole again')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})
