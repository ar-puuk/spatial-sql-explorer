// @vitest-environment happy-dom
// Spec 019: direction arrows on lines (style model, map layer, QML round trip, other formats' notices).
import { describe, expect, it } from 'vitest'
import {
  ARROW_ICON_ID,
  ARROW_SIZE,
  ARROW_SPACING,
  DEFAULT_ARROWS,
  DEFAULT_LAYER_STYLE,
  arrowLayout,
  drawsArrows,
  styleToQml,
  qmlToStyle,
  layoutFor,
  paintFor,
  previewExportNotice,
  sanitizeArrows,
  sanitizeStyle,
} from '@spatial-explorer/core'

const resolved = { status: 'ok', caption: '', classes: [], notes: [] } as never

describe('sanitizeArrows', () => {
  it('keeps valid settings and fills defaults', () => {
    expect(sanitizeArrows({ placement: 'center', spacing: 120, size: 2, color: '#ff0000' })).toEqual({ placement: 'center', spacing: 120, size: 2, color: '#ff0000' })
    expect(sanitizeArrows({})).toEqual({ placement: 'along', spacing: ARROW_SPACING.default, size: ARROW_SIZE.default })
  })
  it('clamps numbers and drops a bad color', () => {
    expect(sanitizeArrows({ spacing: 1, size: 99, color: 'nope' })).toEqual({ placement: 'along', spacing: ARROW_SPACING.min, size: ARROW_SIZE.max })
  })
  it('is none for anything that is not an object', () => {
    for (const bad of [undefined, null, 5, 'x', true]) expect(sanitizeArrows(bad)).toBeUndefined()
  })
  it('rides in the style, and is absent without it', () => {
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE }).arrows).toBeUndefined()
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, arrows: { ...DEFAULT_ARROWS } }).arrows).toEqual(DEFAULT_ARROWS)
    expect(drawsArrows(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, arrows: { ...DEFAULT_ARROWS } }))).toBe(true)
  })
})

describe('the arrow layer', () => {
  const style = sanitizeStyle({ ...DEFAULT_LAYER_STYLE, arrows: { placement: 'along', spacing: 90, size: 1.5 } })

  it('places arrowheads along the line, turning with it', () => {
    const l = layoutFor(style, resolved)['line-arrow']!
    expect(l['icon-image']).toBe(ARROW_ICON_ID)
    expect(l['symbol-placement']).toBe('line')
    expect(l['symbol-spacing']).toBe(90)
    expect(l['icon-rotation-alignment']).toBe('map')
  })
  it('puts one at the middle for the center placement', () => {
    expect(arrowLayout({ ...DEFAULT_ARROWS, placement: 'center' }, 2)['symbol-placement']).toBe('line-center')
  })
  it('sizes from the line width, with a floor', () => {
    expect(arrowLayout({ ...DEFAULT_ARROWS, size: 1 }, 1)['icon-size']).toBe(1.5)
    expect(arrowLayout({ ...DEFAULT_ARROWS, size: 2 }, 9)['icon-size']).toBe(6)
    expect(arrowLayout({ ...DEFAULT_ARROWS }, ['get', 'w'])['icon-size']).toEqual(['max', 1.5, ['/', ['get', 'w'], 3]])
  })
  it('has no layout without the setting, and takes the line color or its own', () => {
    expect(layoutFor(sanitizeStyle({ ...DEFAULT_LAYER_STYLE }), resolved)['line-arrow']).toBeUndefined()
    expect(paintFor(sanitizeStyle({ ...DEFAULT_LAYER_STYLE }), resolved, '#f59e0b')['line-arrow']).toBeUndefined()
    const own = paintFor(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, arrows: { ...DEFAULT_ARROWS, color: '#112233' } }), resolved, '#f59e0b')['line-arrow']!
    expect(JSON.stringify(own['icon-color'])).toContain('#112233')
    const same = paintFor(style, resolved, '#f59e0b')['line-arrow']!
    expect(JSON.stringify(same['icon-color'])).toContain(DEFAULT_LAYER_STYLE.strokeColor)
  })
})

describe('files', () => {
  const style = sanitizeStyle({ ...DEFAULT_LAYER_STYLE, arrows: { placement: 'center', spacing: 60, size: 2 } })

  it('QML keeps the arrows for our own reload and says QGIS does not draw them', () => {
    const out = styleToQml(style, 'LineString', resolved)
    expect(out.notes.join(' ')).toContain('QGIS does not draw')
    expect(qmlToStyle(out.text).style.arrows).toEqual({ placement: 'center', spacing: 60, size: 2 })
  })
  it('SLD and Mapbox GL name the loss', () => {
    expect(previewExportNotice(style, 'sld', resolved).items.join(' ')).toContain('Line arrows are not exported to SLD')
    expect(previewExportNotice(style, 'mapbox', resolved).items.join(' ')).toContain('Mapbox GL')
    expect(previewExportNotice(style, 'qml', resolved).items.join(' ')).not.toContain('Line arrows')
  })
})
