// @vitest-environment happy-dom
// Clusters: QGIS reads our cluster QML. With SE_QGIS_CLUSTERS=<dir>, writes
// two groups of points (300 and 120) and five far apart, the QML the app
// saves, and the colors each should take. tests/qgis/check_clusters.py loads
// them into QGIS and compares. Skipped without the variable.
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_LAYER_STYLE, exportStyle, resolveStyle, setClusters, startStyle } from '@spatial-explorer/core'

const OUT = process.env.SE_QGIS_CLUSTERS

describe.runIf(OUT)('QGIS clusters cases (SE_QGIS_CLUSTERS)', () => {
  it('writes the cases', () => {
    const dir = OUT as string
    fs.mkdirSync(dir, { recursive: true })
    const group = (n: number, cx: number, cy: number) =>
      Array.from({ length: n }, (_, i) => {
        const a = i * 2.399963
        const r = 0.01 * Math.sqrt(i / n)
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
      })
    const loners = [
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
      [0, -0.35],
    ]
    const points = [...group(300, -0.15, 0), ...group(120, 0.15, 0), ...loners]
    const features = points.map((c, i) => ({ type: 'Feature', properties: { n: i }, geometry: { type: 'Point', coordinates: c } }))
    fs.writeFileSync(path.join(dir, 'points.geojson'), JSON.stringify({ type: 'FeatureCollection', features }))
    const layer = { columns: [{ name: 'n', type: 'BIGINT' }], features: [] }
    const style = setClusters(startStyle({ ...DEFAULT_LAYER_STYLE, fillColor: '#3b82f6', fillOpacity: 1 }, 'clusters', layer), {
      radius: 40,
      steps: [
        { from: 2, color: '#51bbd6', radius: 20 },
        { from: 100, color: '#f1f075', radius: 30 },
        { from: 250, color: '#f28cb1', radius: 40 },
      ],
    })
    fs.writeFileSync(path.join(dir, 'clusters.qml'), exportStyle(style, 'qml', 'Point', 'points.geojson', resolveStyle(style, layer)).text)
    fs.writeFileSync(
      path.join(dir, 'expected.json'),
      JSON.stringify({ big: { at: [-0.15, 0], color: '#f28cb1' }, mid: { at: [0.15, 0], color: '#f1f075' }, loner: { at: [-0.3, -0.3], color: '#3b82f6' }, tolerance: 40 })
    )
  })
})
