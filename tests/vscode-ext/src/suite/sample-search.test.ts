// T088 (spec 008 US8, FR-032/FR-033): the bundled sample opens with no
// workspace file, and the place search follows its setting.
import * as assert from 'assert'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const tableState = () => vscode.commands.executeCommand('spatialExplorer._getTableState') as Thenable<{ rowCount: number | null; placeSearch: boolean } | null>

async function until<T>(read: () => Thenable<T> | Promise<T>, ok: (v: T) => boolean, what: string, ms = 45000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await read()
    if (ok(v)) return v
    assert.ok(Date.now() < deadline, `${what}: ${JSON.stringify(v)}`)
    await sleep(200)
  }
}

suite('Spec 008 US8: sample data and place search in VS Code', () => {
  test('Open Sample Data opens the US counties in the custom editor; place search follows its setting', async function () {
    this.timeout(120000)
    const config = vscode.workspace.getConfiguration('spatialExplorer')
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand('spatialExplorer.openSample')
      await until(() => vscode.commands.executeCommand('spatialExplorer._getLoadState') as Thenable<{ loadState: string } | null>, (s) => s?.loadState === 'ready', 'sample did not load')
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      assert.ok(tab?.input instanceof vscode.TabInputCustom, 'a custom editor tab')
      const input = tab.input as vscode.TabInputCustom
      assert.strictEqual(input.viewType, 'spatialExplorer.editorOption')
      assert.match(input.uri.path, /us-counties\.parquet$/)
      await until(tableState, (s) => s?.rowCount === 3222 && s.placeSearch === true, 'sample rows and place search on')

      await config.update('placeSearch.enabled', false, vscode.ConfigurationTarget.Global)
      await until(tableState, (s) => s?.placeSearch === false, 'place search turned off')
      await config.update('placeSearch.enabled', true, vscode.ConfigurationTarget.Global)
      await until(tableState, (s) => s?.placeSearch === true, 'place search turned on again')
    } finally {
      await config.update('placeSearch.enabled', undefined, vscode.ConfigurationTarget.Global)
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    }
  })
})
