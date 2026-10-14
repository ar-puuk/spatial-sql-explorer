// Spec 011 T003/T004: records how the PRE-011 build draws and saves every style
// in fixtures/style/pre-011-styles.ts. Run once, on the build before spec 011
// changes the style code, with SE_RECORD_011=1:
//
//   SE_RECORD_011=1 npx vitest run record-pre-011     (in tests/core)
//
// It writes fixtures/style/pre-011-snapshot.json (resolve, paint, layout,
// filter, marker icons) and fixtures/style/pre-011-sidecars/<name>.qml (the
// 0.3.0 sidecars). Without the variable it does nothing; style-migration-011
// compares against what it wrote (SC-002).
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { drawsHeatmap, exportStyle, layoutFor, markerIconIds, paintFor, resolveStyle, sanitizeStyle, visibilityFilter } from '@spatial-explorer/core'
import { PRE_011_SIDECAR_GEOMETRY, PRE_011_STYLES, snapshotLayer011 } from './fixtures/style/pre-011-styles'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'fixtures', 'style')
const record = process.env.SE_RECORD_011 === '1'

describe.runIf(record)('record the pre-011 drawing (SE_RECORD_011=1)', () => {
  it('writes pre-011-snapshot.json and the 0.3.0 sidecars', () => {
    const layer = snapshotLayer011()
    const snapshot: Record<string, unknown> = {}
    mkdirSync(join(out, 'pre-011-sidecars'), { recursive: true })
    for (const [name, raw] of Object.entries(PRE_011_STYLES)) {
      const style = sanitizeStyle(raw)
      const resolved = resolveStyle(style, layer)
      snapshot[name] = {
        resolved,
        paint: paintFor(style, resolved, '#f59e0b', 40),
        layout: layoutFor(style, resolved),
        filter: visibilityFilter(style, resolved),
        icons: markerIconIds(style, resolved),
        heatmap: drawsHeatmap(style, resolved),
      }
      const geometry = PRE_011_SIDECAR_GEOMETRY[name]
      if (geometry) {
        const qml = exportStyle(style, 'qml', geometry, `${name}.geojson`, resolved, layer.columns)
        writeFileSync(join(out, 'pre-011-sidecars', `${name}.qml`), qml.text)
      }
    }
    const header = { recordedFrom: process.env.SE_RECORD_011_COMMIT ?? 'unknown', note: 'Spec 011 T003: the pre-011 drawing of pre-011-styles.ts. Do not regenerate after spec 011 changes the style code.' }
    writeFileSync(join(out, 'pre-011-snapshot.json'), JSON.stringify({ header, styles: snapshot }, null, 1) + '\n')
  })
})
