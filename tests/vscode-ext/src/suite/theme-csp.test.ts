// T066 (spec 008 US5): the webview allows the new tile hosts and the place
// search, and nothing else new.
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
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

  // Spec 010 T041: every "More basemaps…" style and tile host is allowed, `*.` wildcards included.
  test('every gallery basemap host is allowed for requests and images', async function () {
    this.timeout(60000)
    await openAndWait('sample.geojson', 'spatialExplorer.editorOption')
    const csp = (await vscode.commands.executeCommand('spatialExplorer._getCsp')) as string
    const sources = (name: string) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) ?? '').split(/\s+/).slice(1)
    const allows = (list: string[], host: string) =>
      list.some((s) => s === host || (s.startsWith('https://*.') && host.startsWith('https://') && host.endsWith(s.slice('https://*'.length)) && host.length > s.length - 1))
    const gallery = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../packages/core/src/basemapGallery.json'), 'utf8')) as { basemaps: Array<{ url?: string; tiles?: string[] }> }
    const hosts = new Set(gallery.basemaps.flatMap((b) => [b.url, ...(b.tiles ?? [])]).filter((u): u is string => !!u).map((u) => /^https:\/\/[^/?#]+/.exec(u)![0]))
    assert.ok(hosts.size > 10)
    for (const host of hosts) {
      assert.ok(allows(sources('connect-src'), host), `connect-src ${host}`)
      assert.ok(allows(sources('img-src'), host), `img-src ${host}`)
    }
  })
})
