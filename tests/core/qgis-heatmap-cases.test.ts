// @vitest-environment happy-dom
// Heatmap: QGIS reads our heatmap QML. With SE_QGIS_HEATMAP=<dir>, writes a
// clustered point GeoJSON and the QML the app saves, radius in pixels and in
// meters (weighted by pop), plus the ramp's last color.
// tests/qgis/check_heatmap.py loads them into QGIS and compares. Skipped
// without the variable.
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_LAYER_STYLE, exportStyle, resolveStyle, setHeatmap, startStyle } from '@spatial-explorer/core'

const OUT = process.env.SE_QGIS_HEATMAP

describe.runIf(OUT)('QGIS heatmap cases (SE_QGIS_HEATMAP)', () => {
  it('writes the cases', () => {
    const dir = OUT as string
    fs.mkdirSync(dir, { recursive: true })
    const features = Array.from({ length: 200 }, (_, i) => {
      const a = i * 2.399963
      const r = i < 150 ? 0.02 * Math.sqrt(i / 150) : 0.3 * Math.sqrt((i - 150) / 50)
      return { type: 'Feature', properties: { pop: (i % 10) + 1 }, geometry: { type: 'Point', coordinates: [r * Math.cos(a), r * Math.sin(a)] } }
    })
    fs.writeFileSync(path.join(dir, 'points.geojson'), JSON.stringify({ type: 'FeatureCollection', features }))
    const layer = { columns: [{ name: 'pop', type: 'BIGINT' }], features: features.map((f, id) => ({ id, geometry: null, attributes: f.properties })) }
    const px = setHeatmap(startStyle(DEFAULT_LAYER_STYLE, 'heatmap', layer), { radius: 15 })
    const m = setHeatmap(px, { weight: 'pop', radiusUnit: 'm', radiusMeters: 3000, latitude: 0 })
    for (const [name, style] of [['px', px], ['m', m]] as const) {
      const resolved = resolveStyle(style, layer)
      fs.writeFileSync(path.join(dir, `heatmap-${name}.qml`), exportStyle(style, 'qml', 'Point', 'points.geojson', resolved).text)
      fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({ densest: resolved.heat?.colors.at(-1) }))
    }
  })
})
