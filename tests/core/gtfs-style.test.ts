// @vitest-environment happy-dom
// Spec 024 (GTFS): the style a feed opens with, the network SQL, and the style as a QGIS sidecar.
import { describe, expect, it } from 'vitest'
import { gtfsDefaultStyle, labelLayers, qmlToStyle, sanitizeLabels, sanitizeStyle, styleToQml } from '@spatial-explorer/core'
import { networkReaderSql } from '../../packages/core/src/gtfs/sql'

describe('the default GTFS style', () => {
  const style = gtfsDefaultStyle()

  it('paints routes and stops from the network result\'s color column, as given', () => {
    expect(style.channels?.color).toMatchObject({ source: { kind: 'column', column: 'color' }, scale: { kind: 'identity' } })
  })

  it('follows GTFS-X: 3 px lines with arrows along them, white-outlined stop dots, dark labels with a white halo', () => {
    expect(style).toMatchObject({ lineWidth: 3, strokeColor: '#ffffff', strokeWidth: 1.5, pointRadius: 5, arrows: { placement: 'along', spacing: 80 } })
    expect(style.labels).toMatchObject({ enabled: true, color: '#3d2e22', halo: { enabled: true, color: '#ffffff', width: 2 }, minZoom: 13, source: { column: 'name' } })
  })

  it('grows with the zoom, as GTFS-X\'s stops do: a third of the size (lines 60%) at zoom 10 and below, full from 14', () => {
    expect(style.zoom).toEqual({ sizes: { fromZoom: 10, toZoom: 14, factor: 0.35, lineFactor: 0.6 } })
    expect(style.zoom?.min).toBeUndefined()
  })

  it('is stable through sanitizing (a stored copy reads back the same)', () => {
    expect(sanitizeStyle(JSON.parse(JSON.stringify(style)))).toEqual(style)
  })
})

describe('labels from a zoom', () => {
  const base = { enabled: true, source: { kind: 'column', column: 'name' } }
  it('keeps a minimum zoom, and drops nonsense', () => {
    expect(sanitizeLabels({ ...base, minZoom: 13 })?.minZoom).toBe(13)
    expect(sanitizeLabels({ ...base, minZoom: 99 })?.minZoom).toBe(24)
    expect(sanitizeLabels({ ...base, minZoom: -2 })?.minZoom).toBeUndefined()
    expect(sanitizeLabels({ ...base, minZoom: 'x' })?.minZoom).toBeUndefined()
    expect(sanitizeLabels(base)?.minZoom).toBeUndefined()
  })
  it('draws no text below it (size 0 until the zoom), and at every zoom without one', () => {
    const resolved = { labelError: null } as never
    const withZoom = labelLayers({ ...gtfsDefaultStyle() }, resolved)
    expect(withZoom?.label.layout['text-size']).toEqual(['step', ['zoom'], 0, 13, 12])
    expect(withZoom?.['label-line'].layout['text-size']).toEqual(['step', ['zoom'], 0, 13, 12])
    const labels = { ...(gtfsDefaultStyle().labels as NonNullable<ReturnType<typeof gtfsDefaultStyle>['labels']>), minZoom: undefined }
    const plain = labelLayers({ ...gtfsDefaultStyle(), labels }, resolved)
    expect(plain?.label.layout['text-size']).toBe(12)
  })
})

describe('the network query', () => {
  const sql = networkReaderSql({ tables: ['routes', 'trips', 'stops', 'stop_times'], geometry: ['shapes_geom'] }, { route: '#888888', stop: '#8b7e74' })
  it('has one row per route and per stop, with the columns the style reads', () => {
    expect(sql).toContain("'route' AS kind")
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain('AS color')
    expect(sql).toContain("'#888888'")
    expect(sql).toContain("'#8b7e74'")
  })
  it('makes a color only from six hex digits', () => {
    expect(sql).toContain("^[0-9A-Fa-f]{6}$")
  })
})

describe('the style as a QGIS sidecar', () => {
  it('keeps the colors as given, the line width, the arrows and the labels', () => {
    const style = gtfsDefaultStyle()
    const { text } = styleToQml(style, 'Mixed', 'gtfs')
    const back = qmlToStyle(text).style
    expect(back.channels?.color).toMatchObject({ source: { column: 'color' }, scale: { kind: 'identity' } })
    expect(back.lineWidth).toBe(3)
    expect(back.arrows).toMatchObject({ placement: 'along', spacing: 80 })
    expect(back.labels).toMatchObject({ enabled: true, source: { column: 'name' }, minZoom: 13 })
  })
})
