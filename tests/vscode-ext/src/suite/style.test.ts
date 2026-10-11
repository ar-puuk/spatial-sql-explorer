// Spec 003 (thematic styling) in the VS Code extension, through the
// _setStyle / _getStyleState / _saveStyle test hooks (T013).
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { openAndWait } from './query.test'

interface StyleState {
  renderer: string
  column?: string
  method?: string
  status: string
  reason?: string
  caption: string
  dirty: boolean
  source: string | null
  classes: Array<{ key: string; label: string; color: string; visible: boolean; count: number }>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const styleState = (): Thenable<StyleState | null> => vscode.commands.executeCommand('spatialExplorer._getStyleState')

export const BASE_SYMBOL = { fillColor: '#3b82f6', fillOpacity: 0.45, strokeColor: '#1d4ed8', strokeOpacity: 1, strokeWidth: 1.5, pointRadius: 5 }

/** Applies a style and waits until the webview reports it resolved. */
export async function applyStyle(style: object, until: (s: StyleState) => boolean): Promise<StyleState> {
  await vscode.commands.executeCommand('spatialExplorer._setStyle', style)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const s = await styleState()
    if (s && until(s)) return s
    await sleep(100)
  }
  assert.fail(`style was not applied: ${JSON.stringify(await styleState())}`)
}

const WORLD_TOP_12 = ['Afghanistan', 'Albania', 'Algeria', 'Angola', 'Antarctica', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bangladesh', 'Belarus']

suite('Spec 003 US1: categorized styling in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the default style reports one single-symbol class', async function () {
    this.timeout(60000)
    await openAndWait('world-boundaries.geojson', 'spatialExplorer.editorOption')
    const s = await styleState()
    assert.strictEqual(s?.renderer, 'single')
    assert.strictEqual(s?.classes.length, 1)
    assert.strictEqual(s?.classes[0].count, 180)
  })

  test('categorized classes and counts match the web build (FR-020)', async function () {
    this.timeout(60000)
    await openAndWait('world-boundaries.geojson', 'spatialExplorer.editorOption')
    const s = await applyStyle(
      { ...BASE_SYMBOL, renderer: { kind: 'categorized', column: 'name', ramp: { id: 'brewer-paired', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {} } },
      (x) => x.renderer === 'categorized'
    )
    assert.strictEqual(s.status, 'ok')
    assert.strictEqual(s.caption, 'name · 12 categories')
    assert.deepStrictEqual(
      s.classes.map((c) => c.label),
      [...WORLD_TOP_12, 'Other (168 values)']
    )
    assert.deepStrictEqual(
      s.classes.map((c) => c.count),
      [...Array(12).fill(1), 168]
    )
    assert.strictEqual(s.classes[0].color, '#a6cee3')
    assert.strictEqual(s.dirty, true)
  })
})

/** The same 100 points (value = i²) as the web suite's writeSquares(). */
function writeSquares(): string {
  const features = Array.from({ length: 100 }, (_, i) => `{"type":"Feature","properties":{"value":${i * i}},"geometry":{"type":"Point","coordinates":[${(-112 + i * 0.01).toFixed(2)},40.5]}}`)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-sq-')), 'squares.geojson')
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[${features.join(',')}]}`)
  return file
}

suite('Spec 003 US2: graduated styling in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('quantile classes and counts match the web build (FR-020)', async function () {
    this.timeout(60000)
    const file = writeSquares()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
    const deadline = Date.now() + 45000
    for (;;) {
      const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
      if (s?.loadState === 'ready') break
      assert.ok(Date.now() < deadline, 'squares.geojson did not load')
      await sleep(200)
    }
    const s = await applyStyle(
      { ...BASE_SYMBOL, renderer: { kind: 'graduated', column: 'value', method: 'quantile', classCount: 5, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} } },
      (x) => x.renderer === 'graduated'
    )
    assert.strictEqual(s.caption, 'value · Quantile, 5 classes')
    assert.deepStrictEqual(
      s.classes.map((c) => c.label),
      ['0 – 392', '392 – 1,568', '1,568 – 3,529', '3,529 – 6,273', '6,273 – 9,801']
    )
    assert.deepStrictEqual(
      s.classes.map((c) => c.count),
      [20, 20, 20, 20, 20]
    )
    assert.strictEqual(s.classes[0].color, '#440154')
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  })
})
