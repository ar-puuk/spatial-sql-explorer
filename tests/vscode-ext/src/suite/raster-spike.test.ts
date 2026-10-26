// Spec 026 T002 (constitution VI): does the raster reader work in a real VS Code webview?
// Skipped unless SE_RASTER_SPIKE_DIR names a folder with `web/` (the bundle from
// specs/026-raster-view/spikes/build-vscode.mjs, `engine/` with the three wasm files) and `data/`
// (test rasters). Opens a webview with the extension's CSP, serves the rasters through the real
// loopback range server, and prints the numbers the webview posts back. Replaced by raster.test.ts (T020).
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

interface Api {
  sourceServerForTests: {
    register(p: string, side: string[]): Promise<{ token: string; urlFor(name: string): string }>
    release(token: string): unknown
    statsFor(token: string): { bytes: number; requests: number; size: number } | undefined
  }
}

const FILES = (process.env.SE_RASTER_SPIKE_FILES ?? 'dem_32612.tif,dem_5070.tif,rgb_cog.tif,big_cog_utm.tif,dem_striped.tif').split(',')

suite('Spec 026 spike: raster reader in a VS Code webview', function () {
  this.timeout(240000)
  const dir = process.env.SE_RASTER_SPIKE_DIR

  test('opens COGs over the loopback server under the extension CSP', async function () {
    if (!dir) return this.skip()
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'spatial-explorer')
    assert.ok(ext, 'extension not found')
    const api = (await ext.activate()) as Api
    const web = vscode.Uri.file(path.join(dir, 'web'))
    const panel = vscode.window.createWebviewPanel('rasterSpike', 'raster spike', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [web],
    })
    const regs: { name: string; token: string; url: string }[] = []
    for (const name of FILES) {
      const reg = await api.sourceServerForTests.register(path.join(dir, 'data', name), [])
      regs.push({ name, token: reg.token, url: reg.urlFor(name) })
    }
    const csp = panel.webview.cspSource
    const params = {
      engine: panel.webview.asWebviewUri(vscode.Uri.joinPath(web, 'engine')).toString(),
      files: regs.map((r) => ({ name: r.name, url: r.url })),
      stripedName: 'dem_striped.tif',
    }
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(web, 'vscode-spike.js')).toString()
    // The same policy as apps/vscode-ext/src/extension.ts getHtml (hosts that are not used here left out).
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline'; worker-src ${csp} blob: data:; connect-src ${csp} blob: http://localhost.:*; img-src ${csp} data: blob:; font-src ${csp};">
</head><body><div id="params" data-json='${JSON.stringify(params).replace(/'/g, '&#39;')}'></div><script src="${script}"></script></body></html>`

    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no result from the webview in 200 s')), 200000)
      panel.webview.onDidReceiveMessage((m: { type: string; result: Record<string, unknown> }) => {
        if (m.type === 'result') {
          clearTimeout(timer)
          resolve(m.result)
        }
      })
    })
    const served: Record<string, unknown> = {}
    for (const r of regs) {
      const s = api.sourceServerForTests.statsFor(r.token)
      if (s) served[r.name] = { ...s, pct: +((100 * s.bytes) / s.size).toFixed(3) }
      api.sourceServerForTests.release(r.token)
    }
    panel.dispose()
    console.log('RASTER-SPIKE-RESULT ' + JSON.stringify({ result, served }, null, 1))
    assert.strictEqual(result.fatal, undefined, String(result.fatal))
    assert.strictEqual(result.evalAllowed, false, 'the CSP must keep eval blocked, and the reader must not need it')
  })
})
