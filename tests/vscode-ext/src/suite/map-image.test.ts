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
      // Spec 011 T068: labels are in the captured frame (the web suite checks their pixels; here, a smoke check:
      // the same map with every country's name on it makes a noticeably bigger PNG).
      await vscode.commands.executeCommand('spatialExplorer._setStyle', {
        fillColor: '#3b82f6', fillOpacity: 0.45, strokeColor: '#1d4ed8', strokeOpacity: 1, strokeWidth: 1.5, pointRadius: 5,
        renderer: { kind: 'single' },
        labels: { enabled: true, source: { kind: 'column', column: 'name' }, size: 14, color: '#111111', halo: { enabled: true, color: '#ffffff', width: 2 }, placement: { kind: 'point', anchor: 'above', offset: 4 } },
      })
      await sleep(2500)
      const labeled = path.join(dir, 'map-labels.png')
      await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', labeled)
      await vscode.commands.executeCommand('spatialExplorer._exportMapImage', 1)
      const until = Date.now() + 20000
      while (!fs.existsSync(labeled) || fs.statSync(labeled).size === 0) {
        assert.ok(Date.now() < until, 'map-labels.png was not written')
        await sleep(200)
      }
      await sleep(200)
      const plain = fs.statSync(path.join(dir, 'map-1x.png')).size
      assert.ok(fs.statSync(labeled).size > plain * 1.05, `with labels ${fs.statSync(labeled).size} bytes, without ${plain}`)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // Spec 016: a page on paper, as a PDF and as an editable SVG, through the same host save.
  test('Print map saves a PDF and an SVG of an A4 page through the host', async function () {
    this.timeout(120000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-print-'))
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
      await sleep(1500)
      const save = async (name: string, ...args: unknown[]): Promise<Buffer> => {
        const out = path.join(dir, name)
        await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', out)
        await vscode.commands.executeCommand('spatialExplorer._exportMapImage', ...args)
        const until = Date.now() + 40000
        while (!fs.existsSync(out) || fs.statSync(out).size === 0) {
          assert.ok(Date.now() < until, `${name} was not written`)
          await sleep(200)
        }
        await sleep(300)
        return fs.readFileSync(out)
      }
      const pdf = await save('page.pdf', 1, 'pdf', 'a4')
      assert.strictEqual(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
      const svg = (await save('page.svg', 1, 'svg', 'a4', 'Every country', true)).toString('utf8')
      assert.ok(svg.startsWith('<?xml'), 'an SVG document')
      assert.ok(svg.includes('Every country'), 'the title is text in the SVG')
      const texts = [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1])
      assert.ok(texts.includes('N'), `the north arrow is in the SVG; the texts are: ${texts.join(' | ')}`)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
