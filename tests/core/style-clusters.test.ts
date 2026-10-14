// @vitest-environment happy-dom
// Clusters (bubbles), after mapgl's cluster_options: the style model and its
// defaults, the legend's steps, the map's paint and count text, the engine's
// clustered tiles, and QML / Mapbox GL / SLD.
import { describe, expect, it } from 'vitest'
import {
  CLUSTER_FILTER,
  DEFAULT_CLUSTERS,
  DEFAULT_LAYER_STYLE,
  clusterCountText,
  clusterLegendRows,
  clusterPaint,
  clusterSourceOptions,
  clusterTiles,
  drawOf,
  exportStyle,
  importStyle,
  previewExportNotice,
  rendererOf,
  resolveStyle,
  sanitizeStyle,
  setClusters,
  startStyle,
  styleDataColumns,
  tileSql,
  type LayerStyle,
  type ViewTarget,
} from '@spatial-explorer/core'

const layer = { columns: [{ name: 'name', type: 'VARCHAR' }], features: [] }
const clustered = (): LayerStyle => sanitizeStyle(startStyle(DEFAULT_LAYER_STYLE, 'clusters', layer))

describe('clusters: the style', () => {
  it("starts from mapgl's cluster_options defaults", () => {
    const r = rendererOf(clustered())
    expect(r).toEqual({
      kind: 'clusters',
      radius: 50,
      maxZoom: 14,
      steps: [
        { from: 2, color: '#51bbd6', radius: 20 },
        { from: 100, color: '#f1f075', radius: 30 },
        { from: 750, color: '#f28cb1', radius: 40 },
      ],
      countFormat: 'abbreviated',
      textColor: '#000000',
      opacity: 1,
      strokeColor: '#ffffff',
      strokeWidth: 0,
    })
    expect(DEFAULT_CLUSTERS.steps).toHaveLength(3)
  })

  it('is a way of drawing points: no color channel, nothing varies on points, no columns read', () => {
    const s = clustered()
    expect(drawOf(s).points).toBe('clusters')
    expect(s.channels?.color).toBeUndefined()
    expect(styleDataColumns(s)).toEqual([])
  })

  it('keeps steps valid: rising counts from 2, radii and colors in range, at most 6', () => {
    const s = setClusters(clustered(), {
      steps: [
        { from: 10, color: '#FF0000', radius: 200 },
        { from: 5, color: '#00ff00', radius: 10 },
        { from: 50, color: 'not a color', radius: 10 },
        { from: 80, color: '#0000ff', radius: 1 },
      ],
    })
    expect(rendererOf(sanitizeStyle(s))).toMatchObject({
      steps: [
        { from: 2, color: '#ff0000', radius: 100 },
        { from: 80, color: '#0000ff', radius: 4 },
      ],
    })
    const many = Array.from({ length: 9 }, (_, i) => ({ from: 2 + i * 10, color: '#123456', radius: 10 }))
    expect((rendererOf(sanitizeStyle(setClusters(clustered(), { steps: many }))) as { steps: unknown[] }).steps).toHaveLength(6)
    expect(rendererOf(sanitizeStyle(setClusters(clustered(), { radius: 999, maxZoom: 40 })))).toMatchObject({ radius: 200, maxZoom: 17 })
  })

  it('switching to another color type leaves clusters', () => {
    const back = sanitizeStyle(startStyle(clustered(), 'single', layer))
    expect(drawOf(back).points).toBe('markers')
    expect(rendererOf(back).kind).toBe('single')
  })
})

describe('clusters: legend', () => {
  it('names the counts each step covers, then the points not in a group', () => {
    const s = clustered()
    const resolved = resolveStyle(s, layer)
    expect(resolved.caption).toBe('Clusters')
    expect(resolved.clusters?.steps.map((st) => st.label)).toEqual(['2–99 points', '100–749 points', '750+ points'])
    expect(resolved.classes.map((c) => c.label)).toEqual(['Single points'])
    // Bubbles to scale: the largest fills a row.
    const rows = clusterLegendRows(s, resolved, 10)
    expect(rows.map((r) => [r.color, r.symbol.radius])).toEqual([
      ['#51bbd6', 5],
      ['#f1f075', 7.5],
      ['#f28cb1', 10],
    ])
  })
})

describe('clusters: the map', () => {
  it('steps color and radius by point_count, as mapgl does', () => {
    const p = clusterPaint(clustered())
    expect(CLUSTER_FILTER).toEqual(['has', 'point_count'])
    expect(p?.bubble['circle-color']).toEqual(['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'])
    expect(p?.bubble['circle-radius']).toEqual(['step', ['get', 'point_count'], 20, 100, 30, 750, 40])
    expect(p?.count.paint['text-color']).toBe('#000000')
  })

  it("abbreviates counts as mapgl's labels (987, 1.2k, 12k, 1.2M), groups or leaves them plain", () => {
    expect(JSON.stringify(clusterCountText('abbreviated'))).toContain('"k"')
    expect(clusterCountText('grouped')).toEqual(['number-format', ['get', 'point_count'], { locale: 'en-US' }])
    expect(clusterCountText('raw')).toEqual(['to-string', ['get', 'point_count']])
  })

  it('turns the GeoJSON source clustering on and off with the style', () => {
    const s = clustered()
    expect(clusterSourceOptions(s, resolveStyle(s, layer))).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: 14 })
    expect(clusterSourceOptions(DEFAULT_LAYER_STYLE, resolveStyle(DEFAULT_LAYER_STYLE, layer))).toEqual({ cluster: false })
    expect(clusterTiles(s)).toEqual({ radius: 50, maxZoom: 14 })
    expect(clusterTiles(DEFAULT_LAYER_STYLE)).toBeNull()
  })
})

describe('clusters: engine tiles', () => {
  const t: ViewTarget = { relation: '__se_layer', index: 'columns', geom: '"geom"', srid: 4326, attrs: ['name'] }
  const box: [number, number, number, number] = [-112.5, 39.9, -111.1, 41.01]
  const attrs = [{ name: 'name', type: 'VARCHAR' }]

  it('groups points on a grid that lines up across tiles, merging neighbors within the radius', () => {
    const sql = tileSql(t, 8, 48, 97, box, attrs, { radius: 50, maxZoom: 14 })
    // 512 / 50 px rounds to 10 cells a tile.
    expect(sql).toContain('floor(__x / 409.6)')
    expect(sql).toContain('arg_max([o.__cx, o.__cy], [o.n, o.__cx, o.__cy])')
    expect(sql).toContain(`< ${(50 * 8) ** 2}`)
    // Bubbles carry point_count; the features keep their id and attributes (NULLs are left out of a tile).
    expect(sql).toContain(`'point_count': n`)
    expect(sql).toContain(`'name': NULL::VARCHAR`)
    expect(sql).toContain(`'__id': __se_rowid`)
  })

  it('draws plain tiles above the clusters zoom, and without clusters', () => {
    expect(tileSql(t, 15, 1, 1, box, attrs, { radius: 50, maxZoom: 14 })).not.toContain('point_count')
    expect(tileSql(t, 8, 48, 97, box, attrs)).not.toContain('point_count')
  })
})

describe('clusters: files', () => {
  const style = setClusters(clustered(), { radius: 40, countFormat: 'grouped' })

  it("QML: QGIS's point cluster renderer around the single symbol, colored and sized by @cluster_size", () => {
    const resolved = resolveStyle(style, layer)
    const { text, notes } = exportStyle(style, 'qml', 'Point', 'points.geojson', resolved)
    expect(text).toContain('type="pointCluster" tolerance="40" toleranceUnit="Pixel"')
    expect(text).toContain('type="singleSymbol"')
    expect(text).toContain('name="centerSymbol"')
    expect(text).toContain("CASE WHEN @cluster_size &gt;= 750 THEN '#f28cb1' WHEN @cluster_size &gt;= 100 THEN '#f1f075' ELSE '#51bbd6' END")
    expect(text).toContain('format_number(@cluster_size, 0)')
    expect(notes).toContain('QGIS groups points at every scale: the "up to zoom 14" limit is kept here only.')
    // Reloads exactly.
    expect(rendererOf(importStyle('points.qml', text).style)).toEqual(rendererOf(sanitizeStyle(style)))
  })

  it('QML from QGIS: a point cluster around a single symbol becomes clusters, its distance the radius', () => {
    const resolved = resolveStyle(style, layer)
    const ours = exportStyle(style, 'qml', 'Point', 'points.geojson', resolved).text
    // As QGIS would save it: no spatialExplorer properties.
    const foreign = ours.replace(/<customproperties>[\s\S]*?<\/customproperties>/, '').replace('tolerance="40" toleranceUnit="Pixel"', 'tolerance="5" toleranceUnit="MM"')
    const { style: imported, notes } = importStyle('points.qml', foreign)
    expect(rendererOf(imported)).toMatchObject({ kind: 'clusters', radius: 19, steps: DEFAULT_CLUSTERS.steps })
    expect(notes).toContain('QGIS clusters have one bubble symbol: the bubbles take the default steps.')
  })

  it('Mapbox GL: a clustered source with the bubbles, their counts and the points left alone', () => {
    const resolved = resolveStyle(style, layer)
    const doc = JSON.parse(exportStyle(style, 'mapbox', 'Point', 'points.geojson', resolved).text)
    expect(doc.sources.data).toMatchObject({ type: 'geojson', cluster: true, clusterRadius: 40, clusterMaxZoom: 14 })
    const ids = doc.layers.map((l: { id: string }) => l.id)
    expect(ids).toEqual(expect.arrayContaining(['points-clusters', 'points-cluster-count', 'points-point']))
    const point = doc.layers.find((l: { id: string }) => l.id === 'points-point')
    expect(JSON.stringify(point.filter)).toContain('["!",["has","point_count"]]')
    // Without our metadata (mapgl's own output has none), the steps are read from the expressions.
    delete doc.metadata
    const { style: back } = importStyle('points.json', JSON.stringify(doc))
    expect(rendererOf(back)).toMatchObject({ kind: 'clusters', radius: 40, maxZoom: 14, countFormat: 'grouped', steps: DEFAULT_CLUSTERS.steps })
  })

  it("SLD has none: the save menu says so", () => {
    expect(previewExportNotice(style, 'sld', resolveStyle(style, layer)).items.join(' ')).toContain('SLD has no clusters')
  })
})
