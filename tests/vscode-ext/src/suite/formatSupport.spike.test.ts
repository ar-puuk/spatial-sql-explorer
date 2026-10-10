// T006 spike (specs/001-quick-look/tasks.md): confirms, per format, whether
// the real DuckDB-WASM spatial extension can read it, against the actual
// WASM build this project ships, rather than assuming from documentation
// (Constitution Principle VI, Verified Claims). Depends on T005's fix
// (apps/vscode-ext/src/webview/main.ts) already being in place.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

type FormatResult = { label: string; ok: boolean; detail: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

suite('T006: DuckDB-WASM spatial format support spike', () => {
  test('LOAD spatial + ST_Drivers() + per-format ST_Read round trips', async function () {
    this.timeout(90000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/sample.geojson'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    let summary: FormatResult[] | null = null
    const deadline = Date.now() + 75000
    while (Date.now() < deadline) {
      summary = (await vscode.commands.executeCommand('spatialExplorer._getFormatSummary')) as typeof summary
      if (summary) break
      await sleep(500)
    }

    if (summary === null) {
      assert.fail('Expected a formatSummary message from the webview within 75s, got none.')
      return
    }
    const finalSummary: FormatResult[] = summary

    console.log('\n--- T006 FORMAT SUPPORT RESULTS ---')
    for (const r of finalSummary) {
      console.log(`[${r.ok ? 'OK  ' : 'FAIL'}] ${r.label}: ${r.detail}`)
    }
    console.log('--- END T006 RESULTS ---\n')

    const loadResult = finalSummary.find((r) => r.label === 'spatial extension LOAD')
    assert.ok(loadResult && loadResult.ok, 'Expected the spatial extension to load successfully.')
  })
})
