// T016 (specs/001-quick-look/tasks.md): opening an unsupported/corrupt file
// shows a specific error message with no broken viewer state (FR-011).
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type LoadState = { loadState: string; errorMessage?: string } | null

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

suite('T016: opening an unsupported/corrupt file', () => {
  test('a corrupt GeoJSON file reaches a specific error state, not a crash', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/corrupt.geojson'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'error', `Expected loadState "error", got "${result!.loadState}"`)
    assert.ok(result!.errorMessage && result!.errorMessage.length > 0, 'Expected a specific, non-empty error message.')
  })
})
