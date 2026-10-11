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
  plan: { format: string; rowCount: number; formats: string[]; crs: string; notices: string[] } | null
  outcome: { kind: string; rows?: number; bytes?: number; location?: string; message?: string; notices?: string[] } | null
}
const exportState = (): Thenable<ExportState | null> => vscode.commands.executeCommand('spatialExplorer._getExportState')

/** Opens a copy of a fixture in a temp dir (exports go next to it). */
export async function openCopy(fixture: string, viewType = 'spatialExplorer.editorOption'): Promise<{ dir: string; file: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-export-'))
  const file = path.join(dir, fixture)
  fs.copyFileSync(path.resolve(__dirname, '../../fixtures', fixture), file)
  await openPath(file, viewType)
  return { dir, file }
}

/** Opens `file` in a viewer and waits until it is ready. */
async function openPath(file: string, viewType = 'spatialExplorer.editorOption'): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), viewType)
  const deadline = Date.now() + 45000
  for (;;) {
    const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
    if (s?.loadState === 'ready') break
    assert.ok(Date.now() < deadline, `${path.basename(file)} did not load`)
    await sleep(200)
  }
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
      const s1 = await runExport({ format: 'geoparquet', crs: 'result' }, parquet)
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

/** The JSON object starting at `start`, by matching braces outside strings (PROJJSON nests deeply). */
function balancedJson(text: string, start: number): string {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error('unterminated JSON in the Parquet footer')
}

// T018: US2. The GeoParquet footer carries our `geo` metadata with the
// layer's own CRS (read from the file's tail, where Parquet keeps it).
suite('Spec 005 US2: export keeps the CRS in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('a UTM layer exported as GeoParquet records EPSG:26912', async function () {
    this.timeout(120000)
    const { dir } = await openCopy('usa-utm12n.gpkg', 'spatialExplorer.editor')
    try {
      const out = path.join(dir, 'utm-export.parquet')
      const s = await runExport({ format: 'geoparquet', crs: 'result' }, out)
      assert.strictEqual(s.outcome?.kind, 'saved', JSON.stringify(s.outcome))
      const tail = fs.readFileSync(out).subarray(-8192).toString('latin1')
      const start = tail.indexOf('{"version":"1.1.0"')
      assert.ok(start >= 0, 'no geo metadata in the footer')
      const geo = JSON.parse(balancedJson(tail, start)) as { columns: { geom: { crs: { id: { code: number } } } } }
      assert.strictEqual(geo.columns.geom.crs.id.code, 26912)
      assert.strictEqual((tail.match(/"primary_column"/g) ?? []).length, 1, 'exactly one geo key')
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// T026: US5, the command palette (FR-013).
suite('Spec 005 US5: Export Data… command', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('opens the dialog for the active viewer, and explains when there is none', async function () {
    this.timeout(90000)
    const { dir } = await openCopy('world-boundaries.geojson')
    try {
      const opened = await vscode.commands.executeCommand('spatialExplorer.exportData')
      assert.strictEqual(opened, true)
      const deadline = Date.now() + 10000
      while (!(await exportState())?.open) {
        assert.ok(Date.now() < deadline, 'the export dialog did not open')
        await sleep(100)
      }
      const s = await exportState()
      assert.deepStrictEqual(s?.plan?.formats, ['geoparquet', 'geopackage', 'geojson', 'flatgeobuf', 'shapefile', 'kml', 'geojsonseq', 'csv'])

      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      const none = await vscode.commands.executeCommand('spatialExplorer.exportData')
      assert.strictEqual(none, false)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** `count` parcel-like 12-vertex polygons with a few attributes (about 0.6 KB of GeoJSON each). */
function writeParcels(file: string, count: number): void {
  const out = fs.openSync(file, 'w')
  fs.writeSync(out, '{"type":"FeatureCollection","features":[')
  for (let i = 0; i < count; i++) {
    const cx = -112 + (i % 400) * 0.002
    const cy = 40 + Math.floor(i / 400) * 0.002
    const ring = Array.from({ length: 12 }, (_, k) => {
      const a = (k / 12) * 2 * Math.PI
      return `[${(cx + Math.cos(a) * 0.0008).toFixed(7)},${(cy + Math.sin(a) * 0.0008).toFixed(7)}]`
    })
    ring.push(ring[0])
    const props = `{"parcel_id":"P${String(i).padStart(7, '0')}","zone":"Z${i % 5}","acres":${((i % 97) / 7).toFixed(3)},"owner":"Owner ${i % 1000}"}`
    fs.writeSync(out, `${i ? ',' : ''}{"type":"Feature","properties":${props},"geometry":{"type":"Polygon","coordinates":[[${ring.join(',')}]]}}`)
  }
  fs.writeSync(out, ']}')
  fs.closeSync(out)
}

// T030: the chunked transfer (more than 32 MB crosses the bridge in pieces)
// and the guard that never overwrites the opened source.
suite('Spec 005: large exports and the source guard in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('a GeoJSON export of more than 32 MB arrives intact', async function () {
    this.timeout(300000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-export-'))
    const source = path.join(dir, 'parcels-8k.geojson')
    writeParcels(source, 8_000)
    try {
      await openPath(source)
      // Ten copies of each parcel: an 80,000-row result from a small source.
      await vscode.commands.executeCommand('spatialExplorer._runQuery', 'SELECT a.* FROM layer a, range(10) b ORDER BY b.range, a.parcel_id', 'first')
      const deadline = Date.now() + 60000
      while (((await exportState())?.plan?.rowCount ?? 0) !== 80_000) {
        assert.ok(Date.now() < deadline, `the 80,000-row query did not finish: ${JSON.stringify(await exportState())}`)
        await sleep(200)
      }
      const out = path.join(dir, 'parcels-80k-export.geojson')
      const s = await runExport({ format: 'geojson', rows: 'all' }, out)
      assert.strictEqual(s.outcome?.kind, 'saved', JSON.stringify(s.outcome))
      assert.strictEqual(s.outcome?.rows, 80_000)
      const size = fs.statSync(out).size
      assert.ok(size > 32 * 1024 * 1024, `expected more than 32 MB, got ${size}`)
      assert.strictEqual(size, s.outcome?.bytes)
      const doc = JSON.parse(fs.readFileSync(out, 'utf8')) as { features: Array<{ properties: { parcel_id: string } }> }
      assert.strictEqual(doc.features.length, 80_000)
      assert.strictEqual(doc.features[79_999].properties.parcel_id, 'P0007999')
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the opened source is refused as the target, and left unchanged', async function () {
    this.timeout(120000)
    const { dir, file } = await openCopy('world-boundaries.geojson')
    const before = sha(file)
    try {
      const s = await runExport({ format: 'geojson' }, file)
      assert.strictEqual(s.outcome?.kind, 'failed', JSON.stringify(s.outcome))
      assert.match(s.outcome?.message ?? '', /Choose a different file: this is the opened source\./)
      assert.strictEqual(sha(file), before)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// T050 (spec 008 US4): the new formats are written through the host's save
// (in the webview, sql.js's wasm from the extension) and land on disk.
suite('Spec 008 US4: new export formats in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('GeoPackage, FlatGeobuf, Shapefile, KML, GeoJSONSeq, Excel and JSON are saved', async function () {
    this.timeout(180000)
    const { dir } = await openCopy('world-boundaries.geojson')
    const magic: Record<string, (b: Buffer) => boolean> = {
      gpkg: (b) => b.subarray(0, 15).toString('latin1') === 'SQLite format 3',
      fgb: (b) => b[0] === 0x66 && b[1] === 0x67 && b[2] === 0x62,
      'shp.zip': (b) => b.subarray(0, 2).toString('latin1') === 'PK',
      kml: (b) => b.toString('utf8', 0, 200).includes('<kml'),
      geojsonl: (b) => JSON.parse(b.toString('utf8').split('\n')[0]).type === 'Feature',
      xlsx: (b) => b.subarray(0, 2).toString('latin1') === 'PK',
      json: (b) => (JSON.parse(b.toString('utf8')) as unknown[]).length === 180,
    }
    const cases: Array<[string, string, object]> = [
      ['geopackage', 'gpkg', {}],
      ['flatgeobuf', 'fgb', {}],
      ['shapefile', 'shp.zip', {}],
      ['kml', 'kml', {}],
      ['geojsonseq', 'geojsonl', {}],
      ['xlsx', 'xlsx', { includeGeometry: false }],
      ['json', 'json', { includeGeometry: false }],
    ]
    try {
      for (const [format, ext, extra] of cases) {
        const target = path.join(dir, `out.${ext}`)
        const s = await runExport({ format, crs: 'result', includeGeometry: true, ...extra }, target)
        assert.strictEqual(s.outcome?.kind, 'saved', `${format}: ${JSON.stringify(s.outcome)}`)
        assert.strictEqual(s.outcome?.rows, 180, format)
        const bytes = fs.readFileSync(target)
        assert.ok(bytes.length > 0 && magic[ext](bytes), `${format} content`)
      }
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
