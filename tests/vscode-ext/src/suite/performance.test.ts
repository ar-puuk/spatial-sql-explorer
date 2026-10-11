// T046 (VS Code side): time a ~10 MB GeoJSON in the real webview. Every
// custom-editor webview owns its own DuckDB instance (CLAUDE.md), so each open
// in VS Code includes engine start-up, overlapped with the file transfer by
// the pre-warm. Results are printed for quickstart.md.
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

type LoadState = { loadState: string; featureCount?: number; errorMessage?: string; loadMs?: number; loadTimings?: Record<string, number> } | null

function makeTenMegabyteGeoJson(): string {
  const features: string[] = []
  let seed = 42
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 22000; i++) {
    const cx = -112.2 + rand() * 0.8
    const cy = 40.4 + rand() * 0.8
    const r = 0.0004 + rand() * 0.0008
    const ring: string[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      ring.push(`[${(cx + Math.cos(a) * r * (0.8 + rand() * 0.4)).toFixed(6)},${(cy + Math.sin(a) * r * (0.8 + rand() * 0.4)).toFixed(6)}]`)
    }
    ring.push(ring[0])
    features.push(
      `{"type":"Feature","properties":{"parcel_id":"P-${100000 + i}","zone":"${['R1', 'R2', 'C', 'I', 'AG'][i % 5]}","acres":${(rand() * 5).toFixed(3)},"value":${Math.round(rand() * 900000)},"year_built":${1900 + (i % 124)},"owner":"Owner ${i % 997}"},"geometry":{"type":"Polygon","coordinates":[[${ring.join(',')}]]}}`
    )
  }
  return `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}`
}

suite('T046: performance in the VS Code webview', () => {
  test('~10 MB GeoJSON: time to ready', async function () {
    this.timeout(120000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-perf-'))
    const file = path.join(dir, 'parcels-10mb.geojson')
    fs.writeFileSync(file, makeTenMegabyteGeoJson())
    try {
      const runs: number[] = []
      for (let i = 0; i < 3; i++) {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
        const deadline = Date.now() + 60000
        let state: LoadState = null
        while (Date.now() < deadline) {
          state = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as LoadState
          if (state && state.loadState !== 'loading') break
          await new Promise((r) => setTimeout(r, 100))
        }
        assert.strictEqual(state?.loadState, 'ready', state?.errorMessage ?? '')
        assert.strictEqual(state?.featureCount, 22000)
        runs.push(state!.loadMs!)
        console.log(`PERF vscode run ${i + 1}: ${state!.loadMs} ms ${JSON.stringify(state!.loadTimings)} (${(fs.statSync(file).size / 1048576).toFixed(2)} MB)`)
      }
      runs.sort((a, b) => a - b)
      console.log(`PERF vscode median: ${runs[1]} ms`)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
