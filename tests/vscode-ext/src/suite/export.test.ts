// Spec 005 (export) in the VS Code extension, through the _runExport /
// _getExportState / _saveNextExportTo test hooks.
import * as assert from 'assert'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const sha = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export interface ExportState {
  open: boolean
  phase: string
  disabled: string | null
  plan: { format: string; rowCount: number; displayLimited: { shown: number; total: number } | null; formats: string[]; crs: string; notices: string[] } | null
  outcome: { kind: string; rows?: number; bytes?: number; location?: string; message?: string; notices?: string[] } | null
}
const exportState = (): Thenable<ExportState | null> => vscode.commands.executeCommand('spatialExplorer._getExportState')

/** Opens a copy of a fixture in a temp dir (exports go next to it). */
export async function openCopy(fixture: string, viewType = 'spatialExplorer.editorOption'): Promise<{ dir: string; file: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-export-'))
  const file = path.join(dir, fixture)
  fs.copyFileSync(path.resolve(__dirname, '../../fixtures', fixture), file)
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), viewType)
  const deadline = Date.now() + 45000
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
    if (s?.loadState === 'ready') break
    assert.ok(Date.now() < deadline, `${fixture} did not load`)
    await sleep(200)
  }
  return { dir, file }
}

/** Runs an export to `target` and waits for a terminal phase. */
export async function runExport(request: object, target: string): Promise<ExportState> {
  await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', target)
  await vscode.commands.executeCommand('spatialExplorer._runExport', request)
  const deadline = Date.now() + 60000
  await sleep(200)
  for (;;) {
    const s = await exportState()
    if (s && s.phase !== 'running' && s.outcome) return s
    assert.ok(Date.now() < deadline, `export did not finish: ${JSON.stringify(s)}`)
    await sleep(150)
  }
}

suite('Spec 005 US1: export in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('GeoParquet and GeoJSON are saved next to the source; the source is unchanged', async function () {
    this.timeout(120000)
    const { dir, file } = await openCopy('world-boundaries.geojson')
    const before = sha(file)
    try {
      const parquet = path.join(dir, 'world-boundaries-export.parquet')
      const s1 = await runExport({ format: 'geoparquet', rows: 'all', crs: 'result' }, parquet)
      assert.strictEqual(s1.outcome?.kind, 'saved', JSON.stringify(s1.outcome))
      assert.strictEqual(s1.outcome?.rows, 180)
      assert.strictEqual(fs.readFileSync(parquet).subarray(0, 4).toString('latin1'), 'PAR1')
      assert.strictEqual(fs.statSync(parquet).size, s1.outcome?.bytes)

      const geojson = path.join(dir, 'world-boundaries-export.geojson')
      const s2 = await runExport({ format: 'geojson' }, geojson)
      assert.strictEqual(s2.outcome?.kind, 'saved', JSON.stringify(s2.outcome))
      const doc = JSON.parse(fs.readFileSync(geojson, 'utf8')) as { features: Array<{ geometry: unknown }> }
      assert.strictEqual(doc.features.length, 180)
      assert.strictEqual(doc.features.filter((f) => f.geometry === null).length, 1)
      assert.ok(s2.outcome?.notices?.some((n) => /1 row has no valid geometry/.test(n)), JSON.stringify(s2.outcome?.notices))
      assert.strictEqual(sha(file), before) // SC-007
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
