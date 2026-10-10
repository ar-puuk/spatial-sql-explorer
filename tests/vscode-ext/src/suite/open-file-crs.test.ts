// T034 (specs/001-quick-look/tasks.md): CRS reprojection renders at the
// correct location while Layer.sourceCrs reports the *original* CRS (FR-007),
// and the "WGS84 assumed" disclosure fires only when the file truly has no
// CRS (FR-015). Uses a real, known non-WGS84 fixture
// (usa-utm12n.gpkg — the USA boundary from world-boundaries.geojson,
// reprojected to EPSG:26912/NAD83 UTM Zone 12N via a real `duckdb` CLI spike
// recorded in research.md §5) against the actual VS Code custom editor and
// real DuckDB-WASM, same harness as T014.
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type LoadState = {
  loadState: string
  featureCount?: number
  invalidGeometryCount?: number
  errorMessage?: string
  sourceCrsLabel?: string
  crsAssumed?: boolean
  extent?: [number, number, number, number] | null
} | null

async function waitForLoadState(deadlineMs: number): Promise<LoadState> {
  const deadline = Date.now() + deadlineMs
  let result: LoadState = null
  while (Date.now() < deadline) {
    result = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as LoadState
    if (result && result.loadState !== 'loading') break
    await sleep(500)
  }
  return result
}

suite('T034: CRS reprojection and disclosure', () => {
  test('a known non-WGS84 GeoPackage reports its real source CRS and renders reprojected to WGS84', async function () {
    this.timeout(60000)

    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/usa-utm12n.gpkg'))
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'ready', `Expected loadState "ready", got "${result!.loadState}": ${result!.errorMessage ?? ''}`)

    // FR-007: the *original* source CRS is reported, not WGS84 (what
    // everything is reprojected to for display).
    assert.strictEqual(result!.sourceCrsLabel, 'EPSG:26912', `Expected sourceCrsLabel "EPSG:26912", got "${result!.sourceCrsLabel}"`)
    // FR-015: WGS84-assumed disclosure must NOT fire — this file has a real,
    // known CRS.
    assert.strictEqual(result!.crsAssumed, false, 'Expected crsAssumed=false for a file with a real, known CRS')

    // The extent (computed from the already-reprojected geometry) must be
    // real WGS84 lon/lat for the USA, not raw UTM-zone-12N meter values
    // (which would be ~-5,000,000..3,900,000) — this is the "renders at the
    // correct location" assertion: a real ST_Transform ran, and it used
    // always_xy correctly (research.md §5's "POINT (inf inf)" bug would show
    // up here as a null/non-finite extent).
    const [minX, minY, maxX, maxY] = result!.extent ?? [NaN, NaN, NaN, NaN]
    console.log(`T034 usa-utm12n.gpkg: sourceCrsLabel=${result!.sourceCrsLabel}, extent=[${minX}, ${minY}, ${maxX}, ${maxY}]`)
    assert.ok(minX > -180 && minX < -60, `Expected minX in real USA longitude range, got ${minX}`)
    assert.ok(maxX > -180 && maxX < -60, `Expected maxX in real USA longitude range, got ${maxX}`)
    assert.ok(minY > 15 && minY < 75, `Expected minY in real USA latitude range, got ${minY}`)
    assert.ok(maxY > 15 && maxY < 75, `Expected maxY in real USA latitude range, got ${maxY}`)
  })

  test('a file with no CRS information (CSV) discloses that WGS84 was assumed', async function () {
    this.timeout(60000)

    // No fixture has WFRC's real CSV shape, but any lon/lat CSV exercises
    // the same no-CRS-metadata path: read_csv_auto has no comparable
    // ST_Read_Meta CRS field, so this must always fall back to assumed.
    const csvUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/points.csv'))
    await vscode.commands.executeCommand('vscode.openWith', csvUri, 'spatialExplorer.editor')

    const result = await waitForLoadState(45000)

    assert.ok(result, 'Expected a loadStateChanged message from the webview within 45s, got none.')
    assert.strictEqual(result!.loadState, 'ready', `Expected loadState "ready", got "${result!.loadState}": ${result!.errorMessage ?? ''}`)
    assert.strictEqual(result!.sourceCrsLabel, 'EPSG:4326 (WGS84)', `Expected the WGS84 label, got "${result!.sourceCrsLabel}"`)
    assert.strictEqual(result!.crsAssumed, true, 'Expected crsAssumed=true for a CSV (no CRS metadata exists for this strategy)')
  })
})
