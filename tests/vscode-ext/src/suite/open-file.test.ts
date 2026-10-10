// T014 (specs/001-quick-look/tasks.md): opening a sample file via the real
// registered custom editor renders a map and a table with matching feature
// counts. Exercises the full real pipeline (customEditors -> message
// protocol -> HostAdapter -> openFile -> DuckDB-WASM -> ViewerLayout), not a
// spike — the webview's load outcome is observed via
// `spatialExplorer._getLoadState` (tests cannot inspect the webview's
// rendered DOM directly).
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type LoadState = { loadState: string; featureCount?: number; invalidGeometryCount?: number; errorMessage?: string } | null

async function waitForLoadState(deadlineMs: number): Promise<LoadState> {
  const deadline = Date.now() + deadlineMs
  let result: LoadState = null
  while (Date.now() < deadline) {
    result = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as LoadState
    if (result && result.loadState !== 'loading') break
    await sleep(500)
  }
  return result
}

suite('T014: open a file from VS Code', () => {
  test('opening a real GeoJSON file reaches ready with the expected feature count', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/world-boundaries.geojson'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'ready', `Expected loadState "ready", got "${result!.loadState}": ${result!.errorMessage ?? ''}`)
    console.log(`T014 world-boundaries.geojson: featureCount=${result!.featureCount}, invalidGeometryCount=${result!.invalidGeometryCount}`)
    const total = (result!.featureCount ?? 0) + (result!.invalidGeometryCount ?? 0)
    assert.strictEqual(total, 180, `Expected featureCount + invalidGeometryCount === 180, got ${total}`)
  })

  test('opening a non-GeoJSON format (FlatGeobuf) also reaches ready', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/sample.fgb'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'ready', `Expected loadState "ready", got "${result!.loadState}": ${result!.errorMessage ?? ''}`)
    console.log(`T014 sample.fgb: featureCount=${result!.featureCount}, invalidGeometryCount=${result!.invalidGeometryCount}`)
    const total = (result!.featureCount ?? 0) + (result!.invalidGeometryCount ?? 0)
    assert.strictEqual(total, 180, `Expected featureCount + invalidGeometryCount === 180, got ${total}`)
  })
})
