// Spec 003 (thematic styling) in the VS Code extension, through the
// _setStyle / _getStyleState / _saveStyle test hooks (T013).
import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { openAndWait } from './query.test'

interface StyleState {
  renderer: string
  column?: string
  method?: string
  status: string
  reason?: string
  caption: string
  dirty: boolean
  source: string | null
  classes: Array<{ key: string; label: string; color: string; visible: boolean; count: number }>
  size?: { column: string; mode: string; status: string; caption: string; classes: Array<{ key: string; label: string; size?: number; visible: boolean; count: number }>; samples?: Array<{ value: number; size: number }> }
  channels?: Record<string, { status: string; classes: Array<{ key: string; label: string; output?: string | number; visible: boolean; count: number }> }>
  labels?: { enabled: boolean; source: { kind: string; expression?: string; column?: string } }
  labelError?: string
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const styleState = (): Thenable<StyleState | null> => vscode.commands.executeCommand('spatialExplorer._getStyleState')

export const BASE_SYMBOL = { fillColor: '#3b82f6', fillOpacity: 0.45, strokeColor: '#1d4ed8', strokeOpacity: 1, strokeWidth: 1.5, pointRadius: 5 }

/** Applies a style and waits until the webview reports it resolved. */
export async function applyStyle(style: object, until: (s: StyleState) => boolean): Promise<StyleState> {
  await vscode.commands.executeCommand('spatialExplorer._setStyle', style)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const s = await styleState()
    if (s && until(s)) return s
    await sleep(100)
  }
  assert.fail(`style was not applied: ${JSON.stringify(await styleState())}`)
}

const WORLD_TOP_12 = ['Afghanistan', 'Albania', 'Algeria', 'Angola', 'Antarctica', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bangladesh', 'Belarus']

suite('Spec 003 US1: categorized styling in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the default style reports one single-symbol class', async function () {
    this.timeout(60000)
    await openAndWait('world-boundaries.geojson', 'spatialExplorer.editorOption')
    const s = await styleState()
    assert.strictEqual(s?.renderer, 'single')
    assert.strictEqual(s?.classes.length, 1)
    assert.strictEqual(s?.classes[0].count, 180)
  })

  test('categorized classes and counts match the web build (FR-020)', async function () {
    this.timeout(60000)
    await openAndWait('world-boundaries.geojson', 'spatialExplorer.editorOption')
    const s = await applyStyle(
      { ...BASE_SYMBOL, renderer: { kind: 'categorized', column: 'name', ramp: { id: 'brewer-paired', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {} } },
      (x) => x.renderer === 'categorized'
    )
    assert.strictEqual(s.status, 'ok')
    assert.strictEqual(s.caption, 'name · 12 categories')
    assert.deepStrictEqual(
      s.classes.map((c) => c.label),
      [...WORLD_TOP_12, 'Other (168 values)']
    )
    assert.deepStrictEqual(
      s.classes.map((c) => c.count),
      [...Array(12).fill(1), 168]
    )
    assert.strictEqual(s.classes[0].color, '#a6cee3')
    assert.strictEqual(s.dirty, true)
  })
})

/** The same 100 points (value = i²) as the web suite's writeSquares(). */
function writeSquares(): string {
  const features = Array.from({ length: 100 }, (_, i) => `{"type":"Feature","properties":{"value":${i * i}},"geometry":{"type":"Point","coordinates":[${(-112 + i * 0.01).toFixed(2)},40.5]}}`)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-sq-')), 'squares.geojson')
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[${features.join(',')}]}`)
  return file
}

suite('Spec 003 US2: graduated styling in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('quantile classes and counts match the web build (FR-020)', async function () {
    this.timeout(60000)
    const file = writeSquares()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
    const deadline = Date.now() + 45000
    for (;;) {
      const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
      if (s?.loadState === 'ready') break
      assert.ok(Date.now() < deadline, 'squares.geojson did not load')
      await sleep(200)
    }
    const s = await applyStyle(
      { ...BASE_SYMBOL, renderer: { kind: 'graduated', column: 'value', method: 'quantile', classCount: 5, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} } },
      (x) => x.renderer === 'graduated'
    )
    assert.strictEqual(s.caption, 'value · Quantile, 5 classes')
    assert.deepStrictEqual(
      s.classes.map((c) => c.label),
      ['0 – 392', '392 – 1,568', '1,568 – 3,529', '3,529 – 6,273', '6,273 – 9,801']
    )
    assert.deepStrictEqual(
      s.classes.map((c) => c.count),
      [20, 20, 20, 20, 20]
    )
    assert.strictEqual(s.classes[0].color, '#440154')
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  })
})

suite('Spec 003 US4: save, reopen and auto-apply in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  // T035 (FR-013, SC-003): the QML sidecar holds the thematic style, and
  // reopening the file applies it with the same classes, colors, labels and
  // hidden flags.
  test('a categorized style with a hidden class survives save and reopen', async function () {
    this.timeout(90000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-style-'))
    const file = path.join(dir, 'world.geojson')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/world-boundaries.geojson'), file)
    const open = async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const deadline = Date.now() + 45000
      for (;;) {
        const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
        if (s?.loadState === 'ready') return
        assert.ok(Date.now() < deadline, 'world.geojson did not load')
        await sleep(200)
      }
    }
    try {
      await open()
      const before = await applyStyle(
        {
          ...BASE_SYMBOL,
          renderer: {
            kind: 'categorized',
            column: 'name',
            ramp: { id: 'brewer-dark2', reversed: false },
            cap: 6,
            manual: false,
            classes: [
              { value: 'Albania', visible: false },
              { value: 'Algeria', color: '#123456', label: 'Algérie' },
            ],
            other: { label: 'Rest of world' },
            noValue: {},
          },
        },
        (x) => x.renderer === 'categorized'
      )
      assert.strictEqual(before.classes.find((c) => c.key === 'v:Albania')?.visible, false)
      await vscode.commands.executeCommand('spatialExplorer._saveStyle')
      const sidecar = path.join(dir, 'world.qml')
      const deadline = Date.now() + 10000
      while (!fs.existsSync(sidecar)) {
        assert.ok(Date.now() < deadline, 'world.qml was not written')
        await sleep(100)
      }
      const qml = fs.readFileSync(sidecar, 'utf8')
      assert.match(qml, /type="categorizedSymbol"/)
      assert.match(qml, /value="Albania"[^>]*render="false"|render="false"[^>]*value="Albania"/)

      await open()
      let after: StyleState | null = null
      const until = Date.now() + 10000
      while (Date.now() < until) {
        after = await styleState()
        if (after?.renderer === 'categorized') break
        await sleep(100)
      }
      assert.strictEqual(after?.source, 'world.qml')
      assert.strictEqual(after?.dirty, false)
      const view = (s: StyleState | null) => s?.classes.map((c) => [c.key, c.label, c.color, c.visible, c.count])
      assert.deepStrictEqual(view(after), view(before))
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// T012 (spec 008 FR-006): the Save button's menu. The QML item writes the
// sidecar next to the data, like the main action; SLD and Mapbox GL go
// through the save dialog (answered by the test hook here).
suite('Spec 008 US1: save style as each format', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('QML from the menu is the sidecar; SLD and Mapbox GL are saved where chosen', async function () {
    this.timeout(90000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-style-as-'))
    const file = path.join(dir, 'world.geojson')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/world-boundaries.geojson'), file)
    const waitFor = async (p: string) => {
      const deadline = Date.now() + 10000
      while (!fs.existsSync(p)) {
        assert.ok(Date.now() < deadline, `${path.basename(p)} was not written`)
        await sleep(100)
      }
      return fs.readFileSync(p, 'utf8')
    }
    try {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const deadline = Date.now() + 45000
      for (;;) {
        const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
        if (s?.loadState === 'ready') break
        assert.ok(Date.now() < deadline, 'world.geojson did not load')
        await sleep(200)
      }
      await applyStyle({ ...BASE_SYMBOL, fillColor: '#ff8800' }, (x) => x.renderer === 'single' && x.dirty && x.classes[0]?.color === '#ff8800')

      await vscode.commands.executeCommand('spatialExplorer._saveStyleAs', 'qml')
      assert.match(await waitFor(path.join(dir, 'world.qml')), /<qgis/)

      const sld = path.join(dir, 'out.sld')
      await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', sld)
      await vscode.commands.executeCommand('spatialExplorer._saveStyleAs', 'sld')
      assert.match(await waitFor(sld), /StyledLayerDescriptor/)

      const mapbox = path.join(dir, 'out.json')
      await vscode.commands.executeCommand('spatialExplorer._saveNextExportTo', mapbox)
      await vscode.commands.executeCommand('spatialExplorer._saveStyleAs', 'mapbox')
      assert.strictEqual(JSON.parse(await waitFor(mapbox)).version, 8)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Spec 009 T029 (US5): a color + size style is saved in the QML sidecar and
// restored on reopen, with the same size classes, sizes and hidden class.
suite('Spec 009 US5: a size channel survives save and reopen', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('categorized color + classed width on roads', async function () {
    this.timeout(90000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-size-'))
    const file = path.join(dir, 'roads.geojson')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/roads-traffic.geojson'), file)
    const open = async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const deadline = Date.now() + 45000
      for (;;) {
        const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
        if (s?.loadState === 'ready') return
        assert.ok(Date.now() < deadline, 'roads.geojson did not load')
        await sleep(200)
      }
    }
    try {
      await open()
      const before = await applyStyle(
        {
          ...BASE_SYMBOL,
          renderer: { kind: 'categorized', column: 'functional_class', ramp: { id: 'brewer-set2', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {} },
          size: { column: 'aadt', mode: 'classed', method: 'quantile', classCount: 4, classes: [{ index: 3, visible: false }], noValue: {}, sizeMin: 1, sizeMax: 7, scale: 'linear' },
        },
        (x) => x.renderer === 'categorized' && x.size?.status === 'ok'
      )
      assert.strictEqual(before.size?.caption, 'aadt · Quantile, 4 classes')
      assert.deepStrictEqual(before.size?.classes.filter((c) => c.key.startsWith('size:range')).map((c) => c.size), [1, 3, 5, 7])
      await vscode.commands.executeCommand('spatialExplorer._saveStyle')
      const sidecar = path.join(dir, 'roads.qml')
      const deadline = Date.now() + 10000
      while (!fs.existsSync(sidecar)) {
        assert.ok(Date.now() < deadline, 'roads.qml was not written')
        await sleep(100)
      }
      const qml = fs.readFileSync(sidecar, 'utf8')
      assert.match(qml, /name="spatialExplorer\/size"/)
      assert.match(qml, /<Option name="outlineWidth" type="Map">/)

      await open()
      let after: StyleState | null = null
      const until = Date.now() + 10000
      while (Date.now() < until) {
        after = await styleState()
        if (after?.size?.status === 'ok') break
        await sleep(100)
      }
      assert.strictEqual(after?.source, 'roads.qml')
      const view = (s: StyleState | null) => s?.size?.classes.map((c) => [c.key, c.label, c.size, c.visible, c.count])
      assert.deepStrictEqual(view(after), view(before))
      assert.deepStrictEqual(after?.classes.map((c) => c.color), before.classes.map((c) => c.color))
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Spec 009 T048 (US5): a bivariate style is saved as the QML sidecar (QGIS's
// rule-based renderer) and restored as bivariate, with its palette and hidden cell.
suite('Spec 009 US5: a bivariate style survives save and reopen', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('poverty_rate x obesity_rate, green-purple, one cell hidden', async function () {
    this.timeout(90000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-biv-'))
    const file = path.join(dir, 'counties.geojson')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/counties-bivariate.geojson'), file)
    const open = async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const deadline = Date.now() + 45000
      for (;;) {
        const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
        if (s?.loadState === 'ready') return
        assert.ok(Date.now() < deadline, 'counties.geojson did not load')
        await sleep(200)
      }
    }
    try {
      await open()
      const before = await applyStyle(
        {
          ...BASE_SYMBOL,
          renderer: { kind: 'bivariate', x: { column: 'poverty_rate', method: 'quantile' }, y: { column: 'obesity_rate', method: 'equal' }, palette: 'green-purple', hidden: ['2-0'], noValue: {} },
        },
        (x) => x.renderer === 'bivariate' && x.status === 'ok'
      )
      assert.strictEqual(before.caption, 'poverty_rate × obesity_rate · Quantile / Equal interval')
      assert.strictEqual(before.classes.filter((c) => c.key.startsWith('cell:')).length, 9)
      assert.strictEqual(before.classes.reduce((n, c) => n + c.count, 0), 600)
      await vscode.commands.executeCommand('spatialExplorer._saveStyle')
      const sidecar = path.join(dir, 'counties.qml')
      const deadline = Date.now() + 10000
      while (!fs.existsSync(sidecar)) {
        assert.ok(Date.now() < deadline, 'counties.qml was not written')
        await sleep(100)
      }
      assert.match(fs.readFileSync(sidecar, 'utf8'), /type="RuleRenderer"/)

      await open()
      let after: StyleState | null = null
      const until = Date.now() + 10000
      while (Date.now() < until) {
        after = await styleState()
        if (after?.renderer === 'bivariate' && after.status === 'ok') break
        await sleep(100)
      }
      assert.strictEqual(after?.source, 'counties.qml')
      const view = (s: StyleState | null) => s?.classes.map((c) => [c.key, c.label, c.color, c.visible, c.count])
      assert.deepStrictEqual(view(after), view(before))
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Spec 011 T058 (US7): properties that vary by a column are saved in the QML
// sidecar (QGIS data-defined properties, and our own copy) and restored.
suite('Spec 011 US7: properties by a column survive save and reopen', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('color and pattern by functional class, opacity by lanes with a hidden class, expression labels', async function () {
    this.timeout(90000)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-channels-'))
    const file = path.join(dir, 'roads.geojson')
    fs.copyFileSync(path.resolve(__dirname, '../../fixtures/roads-traffic.geojson'), file)
    const open = async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const deadline = Date.now() + 45000
      for (;;) {
        const s = (await vscode.commands.executeCommand('spatialExplorer._getLoadState')) as { loadState: string } | null
        if (s?.loadState === 'ready') return
        assert.ok(Date.now() < deadline, 'roads.geojson did not load')
        await sleep(200)
      }
    }
    const ready = (s: StyleState | null) => s?.renderer === 'categorized' && s.channels?.dash?.status === 'ok' && s.channels?.opacity?.status === 'ok'
    try {
      await open()
      const before = await applyStyle(
        {
          ...BASE_SYMBOL,
          renderer: { kind: 'categorized', column: 'functional_class', ramp: { id: 'brewer-set2', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {} },
          channels: {
            dash: { source: { kind: 'column', column: 'functional_class' }, scale: { kind: 'categories', manual: false, categories: [], other: {}, noValue: {}, cap: 4 } },
            opacity: { source: { kind: 'column', column: 'lanes' }, scale: { kind: 'classes', method: 'equal', classCount: 3, classes: [{ index: 2, visible: false }], noValue: {} } },
          },
          labels: { enabled: true, source: { kind: 'expression', expression: "functional_class || ' ' || lanes" }, size: 14, color: '#112233', halo: { enabled: true, color: '#ffffff', width: 2 }, placement: { kind: 'point', anchor: 'above', offset: 4 } },
        },
        ready
      )
      assert.strictEqual(before.labelError, undefined, 'the label expression is accepted')
      assert.ok((before.channels?.dash?.classes.length ?? 0) >= 2, 'the pattern has classes')
      assert.strictEqual(before.channels?.opacity?.classes.find((c) => c.key === 'range:2')?.visible, false)
      await vscode.commands.executeCommand('spatialExplorer._saveStyle')
      const sidecar = path.join(dir, 'roads.qml')
      const deadline = Date.now() + 10000
      while (!fs.existsSync(sidecar)) {
        assert.ok(Date.now() < deadline, 'roads.qml was not written')
        await sleep(100)
      }
      const qml = fs.readFileSync(sidecar, 'utf8')
      assert.match(qml, /<Option name="outlineStyle" type="Map">/)
      assert.match(qml, /<Option name="alpha" type="Map">/)
      assert.match(qml, /name="spatialExplorer\/style"/)
      assert.match(qml, /<labeling type="simple">/)

      await open()
      let after: StyleState | null = null
      const until = Date.now() + 10000
      while (Date.now() < until) {
        after = await styleState()
        if (ready(after)) break
        await sleep(100)
      }
      assert.strictEqual(after?.source, 'roads.qml')
      assert.deepStrictEqual(after?.channels, before.channels)
      assert.deepStrictEqual(after?.labels, before.labels)
      assert.strictEqual(after?.labelError, undefined)
      assert.deepStrictEqual(after?.classes.map((c) => c.color), before.classes.map((c) => c.color))
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
