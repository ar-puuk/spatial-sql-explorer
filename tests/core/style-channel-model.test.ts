// Spec 011 T005: the channel model (data-model.md, FR-002, FR-010).
import { describe, expect, it } from 'vitest'
import {
  CHANNEL_ORDER,
  DEFAULT_LAYER_STYLE,
  channelDataColumns,
  channelsFor,
  drawOf,
  fixedValue,
  isOutputFor,
  scalesFor,
  type ChannelId,
  type LayerStyle,
} from '@spatial-explorer/core'

const base = DEFAULT_LAYER_STYLE as LayerStyle

describe('CHANNEL_ORDER', () => {
  it('lists every channel once, in panel order', () => {
    expect(CHANNEL_ORDER).toEqual(['color', 'strokeColor', 'strokeWidth', 'size', 'width', 'shape', 'dash', 'opacity', 'rotation', 'height'])
  })
})

describe('drawOf', () => {
  it('defaults to markers and fills', () => {
    expect(drawOf({})).toEqual({ points: 'markers', polygons: 'fills' })
    expect(drawOf({ draw: { points: 'heatmap', polygons: '3d' } })).toEqual({ points: 'heatmap', polygons: '3d' })
  })
})

describe('channelsFor (FR-002)', () => {
  const flat = { points: 'markers', polygons: 'fills' } as const
  it('markers', () => expect(channelsFor('Point', flat)).toEqual(['color', 'strokeColor', 'strokeWidth', 'size', 'shape', 'opacity', 'rotation']))
  it('lines', () => expect(channelsFor('LineString', flat)).toEqual(['color', 'width', 'dash', 'opacity']))
  it('fills', () => expect(channelsFor('Polygon', flat)).toEqual(['color', 'strokeColor', 'strokeWidth', 'opacity']))
  it('3D', () => expect(channelsFor('Polygon', { points: 'markers', polygons: '3d' })).toEqual(['color', 'opacity', 'height']))
  it('heatmap: no properties', () => expect(channelsFor('Point', { points: 'heatmap', polygons: 'fills' })).toEqual([]))
  it('mixed: every part, in order', () => {
    expect(channelsFor('Mixed', flat)).toEqual(['color', 'strokeColor', 'strokeWidth', 'size', 'width', 'shape', 'dash', 'opacity', 'rotation'])
    expect(channelsFor('Mixed', { points: 'heatmap', polygons: '3d' })).toEqual(['color', 'width', 'dash', 'opacity', 'height'])
  })
})

describe('scalesFor (FR-010)', () => {
  const all = ['categories', 'classes', 'continuous', 'conditions', 'identity']
  it.each<[ChannelId, string[]]>([
    ['color', [...all, 'bivariate']],
    ['strokeColor', all],
    ['size', all],
    ['width', all],
    ['strokeWidth', all],
    ['shape', ['categories', 'conditions']],
    ['dash', ['categories', 'conditions']],
    ['opacity', all],
    ['rotation', ['classes', 'continuous', 'conditions', 'identity']],
    ['height', all],
  ])('%s', (channel, scales) => expect(scalesFor(channel)).toEqual(scales))
})

describe('fixedValue', () => {
  it('reads the layer symbol', () => {
    expect(fixedValue(base, 'color', 'fill')).toBe(base.fillColor)
    expect(fixedValue(base, 'color', 'marker')).toBe(base.fillColor)
    // A line's fixed color is the stroke color (spec 001's single symbol).
    expect(fixedValue(base, 'color', 'line')).toBe(base.strokeColor)
    expect(fixedValue(base, 'strokeColor')).toBe(base.strokeColor)
    expect(fixedValue(base, 'strokeWidth')).toBe(base.strokeWidth)
    expect(fixedValue(base, 'size')).toBe(base.pointRadius)
    expect(fixedValue(base, 'width')).toBe(base.strokeWidth)
    expect(fixedValue({ ...base, lineWidth: 4 }, 'width')).toBe(4)
    expect(fixedValue(base, 'shape')).toBe('circle')
    expect(fixedValue({ ...base, markerShape: 'star' }, 'shape')).toBe('star')
    expect(fixedValue(base, 'dash')).toBe('solid')
    expect(fixedValue(base, 'opacity')).toBe(1)
    expect(fixedValue(base, 'rotation')).toBe(0)
    expect(fixedValue(base, 'height')).toBe(0)
    expect(fixedValue({ ...base, height: { meters: 30 } }, 'height')).toBe(30)
  })
})

describe('isOutputFor', () => {
  it('validates per channel', () => {
    expect(isOutputFor('color', '#a1b2c3')).toBe(true)
    expect(isOutputFor('color', 'red')).toBe(false)
    expect(isOutputFor('strokeColor', '#fff')).toBe(false)
    expect(isOutputFor('size', 0.5)).toBe(true)
    expect(isOutputFor('size', 0.4)).toBe(false)
    expect(isOutputFor('width', 101)).toBe(false)
    expect(isOutputFor('strokeWidth', 0)).toBe(true)
    expect(isOutputFor('shape', 'triangle')).toBe(true)
    expect(isOutputFor('shape', 'hexagon')).toBe(false)
    expect(isOutputFor('dash', 'dash-dot')).toBe(true)
    expect(isOutputFor('opacity', 1.2)).toBe(false)
    expect(isOutputFor('rotation', -720)).toBe(true)
    expect(isOutputFor('rotation', Number.NaN)).toBe(false)
    expect(isOutputFor('height', -1)).toBe(false)
  })
})

describe('channelDataColumns', () => {
  const classes = { kind: 'classes', method: 'quantile', classCount: 5, classes: [], noValue: {} } as const
  it('column, expression, pair and conditions', () => {
    expect(channelDataColumns('size', { source: { kind: 'column', column: 'pop' }, scale: classes })).toEqual(['pop'])
    // The color channel keeps spec 010's engine column names.
    expect(channelDataColumns('color', { source: { kind: 'expression', expression: 'a / b' }, scale: classes })).toEqual(['__se_val'])
    expect(channelDataColumns('width', { source: { kind: 'expression', expression: 'a / b' }, scale: classes })).toEqual(['__se_val_width'])
    expect(channelDataColumns('color', { source: { kind: 'pair', x: 'a', y: 'b' }, scale: { kind: 'bivariate', x: { method: 'quantile' }, y: { method: 'quantile' }, palette: 'orange-blue', hidden: [], noValue: {} } })).toEqual(['a', 'b'])
    const rules = { kind: 'conditions', rules: [], else: { label: 'Else', output: 1, visible: true } } as const
    expect(channelDataColumns('color', { source: { kind: 'column', column: '' }, scale: rules })).toEqual(['__se_cls'])
    expect(channelDataColumns('opacity', { source: { kind: 'column', column: '' }, scale: rules })).toEqual(['__se_cls_opacity'])
  })
})
