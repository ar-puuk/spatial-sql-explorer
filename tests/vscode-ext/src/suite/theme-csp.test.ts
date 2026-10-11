// T066 (spec 008 US5): the webview allows the new tile hosts and the place
// search, and nothing else new.
import * as assert from 'assert'
import * as vscode from 'vscode'
import { openAndWait } from './query.test'

suite('Spec 008 US5: webview CSP', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('raster basemap hosts and Nominatim are allowed for images and requests', async function () {
    this.timeout(60000)
    await openAndWait('sample.geojson', 'spatialExplorer.editorOption')
    const csp = (await vscode.commands.executeCommand('spatialExplorer._getCsp')) as string
    const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) ?? ''
    for (const host of ['https://server.arcgisonline.com', 'https://*.tile.opentopomap.org', 'https://tile.openstreetmap.org']) {
      assert.ok(directive('img-src').includes(host), `img-src ${host}`)
      assert.ok(directive('connect-src').includes(host), `connect-src ${host}`)
    }
    assert.ok(directive('connect-src').includes('https://nominatim.openstreetmap.org'))
    assert.ok(!directive('img-src').includes('nominatim'))
  })
})
