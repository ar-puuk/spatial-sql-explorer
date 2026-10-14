// @vitest-environment happy-dom
// Heatmap: the renderer model, its resolution (ramp, weight scaling), the
// MapLibre paint through MapLibre's own evaluator, and the style files (QML
// and Mapbox GL keep it; SLD says it can't).
import { describe, expect, it } from 'vitest'
import { expression, latest } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  HEATMAP_STOPS,
  drawsHeatmap,
  exportStyle,
  importStyle,
  paintFor,
  previewExportNotice,
  rampColors,
  resolveStyle,
  sanitizeStyle,
  HEAT_GAUSS,
  heatmapPeak,
  mercatorRadius,
  metersPerPixel,
  setHeatmap,
  setHeatmapAutoIntensity,
  setHeatmapRadiusUnit,
  setSizeChannel,
  startStyle,
  styleDataColumns,
  type HeatmapRenderer,
  type LayerStyle,
} from '@spatial-explorer/core'

/** `density`: `heatmap-color` is evaluated as that property (only it may read the density). */
function evaluate(expr: unknown, properties: Record<string, unknown>, opts: { density?: number; state?: Record<string, unknown> } = {}): unknown {
  const spec = opts.density === undefined ? null : (latest as unknown as { paint_heatmap: Record<string, never> }).paint_heatmap['heatmap-color']
  const parsed = expression.createExpression(expr, 'layers[0].paint.x', spec)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0, heatmapDensity: opts.density } as never, { type: 'Point', properties } as never, (opts.state ?? {}) as never)
}

/** 20 points: a population (every 5th null) and a name. */
const places = {
  features: Array.from({ length: 20 }, (_, i) => ({ id: i, geometry: null, attributes: { pop: i % 5 === 4 ? null : (i + 1) * 1000, name: `P${i}` } })),
  columns: [
    { name: 'pop', type: 'BIGINT' },
    { name: 'name', type: 'VARCHAR' },
  ],
}

const heat = (patch: Partial<HeatmapRenderer> = {}): LayerStyle => {
  const s = startStyle(DEFAULT_LAYER_STYLE, 'heatmap', places)
  return { ...s, renderer: { ...(s.renderer as HeatmapRenderer), ...patch } }
}

describe('model', () => {
  it('starts unweighted with the default radius, intensity and ramp, and leaves the symbol alone', () => {
    const s = startStyle({ ...DEFAULT_LAYER_STYLE, fillColor: '#ff0000' }, 'heatmap', places)
    expect(s.renderer).toEqual({ kind: 'heatmap', weight: '', radius: 20, intensity: 1, ramp: { id: 'brewer-ylorrd', reversed: false } })
    expect(s.fillColor).toBe('#ff0000')
    expect(s.fillOpacity).toBe(DEFAULT_LAYER_STYLE.fillOpacity)
  })
  it('sanitizes and edits within the ranges', () => {
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, renderer: { kind: 'heatmap', radius: 900, intensity: -2, weight: 7 } as never }).renderer).toEqual({
      kind: 'heatmap',
      weight: '',
      radius: 100,
      intensity: 0.01,
      ramp: { id: 'brewer-ylorrd', reversed: false },
    })
    const s = setHeatmap(heat(), { weight: 'pop', radius: 1, intensity: 9 })
    expect(s.renderer).toMatchObject({ weight: 'pop', radius: 2, intensity: 5 })
    expect(setHeatmap(DEFAULT_LAYER_STYLE, { radius: 5 })).toBe(DEFAULT_LAYER_STYLE)
  })
  it('the map reads only the weight column', () => {
    expect(styleDataColumns(heat())).toEqual([])
    expect(styleDataColumns(heat({ weight: 'pop' }))).toEqual(['pop'])
  })
})

describe('resolve', () => {
  it('unweighted: one legend entry (every point) and the ramp', () => {
    const r = resolveStyle(heat(), places)
    expect(r).toMatchObject({ status: 'ok', caption: 'Density', notes: [] })
    expect(r.classes).toEqual([expect.objectContaining({ key: 'single', label: 'All points', count: 20 })])
    expect(r.heat).toEqual({ colors: rampColors({ id: 'brewer-ylorrd', reversed: false }, HEATMAP_STOPS) })
  })
  it("weighted: by the column's largest value (from the rows, or the engine's numbers)", () => {
    expect(resolveStyle(heat({ weight: 'pop' }), places)).toMatchObject({ caption: 'Density · weighted by pop', heat: { weight: { column: 'pop', max: 19000 } } })
    const big = { columns: places.columns, rowCount: 1e6, dataByColumn: { pop: { kind: 'numbers' as const, column: 'pop', sample: [3, 81000], n: 999000, nulls: 1000 } } }
    expect(resolveStyle(heat({ weight: 'pop' }), big).heat?.weight).toEqual({ column: 'pop', max: 81000 })
  })
  it('a weight column that cannot be used: each point counts once, with the reason', () => {
    const text = resolveStyle(heat({ weight: 'name' }), places)
    expect(text.heat?.weight).toBeUndefined()
    expect(text.notes).toEqual(['Column "name" is not numeric in this result. Each point counts once.'])
    const zero = { ...places, features: places.features.map((f) => ({ ...f, attributes: { ...f.attributes, pop: 0 } })) }
    expect(resolveStyle(heat({ weight: 'pop' }), zero).notes).toEqual(['Column "pop" has no positive values: each point counts once.'])
  })
  it('a size channel is kept but has no effect under a heatmap', () => {
    const s = setSizeChannel(heat(), 'pop', 'point')
    expect(s.size?.column).toBe('pop')
    expect(resolveStyle(s, places).size).toBeUndefined()
  })
})

describe('map paint', () => {
  const style = heat({ weight: 'pop', radius: 30, intensity: 1.5 })
  const resolved = resolveStyle({ ...style, layerOpacity: 0.8 }, places)
  const p = paintFor({ ...style, layerOpacity: 0.8 }, resolved, '#f59e0b')

  it('radius, intensity and opacity as set; weights 0..1 by the largest value, missing and negative values 0', () => {
    expect(p.heatmap).toMatchObject({ 'heatmap-radius': 30, 'heatmap-intensity': 1.5, 'heatmap-opacity': 0.8 })
    const w = p.heatmap['heatmap-weight']
    expect(evaluate(w, { pop: 19000 })).toBe(1)
    expect(evaluate(w, { pop: 9500 })).toBe(0.5)
    expect(evaluate(w, { pop: null })).toBe(0)
    expect(evaluate(w, {})).toBe(0)
    expect(evaluate(w, { pop: -5 })).toBe(0)
    expect(evaluate(w, { pop: 'many' })).toBe(0)
  })
  it('zero density is transparent; the densest is the ramp’s last color', () => {
    const c = p.heatmap['heatmap-color']
    expect(String(evaluate(c, {}, { density: 0 }))).toMatch(/^rgba\(0,\s*0,\s*0,\s*0\)$/)
    const last = resolved.heat?.colors.at(-1) as string
    const rgb = evaluate(c, {}, { density: 1 }) as { r: number; g: number; b: number }
    expect([rgb.r, rgb.g, rgb.b].map((v) => Math.round(v * 255))).toEqual([1, 3, 5].map((i) => parseInt(last.slice(i, i + 2), 16)))
  })
  it('point circles show only when hovered or selected (they keep clicks working)', () => {
    expect(drawsHeatmap(style, resolved)).toBe(true)
    const op = p.circle['circle-stroke-opacity']
    const fill = p.circle['circle-opacity']
    expect(evaluate(fill, {})).toBe(0)
    expect(evaluate(op, {})).toBe(0)
    expect(evaluate(fill, {}, { state: { selected: true } })).toBe(1)
    expect(evaluate(op, {}, { state: { hover: true } })).toBe(0.6)
    // A polygon too small to see is still its dot (mixed layers).
    expect(evaluate(fill, { __se_dot: true })).toBeGreaterThan(0)
  })
  it('other styles draw no heatmap', () => {
    const single = resolveStyle(DEFAULT_LAYER_STYLE, places)
    expect(drawsHeatmap(DEFAULT_LAYER_STYLE, single)).toBe(false)
    expect(paintFor(DEFAULT_LAYER_STYLE, single, '#f59e0b').heatmap).toEqual({})
  })
})

describe('style files', () => {
  const style: LayerStyle = { ...heat({ weight: 'pop', radius: 24, intensity: 2, ramp: { id: 'magma', reversed: true } }), fillColor: '#123456', pointRadius: 7 }
  const resolved = resolveStyle(style, places)

  it("QML: QGIS's heatmap renderer, in pixels, weighted by the field, the ramp transparent at zero", () => {
    const { text, notes } = exportStyle(style, 'qml', 'Point', 'places.geojson', resolved)
    expect(text).toContain('<renderer-v2 type="heatmapRenderer" radius="24" radius_unit="2"')
    expect(text).toContain('weight_expression="&quot;pop&quot;"')
    expect(text).toContain('<Option name="color1" type="QString" value="0,0,0,0"/>')
    const stops = /name="stops" type="QString" value="([^"]+)"/.exec(text)?.[1].split(':') ?? []
    expect(stops).toHaveLength(HEATMAP_STOPS - 1)
    expect(stops[0]).toMatch(/^0\.142857;\d+,\d+,\d+,255$/)
    expect(notes).toEqual(["QGIS heatmaps have no intensity: QGIS draws it at 1 (Spatial Explorer keeps yours)."])
    // Back here: the whole renderer, and the single symbol for a later switch back.
    const back = importStyle('places.qml', text)
    expect(back.style.renderer).toEqual(style.renderer)
    expect(back.style).toMatchObject({ fillColor: '#123456', pointRadius: 7 })
    expect(back.notes).toEqual([])
  })
  it('QML of a non-point layer: the single symbol, with a note', () => {
    const { text, notes } = exportStyle(style, 'qml', 'Polygon', 'areas.geojson', resolved)
    expect(text).toContain('type="singleSymbol"')
    expect(notes).toContain('QGIS heatmaps are for point layers: this layer was exported with its single symbol.')
  })
  it("QGIS's own heatmap: radius converted to pixels, the weight field read, the ramp replaced (with notes)", () => {
    const qml = (radius: string, unit: string, weight: string) => `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0"><renderer-v2 type="heatmapRenderer" radius="${radius}" radius_unit="${unit}" max_value="0" quality="3" weight_expression="${weight}">
<colorramp type="gradient" name="[source]"><Option type="Map"><Option name="color1" type="QString" value="255,255,255,0"/></Option></colorramp>
</renderer-v2></qgis>`
    const mm = importStyle('a.qml', qml('10', '0', '&quot;pop&quot;'))
    expect(mm.style.renderer).toMatchObject({ kind: 'heatmap', weight: 'pop', intensity: 1, ramp: { id: 'brewer-ylorrd' } })
    expect((mm.style.renderer as HeatmapRenderer).radius).toBeCloseTo((10 * 96) / 25.4, 6)
    expect(mm.notes).toEqual(["The heatmap's own colors were replaced by the Yellow–orange–red ramp."])
    const expr = importStyle('a.qml', qml('15', '2', '&quot;pop&quot; * 2'))
    expect(expr.style.renderer).toMatchObject({ kind: 'heatmap', weight: '', radius: 15 })
    expect(expr.notes).toContain('The heatmap weight is the QGIS expression "\"pop\" * 2"; each point counts once instead.')
    const mapUnits = importStyle('a.qml', qml('500', '1', ''))
    expect((mapUnits.style.renderer as HeatmapRenderer).radius).toBe(20)
    expect(mapUnits.notes).toContain('The heatmap radius is in map units, which have no fixed size on screen: the default radius was used.')
  })
  it('Mapbox GL: a heatmap layer with the viewer’s paint; read back with or without our metadata', () => {
    const { text } = exportStyle(style, 'mapbox', 'Point', 'places.geojson', resolved)
    const doc = JSON.parse(text) as { layers: Array<{ type: string; paint: Record<string, unknown> }>; metadata?: unknown }
    expect(doc.layers.map((l) => l.type)).toEqual(['heatmap'])
    expect(doc.layers[0].paint).toEqual(paintFor(style, resolved, '#000').heatmap)
    expect(importStyle('p.json', text).style.renderer).toEqual(style.renderer)
    delete doc.metadata
    const foreign = importStyle('p.json', JSON.stringify(doc))
    expect(foreign.style.renderer).toMatchObject({ kind: 'heatmap', weight: 'pop', radius: 24, intensity: 2 })
    expect(foreign.notes).toEqual(["The heatmap's own colors were replaced by the Yellow–orange–red ramp."])
  })
  it('SLD has no heatmap: the single symbol, and the notice says so', () => {
    const notice = previewExportNotice(style, 'sld', resolved)
    expect(notice.items).toContain('SLD has no heatmap: the points are written with the single symbol (QML and Mapbox GL keep the heatmap).')
    const { text } = exportStyle(style, 'sld', 'Point', 'places.geojson', resolved)
    expect(text).toContain('<Name>Single symbol</Name>')
  })
})

describe('radius in meters (fixed on the map)', () => {
  const zoomed = (expr: unknown, zoom: number): number => {
    const parsed = expression.createExpression(expr, 'layers[0].paint.x')
    if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
    return parsed.value.evaluate({ zoom } as never, { type: 'Point', properties: {} } as never) as number
  }

  it('pixels double with each zoom, so the ground radius stays the same', () => {
    const s = setHeatmap(heat(), { radiusUnit: 'm', radiusMeters: 500, latitude: 40 })
    const r = paintFor(s, resolveStyle(s, places), '#000').heatmap['heatmap-radius']
    for (const z of [3, 10.5, 16]) expect(zoomed(r, z) * metersPerPixel(40, z)).toBeCloseTo(500, 6)
    // Without a latitude of its own, the layer's center is used.
    const noLat = setHeatmap(heat(), { radiusUnit: 'm', radiusMeters: 500 })
    const r2 = paintFor(noLat, resolveStyle(noLat, places), '#000', 60).heatmap['heatmap-radius']
    expect(zoomed(r2, 12) * metersPerPixel(60, 12)).toBeCloseTo(500, 6)
  })
  it('switching units keeps the size on screen at the current view', () => {
    const view = { latitude: 40, zoom: 11 }
    const m = setHeatmapRadiusUnit(heat({ radius: 20 }), 'm', view).renderer as HeatmapRenderer
    expect(m).toMatchObject({ radiusUnit: 'm', latitude: 40, radius: 20 })
    expect(m.radiusMeters).toBe(Number((20 * metersPerPixel(40, 11)).toPrecision(2)))
    const back = setHeatmapRadiusUnit({ ...DEFAULT_LAYER_STYLE, renderer: m }, 'px', { latitude: 40, zoom: 12 }).renderer as HeatmapRenderer
    expect(back.radiusUnit).toBe('px')
    expect(back.radius).toBe(Math.round((m.radiusMeters as number) / metersPerPixel(40, 12)))
  })
  it('QML: QGIS meters at scale; Mapbox GL: a radius doubling with zoom', () => {
    const s = setHeatmap(heat(), { radiusUnit: 'm', radiusMeters: 750, latitude: 0 })
    const resolved = resolveStyle(s, places)
    const qml = exportStyle(s, 'qml', 'Point', 'p.geojson', resolved).text
    expect(qml).toContain('radius="750" radius_unit="7"')
    const foreign = importStyle('p.qml', qml.replace(/<customproperties>[\s\S]*<\/customproperties>\n/, ''))
    expect(foreign.style.renderer).toMatchObject({ kind: 'heatmap', radiusUnit: 'm', radiusMeters: 750 })
    const doc = JSON.parse(exportStyle(s, 'mapbox', 'Point', 'p.geojson', resolved).text) as { metadata?: unknown }
    delete doc.metadata
    const mb = importStyle('p.json', JSON.stringify(doc))
    expect(mb.style.renderer).toMatchObject({ kind: 'heatmap', radiusUnit: 'm' })
    expect((mb.style.renderer as HeatmapRenderer).radiusMeters).toBeCloseTo(750, 3)
    expect(mb.notes).toContain('The heatmap radius is fixed on the map; it was read as meters at the equator.')
  })
})

describe('automatic intensity (radius in meters)', () => {
  /** A dense cluster near Salt Lake City and a sparse one, as WGS84 points. */
  const pts: Array<[number, number, number]> = Array.from({ length: 1500 }, (_, i) => {
    const dense = i < 1000
    const a = i * 2.399963
    const r = (dense ? 0.01 : 0.05) * Math.sqrt((dense ? i : i - 1000) / (dense ? 1000 : 500))
    return [(dense ? -111.89 : -111.7) + r * Math.cos(a), (dense ? 40.76 : 40.6) + r * Math.sin(a), 1]
  })
  /** Brute force: MapLibre's kernel summed at every point, in Web Mercator meters. */
  const brute = (radius: number): number => {
    const R = 6378137
    const xy = pts.map(([lon, lat]) => [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))])
    let best = 0
    for (const [x0, y0] of xy) {
      let d = 0
      for (const [x, y] of xy) d += Math.exp((-4.5 * ((x - x0) ** 2 + (y - y0) ** 2)) / radius ** 2)
      best = Math.max(best, d)
    }
    return best * HEAT_GAUSS
  }

  it('the grid estimate of the peak is within 10% of the exact sum', () => {
    for (const meters of [200, 1000, 5000]) {
      const radius = mercatorRadius(meters, 40.7)
      const exact = brute(radius)
      expect(Math.abs(heatmapPeak(pts, radius) - exact) / exact, `${meters} m`).toBeLessThan(0.1)
    }
  })
  it('resolves to 1 / peak and the map paints with it; off, the slider’s value', () => {
    const layer = { columns: [{ name: 'pop', type: 'BIGINT' }], features: pts.map(([lon, lat], id) => ({ id, geometry: { type: 'Point' as const, coordinates: [lon, lat] }, attributes: { pop: 1 } })) }
    const on = setHeatmapAutoIntensity(heat({ intensity: 2 }), true, { latitude: 40.7, zoom: 11 })
    expect(on.renderer).toMatchObject({ radiusUnit: 'm', autoIntensity: true, latitude: 40.7 })
    const r = resolveStyle(on, layer)
    const radius = mercatorRadius((on.renderer as HeatmapRenderer).radiusMeters as number, 40.7)
    expect(r.heat?.intensity).toBeCloseTo(1 / heatmapPeak(pts, radius), 9)
    expect(paintFor(on, r, '#000').heatmap['heatmap-intensity']).toBe(r.heat?.intensity)
    // The engine's peak, when it gave one, wins.
    expect(resolveStyle(on, { ...layer, heatPeak: 40 }).heat?.intensity).toBe(1 / 40)
    const off = setHeatmapAutoIntensity(on, false, null)
    expect(paintFor(off, resolveStyle(off, layer), '#000').heatmap['heatmap-intensity']).toBe(2)
  })
  it('pixels end it (on screen the densest spot changes with zoom), and files keep it', () => {
    const on = setHeatmapAutoIntensity(heat(), true, { latitude: 0, zoom: 5 })
    expect((setHeatmapRadiusUnit(on, 'px', { latitude: 0, zoom: 5 }).renderer as HeatmapRenderer).autoIntensity).toBe(false)
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, renderer: { kind: 'heatmap', autoIntensity: true } as never }).renderer).not.toHaveProperty('autoIntensity')
    const resolved = resolveStyle(on, places)
    const qml = exportStyle(on, 'qml', 'Point', 'p.geojson', resolved)
    expect(qml.text).toContain('max_value="0"')
    expect(qml.notes).toEqual([])
    expect(importStyle('p.qml', qml.text).style.renderer).toEqual(on.renderer)
  })
})
