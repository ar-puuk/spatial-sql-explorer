// T017 (specs/001-quick-look/tasks.md): two edge cases — (a) a zero-feature
// file reaches loadState 'ready' (not 'error') with featureCount 0 (FR-012),
// and (b) a file with genuinely mixed base geometry types (Point +
// LineString + Polygon in one layer, not just Polygon/MultiPolygon which
// share a base category) loads every feature (FR-013).
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

suite('T017: open-file edge cases', () => {
  test('(a) a zero-feature file reaches ready, not error, with featureCount 0 (FR-012)', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/zero-features.geojson'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'ready', `Expected loadState "ready" for a zero-feature file, got "${result!.loadState}": ${result!.errorMessage ?? ''}`)
    assert.strictEqual(result!.featureCount, 0, `Expected featureCount 0, got ${result!.featureCount}`)
  })

  test('(b) a file with mixed Point/LineString/Polygon geometry loads every feature (FR-013)', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/mixed-geometry.geojson'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'ready', `Expected loadState "ready", got "${result!.loadState}": ${result!.errorMessage ?? ''}`)
    assert.strictEqual(result!.featureCount, 3, `Expected all 3 mixed-geometry features to load, got ${result!.featureCount}`)
  })
})
