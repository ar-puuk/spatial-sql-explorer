// VS Code integration beyond opening a file:
// - T039-T041 / FR-009 / FR-017: the basemap matches the host theme on open
//   and follows a theme change while the viewer is open.
// - CLAUDE.md "VS Code integration": the "Open in Spatial Explorer" command
//   (explorer / editor-tab context menu) opens the viewer.
// - spec.md edge case: a file changed on disk is flagged, not silently shown
//   as current.
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

type ViewState = { basemapId: string; appearance: string; basemapNotice: string | null; sourceChanged: boolean } | null
type LoadState = { loadState: string; featureCount?: number; errorMessage?: string } | null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function poll<T>(get: () => Thenable<T> | T, done: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await get()
  while (!done(value) && Date.now() < deadline) {
    await sleep(300)
    value = await get()
  }
  return value
}

const viewState = (): Thenable<ViewState> => vscode.commands.executeCommand('spatialExplorer._getViewState')
const loadState = (): Thenable<LoadState> => vscode.commands.executeCommand('spatialExplorer._getLoadState')

async function setTheme(theme: string): Promise<void> {
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global)
}

suite('Host integration: theme-matched basemap, context command, file changes', () => {
  const originalTheme = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme')

  suiteTeardown(async () => {
    await setTheme(originalTheme ?? 'Default Dark Modern')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the basemap follows the host theme, including a change while open (FR-009, FR-017)', async function () {
    this.timeout(90000)
    // A fresh viewer: openWith on an already-open file only focuses it.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await setTheme('Default Dark Modern')
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.resolve(__dirname, '../../fixtures/sample.fgb')), 'spatialExplorer.editor')
    const ready = await poll(loadState, (s) => !!s && s.loadState !== 'loading', 45000)
    assert.strictEqual(ready?.loadState, 'ready', ready?.errorMessage ?? '')

    let state = await poll(viewState, (s) => s?.appearance === 'dark', 10000)
    assert.strictEqual(state?.basemapId, 'openfreemap-dark', `dark theme default, got ${JSON.stringify(state)}`)

    await setTheme('Default Light Modern')
    state = await poll(viewState, (s) => s?.appearance === 'light', 15000)
    assert.strictEqual(state?.appearance, 'light', 'the open viewer saw the theme change')
    assert.strictEqual(state?.basemapId, 'openfreemap-positron', `light theme default, got ${JSON.stringify(state)}`)

    await setTheme('Default High Contrast')
    state = await poll(viewState, (s) => s?.appearance === 'dark', 15000)
    assert.strictEqual(state?.basemapId, 'openfreemap-dark', 'high contrast (dark) uses the dark default')
  })

  test('"Open in Spatial Explorer" opens the file in the viewer', async function () {
    this.timeout(60000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('spatialExplorer.openInViewer', vscode.Uri.file(path.resolve(__dirname, '../../fixtures/sample.gpkg')))
    const state = await poll(loadState, (s) => !!s && s.loadState !== 'loading', 45000)
    assert.strictEqual(state?.loadState, 'ready', state?.errorMessage ?? '')
    assert.strictEqual(state?.featureCount, 179)
  })

  test('a file that changes on disk is flagged as changed', async function () {
    this.timeout(60000)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-watch-'))
    const file = path.join(dir, 'watched.csv')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/points.csv'), file)
    try {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const ready = await poll(loadState, (s) => !!s && s.loadState !== 'loading', 45000)
      assert.strictEqual(ready?.loadState, 'ready', ready?.errorMessage ?? '')
      let state = await viewState()
      assert.strictEqual(state?.sourceChanged, false)

      await sleep(500)
      fs.appendFileSync(file, 'Logan,-111.834892,41.736980\n')
      state = await poll(viewState, (s) => s?.sourceChanged === true, 20000)
      assert.strictEqual(state?.sourceChanged, true, 'the viewer was told the file changed on disk')
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
