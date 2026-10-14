// @vitest-environment happy-dom
// T070 (spec 008 US6, FR-025–FR-027): polygon extrusion in the style model,
// the map paint, and the QML / Mapbox GL / SLD interchange.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { expression as mlExpression } from '@maplibre/maplibre-gl-style-spec'
import {
  activeExtrusion,
  autoExtrusionScale,
  DEFAULT_LAYER_STYLE,
  exportStyle,
  extrusionColumn,
  extrusionFromQgis,
  extrusionHighSql,
  extrusionHeightExpression,
  extrusionUnavailableReason,
  flatCountSql,
  importStyle,
  paintFor,
  previewExportNotice,
  resolveStyle,
  sanitizeStyle,
  type Extrusion,
  type LayerStyle,
  extrusionOf,
} from '@spatial-explorer/core'

const here = path.dirname(fileURLToPath(import.meta.url))
const byColumn: Extrusion = { enabled: true, source: { kind: 'column', column: 'height_m' }, scale: 2 }
const styled = (e: Extrusion | undefined): LayerStyle => sanitizeStyle({ ...DEFAULT_LAYER_STYLE, extrusion: e })

/** Evaluates a MapLibre expression for one feature's properties. */
function evaluate(expr: unknown, properties: Record<string, unknown>): unknown {
  const parsed = mlExpression.createExpression(expr, 'layers[0].paint.fill-extrusion-height')
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 14 }, { type: 'Polygon', properties } as never, {} as never)
}

describe('extrusion model', () => {
  it('sanitizes: unknown shapes dropped, scale defaults to 1, constants not negative', () => {
    expect(extrusionOf(styled(byColumn))).toEqual(byColumn)
    expect(extrusionOf(styled({ enabled: true, source: { kind: 'column', column: 'h' }, scale: -3 }))?.scale).toBe(1)
    expect(extrusionOf(styled({ enabled: true, source: { kind: 'constant', meters: -5 }, scale: 1 }))?.source).toEqual({ kind: 'constant', meters: 0 })
    expect(extrusionOf(styled({ enabled: true, source: { kind: 'nope' } as never, scale: 1 }))).toBeUndefined()
    expect(extrusionOf(styled(undefined))).toBeUndefined()
  })

  it('applies to polygons only, when on', () => {
    expect(activeExtrusion(styled(byColumn), 'Polygon')).toEqual(byColumn)
    expect(activeExtrusion(styled(byColumn), 'Point')).toBeNull()
    expect(activeExtrusion(styled({ ...byColumn, enabled: false }), 'Polygon')).toBeNull()
    expect(extrusionUnavailableReason('LineString')).toBe('3D extrusion applies to polygons.')
    expect(extrusionUnavailableReason('Polygon')).toBeNull()
    expect(extrusionColumn(styled(byColumn))).toBe('height_m')
  })

  it('height: the column times the scale; missing, zero or negative are flat', () => {
    const h = extrusionHeightExpression(byColumn)
    expect(evaluate(h, { height_m: 12 })).toBe(24)
    expect(evaluate(h, { height_m: null })).toBe(0)
    expect(evaluate(h, {})).toBe(0)
    expect(evaluate(h, { height_m: -4 })).toBe(0)
    expect(evaluate(h, { height_m: '7' })).toBe(14)
    expect(extrusionHeightExpression({ enabled: true, source: { kind: 'constant', meters: 30 }, scale: 1 })).toBe(30)
    expect(flatCountSql('__se_layer', byColumn)).toBe('SELECT count(*)::BIGINT AS n FROM __se_layer WHERE coalesce(TRY_CAST("height_m" AS DOUBLE), 0) * 2 <= 0')
  })

  it('the map paint raises polygons in the style colors', () => {
    const s = styled(byColumn)
    const p = paintFor(s, resolveStyle(s, null), '#0078d4')
    expect(p.extrusion['fill-extrusion-height']).toEqual(extrusionHeightExpression(byColumn))
    expect(p.extrusion['fill-extrusion-color']).toEqual(['case', expect.anything(), '#0078d4', s.fillColor])
  })
})

describe('extrusion in style files', () => {
  it('QML: writes QGIS 3D renderer like the spike file, and reads it back', () => {
    const { text } = exportStyle(styled(byColumn), 'qml', 'Polygon', 'buildings.parquet')
    expect(text).toContain('<renderer-3d layer="" type="vector">')
    expect(text).toContain('<symbol material_type="phong" type="polygon">')
    expect(text).toContain('<Option name="expression" type="QString" value="&quot;height_m&quot; * 2"/>')
    expect(extrusionOf(importStyle('b.qml', text).style)).toEqual(byColumn)
    // Not written for points or when off.
    expect(exportStyle(styled(byColumn), 'qml', 'Point', 'p.csv').text).not.toContain('renderer-3d')
    expect(exportStyle(styled({ ...byColumn, enabled: false }), 'qml', 'Polygon', 'b.parquet').text).not.toContain('renderer-3d')
  })

  it('QML: reads QGIS’s own file (the spike), constants, and refuses other expressions with a notice', () => {
    const spike = fs.readFileSync(path.resolve(here, '../../specs/008-ux-parity/spikes/extrude.qml'), 'utf8')
    expect(extrusionOf(importStyle('extrude.qml', spike).style)).toEqual({ enabled: true, source: { kind: 'column', column: 'pop_est' }, scale: 0.001 })
    expect(extrusionFromQgis('"a"', 0)).toEqual({ source: { kind: 'column', column: 'a' }, scale: 1 })
    expect(extrusionFromQgis(null, 15)).toEqual({ source: { kind: 'constant', meters: 15 }, scale: 1 })
    expect(extrusionFromQgis('"a" + "b"', 0)).toBeNull()
    const odd = spike.replace('&quot;pop_est&quot; * 0.001', 'log10(&quot;pop_est&quot;)')
    const r = importStyle('odd.qml', odd)
    expect(extrusionOf(r.style)).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/3D height expression .* is not supported/)
  })

  it('Mapbox GL: a fill-extrusion layer; the round trip keeps it', () => {
    const { text } = exportStyle(styled(byColumn), 'mapbox', 'Polygon', 'buildings.parquet')
    const doc = JSON.parse(text) as { layers: Array<{ type: string; paint: Record<string, unknown> }> }
    const layer = doc.layers.find((l) => l.type === 'fill-extrusion')
    expect(layer?.paint['fill-extrusion-height']).toEqual(extrusionHeightExpression(byColumn))
    expect(extrusionOf(importStyle('b.style.json', text).style)).toEqual(byColumn)
    // A foreign style (no embedded metadata) is read from the layer.
    const foreign = JSON.stringify({ version: 8, layers: [{ id: 'x', type: 'fill-extrusion', paint: { 'fill-extrusion-color': '#ff0000', 'fill-extrusion-height': ['*', ['get', 'floors'], 3] } }] })
    expect(extrusionOf(importStyle('f.json', foreign).style)).toEqual({ enabled: true, source: { kind: 'column', column: 'floors' }, scale: 3 })
  })

  it('SLD: saved without it, and says so', () => {
    const s = styled(byColumn)
    expect(previewExportNotice(s, 'sld', undefined).items).toContain('SLD has no 3D: the extrusion is left out.')
    const out = exportStyle(s, 'sld', 'Polygon', 'b.parquet')
    expect(out.notes).toContain('SLD has no 3D: the extrusion is left out.')
    expect(previewExportNotice(s, 'qml', undefined).items.join(' ')).not.toMatch(/3D/)
  })
})

describe('auto height scale (spec 008 US6: raw values are rarely meters)', () => {
  const usExtent: [number, number, number, number] = [-125, 24, -66, 50]
  it('raises a density column to a visible share of a continent, as a 1/2/5 step', () => {
    const s = autoExtrusionScale(500, usExtent)
    expect([1, 2, 5].some((m) => Number((s / 10 ** Math.floor(Math.log10(s))).toFixed(6)) === m)).toBe(true)
    // ~6% of ~5,300 km: a few hundred km at the 95th percentile.
    expect(500 * s).toBeGreaterThan(100_000)
    expect(500 * s).toBeLessThanOrEqual(300_000)
  })
  it('keeps building heights near meters at a city extent', () => {
    expect(autoExtrusionScale(30, [-0.13, 51.5, -0.11, 51.51])).toBeLessThanOrEqual(5)
  })
  it('falls back to 1 without numbers or an extent', () => {
    expect(autoExtrusionScale(null, usExtent)).toBe(1)
    expect(autoExtrusionScale(0, usExtent)).toBe(1)
    expect(autoExtrusionScale(500, null)).toBe(1)
  })
  it('reads the 95th percentile of positive values', () => {
    expect(extrusionHighSql('t', 'DENSITY')).toBe('SELECT quantile_cont(TRY_CAST("DENSITY" AS DOUBLE), 0.95) AS v FROM t WHERE TRY_CAST("DENSITY" AS DOUBLE) > 0')
  })
})
