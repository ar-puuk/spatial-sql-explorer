// T081 (spec 008 US7, FR-030): Export map image in VS Code saves a PNG
// through the host (kind 'image'). The share link is web only: the webview
// has no Copy link (it lives in the web shell's header, not in ViewerLayout).
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

suite('Spec 008 US7: map image in VS Code', () => {
  test('Export map image saves a PNG through the host', async function () {
    this.timeout(90000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-map-image-'))
    const file = path.join(dir, 'world.geojson')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/world-boundaries.geojson'), file)
    try {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const deadline = Date.now() + 45000
      for (;;) {
        const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
        if (s?.loadState === 'ready') break
        assert.ok(Date.now() < deadline, 'world.geojson did not load')
        await sleep(200)
      }
      await sleep(1500) // the map's first frame
      for (const scale of [1, 2]) {
        const out = path.join(dir, `map-${scale}x.png`)
        await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', out)
        await vscode.commands.executeCommand('spatialExplorer._exportMapImage', scale)
        const until = Date.now() + 20000
        while (!fs.existsSync(out) || fs.statSync(out).size === 0) {
          assert.ok(Date.now() < until, `${path.basename(out)} was not written`)
          await sleep(200)
        }
        await sleep(200)
        const bytes = fs.readFileSync(out)
        assert.strictEqual(bytes.subarray(1, 4).toString('latin1'), 'PNG')
        const width = bytes.readUInt32BE(16)
        assert.ok(width > 100, `width ${width}`)
        if (scale === 2) {
          const one = fs.readFileSync(path.join(dir, 'map-1x.png')).readUInt32BE(16)
          assert.strictEqual(width, one * 2)
        }
      }
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
