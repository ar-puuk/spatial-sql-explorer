// @vitest-environment happy-dom
// Spec 011 T051 (SC-003): QGIS parity cases for properties that vary by a
// column (Vary by attribute). With SE_QGIS_011=<dir>, writes for each case the
// data (GeoJSON), the QML the app saves, and what the map draws per feature,
// read from the map's own expressions (MapLibre's evaluator), in QGIS's terms:
// color, outline color and width, marker shape (QGIS name) and angle,
// pattern (Qt pen name), opacity (percent), and whether it is drawn.
// tests/qgis/check_011.py asks QGIS the same per feature.
// Skipped without the variable (it needs PyQGIS to mean anything).
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  exportStyle,
  layoutFor,
  paintFor,
  parseMarkerIconId,
  resolveStyle,
  sanitizeStyle,
  setChannelClass,
  setChannelClasses,
  setChannelColumn,
  setFixed,
  setLabels,
  startStyle,
  visibilityFilter,
  type LayerStyle,
} from '@spatial-explorer/core'

const OUT = process.env.SE_QGIS_011

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type: string): unknown {
  if (!Array.isArray(expr)) return expr
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

/** 72 features: a class (3), a kind (9, uneven: some share Other for shapes), a number (every 11th null) and an angle. */
const KINDS = ['k1', 'k1', 'k1', 'k1', 'k2', 'k2', 'k2', 'k3', 'k3', 'k4', 'k4', 'k5', 'k5', 'k6', 'k7', 'k8', 'k9', 'k1']
const rows = Array.from({ length: 72 }, (_, i) => ({ cls: ['A', 'B', 'C'][i % 3], kind: KINDS[i % KINDS.length], num: i % 11 === 5 ? null : (i * 13) % 97, deg: (i * 37) % 360 }))
const columns = [
  { name: 'cls', type: 'VARCHAR' },
  { name: 'kind', type: 'VARCHAR' },
  { name: 'num', type: 'DOUBLE' },
  { name: 'deg', type: 'INTEGER' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }

/** QGIS's names for our marker shapes (qml.ts qgisMarker): our "x" is the filled cross turned 45°. */
const QGIS_SHAPE: Record<string, string> = { circle: 'circle', square: 'square', triangle: 'triangle', diamond: 'diamond', star: 'star', cross: 'cross_fill', x: 'cross_fill' }
const QGIS_DASH: Record<string, string> = { solid: 'solid', dash: 'dash', dot: 'dot', 'dash-dot': 'dash dot', 'dash-dot-dot': 'dash dot dot' }
const PATTERNS: Record<string, number[]> = { solid: [1, 0], dash: [4, 2], dot: [1, 2], 'dash-dot': [4, 2, 1, 2], 'dash-dot-dot': [4, 2, 1, 2, 1, 2] }

describe.runIf(OUT)('QGIS parity cases for Vary by attribute (SE_QGIS_011)', () => {
  it('writes the cases', () => {
    const base = sanitizeStyle(DEFAULT_LAYER_STYLE)
    const categorized = sanitizeStyle(startStyle(base, 'categorized', layer, 'cls'))
    // Graduated color on a column without nulls: QGIS's graduated renderer draws nulls in no class (qml.ts, spec 008).
    const graduated = sanitizeStyle(startStyle(base, 'graduated', layer, 'deg'))
    // Points: color by class; shape by kind (Other included); outline color by class; rotation by angle classes; opacity by number, one class hidden.
    let points: LayerStyle = setChannelColumn(categorized, 'shape', 'kind', layer)
    points = setChannelColumn(points, 'strokeColor', 'cls', layer)
    points = setChannelColumn(points, 'rotation', 'deg', layer)
    points = setChannelColumn(points, 'opacity', 'num', layer)
    points = setChannelClasses(points, 'opacity', { classCount: 3 })
    points = setChannelClass(points, 'opacity', 'range:1', { visible: false })
    // Polygons: graduated color; outline color by kind; outline width by a number with nulls.
    let polygons: LayerStyle = setChannelColumn(graduated, 'strokeColor', 'kind', layer)
    polygons = setChannelColumn(polygons, 'strokeWidth', 'num', layer)
    // Lines: one color, a fixed width apart from the outline; pattern by class; opacity by number.
    let lines: LayerStyle = setFixed(base, 'width', 3, 'line')
    lines = setChannelColumn(lines, 'dash', 'cls', layer)
    lines = setChannelColumn(lines, 'opacity', 'num', layer)
    // Rules (a rule-based renderer) with a fixed rotation and shapes by class.
    let rules: LayerStyle = sanitizeStyle(startStyle(base, 'rules', layer))
    rules = setFixed(setFixed(rules, 'rotation', 30), 'shape', 'triangle')
    rules = setChannelColumn(rules, 'strokeWidth', 'cls', layer)
    const cases: Array<{ name: string; geometry: 'point' | 'line' | 'polygon'; style: LayerStyle }> = [
      { name: 'points-shape-outline-rotation-opacity', geometry: 'point', style: points },
      { name: 'polygons-outline-color-width', geometry: 'polygon', style: polygons },
      { name: 'lines-pattern-opacity', geometry: 'line', style: lines },
      { name: 'rules-points-fixed-rotation', geometry: 'point', style: rules },
      // Spec 011 US6: labels (QGIS reads them back: text, size, color, buffer, placement).
      { name: 'labels-points', geometry: 'point', style: setLabels(base, { enabled: true, source: { kind: 'column', column: 'kind' }, size: 16, color: '#aa3300', halo: { enabled: false }, placement: { anchor: 'below', offset: 6 } }, columns) },
      { name: 'labels-lines-expression', geometry: 'line', style: setLabels(lines, { enabled: true, source: { kind: 'expression', expression: "cls || ' ' || kind" }, halo: { color: '#000000', width: 2 } }, columns) },
      { name: 'labels-polygons', geometry: 'polygon', style: setLabels(polygons, { enabled: true, source: { kind: 'column', column: 'cls' } }, columns) },
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
      const l = layoutFor(c.style, resolved)
      const filter = visibilityFilter(c.style, resolved)
      const ev = (e: unknown, props: Record<string, unknown>, key: string) => evaluate(e, props, `layers[0].${key}`, geometryType)
      const expected = rows.map((props) => {
        const visible = filter ? ev(filter, props, 'filter') === true : true
        const out: Record<string, unknown> = { visible }
        if (c.geometry === 'point') {
          const icon = parseMarkerIconId(String(ev(l.marker?.['icon-image'], props, 'layout.icon-image')))
          out.color = String(icon?.fillColor ?? ev(p.circle['circle-color'], props, 'paint.circle-color')).toLowerCase()
          out.strokeColor = String(icon?.strokeColor ?? ev(p.circle['circle-stroke-color'], props, 'paint.circle-stroke-color')).toLowerCase()
          out.strokeWidth = Number(icon?.strokeWidth ?? ev(p.circle['circle-stroke-width'], props, 'paint.circle-stroke-width'))
          const shape = icon?.shape ?? 'circle'
          out.shape = QGIS_SHAPE[shape]
          out.angle = Number(ev(l.marker?.['icon-rotate'] ?? 0, props, 'layout.icon-rotate')) + (shape === 'x' ? 45 : 0)
          const o = Number(ev(p.marker['icon-opacity'] ?? 1, props, 'paint.icon-opacity'))
          out.opacity = Math.round(o * 10000) / 100
        } else if (c.geometry === 'polygon') {
          out.color = String(ev(p.fill['fill-color'], props, 'paint.fill-color')).toLowerCase()
          out.strokeColor = String(ev(p['fill-outline']['line-color'], props, 'paint.line-color')).toLowerCase()
          out.strokeWidth = Number(ev(p['fill-outline']['line-width'], props, 'paint.line-width'))
        } else {
          out.color = String(ev(p.line['line-color'], props, 'paint.line-color')).toLowerCase()
          out.strokeWidth = Number(ev(p.line['line-width'], props, 'paint.line-width'))
          const dash = (ev(p.line['line-dasharray'] ?? ['literal', [1, 0]], props, 'paint.line-dasharray') as number[] | undefined) ?? [1, 0]
          out.dash = QGIS_DASH[Object.entries(PATTERNS).find(([, v]) => v.join() === [...dash].join())?.[0] ?? 'solid']
          const lineOpacity = Number(ev(p.line['line-opacity'], props, 'paint.line-opacity'))
          out.opacity = Math.round((lineOpacity / c.style.strokeOpacity) * 10000) / 100
        }
        return out
      })
      // Labels as QGIS should read them back (QgsPalLayerSettings): placement 1 OverPoint, 3 Curved.
      const ls = c.style.labels
      const labels = ls?.enabled
        ? {
            fieldName: ls.source.kind === 'column' ? ls.source.column : ls.source.expression,
            isExpression: ls.source.kind === 'expression',
            size: ls.size,
            color: ls.color,
            buffer: ls.halo.enabled,
            ...(ls.halo.enabled ? { bufferSize: ls.halo.width, bufferColor: ls.halo.color } : {}),
            placement: c.geometry === 'line' ? 3 : 1,
            ...(c.geometry === 'point' && ls.placement.kind === 'point' ? { quadOffset: { above: 1, below: 7, left: 3, right: 5, center: 4 }[ls.placement.anchor], dist: ls.placement.offset } : {}),
            ...(c.geometry === 'polygon' ? { quadOffset: 4 } : {}),
          }
        : undefined
      fs.writeFileSync(path.join(dir, `${c.name}.expected.json`), JSON.stringify({ geometry: c.geometry, features: expected, ...(labels ? { labels } : {}) }, null, 1))
    }
  })
})
