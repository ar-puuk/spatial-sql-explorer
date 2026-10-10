// T005 spike (specs/001-quick-look/tasks.md): proves — or disproves — whether
// DuckDB-WASM's worker can be instantiated inside a real VS Code custom
// editor webview via webview.asWebviewUri(), given ../omx-viewer's documented
// finding that `new Worker(new URL(..., import.meta.url))` throws
// synchronously in a webview due to an origin mismatch.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

suite('T005: DuckDB-WASM worker bootstrap spike', () => {
  test('instantiates DuckDB-WASM and runs a query inside the webview', async function () {
    this.timeout(90000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/sample.geojson'))

    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    let result: { ok: boolean; stage: string; detail?: string } | null = null
    const deadline = Date.now() + 55000
    while (Date.now() < deadline) {
      result = (await vscode.commands.executeCommand('spatialExplorer._getSpikeResult')) as typeof result
      if (result) break
      await sleep(500)
    }

    if (result === null) {
      assert.fail('Expected a spikeResult message from the webview within 55s, got none.')
      return
    }
    const finalResult: { ok: boolean; stage: string; detail?: string } = result
    if (!finalResult.ok) {
      assert.fail(`Worker bootstrap spike FAILED at stage "${finalResult.stage}": ${finalResult.detail}`)
    }
    console.log(`T005 SPIKE RESULT: OK — ${finalResult.detail}`)
  })
})
