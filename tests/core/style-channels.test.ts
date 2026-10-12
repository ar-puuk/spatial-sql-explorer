// @vitest-environment happy-dom
// Spec 009 US1–US3 (contracts/style-core.md): the size channel next to any
// color channel. Map = legend per channel through MapLibre's own evaluator
// (SC-003); styles without a size channel are unchanged (pre-009 snapshot).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  classSizes,
  exportStyle,
  importStyle,
  sanitizeStyle,
  layoutFor,
  markerIconIds,
  paintFor,
  parseMarkerIconId,
  resolveStyle,
  setClassVisible,
  setSizeChannel,
  setSizeClassBound,
  setSizeClassCount,
  setSizeClassLabel,
  setSizeClassVisible,
  setSizeMethod,
  setSizeMode,
  setSizeRange,
  proportionalSize,
  sizeSymbols,
  startStyle,
  validateStyle,
  visibilityFilter,
  type LayerStyle,
  type ResolvedStyle,
} from '@spatial-explorer/core'
import { SNAPSHOT_LAYER, snapshotStyles } from './fixtures/style/pre-009-styles'

const fixture = (name: string): string => readFileSync(`${import.meta.dirname}/fixtures/style/${name}`, 'utf8')

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type = 'LineString'): unknown {
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

/** 40 roads: a class and traffic (every 9th null). */
const roads = {
  features: Array.from({ length: 40 }, (_, i) => ({ id: i, geometry: null, attributes: { cls: ['A', 'B', 'C'][i % 3], aadt: i % 9 === 4 ? null : (i + 1) * 100 } })),
  columns: [
    { name: 'cls', type: 'VARCHAR' },
    { name: 'aadt', type: 'BIGINT' },
  ],
}

const base = DEFAULT_LAYER_STYLE as LayerStyle
const categorized = startStyle(base, 'categorized', roads, 'cls')
const withSize = (style: LayerStyle, geometry: 'point' | 'line' = 'line', column = 'aadt'): LayerStyle => setSizeChannel(style, column, geometry)

/** The class a value falls in, by the resolved ranges (classOf's rules); -1 = no value. */
function sizeClassOf(resolved: ResolvedStyle, v: number | null): number {
  if (v === null) return -1
  const ranges = resolved.size?.classes.filter((c) => c.kind === 'range') ?? []
  return ranges.findIndex((c, i) => (i === 0 ? v >= (c.lower as number) : v > (c.lower as number)) && v <= (c.upper as number))
}

describe('the size channel resolves on its own column (US1)', () => {
  it('classed: 5 quantile classes with evenly spaced sizes, counts, No value and a caption', () => {
    const style = withSize(categorized)
    const r = resolveStyle(style, roads)
    expect(r.size?.status).toBe('ok')
    expect(r.size?.caption).toBe('aadt · Quantile, 5 classes')
    const ranges = r.size?.classes.filter((c) => c.kind === 'range') ?? []
    expect(ranges.map((c) => c.size)).toEqual(classSizes(5, 1, 6))
    const nulls = roads.features.filter((f) => f.attributes.aadt === null).length
    expect(r.size?.classes.find((c) => c.kind === 'noValue')?.count).toBe(nulls)
    expect(ranges.reduce((n, c) => n + c.count, 0) + nulls).toBe(roads.features.length)
    // The color channel is untouched.
    expect(r.classes).toEqual(resolveStyle(categorized, roads).classes)
  })

  it('the same column as the color channel classifies independently', () => {
    const graduated = startStyle(base, 'graduated', roads, 'aadt')
    const style = setSizeClassCount(withSize(graduated), 3)
    const r = resolveStyle(style, roads)
    expect(r.classes.filter((c) => c.kind === 'range')).toHaveLength(5)
    expect(r.size?.classes.filter((c) => c.kind === 'range')).toHaveLength(3)
  })

  it('a missing or text size column falls back for size only', () => {
    for (const column of ['gone', 'cls']) {
      const r = resolveStyle(withSize(categorized, 'line', column), roads)
      expect(r.status).toBe('ok')
      expect(r.size?.status).toBe('fallback')
      expect(r.size?.reason).toBeTruthy()
    }
  })

  it('edits: method, class count, sizes, labels, bounds (Manual) and validation', () => {
    let style = withSize(categorized)
    style = setSizeMethod(style, 'equal')
    expect(resolveStyle(style, roads).size?.caption).toBe('aadt · Equal interval, 5 classes')
    style = setSizeRange(style, 2, 12)
    expect(resolveStyle(style, roads).size?.classes.filter((c) => c.kind === 'range').map((c) => c.size)).toEqual(classSizes(5, 2, 12))
    style = setSizeClassLabel(style, 'size:range:0', 'Quiet')
    expect(resolveStyle(style, roads).size?.classes[0].label).toBe('Quiet')
    const resolved = resolveStyle(style, roads)
    style = setSizeClassBound(style, resolved, 0, 'upper', 1000)
    expect(style.size?.method).toBe('manual')
    expect(resolveStyle(style, roads).size?.classes[0].upper).toBe(1000)
    expect(validateStyle(setSizeRange(style, 8, 3))).toContain('The smallest size must not be larger than the largest.')
    expect(setSizeChannel(style, null, 'line').size).toBeUndefined()
  })
})

describe('map = legend for both channels (SC-003)', () => {
  for (const geometry of ['line', 'point'] as const) {
    it(`${geometry}s: color from the color class, size from the size class`, () => {
      for (const colorStyle of [categorized, startStyle(base, 'graduated', roads, 'aadt')]) {
        const style = withSize(colorStyle, geometry)
        const r = resolveStyle(style, roads)
        const p = paintFor(style, r, '#f59e0b')
        const [layer, prop, type] = geometry === 'line' ? (['line', 'line-width', 'LineString'] as const) : (['circle', 'circle-radius', 'Point'] as const)
        for (const f of roads.features) {
          const cls = sizeClassOf(r, f.attributes.aadt)
          const want = cls === -1 ? (geometry === 'line' ? style.strokeWidth : style.pointRadius) : r.size?.classes[cls].size
          expect(evaluate((p[layer] as Record<string, unknown>)[prop], f.attributes, `layers[0].paint.${prop}`, type), `aadt=${f.attributes.aadt}`).toBe(want)
        }
      }
    })
  }

  it('a feature is hidden when its color class or its size class is hidden', () => {
    let style = withSize(categorized)
    style = setClassVisible(style, 'v:A', false)
    style = setSizeClassVisible(style, 'size:range:4', false)
    const r = resolveStyle(style, roads)
    const filter = visibilityFilter(style, r)
    const top = r.size?.classes[4]
    for (const f of roads.features) {
      const sizeHidden = f.attributes.aadt !== null && top && f.attributes.aadt > (top.lower as number)
      const want = f.attributes.cls !== 'A' && !sizeHidden
      expect(evaluate(filter, f.attributes, 'layers[0].filter'), JSON.stringify(f.attributes)).toBe(want)
    }
  })

  it('polygons are never sized; mixed layers size lines and points only', () => {
    const style = withSize(categorized)
    const r = resolveStyle(style, roads)
    const p = paintFor(style, r, '#f59e0b')
    expect(p['fill-outline']['line-width']).toEqual(paintFor(categorized, resolveStyle(categorized, roads), '#f59e0b')['fill-outline']['line-width'])
  })

  it('shaped markers: icons are drawn at the largest size and scaled per feature', () => {
    const style = { ...withSize(categorized, 'point'), markerShape: 'star' as const }
    const r = resolveStyle(style, roads)
    const radii = markerIconIds(style, r).map((id) => parseMarkerIconId(id)?.radius)
    expect(new Set(radii)).toEqual(new Set([10]))
    const iconSize = layoutFor(style, r).marker?.['icon-size']
    for (const f of roads.features) {
      const cls = sizeClassOf(r, f.attributes.aadt)
      const radius = cls === -1 ? style.pointRadius : (r.size?.classes[cls].size as number)
      expect(evaluate(iconSize, f.attributes, 'layers[0].layout.icon-size', 'Point')).toBeCloseTo(radius / 10, 6)
    }
  })

  it('size symbols are drawn in the single colors at the class sizes', () => {
    const style = withSize(categorized, 'point')
    const r = resolveStyle(style, roads)
    const symbols = sizeSymbols(style, r)
    expect(symbols.map((s) => s.radius)).toEqual(r.size?.classes.map((c) => c.size ?? style.pointRadius))
    expect(new Set(symbols.map((s) => s.fillColor))).toEqual(new Set([style.fillColor]))
  })
})

describe('styles without a size channel are unchanged (pre-009 snapshot)', () => {
  const snapshot = JSON.parse(fixture('pre-009-snapshot.json')) as Record<string, unknown>
  for (const [name, style] of Object.entries(snapshotStyles())) {
    it(name, () => {
      const resolved = resolveStyle(style, SNAPSHOT_LAYER)
      const now = { resolved, paint: paintFor(style, resolved, '#f59e0b'), layout: layoutFor(style, resolved), filter: visibilityFilter(style, resolved) }
      expect(JSON.parse(JSON.stringify(now))).toEqual(snapshot[name])
    })
  }
})

describe('styles saved with Graduated "Vary: Size" open unchanged (US3, FR-009)', () => {
  const legacy = JSON.parse(fixture('legacy-vary-size.json')) as LayerStyle
  const expected = JSON.parse(fixture('legacy-vary-size.expected.json')) as {
    layer: { values: Array<number | null>; columns: Array<{ name: string; type: string }> }
    labels: string[]
    features: Array<{ v: number | null; radius: number; visible: boolean }>
  }
  const layer = { features: expected.layer.values.map((v, i) => ({ id: i, geometry: null, attributes: { v } })), columns: expected.layer.columns }

  it('migrates to a single color with a classed size channel on the same column', () => {
    const style = sanitizeStyle(legacy)
    expect(style.renderer).toEqual({ kind: 'single' })
    expect(style.size).toEqual({
      column: 'v',
      mode: 'classed',
      method: 'quantile',
      classCount: 5,
      classes: [
        { index: 1, label: 'Medium-low' },
        { index: 3, visible: false },
      ],
      noValue: {},
      sizeMin: 2,
      sizeMax: 10,
    })
    expect(JSON.stringify(style.renderer)).not.toMatch(/vary|sizeMin|sizeMax/)
  })

  it('draws every feature at the same radius, with the same labels and hidden class', () => {
    const style = sanitizeStyle(legacy)
    const r = resolveStyle(style, layer)
    expect(r.size?.classes.map((c) => c.label)).toEqual(expected.labels)
    const p = paintFor(style, r, '#f59e0b')
    const filter = visibilityFilter(style, r)
    for (const f of expected.features) {
      expect(evaluate(p.circle['circle-radius'], { v: f.v }, 'layers[0].paint.circle-radius', 'Point'), `v=${f.v}`).toBe(f.radius)
      expect(filter ? evaluate(filter, { v: f.v }, 'layers[0].filter', 'Point') : true, `v=${f.v}`).toBe(f.visible)
    }
  })

  it('a QGIS GraduatedSize file imports as a size channel (sizes in pixels)', () => {
    const { style } = importStyle('a.qml', readFileSync(`${import.meta.dirname}/fixtures/style/symbols/pt_gradsize.qml`, 'utf8'))
    const mm = 96 / 25.4
    expect(style.renderer).toEqual({ kind: 'single' })
    expect(style.size?.column).toBe('v')
    expect(style.size?.sizeMin).toBeCloseTo(mm, 1) // a 2 mm diameter is a 1 mm radius
    expect(style.size?.sizeMax).toBeCloseTo(5 * mm, 1)
  })

  it('the old fields are never written again', () => {
    const style = sanitizeStyle(legacy)
    for (const format of ['qml', 'sld', 'mapbox'] as const) {
      const text = exportStyle(style, format, 'Point', 'x.geojson', resolveStyle(style, layer), layer.columns).text
      expect(text, format).not.toMatch(/"vary"|graduatedMethod="GraduatedSize"/)
    }
  })
})

describe('proportional sizes (US2)', () => {
  const prop = (geometry: 'point' | 'line') => setSizeMode(withSize(categorized, geometry), 'proportional')

  it('lines scale linearly, points by area (QGIS size assistant "Area": r = min + (max - min) * sqrt(t))', () => {
    const domain = { min: 100, max: 4100 }
    expect(proportionalSize(100, domain, 1, 6, 'line')).toBe(1)
    expect(proportionalSize(2100, domain, 1, 6, 'line')).toBe(3.5)
    expect(proportionalSize(4100, domain, 1, 6, 'line')).toBe(6)
    expect(proportionalSize(1100, domain, 4, 20, 'point')).toBeCloseTo(4 + 16 * 0.5, 9) // t = 0.25
    expect(proportionalSize(99999, domain, 4, 20, 'point')).toBe(20) // clamped
    expect(proportionalSize(-5, domain, 4, 20, 'point')).toBe(4)
    expect(proportionalSize(7, { min: 7, max: 7 }, 4, 20, 'point')).toBe(20) // one value: the largest size
  })

  it('resolves the domain, 3-5 reference sizes (with min and max) and No value', () => {
    const style = prop('line')
    const r = resolveStyle(style, roads)
    const values = roads.features.map((f) => f.attributes.aadt).filter((v): v is number => v !== null)
    expect(r.size?.mode).toBe('proportional')
    expect(r.size?.caption).toBe('aadt · Proportional')
    expect(r.size?.domain).toEqual({ min: Math.min(...values), max: Math.max(...values) })
    const samples = r.size?.samples ?? []
    expect(samples.length).toBeGreaterThanOrEqual(3)
    expect(samples.length).toBeLessThanOrEqual(5)
    expect(samples[0].value).toBe(Math.min(...values))
    expect(samples.at(-1)?.value).toBe(Math.max(...values))
    for (const s of samples) expect(s.size).toBe(proportionalSize(s.value, r.size?.domain as { min: number; max: number }, 1, 6, 'line'))
    expect(r.size?.classes.map((c) => c.kind)).toEqual(['noValue'])
  })

  it('the map draws each feature at proportionalSize (null: the single size)', () => {
    for (const geometry of ['line', 'point'] as const) {
      const style = prop(geometry)
      const r = resolveStyle(style, roads)
      const p = paintFor(style, r, '#f59e0b')
      const [layer, prop2, type] = geometry === 'line' ? (['line', 'line-width', 'LineString'] as const) : (['circle', 'circle-radius', 'Point'] as const)
      const domain = r.size?.domain as { min: number; max: number }
      const [lo, hi] = geometry === 'line' ? [1, 6] : [2, 10]
      for (const f of roads.features) {
        const v = f.attributes.aadt
        const want = v === null ? (geometry === 'line' ? style.strokeWidth : style.pointRadius) : proportionalSize(v, domain, lo, hi, geometry)
        expect(evaluate((p[layer] as Record<string, unknown>)[prop2], f.attributes, `layers[0].paint.${prop2}`, type) as number).toBeCloseTo(want, 9)
      }
    }
  })

  it('hiding No value hides features without a value; reference sizes are not classes', () => {
    const style = setSizeClassVisible(prop('line'), 'size:__null', false)
    const r = resolveStyle(style, roads)
    const filter = visibilityFilter(style, r)
    for (const f of roads.features) expect(evaluate(filter, f.attributes, 'layers[0].filter')).toBe(f.attributes.aadt !== null)
    expect(sizeSymbols(style, r)).toHaveLength((r.size?.samples?.length ?? 0) + 1)
  })

  it('switching back to classed restores stepped classes', () => {
    const back = setSizeMode(prop('line'), 'classed')
    expect(resolveStyle(back, roads).size?.classes.filter((c) => c.kind === 'range')).toHaveLength(5)
  })
})
