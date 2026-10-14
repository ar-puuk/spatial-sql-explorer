// SC-002 / FR-018: every format spec 001 claims opens in the real VS Code
// webview (real DuckDB-WASM build), with the right feature count and source
// CRS. Covers the formats T014/T034 don't already: Shapefile (+ sidecars),
// GML, GeoPackage, GeoParquet (DuckDB-decoded GEOMETRY column, with and
// without a non-WGS84 CRS), plain Parquet with a WKB BLOB column, and the
// multi-layer edge case (spec 008: both layers listed, the first opens).
import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

type LoadState = {
  loadState: string
  featureCount?: number
  invalidGeometryCount?: number
  errorMessage?: string
  sourceCrsLabel?: string
  crsAssumed?: boolean
  extent?: [number, number, number, number] | null
  renderedFeatureCount?: number | null
} | null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function open(file: string, viewType: string): Promise<LoadState> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.resolve(__dirname, '../../fixtures', file)), viewType)
  const deadline = Date.now() + 45000
  let state: LoadState = null
  while (Date.now() < deadline) {
    state = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as LoadState
    if (state && state.loadState !== 'loading') break
    await sleep(300)
  }
  return state
}

const CASES: Array<{ file: string; viewType: string; features: number; crs: string; assumed?: boolean; note: string }> = [
  { file: 'sample.shp', viewType: 'spatialExplorer.editor', features: 179, crs: 'EPSG:4326 (WGS84)', note: 'Shapefile with .shx/.dbf/.prj sidecars' },
  { file: 'sample.gml', viewType: 'spatialExplorer.editorOption', features: 179, crs: 'EPSG:4326 (WGS84)', note: 'GML (+ .xsd)' },
  { file: 'sample.gpkg', viewType: 'spatialExplorer.editor', features: 179, crs: 'EPSG:4326 (WGS84)', note: 'GeoPackage' },
  { file: 'sample.parquet', viewType: 'spatialExplorer.editorOption', features: 179, crs: 'EPSG:4326 (WGS84)', note: 'GeoParquet 1.0 (decoded to GEOMETRY)' },
  { file: 'usa-utm12n.parquet', viewType: 'spatialExplorer.editorOption', features: 1, crs: 'EPSG:26912', note: 'GeoParquet with a non-WGS84 CRS from its metadata' },
  { file: 'sample-wkb.parquet', viewType: 'spatialExplorer.editorOption', features: 179, crs: 'EPSG:4326 (WGS84)', assumed: true, note: 'plain Parquet, WKB BLOB, no CRS' },
  { file: 'multi-layer.gpkg', viewType: 'spatialExplorer.editor', features: 179, crs: 'EPSG:4326 (WGS84)', note: 'two layers listed (spec 008 US3); the first (countries) opens' },
  { file: 'places.xlsx', viewType: 'spatialExplorer.editorOption', features: 3, crs: 'EPSG:4326 (WGS84)', assumed: true, note: 'Excel workbook with lon/lat columns (spec 010), opened like a CSV' },
]

suite('SC-002: every supported format opens', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  for (const c of CASES) {
    test(`${c.file}: ${c.note}`, async function () {
      this.timeout(60000)
      const state = await open(c.file, c.viewType)
      assert.ok(state, 'no loadStateChanged message')
      assert.strictEqual(state!.loadState, 'ready', state!.errorMessage ?? '')
      assert.strictEqual(state!.featureCount, c.features)
      assert.strictEqual(state!.sourceCrsLabel, c.crs)
      assert.strictEqual(state!.crsAssumed, c.assumed ?? false)
      assert.ok((state!.renderedFeatureCount ?? 0) > 0, `rendered ${state!.renderedFeatureCount}`)
      if (c.crs !== 'EPSG:4326 (WGS84)') {
        // Reprojected for display: a UTM extent would be in the hundreds of thousands.
        const [minX, , maxX] = state!.extent!
        assert.ok(minX >= -180 && maxX <= 180, `extent should be lon/lat, got ${state!.extent}`)
      }
    })
  }
})
