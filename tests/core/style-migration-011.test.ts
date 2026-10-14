// Spec 011 T010 (US2, SC-002): every style saved before spec 011 migrates to
// channels, and draws exactly as the pre-011 build drew it (recorded in
// fixtures/style/pre-011-snapshot.json by record-pre-011.test.ts).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  drawsHeatmap,
  extrusionOf,
  layoutFor,
  markerIconIds,
  paintFor,
  rendererOf,
  resolveStyle,
  sanitizeExtrusion,
  sanitizeRenderer,
  sanitizeSizeChannel,
  sanitizeStyle,
  sizeOf,
  visibilityFilter,
} from '@spatial-explorer/core'
import { PRE_011_STYLES, snapshotLayer011 } from './fixtures/style/pre-011-styles'

const here = dirname(fileURLToPath(import.meta.url))
const snapshot = JSON.parse(readFileSync(join(here, 'fixtures', 'style', 'pre-011-snapshot.json'), 'utf8')) as { styles: Record<string, Record<string, unknown>> }
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as unknown

describe('pre-011 styles migrate to channels (research §9)', () => {
  const m = (name: string) => sanitizeStyle(PRE_011_STYLES[name])

  it('no legacy keys remain, and migrating twice changes nothing', () => {
    for (const [name, raw] of Object.entries(PRE_011_STYLES)) {
      const s = sanitizeStyle(raw)
      expect(Object.keys(s), name).not.toContain('renderer')
      expect(Object.keys(s), name).not.toContain('size')
      expect(Object.keys(s), name).not.toContain('extrusion')
      expect(sanitizeStyle(s), name).toEqual(s)
    }
  })

  it('single: no channels', () => {
    expect(m('single').channels).toBeUndefined()
    expect(m('singleNoRenderer').channels).toBeUndefined()
    expect(m('singleShaped')).toMatchObject({ markerShape: 'star', lineDash: 'dash', pointRadius: 7, layerOpacity: 0.5 })
  })

  it('categorized → color by Categories', () => {
    expect(m('categorizedEdited').channels?.color).toEqual({
      source: { kind: 'column', column: 'kind' },
      scale: {
        kind: 'categories',
        manual: false,
        categories: [
          { value: 'a', visible: false },
          { value: 'b', output: '#123456', label: 'Bee' },
        ],
        other: {},
        noValue: { output: '#000000', label: 'Unknown' },
        cap: 12,
        ramp: { id: 'brewer-set2', reversed: true },
      },
    })
  })

  it('graduated → color by Classes; an expression is the source', () => {
    expect(m('graduatedManual').channels?.color?.scale).toMatchObject({ kind: 'classes', method: 'manual', classes: [{ index: 0, lower: 0, upper: 10 }, { index: 1, output: '#ff8800' }, { index: 2 }] })
    expect(m('graduatedExpression').channels?.color?.source).toEqual({ kind: 'expression', expression: 'v * 1.5 + 1', label: 'v times 1.5' })
  })

  it('rules → color by Conditions', () => {
    const c = m('rules').channels?.color
    expect(c?.scale).toEqual({
      kind: 'conditions',
      rules: [
        { id: 'r1', label: 'Big', where: 'v > 40', output: '#e41a1c', visible: true },
        { id: 'r2', label: '', where: "kind = 'b'", output: '#377eb8', visible: false },
        { id: 'r3', label: 'Broken', where: 'nope > 1', output: '#4daf4a', visible: true },
      ],
      else: { label: 'Everything else', output: '#bdbdbd', visible: true },
    })
  })

  it('bivariate → color by a pair', () => {
    expect(m('bivariate').channels?.color).toEqual({
      source: { kind: 'pair', x: 'v', y: 'w' },
      scale: { kind: 'bivariate', x: { method: 'quantile' }, y: { method: 'equal' }, palette: 'orange-blue', hidden: ['1-1'], noValue: { label: 'Missing' } },
    })
  })

  it('heatmap → draw points as a heatmap, with its settings', () => {
    const h = m('heatmapMetersAuto')
    expect(h.draw).toEqual({ points: 'heatmap' })
    expect(h.heatmap).toEqual({ weight: 'w', radius: 20, radiusUnit: 'm', radiusMeters: 500, latitude: 40.7, intensity: 1, ramp: { id: 'magma', reversed: true }, autoIntensity: true })
    expect(h.channels).toBeUndefined()
  })

  it('size → the size and width channels, one encoding', () => {
    const s = m('sizeClassed')
    expect(s.channels?.size).toEqual(s.channels?.width)
    expect(s.channels?.size).toEqual({
      source: { kind: 'column', column: 'v' },
      scale: { kind: 'classes', method: 'quantile', classCount: 4, classes: [{ index: 1, visible: false }, { index: 3, label: 'Top' }], noValue: { label: 'No size' }, range: { min: 2, max: 12 } },
    })
    expect(m('sizeProportionalArea').channels?.size?.scale).toEqual({ kind: 'continuous', range: { min: 3, max: 18 }, curve: 'area', noValue: { visible: false } })
  })

  it('extrusion → 3D and height', () => {
    const c = m('extrusionColumn')
    expect(c.draw).toEqual({ polygons: '3d' })
    expect(c.channels?.height).toEqual({ source: { kind: 'column', column: 'h' }, scale: { kind: 'identity', multiply: 2.5, noValue: {} } })
    expect(m('extrusionConstant')).toMatchObject({ draw: { polygons: '3d' }, height: { meters: 120 } })
    // Off, but its column is kept for when 3D is turned back on.
    const off = m('extrusionOffGraduated')
    expect(off.draw).toBeUndefined()
    expect(off.channels?.height?.source).toEqual({ kind: 'column', column: 'h' })
  })

  it('reads back as the pre-011 shapes, unchanged', () => {
    for (const [name, raw] of Object.entries(PRE_011_STYLES)) {
      const migrated = sanitizeStyle(raw)
      // What the pre-011 sanitize made of each part (those functions are unchanged).
      expect(rendererOf(migrated), name).toEqual(sanitizeRenderer(raw.renderer))
      expect(sizeOf(migrated), name).toEqual(sanitizeSizeChannel(raw.size))
      expect(extrusionOf(migrated), name).toEqual(sanitizeExtrusion(raw.extrusion))
    }
  })
})

describe('pre-011 styles draw exactly as before (SC-002)', () => {
  const layer = snapshotLayer011()
  for (const [name, raw] of Object.entries(PRE_011_STYLES)) {
    it(name, () => {
      const style = sanitizeStyle(raw)
      const resolved = resolveStyle(style, layer)
      const want = snapshot.styles[name]
      // Spec 011 adds `channels` to the resolved style; the pre-011 fields must be unchanged.
      const { channels: _added, ...pre011 } = resolved
      void _added
      expect(json(pre011)).toEqual(want.resolved)
      expect(json(paintFor(style, resolved, '#f59e0b', 40))).toEqual(want.paint)
      expect(json(layoutFor(style, resolved))).toEqual(want.layout)
      expect(json(visibilityFilter(style, resolved))).toEqual(want.filter)
      expect(markerIconIds(style, resolved)).toEqual(want.icons)
      expect(drawsHeatmap(style, resolved)).toBe(want.heatmap)
    })
  }
})

describe('resolved channels (slice 1: from the color and size results)', () => {
  it('color, size and width carry each class output', () => {
    const style = sanitizeStyle(PRE_011_STYLES.categorizedWithSize)
    const r = resolveStyle(style, snapshotLayer011())
    expect(r.channels?.color?.classes.map((c) => c.output)).toEqual(r.classes.map((c) => c.color))
    expect(r.channels?.color?.dataColumn).toBe('kind')
    expect(r.channels?.size?.classes.map((c) => c.output)).toEqual(r.size?.classes.map((c) => c.size))
    expect(r.channels?.width).toEqual({ ...r.channels?.size, channel: 'width' })
  })
  it('a heatmap has no color channel; 3D has height', () => {
    expect(resolveStyle(sanitizeStyle(PRE_011_STYLES.heatmapPx), snapshotLayer011()).channels).toBeUndefined()
    const h = resolveStyle(sanitizeStyle(PRE_011_STYLES.extrusionColumn), snapshotLayer011()).channels?.height
    expect(h).toMatchObject({ scale: 'identity', dataColumn: 'h' })
  })
})
