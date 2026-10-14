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
  addCondition,
  updateCondition,
  setConditionElse,
  setChannelCurve,
  setChannelRamp,
  setChannelRange,
  setFixed,
  setScaleKind,
  setLabels,
  startStyle,
  visibilityFilter,
  type LayerStyle,
} from '@spatial-explorer/core'

const OUT = process.env.SE_QGIS_011

/** The property's type, as the map parses it (colors, numbers, dash arrays; icon ids and filters as they are). */
function specFor(key: string): unknown {
  const t = /color$/.test(key) ? 'color' : /dasharray$/.test(key) ? 'array' : /(width|opacity|rotate|radius|size)$/.test(key) ? 'number' : null
  if (!t) return key
  return { type: t, ...(t === 'array' ? { value: 'number' } : {}), 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature', 'feature-state'] } }
}

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type: string): unknown {
  if (!Array.isArray(expr)) return expr
  const parsed = expression.createExpression(expr, specFor(key) as never)
  if (parsed.result !== 'success') throw new Error(`${key}: ${(parsed.value as Array<{ key: string; message: string }>).map((e) => `${e.key} ${e.message}`).join('; ')}`)
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

/** 72 features: a class (3), a kind (9, uneven: some share Other for shapes), a number (every 11th null) and an angle. */
const KINDS = ['k1', 'k1', 'k1', 'k1', 'k2', 'k2', 'k2', 'k3', 'k3', 'k4', 'k4', 'k5', 'k5', 'k6', 'k7', 'k8', 'k9', 'k1']
// Spec 011 US4: a fraction (as-is opacity) and colors as text (as-is colors; every 7th isn't one, every 13th is missing).
const rows = Array.from({ length: 72 }, (_, i) => ({
  cls: ['A', 'B', 'C'][i % 3],
  kind: KINDS[i % KINDS.length],
  num: i % 11 === 5 ? null : (i * 13) % 97,
  deg: (i * 37) % 360,
  frac: (i % 10) / 10,
  hex: i % 13 === 4 ? null : i % 7 === 3 ? 'not-a-color' : `#${((i * 2654435) % 0xffffff).toString(16).padStart(6, '0')}`,
}))
const columns = [
  { name: 'cls', type: 'VARCHAR' },
  { name: 'kind', type: 'VARCHAR' },
  { name: 'num', type: 'DOUBLE' },
  { name: 'deg', type: 'INTEGER' },
  { name: 'frac', type: 'DOUBLE' },
  { name: 'hex', type: 'VARCHAR' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }

/** QGIS's names for our marker shapes (qml.ts qgisMarker): our "x" is the filled cross turned 45°. */
const QGIS_SHAPE: Record<string, string> = { circle: 'circle', square: 'square', triangle: 'triangle', diamond: 'diamond', star: 'star', cross: 'cross_fill', x: 'cross_fill' }
/** A color as `#rrggbb`: hex as is, MapLibre's `rgba(r,g,b,a)` (a Color's text) converted. */
function toHex(v: unknown): string {
  const s = String(v).toLowerCase()
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(s)
  return m ? '#' + m.slice(1, 4).map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('') : s
}
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
    // Spec 011 US4: continuous and as is (circles: smooth paint; triangles: their icons).
    let smooth: LayerStyle = setChannelRamp(setScaleKind(setChannelColumn(base, 'strokeColor', 'num', layer), 'strokeColor', 'continuous', layer), 'strokeColor', { id: 'brewer-ylorrd', reversed: false })
    smooth = setChannelCurve(setChannelRange(setScaleKind(setChannelColumn(smooth, 'strokeWidth', 'num', layer), 'strokeWidth', 'continuous', layer), 'strokeWidth', 0.5, 4), 'strokeWidth', 'area')
    smooth = setScaleKind(setChannelColumn(smooth, 'opacity', 'frac', layer), 'opacity', 'identity', layer)
    let asIs: LayerStyle = setFixed(base, 'shape', 'triangle')
    asIs = setScaleKind(setChannelColumn(asIs, 'rotation', 'deg', layer), 'rotation', 'identity', layer)
    asIs = setScaleKind(setChannelColumn(asIs, 'strokeColor', 'hex', layer), 'strokeColor', 'identity', layer)
    asIs = setFixed(asIs, 'strokeWidth', 2)
    // Spec 011 US4: conditions (the map reads the engine's rule index, computed below as the engine would).
    let byRules: LayerStyle = setScaleKind(setChannelColumn(base, 'shape', 'kind', layer), 'shape', 'conditions', layer)
    byRules = updateCondition(byRules, 'shape', 'r1', { where: 'deg > 180', output: 'star' })
    byRules = addCondition(byRules, 'shape', "cls = 'A'")
    byRules = updateCondition(byRules, 'shape', 'r2', { output: 'square' })
    byRules = setScaleKind(setChannelColumn(byRules, 'strokeWidth', 'num', layer), 'strokeWidth', 'conditions', layer)
    byRules = updateCondition(byRules, 'strokeWidth', 'r1', { where: 'num > 50', output: 3, visible: true })
    byRules = addCondition(byRules, 'strokeWidth', 'num > 90')
    byRules = updateCondition(byRules, 'strokeWidth', 'r2', { visible: false })
    byRules = setConditionElse(byRules, 'strokeWidth', { output: 1 })
    const ruleIndex = (tests: Array<(r: (typeof rows)[number]) => boolean>) => (r: (typeof rows)[number]) => tests.findIndex((t) => t(r))
    const engine: Record<string, (r: (typeof rows)[number]) => number> = {
      __se_cls_shape: ruleIndex([(r) => r.deg > 180, (r) => r.cls === 'A']),
      __se_cls_strokeWidth: ruleIndex([(r) => r.num !== null && r.num > 50, (r) => r.num !== null && r.num > 90]),
    }
    const counted = () => ({
      ...layer,
      ruleCountsByChannel: Object.fromEntries(
        Object.entries(engine).map(([col, f]) => [col.replace('__se_cls_', ''), rows.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map<number, number>())])
      ),
    })
    // Spec 011 US4: Color itself continuous (polygons, the fill opacity kept) and as is (points).
    const colorContinuous: LayerStyle = setChannelRamp(setScaleKind(setChannelColumn(base, 'color', 'num', layer), 'color', 'continuous', layer), 'color', { id: 'brewer-blues', reversed: false })
    const colorAsIs: LayerStyle = setScaleKind(setChannelColumn(base, 'color', 'hex', layer), 'color', 'identity', layer)
    const cases: Array<{ name: string; geometry: 'point' | 'line' | 'polygon'; style: LayerStyle; input?: ReturnType<typeof counted> }> = [
      { name: 'polygons-color-continuous', geometry: 'polygon', style: colorContinuous },
      { name: 'points-color-as-is', geometry: 'point', style: colorAsIs },
      { name: 'points-conditions', geometry: 'point', style: byRules, input: counted() },
      { name: 'points-continuous', geometry: 'point', style: smooth },
      { name: 'points-as-is', geometry: 'point', style: asIs },
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
      const resolved = resolveStyle(c.style, c.input ?? layer)
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
      const expected = rows.map((row) => {
        // The engine's rule index per property, as the map reads it (conditions cases).
        const props: Record<string, unknown> = { ...row, ...(c.input ? Object.fromEntries(Object.entries(engine).map(([col, f]) => [col, f(row)])) : {}) }
        const visible = filter ? ev(filter, props, 'filter') === true : true
        const out: Record<string, unknown> = { visible }
        // The fill's alpha: the symbol's fill opacity, which a data-defined fill color must keep.
        if (c.geometry !== 'line') out.fillAlpha = Math.round(c.style.fillOpacity * 255)
        if (c.geometry === 'point') {
          const parsed = parseMarkerIconId(String(ev(l.marker?.['icon-image'], props, 'layout.icon-image')))
          // Circles are drawn by the circle layer (smooth paint), other shapes from their icons.
          const icon = parsed && parsed.shape !== 'circle' ? parsed : null
          out.color = toHex(icon?.fillColor ?? ev(p.circle['circle-color'], props, 'paint.circle-color'))
          out.strokeColor = toHex(icon?.strokeColor ?? ev(p.circle['circle-stroke-color'], props, 'paint.circle-stroke-color'))
          out.strokeWidth = Math.round(Number(icon?.strokeWidth ?? ev(p.circle['circle-stroke-width'], props, 'paint.circle-stroke-width')) * 10000) / 10000
          const shape = icon?.shape ?? 'circle'
          out.shape = QGIS_SHAPE[shape]
          out.angle = Number(ev(l.marker?.['icon-rotate'] ?? 0, props, 'layout.icon-rotate')) + (shape === 'x' ? 45 : 0)
          const o = Number(ev(p.marker['icon-opacity'] ?? 1, props, 'paint.icon-opacity'))
          out.opacity = Math.round(o * 10000) / 100
        } else if (c.geometry === 'polygon') {
          out.color = toHex(ev(p.fill['fill-color'], props, 'paint.fill-color'))
          out.strokeColor = toHex(ev(p['fill-outline']['line-color'], props, 'paint.line-color'))
          out.strokeWidth = Number(ev(p['fill-outline']['line-width'], props, 'paint.line-width'))
        } else {
          out.color = toHex(ev(p.line['line-color'], props, 'paint.line-color'))
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
