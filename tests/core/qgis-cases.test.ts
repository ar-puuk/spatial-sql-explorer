// @vitest-environment happy-dom
// Spec 009 T028 (SC-005): QGIS parity cases. With SE_QGIS_CASES=<dir>, writes
// for each case the data (GeoJSON), the QML the app saves, and what the map
// draws per feature (color, QGIS size: line width or marker diameter, and
// whether it is drawn), evaluated with MapLibre's own evaluator.
// tests/qgis/check_009.py then asks QGIS's renderer the same per feature.
// Skipped without the variable (it needs PyQGIS to mean anything).
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { DEFAULT_LAYER_STYLE, exportStyle, paintFor, resolveStyle, setBivariateAxis, setCellVisible, setSizeChannel, setSizeClassVisible, setSizeMode, startStyle, visibilityFilter, type LayerStyle } from '@spatial-explorer/core'

const OUT = process.env.SE_QGIS_CASES

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type: string): unknown {
  if (!Array.isArray(expr)) return expr
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

/** 60 features: a class, traffic (every 9th null) and a second number. */
const rows = Array.from({ length: 60 }, (_, i) => ({ cls: ['A', 'B', 'C'][i % 3], aadt: i % 9 === 4 ? null : (i + 1) * 137, w: (i * 7) % 23 }))
const columns = [
  { name: 'cls', type: 'VARCHAR' },
  { name: 'aadt', type: 'BIGINT' },
  { name: 'w', type: 'INTEGER' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }

describe.runIf(OUT)('QGIS parity cases (SE_QGIS_CASES)', () => {
  it('writes the cases', () => {
    const base = DEFAULT_LAYER_STYLE as LayerStyle
    const categorized = startStyle(base, 'categorized', layer, 'cls')
    const graduated = startStyle(base, 'graduated', layer, 'w')
    // Spec 009 US4: a bivariate polygon map (aadt x w), one cell hidden.
    const bivariate = setCellVisible(setBivariateAxis(setBivariateAxis(startStyle(base, 'bivariate', layer), 'x', { column: 'aadt' }), 'y', { column: 'w' }), 'cell:1-2', false)
    const cases: Array<{ name: string; geometry: 'point' | 'line' | 'polygon'; style: LayerStyle }> = [
      { name: 'bivariate-polygons', geometry: 'polygon', style: bivariate },
      { name: 'categorized-classed-lines', geometry: 'line', style: setSizeChannel(categorized, 'aadt', 'line') },
      { name: 'categorized-proportional-points', geometry: 'point', style: setSizeMode(setSizeChannel(categorized, 'aadt', 'point'), 'proportional') },
      { name: 'graduated-classed-hidden-points', geometry: 'point', style: setSizeClassVisible(setSizeChannel(graduated, 'aadt', 'point'), 'size:range:2', false) },
      { name: 'single-proportional-lines', geometry: 'line', style: setSizeMode(setSizeChannel(base, 'aadt', 'line'), 'proportional') },
    ]
    const dir = OUT as string
    fs.mkdirSync(dir, { recursive: true })
    for (const c of cases) {
      const resolved = resolveStyle(c.style, layer)
      const geometryType = c.geometry === 'point' ? 'Point' : c.geometry === 'line' ? 'LineString' : 'Polygon'
      const features = rows.map((p, i) => ({
        type: 'Feature',
        properties: p,
        geometry:
          c.geometry === 'point'
            ? { type: 'Point', coordinates: [i * 0.01, 0] }
            : c.geometry === 'line'
              ? { type: 'LineString', coordinates: [[i * 0.01, 0], [i * 0.01 + 0.005, 0.005]] }
              : { type: 'Polygon', coordinates: [[[i * 0.01, 0], [i * 0.01 + 0.008, 0], [i * 0.01 + 0.008, 0.008], [i * 0.01, 0]]] },
      }))
      fs.writeFileSync(path.join(dir, `${c.name}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }))
      fs.writeFileSync(path.join(dir, `${c.name}.qml`), exportStyle(c.style, 'qml', geometryType, `${c.name}.geojson`, resolved, columns).text)
      const p = paintFor(c.style, resolved, '#f59e0b')
      const filter = visibilityFilter(c.style, resolved)
      const expected = rows.map((props) => {
        const visible = filter ? evaluate(filter, props, 'layers[0].filter', geometryType) === true : true
        const color =
          c.geometry === 'line'
            ? evaluate(p.line['line-color'], props, 'layers[0].paint.line-color', geometryType)
            : c.geometry === 'point'
              ? evaluate(p.circle['circle-color'], props, 'layers[0].paint.circle-color', geometryType)
              : evaluate(p.fill['fill-color'], props, 'layers[0].paint.fill-color', geometryType)
        // Polygons have no size channel: only color and visibility are compared.
        const size = c.geometry === 'line' ? evaluate(p.line['line-width'], props, 'layers[0].paint.line-width', geometryType) : c.geometry === 'point' ? 2 * (evaluate(p.circle['circle-radius'], props, 'layers[0].paint.circle-radius', geometryType) as number) : null
        return { visible, color: String(color).toLowerCase(), size }
      })
      fs.writeFileSync(path.join(dir, `${c.name}.expected.json`), JSON.stringify({ geometry: c.geometry, features: expected }, null, 1))
    }
  })
})
