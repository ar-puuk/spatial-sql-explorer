// T015 (specs/001-quick-look/tasks.md): selecting a feature propagates
// through ViewerSession.selectedFeatureId — the shared state both MapView
// and AttributeTable render from (FR-005). @vscode/test-electron cannot
// click inside this webview's rendered DOM, so this exercises the same
// onSelectFeature path a real map/table click invokes
// (`spatialExplorer._testSelectFeature`, see hostAdapter.ts/main.ts) and
// confirms the resulting selection is observable — i.e. the real data flow
// both components share, not actual mouse interaction.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForLoadState(deadlineMs: number): Promise<{ loadState: string } | null> {
  const deadline = Date.now() + deadlineMs
  let result: { loadState: string } | null = null
  while (Date.now() < deadline) {
    const latest = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
    result = latest
    if (latest !== null && latest.loadState !== 'loading') break
    await sleep(500)
  }
  return result
}

suite('T015: map <-> table selection sync', () => {
  test('selecting a feature updates the shared ViewerSession.selectedFeatureId', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/world-boundaries.geojson'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const loadResult = await waitForLoadState(45000)
    if (loadResult === null) {
      assert.fail('Expected the file to finish loading before testing selection, got no loadStateChanged message.')
      return
    }
    const finalLoadResult: { loadState: string } = loadResult
    assert.strictEqual(finalLoadResult.loadState, 'ready', 'Expected the file to finish loading before testing selection.')

    await vscode.commands.executeCommand('spatialExplorer._testSelectFeature', 3)

    let selection: unknown = undefined
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      selection = await vscode.commands.executeCommand('spatialExplorer._getSelection')
      if (selection !== null) break
      await sleep(300)
    }

    assert.strictEqual(selection, 3, `Expected selectedFeatureId to become 3, got ${JSON.stringify(selection)}`)
  })
})
