// Spec 011: style by channels. A channel is one visual property (color,
// outline, size, shape, ...) that is either a fixed value (the flat LayerStyle
// fields, unchanged from spec 001–009) or By column: a source (a column, a SQL
// expression the engine computes, or a pair for bivariate) through a scale.
// data-model.md has the model; FR-010 the scales each channel offers.
import { isLineDash, isMarkerShape, type LineDash, type MarkerShape } from './symbol.js'
import { DEFAULT_CATEGORY_CAP, EXPRESSION_VALUE_COLUMN, RULE_CLASS_COLUMN, type BivariateMethod, type GraduatedMethod, type LayerStyle, type RampRef, type StyleGeometry } from './model.js'

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
  /** Numeric channels: the curve kept for a switch to Continuous (spec 009 sets it when sizing starts). */
  curve?: 'linear' | 'area'
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
  points?: 'markers' | 'heatmap' | 'clusters'
  polygons?: 'fills' | '3d'
}

export function drawOf(style: Pick<LayerStyle, 'draw'>): Required<DrawAs> {
  const points = style.draw?.points === 'heatmap' || style.draw?.points === 'clusters' ? style.draw.points : 'markers'
  return { points, polygons: style.draw?.polygons === '3d' ? '3d' : 'fills' }
}

const MARKERS: readonly ChannelId[] = ['color', 'strokeColor', 'strokeWidth', 'size', 'shape', 'opacity', 'rotation']
const LINES: readonly ChannelId[] = ['color', 'width', 'dash', 'opacity']
const FILLS: readonly ChannelId[] = ['color', 'strokeColor', 'strokeWidth', 'opacity']
const EXTRUDED: readonly ChannelId[] = ['color', 'height', 'opacity']

/** The properties the panel lists for a geometry and drawing, in CHANNEL_ORDER (Mixed: every part's). */
export function channelsFor(geometry: StyleGeometry | null | undefined, draw: Required<DrawAs>): ChannelId[] {
  const parts: Array<readonly ChannelId[]> = []
  // A heatmap or clusters draw points themselves (points left out of a group keep the single symbol).
  const points = draw.points === 'heatmap' || draw.points === 'clusters' ? [] : MARKERS
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
      return (style.height?.meters ?? 0) * (style.height?.scale ?? 1)
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

// --- validation (data-model.md "Validation and migration") ------------------

/** Values with their own class before "Other", per output (shapes and patterns keep one for Other: 7 and 5 in all). */
export function categoryCapFor(channel: ChannelId): number {
  const k = OUTPUT_KIND[channel]
  return k === 'shape' ? 6 : k === 'dash' ? 4 : DEFAULT_CATEGORY_CAP
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const METHODS: readonly GraduatedMethod[] = ['equal', 'quantile', 'jenks', 'manual']

function sanitizeClassDef(channel: ChannelId, raw: unknown): ClassDef {
  const out: ClassDef = {}
  if (!isObj(raw)) return out
  if (typeof raw.label === 'string') out.label = raw.label
  if (raw.visible === false) out.visible = false
  if (isOutputFor(channel, raw.output)) out.output = raw.output
  return out
}

function sanitizeRampRef(raw: unknown): RampRef | undefined {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return undefined
  return { id: raw.id, reversed: raw.reversed === true }
}

function sanitizeRange(channel: ChannelId, raw: unknown): { min: number; max: number } | undefined {
  if (!isObj(raw) || !finiteNum(raw.min) || !finiteNum(raw.max)) return undefined
  if (!isOutputFor(channel, raw.min) || !isOutputFor(channel, raw.max)) return undefined
  return { min: Math.min(raw.min, raw.max), max: Math.max(raw.min, raw.max) }
}

function rows(v: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(v) ? v : []).filter(isObj)
}

function sanitizeScale(channel: ChannelId, raw: unknown): Scale | null {
  if (!isObj(raw) || !scalesFor(channel).includes(raw.kind as ScaleKind)) return null
  const color = isColorChannel(channel)
  const ramp = color ? sanitizeRampRef(raw.ramp) : undefined
  const range = color ? undefined : sanitizeRange(channel, raw.range)
  const extras = { ...(ramp ? { ramp } : {}), ...(range ? { range } : {}) }
  switch (raw.kind as ScaleKind) {
    case 'categories': {
      const cap = finiteNum(raw.cap) ? clampN(Math.round(raw.cap), 1, categoryCapFor(channel)) : categoryCapFor(channel)
      return {
        kind: 'categories',
        manual: raw.manual === true,
        categories: rows(raw.categories)
          .filter((c) => typeof c.value === 'string')
          .map((c) => ({ value: c.value as string, ...sanitizeClassDef(channel, c) })),
        other: sanitizeClassDef(channel, raw.other),
        noValue: sanitizeClassDef(channel, raw.noValue),
        cap,
        ...extras,
      }
    }
    case 'classes':
      return {
        kind: 'classes',
        method: METHODS.includes(raw.method as GraduatedMethod) ? (raw.method as GraduatedMethod) : 'quantile',
        classCount: finiteNum(raw.classCount) ? clampN(Math.round(raw.classCount), 2, 10) : 5,
        classes: rows(raw.classes)
          .filter((c) => Number.isInteger(c.index))
          .map((c) => ({
            index: c.index as number,
            ...sanitizeClassDef(channel, c),
            ...(finiteNum(c.lower) ? { lower: c.lower } : {}),
            ...(finiteNum(c.upper) ? { upper: c.upper } : {}),
          })),
        noValue: sanitizeClassDef(channel, raw.noValue),
        ...extras,
        ...(!color && (raw.curve === 'area' || raw.curve === 'linear') ? { curve: raw.curve } : {}),
      }
    case 'continuous': {
      const d = raw.domain
      const domain = isObj(d) && finiteNum(d.min) && finiteNum(d.max) && d.min < d.max ? { min: d.min, max: d.max } : undefined
      return {
        kind: 'continuous',
        ...(domain ? { domain } : {}),
        ...extras,
        ...(!color && (raw.curve === 'area' || raw.curve === 'linear') ? { curve: raw.curve } : {}),
        noValue: sanitizeClassDef(channel, raw.noValue),
      }
    }
    case 'conditions': {
      const seen = new Set<string>()
      const output = (v: unknown): Output | null => (isOutputFor(channel, v) ? v : null)
      const rules = rows(raw.rules).flatMap((k, i) => {
        const o = output(k.output)
        if (o === null) return []
        let id = typeof k.id === 'string' && k.id ? k.id : `r${i + 1}`
        while (seen.has(id)) id = `${id}_`
        seen.add(id)
        return [{ id, label: typeof k.label === 'string' ? k.label : '', where: typeof k.where === 'string' ? k.where : '', output: o, visible: k.visible !== false }]
      })
      const e = isObj(raw.else) ? raw.else : {}
      const elseOut = output(e.output)
      if (elseOut === null) return null
      return { kind: 'conditions', rules, else: { label: typeof e.label === 'string' && e.label.trim() ? e.label : 'Everything else', output: elseOut, visible: e.visible !== false } }
    }
    case 'identity':
      return {
        kind: 'identity',
        ...(finiteNum(raw.multiply) && raw.multiply > 0 && raw.multiply !== 1 ? { multiply: raw.multiply } : {}),
        noValue: sanitizeClassDef(channel, raw.noValue),
      }
    case 'bivariate': {
      const axis = (a: unknown): { method: BivariateMethod } => {
        const m = isObj(a) ? a.method : undefined
        return { method: m === 'equal' || m === 'jenks' || m === 'quantile' ? m : 'quantile' }
      }
      return {
        kind: 'bivariate',
        x: axis(raw.x),
        y: axis(raw.y),
        palette: typeof raw.palette === 'string' && raw.palette ? raw.palette : 'orange-blue',
        hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).filter((k): k is string => typeof k === 'string' && /^[0-2]-[0-2]$/.test(k)),
        noValue: sanitizeClassDef(channel, raw.noValue),
      }
    }
  }
}

function sanitizeSource(scale: Scale, raw: unknown): Source | null {
  // Conditions read the engine's rule column; their source is only a placeholder.
  const none: Source | null = scale.kind === 'conditions' ? { kind: 'column', column: '' } : null
  if (!isObj(raw)) return none
  if (scale.kind === 'bivariate') return raw.kind === 'pair' && typeof raw.x === 'string' && typeof raw.y === 'string' ? { kind: 'pair', x: raw.x, y: raw.y } : null
  if (raw.kind === 'expression' && typeof raw.expression === 'string' && raw.expression.trim()) {
    return { kind: 'expression', expression: raw.expression.trim(), ...(typeof raw.label === 'string' && raw.label ? { label: raw.label } : {}) }
  }
  if (raw.kind === 'column' && typeof raw.column === 'string') return { kind: 'column', column: raw.column }
  return none
}

/** One stored encoding made valid, or null (dropped: a scale the channel doesn't offer, or no usable source). */
export function sanitizeEncoding(channel: ChannelId, raw: unknown): Encoding | null {
  if (!isObj(raw)) return null
  const scale = sanitizeScale(channel, raw.scale)
  if (!scale) return null
  const source = sanitizeSource(scale, raw.source)
  if (!source) return null
  const l = raw.legend
  const legend = isObj(l) ? { ...(typeof l.title === 'string' && l.title ? { title: l.title } : {}), ...(l.hidden === true ? { hidden: true } : {}) } : {}
  return { source, scale, ...(Object.keys(legend).length ? { legend } : {}) }
}

/** Stored channels made valid: unknown channel ids and unusable encodings are dropped. */
export function sanitizeChannels(raw: unknown): Channels {
  const out: Channels = {}
  if (!isObj(raw)) return out
  for (const id of CHANNEL_ORDER) {
    const enc = sanitizeEncoding(id, raw[id])
    if (enc) out[id] = enc
  }
  return out
}

/** A stored `draw` made valid; the defaults (markers, fills) are left out. */
export function sanitizeDraw(raw: unknown): DrawAs {
  if (!isObj(raw)) return {}
  const points: DrawAs = raw.points === 'heatmap' || raw.points === 'clusters' ? { points: raw.points } : {}
  return { ...points, ...(raw.polygons === '3d' ? { polygons: '3d' as const } : {}) }
}
