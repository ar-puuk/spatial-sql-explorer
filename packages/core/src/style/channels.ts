// Spec 011: style by channels. A channel is one visual property (color,
// outline, size, shape, ...) that is either a fixed value (the flat LayerStyle
// fields, unchanged from spec 001–009) or By column: a source (a column, a SQL
// expression the engine computes, or a pair for bivariate) through a scale.
// data-model.md has the model; FR-010 the scales each channel offers.
import { isLineDash, isMarkerShape, type LineDash, type MarkerShape } from './symbol.js'
import { EXPRESSION_VALUE_COLUMN, RULE_CLASS_COLUMN, type BivariateMethod, type GraduatedMethod, type LayerStyle, type RampRef, type StyleGeometry } from './model.js'

export type ChannelId =
  | 'color' // marker fill, line color, polygon fill
  | 'strokeColor' // marker and polygon outline
  | 'strokeWidth' // marker and polygon outline width, px
  | 'size' // marker radius, px
  | 'width' // line width, px
  | 'shape' // marker shape
  | 'dash' // line and polygon-outline pattern
  | 'opacity' // per-feature opacity, 0..1, times the fill, outline and layer opacities
  | 'rotation' // marker rotation, degrees clockwise
  | 'height' // 3D polygon height, meters

/** Panel, legend and map order. */
export const CHANNEL_ORDER: readonly ChannelId[] = Object.freeze(['color', 'strokeColor', 'strokeWidth', 'size', 'width', 'shape', 'dash', 'opacity', 'rotation', 'height'])

export const CHANNEL_NAMES: Readonly<Record<ChannelId, string>> = Object.freeze({
  color: 'Color',
  strokeColor: 'Outline color',
  strokeWidth: 'Outline width',
  size: 'Size',
  width: 'Width',
  shape: 'Shape',
  dash: 'Pattern',
  opacity: 'Opacity',
  rotation: 'Rotation',
  height: 'Height',
})

/** What a channel draws: a `#rrggbb` color, a number (px, 0..1, degrees, meters), a MarkerShape or a LineDash. */
export type Output = string | number

/** Per-class settings: legend label, visibility, and (absent: from the ramp or range) the output. */
export interface ClassDef {
  label?: string
  visible?: boolean
  output?: Output
}

export interface CategoriesScale {
  kind: 'categories'
  /** True after a value edit, add or delete: the class list is fixed (spec 003). */
  manual: boolean
  /** Manual: the full list, in order. Otherwise: overrides, matched by value. */
  categories: Array<ClassDef & { value: string }>
  other: ClassDef
  noValue: ClassDef
  /** Values with their own class before "Other". */
  cap: number
  /** Color channels: the palette unset outputs come from. */
  ramp?: RampRef
  /** Numeric channels: unset outputs spread evenly from min to max. */
  range?: { min: number; max: number }
}

export interface ClassesScale {
  kind: 'classes'
  method: GraduatedMethod
  /** 2..10 */
  classCount: number
  /** Manual: the full list with bounds. Otherwise: overrides, keyed by class index. */
  classes: Array<ClassDef & { index: number; lower?: number; upper?: number }>
  noValue: ClassDef
  ramp?: RampRef
  range?: { min: number; max: number }
}

export interface ContinuousScale {
  kind: 'continuous'
  /** Absent: the column's minimum to maximum. */
  domain?: { min: number; max: number }
  /** Color channels: smooth, through every stop. */
  ramp?: RampRef
  /** Numeric channels. */
  range?: { min: number; max: number }
  /** Numeric channels: `area` (markers, QGIS's size assistant "Area") or linear (absent). */
  curve?: 'linear' | 'area'
  noValue: ClassDef
}

export interface ConditionRule {
  /** Stable across edits (legend keys, reorder). */
  id: string
  /** Empty: the legend shows the condition. */
  label: string
  /** A SQL boolean expression over the result's columns. */
  where: string
  output: Output
  visible: boolean
}

export interface ConditionsScale {
  kind: 'conditions'
  rules: ConditionRule[]
  /** Features no rule matches. */
  else: { label: string; output: Output; visible: boolean }
}

export interface IdentityScale {
  kind: 'identity'
  /** Height: meters = value × multiply (spec 008's extrusion scale). Absent: 1. */
  multiply?: number
  noValue: ClassDef
}

export interface BivariateScale {
  kind: 'bivariate'
  /** Classification of the source pair's x and y columns. */
  x: { method: BivariateMethod }
  y: { method: BivariateMethod }
  /** A palette id (./bivariateData.ts). */
  palette: string
  /** Hidden cells, `'<i>-<j>'`. */
  hidden: string[]
  noValue: ClassDef
}

export type Scale = CategoriesScale | ClassesScale | ContinuousScale | ConditionsScale | IdentityScale | BivariateScale
export type ScaleKind = Scale['kind']

export type Source =
  | { kind: 'column'; column: string }
  /** A SQL expression over the result's columns, computed by the engine; `label` is what the legend calls it. */
  | { kind: 'expression'; expression: string; label?: string }
  /** Bivariate: x is the legend's horizontal axis. */
  | { kind: 'pair'; x: string; y: string }

export interface Encoding {
  source: Source
  scale: Scale
  legend?: { title?: string; hidden?: boolean }
}

export type Channels = Partial<Record<ChannelId, Encoding>>

/** How points and polygons are drawn (lines are always lines). */
export interface DrawAs {
  points?: 'markers' | 'heatmap'
  polygons?: 'fills' | '3d'
}

export function drawOf(style: Pick<LayerStyle, 'draw'>): Required<DrawAs> {
  return { points: style.draw?.points === 'heatmap' ? 'heatmap' : 'markers', polygons: style.draw?.polygons === '3d' ? '3d' : 'fills' }
}

const MARKERS: readonly ChannelId[] = ['color', 'strokeColor', 'strokeWidth', 'size', 'shape', 'opacity', 'rotation']
const LINES: readonly ChannelId[] = ['color', 'width', 'dash', 'opacity']
const FILLS: readonly ChannelId[] = ['color', 'strokeColor', 'strokeWidth', 'opacity']
const EXTRUDED: readonly ChannelId[] = ['color', 'height', 'opacity']

/** The properties the panel lists for a geometry and drawing, in CHANNEL_ORDER (Mixed: every part's). */
export function channelsFor(geometry: StyleGeometry | null | undefined, draw: Required<DrawAs>): ChannelId[] {
  const parts: Array<readonly ChannelId[]> = []
  const points = draw.points === 'heatmap' ? [] : MARKERS
  const polygons = draw.polygons === '3d' ? EXTRUDED : FILLS
  if (geometry === 'Point') parts.push(points)
  else if (geometry === 'LineString') parts.push(LINES)
  else if (geometry === 'Polygon') parts.push(polygons)
  else parts.push(points, LINES, polygons)
  const set = new Set(parts.flat())
  return CHANNEL_ORDER.filter((c) => set.has(c))
}

const SCALES: Readonly<Record<ChannelId, readonly ScaleKind[]>> = {
  color: ['categories', 'classes', 'continuous', 'conditions', 'identity', 'bivariate'],
  strokeColor: ['categories', 'classes', 'continuous', 'conditions', 'identity'],
  strokeWidth: ['categories', 'classes', 'continuous', 'conditions', 'identity'],
  size: ['categories', 'classes', 'continuous', 'conditions', 'identity'],
  width: ['categories', 'classes', 'continuous', 'conditions', 'identity'],
  shape: ['categories', 'conditions'],
  dash: ['categories', 'conditions'],
  opacity: ['categories', 'classes', 'continuous', 'conditions', 'identity'],
  rotation: ['classes', 'continuous', 'conditions', 'identity'],
  height: ['categories', 'classes', 'continuous', 'conditions', 'identity'],
}

/** The scales a channel offers (spec FR-010). */
export function scalesFor(channel: ChannelId): ScaleKind[] {
  return [...SCALES[channel]]
}

export type OutputKind = 'color' | 'px' | 'shape' | 'dash' | 'opacity' | 'degrees' | 'meters'

export const OUTPUT_KIND: Readonly<Record<ChannelId, OutputKind>> = Object.freeze({
  color: 'color',
  strokeColor: 'color',
  strokeWidth: 'px',
  size: 'px',
  width: 'px',
  shape: 'shape',
  dash: 'dash',
  opacity: 'opacity',
  rotation: 'degrees',
  height: 'meters',
})

export const isColorChannel = (c: ChannelId): boolean => OUTPUT_KIND[c] === 'color'
export const isNumericChannel = (c: ChannelId): boolean => ['px', 'opacity', 'degrees', 'meters'].includes(OUTPUT_KIND[c])

/** Pixel outputs (sizes and widths), as spec 009's size channel. */
export const PX_RANGE = Object.freeze({ min: 0.5, max: 100 })
/** Outline widths may be 0 (no outline), as the fixed `strokeWidth`. */
export const STROKE_PX_RANGE = Object.freeze({ min: 0, max: 50 })

const HEX = /^#[0-9a-f]{6}$/i

/** Whether `v` is a valid output for the channel (data-model "Output values"). */
export function isOutputFor(channel: ChannelId, v: unknown): v is Output {
  switch (OUTPUT_KIND[channel]) {
    case 'color':
      return typeof v === 'string' && HEX.test(v)
    case 'px': {
      const r = channel === 'strokeWidth' ? STROKE_PX_RANGE : PX_RANGE
      return typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max
    }
    case 'shape':
      return isMarkerShape(v)
    case 'dash':
      return isLineDash(v)
    case 'opacity':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
    case 'degrees':
      return typeof v === 'number' && Number.isFinite(v)
    case 'meters':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0
  }
}

/** Which geometry part a fixed value is read for: a line's Color is the stroke color (spec 001's look). */
export type SymbolPart = 'marker' | 'line' | 'fill'

/** A channel's fixed value: the layer's own symbol setting. */
export function fixedValue(style: LayerStyle, channel: ChannelId, part: SymbolPart = 'fill'): Output {
  switch (channel) {
    case 'color':
      return part === 'line' ? style.strokeColor : style.fillColor
    case 'strokeColor':
      return style.strokeColor
    case 'strokeWidth':
      return style.strokeWidth
    case 'size':
      return style.pointRadius
    case 'width':
      return style.lineWidth ?? style.strokeWidth
    case 'shape':
      return (style.markerShape ?? 'circle') as MarkerShape
    case 'dash':
      return (style.lineDash ?? 'solid') as LineDash
    case 'opacity':
      return style.opacity ?? 1
    case 'rotation':
      return style.rotation ?? 0
    case 'height':
      return style.height?.meters ?? 0
  }
}

/** The engine-computed value column of an expression source (the color channel keeps spec 010's name). */
export function expressionColumn(channel: ChannelId): string {
  return channel === 'color' ? EXPRESSION_VALUE_COLUMN : `${EXPRESSION_VALUE_COLUMN}_${channel}`
}

/** The engine-computed rule index column of a conditions scale (the color channel keeps spec 010's name). */
export function conditionsColumn(channel: ChannelId): string {
  return channel === 'color' ? RULE_CLASS_COLUMN : `${RULE_CLASS_COLUMN}_${channel}`
}

/** The engine-computed label text of an expression label. */
export const LABEL_COLUMN = '__se_lbl'

/** The feature properties a channel's map expression reads. */
export function channelDataColumns(channel: ChannelId, enc: Encoding): string[] {
  if (enc.scale.kind === 'conditions') return [conditionsColumn(channel)]
  const s = enc.source
  if (s.kind === 'pair') return [s.x, s.y].filter(Boolean)
  if (s.kind === 'expression') return [expressionColumn(channel)]
  return s.column ? [s.column] : []
}

/** A short title for an encoding's source: the column, the expression's label, or `x × y`. */
export function sourceTitle(source: Source): string {
  if (source.kind === 'column') return source.column
  if (source.kind === 'pair') return [source.x, source.y].filter(Boolean).join(' × ')
  return source.label || source.expression
}
