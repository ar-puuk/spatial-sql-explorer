// @vitest-environment happy-dom
// Spec 011 T011 (US2): sidecars saved by 0.3.0 (fixtures/style/pre-011-sidecars)
// import as channels and draw exactly what the pre-011 build drew after
// importing them (fixtures/style/pre-011-imports.json, recorded by
// record-pre-011-imports.test.ts); saved again and reopened, they still do.
// The full model also rides in spatialExplorer/style, preferred on import.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { exportStyle, importStyle, resolveStyle, sanitizeStyle, type LayerStyle } from '@spatial-explorer/core'
import { PRE_011_SIDECAR_GEOMETRY, PRE_011_STYLES, snapshotLayer011 } from './fixtures/style/pre-011-styles'
import { drawnAfterImport } from './fixtures/style/pre-011-drawn'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'fixtures', 'style')
const sidecar = (name: string) => readFileSync(join(dir, 'pre-011-sidecars', `${name}.qml`), 'utf8')
const recorded = JSON.parse(readFileSync(join(dir, 'pre-011-imports.json'), 'utf8')) as { styles: Record<string, unknown> }
const layer = snapshotLayer011()

describe('0.3.0 sidecars import as channels and draw as before', () => {
  for (const [name, geometry] of Object.entries(PRE_011_SIDECAR_GEOMETRY)) {
    it(name, () => {
      const imported = importStyle(`${name}.qml`, sidecar(name)).style
      expect(Object.keys(imported)).not.toContain('renderer')
      expect(drawnAfterImport(imported)).toEqual(recorded.styles[name])
      // Saved again with 011 and reopened: drawn the same.
      const again = exportStyle(imported, 'qml', geometry, `${name}.geojson`, resolveStyle(imported, layer), layer.columns)
      expect(drawnAfterImport(importStyle(`${name}.qml`, again.text).style)).toEqual(recorded.styles[name])
    })
  }
})

describe('spatialExplorer/style', () => {
  it('is written, and preferred on import', () => {
    const style = sanitizeStyle(PRE_011_STYLES.categorizedWithSize)
    const qml = exportStyle(style, 'qml', 'Mixed', 'x.geojson', resolveStyle(style, layer), layer.columns).text
    const m = /<Option name="spatialExplorer\/style" type="QString" value="([^"]*)"\/>/.exec(qml)
    expect(m).not.toBeNull()
    const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const saved = JSON.parse(unescape(m![1])) as LayerStyle
    expect(saved.channels).toEqual(style.channels)
    // Edit the property: the import follows it, not the renderer QGIS sees.
    saved.channels!.color = { ...saved.channels!.color!, legend: { title: 'Kind of thing' } }
    const back = importStyle('x.qml', qml.replace(m![1], escape(JSON.stringify(saved)))).style
    expect(back.channels?.color?.legend).toEqual({ title: 'Kind of thing' })
  })
})
