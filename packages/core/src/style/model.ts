// Layer style: the symbol settings shared by every renderer (spec 001's
// single symbol) plus the renderer (spec 003: single, categorized or
// graduated). The shared model behind every interchange format (QGIS QML,
// OGC SLD, Mapbox GL style JSON: see ./qml.ts, ./sld.ts, ./mapbox.ts).
// Persisted shapes are plain JSON; derived ones (ResolvedStyle) never are.
//
import { sanitizeExtrusion, type Extrusion } from './extrusion.js'
import { isLineDash, isMarkerShape, type LineDash, type MarkerShape } from './symbol.js'

// Units are screen pixels throughout (MapLibre's native unit). Formats whose
// default unit is millimetres (QML) or that size markers by diameter (QML,
// SLD) are converted at the format boundary, never here.

export interface LayerStyle {
  /** `#rrggbb`. Polygon fill and point marker fill. */
  fillColor: string
  /** 0..1 */
  fillOpacity: number
  /** `#rrggbb`. Polygon outline, line color, and point marker outline. */
  strokeColor: string
  /** 0..1 */
  strokeOpacity: number
  /** Pixels. */
  strokeWidth: number
  /** Pixels (radius, as MapLibre's `circle-radius`). */
  pointRadius: number
  /**
   * Spec 008: the whole layer's opacity, 0..1, on top of the fill and
   * outline opacities (QGIS's layer opacity). Absent means 1.
   */
  layerOpacity?: number
  /**
   * Spec 003. Absent in spec 001 styles, which behave as `{ kind: 'single' }`
   * (see `rendererOf`). `sanitizeStyle` and the defaults always fill it in.
   */
  renderer?: Renderer
  /** Spec 008 US6: polygon extrusion (./extrusion.ts). Absent: flat. */
  extrusion?: Extrusion
  /** Point marker shape (./symbol.ts). Absent: circle. */
  markerShape?: MarkerShape
  /** Line and polygon outline pattern (./symbol.ts). Absent: solid. */
  lineDash?: LineDash
  /**
   * Spec 009: the size channel, an independent marker size (points) or line
   * width (lines) by a numeric column. Absent: every feature uses
   * `pointRadius` / `strokeWidth`. Not applied to polygons, nor with a
   * bivariate color channel (kept, inactive).
   */
  size?: SizeChannel
}

// --- Renderers (spec 003, data-model.md) ----------------------------------

/** The color channel. */
export type Renderer = SingleRenderer | CategorizedRenderer | GraduatedRenderer | BivariateRenderer

export interface SingleRenderer {
  kind: 'single'
}

/** A ramp from the catalog (./ramps.ts). */
export interface RampRef {
  id: string
  reversed: boolean
}

/** Per-class edits that don't change the classes themselves (FR-009). */
export interface ClassOverride {
  /** `#rrggbb`; absent = from the ramp. */
  color?: string
  /** Absent = generated. */
  label?: string
  /** Absent = visible. */
  visible?: boolean
}

export interface CategoryClassDef extends ClassOverride {
  /** String form of the value, as `toCategory()` and MapLibre's `to-string` make it. */
  value: string
}

export interface CategorizedRenderer {
  kind: 'categorized'
  column: string
  ramp: RampRef
  /** Classes before "Other" (spec Assumptions: 12). */
  cap: number
  /** True after a value edit, add or delete: the class list is fixed. */
  manual: boolean
  /** Manual: the full list, in order. Otherwise: overrides, matched by value. */
  classes: CategoryClassDef[]
  other: ClassOverride
  noValue: ClassOverride
}

export type GraduatedMethod = 'equal' | 'quantile' | 'jenks' | 'manual'

export interface RangeClassDef extends ClassOverride {
  index: number
  /** Required when the method is manual. */
  lower?: number
  upper?: number
}

export interface GraduatedRenderer {
  kind: 'graduated'
  column: string
  method: GraduatedMethod
  /** 2..10 */
  classCount: number
  ramp: RampRef
  /** Manual: the full list with bounds. Otherwise: overrides, keyed by class index. */
  classes: RangeClassDef[]
  noValue: ClassOverride
  /**
   * LEGACY INPUT ONLY (2026-10-12 build, "Vary: Size"): read by
   * `sanitizeStyle`, which migrates it to a `SizeChannel` (spec 009 FR-009),
   * and never written again.
   */
  vary?: 'color' | 'size'
  sizeMin?: number
  sizeMax?: number
}

// --- Spec 009: the size channel and bivariate colors (data-model.md) ----------

/** How the size channel turns values into sizes. */
export type SizeMode = 'classed' | 'proportional'

export interface SizeChannel {
  /** A numeric column; may be the color channel's column. */
  column: string
  mode: SizeMode
  /** Classed only (as graduated). */
  method: GraduatedMethod
  /** Classed only: 2..10. */
  classCount: number
  /** Classed only: as graduated (manual: the full list with bounds; otherwise overrides by index). Color overrides don't apply. */
  classes: RangeClassDef[]
  /** Label and visibility of features with no value. */
  noValue: Omit<ClassOverride, 'color'>
  /** px: marker radius (points) or line width (lines); sizeMin <= sizeMax. */
  sizeMin: number
  sizeMax: number
}

export type BivariateMethod = Exclude<GraduatedMethod, 'manual'>

export interface BivariateAxis {
  column: string
  method: BivariateMethod
}

export interface BivariateRenderer {
  kind: 'bivariate'
  /** Axis 1: the legend's horizontal axis. */
  x: BivariateAxis
  /** Axis 2: the legend's vertical axis; a different column from x. */
  y: BivariateAxis
  /** A palette id (./bivariateData.ts); unknown ids use the default. */
  palette: string
  /** Hidden cells, `'<i>-<j>'` (i: x class, j: y class, 0-based). */
  hidden: string[]
  noValue: Omit<ClassOverride, 'color'>
}

/** What the map, legend and panel draw. Recomputed on every style or data change; never saved. */
export interface ResolvedStyle {
  /** 'fallback' (FR-012): the styled column is missing or no longer fits; the single symbol is drawn. */
  status: 'ok' | 'fallback'
  reason?: string
  /** Legend header, e.g. 'value · Quantile, 5 classes'. Empty for single. */
  caption: string
  /** Legend order: value or range classes, then "Other", then "No value". */
  classes: ResolvedClass[]
  /** e.g. 'Only 3 distinct values: 3 classes.' */
  notes: string[]
  /** Spec 009, bivariate only: both axes' classes. */
  grid?: { x: AxisInfo; y: AxisInfo }
  /** Spec 009: the size channel, when one applies. */
  size?: ResolvedSizeChannel
}

/** A bivariate axis as resolved. */
export interface AxisInfo {
  column: string
  method: BivariateMethod
  ranges: Array<{ lower: number; upper: number; label: string }>
}

/** The size channel as resolved (spec 009). Recomputed with the style; never saved. */
export interface ResolvedSizeChannel {
  /** 'fallback': the size column is missing or not numeric; the single size is drawn. */
  status: 'ok' | 'fallback'
  reason?: string
  /** Legend group header, e.g. 'aadt · Quantile, 5 classes'. */
  caption: string
  mode: SizeMode
  column: string
  /** Classed: range classes with `size`, then "No value". Proportional: only "No value", when present. */
  classes: ResolvedClass[]
  /** Proportional: the column's range over the displayed result. */
  domain?: { min: number; max: number }
  /** Proportional: legend reference sizes, smallest first. */
  samples?: Array<{ value: number; size: number; label: string }>
  notes: string[]
}

export interface ResolvedClass {
  /** Stable: `v:<value>`, `range:<i>`, `cell:<i>-<j>`, `__other`, `__null`, or `single`. */
  key: string
  kind: 'single' | 'value' | 'range' | 'other' | 'noValue' | 'cell'
  label: string
  color: string
  visible: boolean
  /** Features of the displayed result in this class. */
  count: number
  /** kind 'value' */
  value?: string
  /** kind 'range': lower < v <= upper; the first range also includes lower (research §2). */
  lower?: number
  upper?: number
  /** kind 'other': how many distinct values it groups. */
  groups?: number
  /** Size channel classes: marker radius or line width, px. */
  size?: number
  /** kind 'cell': the x class (column) and y class (row), 0-based. */
  col?: number
  row?: number
  /** kind 'cell': the x and y value ranges (same rules as 'range'). */
  x?: { lower: number; upper: number }
  y?: { lower: number; upper: number }
}

/** Items not exported, not imported, or not applied (FR-015). */
export interface StyleNotice {
  direction: 'export' | 'import' | 'apply'
  format?: StyleFormat
  items: string[]
}

export const OTHER_COLOR = '#bdbdbd'
export const NO_VALUE_COLOR = '#8c8c8c'
export const DEFAULT_CATEGORY_CAP = 12
/** Spec 009: the bivariate palette new styles start with (./bivariateData.ts). */
export const DEFAULT_BIVARIATE_PALETTE = 'orange-blue'
export const DEFAULT_CLASS_COUNT = 5
export const MIN_CLASS_COUNT = 2
export const MAX_CLASS_COUNT = 10

const SINGLE: SingleRenderer = Object.freeze({ kind: 'single' }) as SingleRenderer

/** The style's renderer; spec 001 styles (no renderer) are single. */
export function rendererOf(style: Pick<LayerStyle, 'renderer'>): Renderer {
  return style.renderer ?? SINGLE
}

/** The columns the color channel reads: none, one, or both bivariate axes (spec 009). */
export function rendererColumns(renderer: Renderer): string[] {
  if (renderer.kind === 'single') return []
  if (renderer.kind === 'bivariate') return [renderer.x.column, renderer.y.column].filter(Boolean)
  return renderer.column ? [renderer.column] : []
}

/** Every attribute a style's channels read (color, then size), deduplicated. Map views fetch only these (spec 007). */
export function styleDataColumns(style: Pick<LayerStyle, 'renderer' | 'size'>): string[] {
  const cols = rendererColumns(rendererOf(style))
  const size = style.size?.column
  return size && !cols.includes(size) ? [...cols, size] : cols
}

/** A short title for the color channel's columns: `zone`, `poverty_rate × obesity_rate`, or '' (single). */
export function rendererTitle(renderer: Renderer): string {
  return rendererColumns(renderer).join(' × ')
}

/**
 * Data colors are fixed and theme-independent (CLAUDE.md): a mid blue that
 * reads on light and dark basemaps alike, with a darker outline, following
 * GeoLibre's default single-symbol treatment.
 */
export const DEFAULT_LAYER_STYLE: Readonly<LayerStyle> = Object.freeze({
  fillColor: '#3b82f6',
  fillOpacity: 0.45,
  strokeColor: '#1d4ed8',
  strokeOpacity: 1,
  strokeWidth: 1.5,
  pointRadius: 5,
  renderer: { kind: 'single' } as SingleRenderer,
})

export type StyleFormat = 'qml' | 'sld' | 'mapbox'

/** Which geometry the exported style should describe. `Mixed` layers export every symbolizer the format allows. */
export type StyleGeometry = 'Point' | 'LineString' | 'Polygon' | 'Mixed'

export interface StyleImportResult {
  style: LayerStyle
  format: StyleFormat
  /** Human-readable caveats, e.g. "Only the first symbol of a categorized renderer was imported." */
  notes: string[]
}

// --- color helpers (shared by every format) -------------------------------

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function hex2(n: number): string {
  return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
}

export function rgbToHex({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

/**
 * Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, and QGIS's
 * `r,g,b,a` (0–255 alpha; newer QGIS appends `,rgb:...` float components,
 * which are ignored). Returns null for anything else (named colors,
 * expressions) so importers can fall back to a default and add a note.
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null
  const s = input.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 }
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? clamp(Number(m[4]), 0, 1) : 1 }
  }
  m = /^(\d{1,3}),(\d{1,3}),(\d{1,3})(?:,(\d{1,3}))?(?:,.*)?$/.exec(s)
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) / 255 : 1 }
  }
  return null
}

/** Rounds to a sensible precision for files humans may diff. */
export function round(n: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export function sanitizeStyle(style: Partial<LayerStyle>): LayerStyle {
  const pick = (c: string | undefined, fallback: string): string => {
    const rgba = parseColor(c)
    return rgba ? rgbToHex(rgba) : fallback
  }
  const num = (n: number | undefined, fallback: number, lo: number, hi: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fallback
  return {
    fillColor: pick(style.fillColor, DEFAULT_LAYER_STYLE.fillColor),
    fillOpacity: num(style.fillOpacity, DEFAULT_LAYER_STYLE.fillOpacity, 0, 1),
    strokeColor: pick(style.strokeColor, DEFAULT_LAYER_STYLE.strokeColor),
    strokeOpacity: num(style.strokeOpacity, DEFAULT_LAYER_STYLE.strokeOpacity, 0, 1),
    strokeWidth: num(style.strokeWidth, DEFAULT_LAYER_STYLE.strokeWidth, 0, 50),
    pointRadius: num(style.pointRadius, DEFAULT_LAYER_STYLE.pointRadius, 0.5, 100),
    renderer: sanitizeRenderer(style.renderer),
    ...(typeof style.layerOpacity === 'number' && Number.isFinite(style.layerOpacity) && style.layerOpacity < 1 ? { layerOpacity: clamp(style.layerOpacity, 0, 1) } : {}),
    ...(sanitizeExtrusion(style.extrusion) ? { extrusion: sanitizeExtrusion(style.extrusion) } : {}),
    ...(isMarkerShape(style.markerShape) && style.markerShape !== 'circle' ? { markerShape: style.markerShape } : {}),
    ...(isLineDash(style.lineDash) && style.lineDash !== 'solid' ? { lineDash: style.lineDash } : {}),
  }
}

const HEX = /^#[0-9a-f]{6}$/i

function sanitizeOverride(o: ClassOverride | undefined): ClassOverride {
  const out: ClassOverride = {}
  if (!o) return out
  if (typeof o.color === 'string') {
    const c = parseColor(o.color)
    if (c) out.color = rgbToHex(c)
  }
  if (typeof o.label === 'string') out.label = o.label
  if (o.visible === false) out.visible = false
  return out
}

function sanitizeRamp(r: RampRef | undefined, fallback: string): RampRef {
  return { id: typeof r?.id === 'string' && r.id ? r.id : fallback, reversed: r?.reversed === true }
}

const SIZE_LO = 0.5
const SIZE_HI = 100

/** A size-graduated renderer's range, made valid (min <= max, both within 0.5..100 px). */
function sanitizeSizes(g: Partial<GraduatedRenderer>): Pick<GraduatedRenderer, 'vary' | 'sizeMin' | 'sizeMax'> {
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, SIZE_LO, SIZE_HI) : fallback)
  const min = n(g.sizeMin, 2)
  const max = n(g.sizeMax, Math.max(min, 10))
  return { vary: 'size', sizeMin: Math.min(min, max), sizeMax: Math.max(min, max) }
}

/**
 * Coerces a stored or imported renderer into a valid one: unknown kinds
 * become single, numbers are clamped, overrides keep only valid fields.
 * Structural rules a user edit can break (order, duplicates) are checked by
 * `validateStyle`, not silently repaired here.
 */
export function sanitizeRenderer(r: Partial<Renderer> | undefined): Renderer {
  if (!r || typeof r !== 'object') return { kind: 'single' }
  if (r.kind === 'categorized') {
    const c = r as Partial<CategorizedRenderer>
    return {
      kind: 'categorized',
      column: String(c.column ?? ''),
      ramp: sanitizeRamp(c.ramp, 'brewer-set2'),
      cap: clamp(Math.round(Number(c.cap ?? DEFAULT_CATEGORY_CAP)) || DEFAULT_CATEGORY_CAP, 1, DEFAULT_CATEGORY_CAP),
      manual: c.manual === true,
      classes: (Array.isArray(c.classes) ? c.classes : []).filter((k) => k && typeof k.value === 'string').map((k) => ({ value: k.value, ...sanitizeOverride(k) })),
      other: sanitizeOverride(c.other),
      noValue: sanitizeOverride(c.noValue),
    }
  }
  if (r.kind === 'graduated') {
    const g = r as Partial<GraduatedRenderer>
    const method: GraduatedMethod = g.method === 'equal' || g.method === 'quantile' || g.method === 'jenks' || g.method === 'manual' ? g.method : 'quantile'
    return {
      kind: 'graduated',
      column: String(g.column ?? ''),
      method,
      classCount: clamp(Math.round(Number(g.classCount ?? DEFAULT_CLASS_COUNT)) || DEFAULT_CLASS_COUNT, MIN_CLASS_COUNT, MAX_CLASS_COUNT),
      ramp: sanitizeRamp(g.ramp, 'viridis'),
      classes: (Array.isArray(g.classes) ? g.classes : [])
        .filter((k) => k && Number.isInteger(k.index))
        .map((k) => {
          const out: RangeClassDef = { index: k.index, ...sanitizeOverride(k) }
          if (typeof k.lower === 'number' && Number.isFinite(k.lower)) out.lower = k.lower
          if (typeof k.upper === 'number' && Number.isFinite(k.upper)) out.upper = k.upper
          return out
        }),
      noValue: sanitizeOverride(g.noValue),
      ...(g.vary === 'size' ? sanitizeSizes(g) : {}),
    }
  }
  return { kind: 'single' }
}

/** Problems a user edit or a hand-written file can introduce (data-model.md Validation). Empty = valid. */
export function validateStyle(style: LayerStyle): string[] {
  const errors: string[] = []
  const r = rendererOf(style)
  const colorOk = (c: string | undefined) => c === undefined || HEX.test(c)
  if (r.kind === 'categorized') {
    if (!r.column) errors.push('Choose a column.')
    if (!Number.isInteger(r.cap) || r.cap < 1 || r.cap > DEFAULT_CATEGORY_CAP) errors.push(`The class cap must be between 1 and ${DEFAULT_CATEGORY_CAP}.`)
    const seen = new Set<string>()
    for (const k of r.classes) {
      if (seen.has(k.value)) errors.push(`The value "${k.value}" is used by two classes.`)
      seen.add(k.value)
    }
    for (const o of [...r.classes, r.other, r.noValue]) if (!colorOk(o.color)) errors.push(`"${o.color}" is not a #rrggbb color.`)
  } else if (r.kind === 'graduated') {
    if (!r.column) errors.push('Choose a column.')
    if (!Number.isInteger(r.classCount) || r.classCount < MIN_CLASS_COUNT || r.classCount > MAX_CLASS_COUNT) {
      errors.push(`The number of classes must be between ${MIN_CLASS_COUNT} and ${MAX_CLASS_COUNT}.`)
    }
    if (r.method === 'manual') {
      const ranges = [...r.classes].sort((a, b) => a.index - b.index)
      ranges.forEach((k, i) => {
        if (k.lower === undefined || k.upper === undefined) errors.push(`Class ${i + 1} needs both bounds.`)
        else if (!(k.lower < k.upper)) errors.push(`Class ${i + 1}: the lower bound must be below the upper bound.`)
        const next = ranges[i + 1]
        if (next && k.upper !== undefined && next.lower !== undefined && k.upper !== next.lower) {
          errors.push(`Class ${i + 2} must start where class ${i + 1} ends (${k.upper}).`)
        }
      })
    }
    for (const o of [...r.classes, r.noValue]) if (!colorOk(o.color)) errors.push(`"${o.color}" is not a #rrggbb color.`)
    if (r.vary === 'size') {
      const ok = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v >= SIZE_LO && v <= SIZE_HI
      if (!ok(r.sizeMin) || !ok(r.sizeMax)) errors.push(`Sizes must be between ${SIZE_LO} and ${SIZE_HI} px.`)
      else if ((r.sizeMin as number) > (r.sizeMax as number)) errors.push('The smallest size must not be larger than the largest.')
    }
  }
  return errors
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Spec 008: the style with the layer opacity folded into the fill and
 * outline opacities, for formats and renderers with no layer-level opacity
 * (MapLibre paint, SLD, Mapbox GL style JSON).
 */
export function withLayerOpacity(style: LayerStyle): LayerStyle {
  const lo = style.layerOpacity ?? 1
  if (lo >= 1) return style
  const { layerOpacity: _drop, ...rest } = style
  void _drop
  return { ...rest, fillOpacity: style.fillOpacity * lo, strokeOpacity: style.strokeOpacity * lo }
}
