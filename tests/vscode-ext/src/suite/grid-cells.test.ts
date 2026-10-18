// Spec 017 (T045) in the real VS Code webview: the h3 and a5 grids are loaded from their pinned downloads (the extension
// host fetches them, hash-checked), work under the webview's CSP, and the a5 start-up report to Query.Farm has nowhere to
// go. @vscode/test-electron can't click in the webview, so the bin's SQL is run through the same hook as Run
// (spatialExplorer._runQuery); the dialog itself is covered by the browser tests (tests/web/specs/grid-cells-017.spec.ts).
import * as assert from 'assert'
import * as fs from 'fs'
import * as vscode from 'vscode'
import { openAndWait, run } from './query.test'

/** The shape of the bin query over crashes.geojson (3,000 points), for one system and resolution. */
const bin = (system: 'h3' | 'a5', res: number): string => {
  const cell = system === 'h3' ? `h3_latlng_to_cell(ST_Y(p), ST_X(p), ${res})` : `a5_lonlat_to_cell(ST_X(p), ST_Y(p), ${res})`
  const id = system === 'h3' ? 'h3_h3_to_string(cell)' : 'a5_u64_to_hex(cell)'
  const ring = system === 'h3' ? `ST_GeomFromText(h3_cell_to_boundary_wkt(cell))` : 'a5_cell_to_geometry(cell)'
  return `SELECT ${id} AS cell_id, ${res} AS resolution, count(*)::DOUBLE AS value, count(*) AS n, ST_SetCRS(${ring}, 'EPSG:4326') AS geom
FROM (SELECT ${cell} AS cell FROM (SELECT ST_Centroid(geom) AS p FROM layer) WHERE p IS NOT NULL AND NOT ST_IsEmpty(p))
GROUP BY cell`
}

suite('Spec 017: grid cells (H3 and A5) in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the h3 and a5 extensions are downloaded by the host, hash-checked and kept', async function () {
    this.timeout(120000)
    await openAndWait('crashes.geojson')
    const { dir, downloaded } = (await vscode.commands.executeCommand('spatialExplorer._getEngineDownloads')) as { dir: string; downloaded: string[] }
    const kept = fs.readdirSync(dir).filter((f) => !f.endsWith('.part'))
    for (const name of ['h3', 'a5', 'fts']) {
      assert.ok(
        kept.some((f) => /^[0-9a-f]{64}-/.test(f) && f.endsWith(`-${name}.duckdb_extension.wasm`)),
        `${name} is kept in the host's storage (${kept.join(', ')})`
      )
    }
    // Whatever was downloaded in this session came from the pinned engine hosts only: nothing is named after the telemetry host.
    assert.ok(!downloaded.some((d) => /query-farm/i.test(d)), `downloads: ${downloaded.join(', ')}`)
  })

  test('the H3 bin runs in the webview, and its cells are mapped', async function () {
    this.timeout(120000)
    await openAndWait('crashes.geojson')
    const s = await run(bin('h3', 6))
    assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? '')
    assert.ok((s?.rowCount ?? 0) > 1, `cells: ${s?.rowCount}`)
    assert.strictEqual(s?.mappedCount, s?.rowCount, 'every cell has a geometry that is drawn')
    assert.strictEqual(s?.geometryColumn, 'geom')
    assert.strictEqual(s?.resultCrs?.includes('4326'), true, `result CRS: ${s?.resultCrs}`)
    assert.strictEqual(s?.resultCrsSource, 'engine', 'the engine types the cells EPSG:4326, so the CRS is not guessed')
  })

  test('the A5 bin runs in the webview too', async function () {
    this.timeout(120000)
    await openAndWait('crashes.geojson')
    const s = await run(bin('a5', 9))
    assert.strictEqual(s?.phase, 'succeeded', s?.errorMessage ?? '')
    assert.ok((s?.rowCount ?? 0) > 1, `cells: ${s?.rowCount}`)
    assert.strictEqual(s?.mappedCount, s?.rowCount)
  })

  test('the webview cannot reach the a5 extension\'s telemetry host', async function () {
    this.timeout(60000)
    await openAndWait('crashes.geojson')
    const csp = (await vscode.commands.executeCommand('spatialExplorer._getCsp')) as string
    assert.ok(csp && !/query-farm/i.test(csp), 'the content security policy does not list the telemetry host')
    assert.ok(!/community-extensions\.duckdb\.org/.test(csp), 'the webview downloads nothing: the extension host does')
  })
})
