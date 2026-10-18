// Layer style: the symbol settings shared by every renderer (spec 001's
// single symbol) plus the renderer (spec 003: single, categorized or
// graduated). The shared model behind every interchange format (QGIS QML,
// OGC SLD, Mapbox GL style JSON: see ./qml.ts, ./sld.ts, ./mapbox.ts).
// Persisted shapes are plain JSON; derived ones (ResolvedStyle) never are.
//
import { sanitizeExtrusion, type Extrusion } from './extrusion.js'
import { isLineDash, isMarkerShape, type LineDash, type MarkerShape } from './symbol.js'
import type { ChannelId, Channels, DrawAs, Output, ScaleKind } from './channels.js'
import { sanitizeLabels, type LabelSettings } from './labels.js'
import { rendererOf, sizeOf, withExtrusion, withRenderer, withSize } from './legacy.js'
import { LABEL_COLUMN, channelDataColumns, sanitizeChannels, sanitizeDraw } from './channels.js'

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
  /** Spec 011: line Width, fixed, when it differs from `strokeWidth` (absent: `strokeWidth`). */
  lineWidth?: number
  /** Spec 011: Rotation, fixed, degrees clockwise (absent: 0). */
  rotation?: number
  /** Spec 011: Opacity, fixed, per feature on top of the fill and outline opacities (absent: 1). */
  opacity?: number
  /** Spec 011: how points and polygons are drawn (absent: markers, fills). */
  draw?: DrawAs
  /** Spec 011: the properties that vary by data; absent ones use the fixed values above. */
  channels?: Channels
  /** Spec 011: the heatmap's settings, used while points are drawn as a heatmap. */
  heatmap?: HeatmapSettings
  /** The clusters' settings, used while points are drawn as clusters (bubbles). */
  clusters?: ClusterSettings
  /** Spec 011: the fixed 3D height (meters × scale, spec 008's constant), when no height channel varies. */
  height?: { meters: number; scale?: number }
  /** Spec 011 US6: labels. */
  labels?: LabelSettings
  /** Spec 019: direction arrows along lines. Absent: none. */
  arrows?: ArrowSettings
}

// --- Spec 019: direction arrows on lines -------------------------------------

/**
 * Arrowheads drawn along every line, pointing the way the line is digitized (its first vertex to its last), so a
 * flow, a one-way street or a river reads in its direction. MapLibre's line-placed symbols; lines only.
 */
export interface ArrowSettings {
  /** 'along': repeated every `spacing` px; 'center': one at the middle of each line. */
  placement: 'along' | 'center'
  /** px between arrows ('along'). */
  spacing: number
  /** Scale of the arrowhead, 1 = a head as wide as a 4 px line draws it (it follows the line width). */
  size: number
  /** `#rrggbb`. Absent: the line's own color (also per feature, when the color varies by data). */
  color?: string
}

export const ARROW_SPACING = { min: 20, max: 500, default: 80 } as const
export const ARROW_SIZE = { min: 0.5, max: 4, default: 1 } as const
export const DEFAULT_ARROWS: Readonly<ArrowSettings> = Object.freeze({ placement: 'along', spacing: ARROW_SPACING.default, size: ARROW_SIZE.default })

/** Arrow settings made valid, or undefined (none). */
export function sanitizeArrows(raw: unknown): ArrowSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Partial<ArrowSettings>
  const num = (v: unknown, b: { min: number; max: number; default: number }): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, b.min, b.max) : b.default)
  const rgba = typeof a.color === 'string' ? parseColor(a.color) : null
  return {
    placement: a.placement === 'center' ? 'center' : 'along',
    spacing: Math.round(num(a.spacing, ARROW_SPACING)),
    size: Math.round(num(a.size, ARROW_SIZE) * 10) / 10,
    ...(rgba ? { color: rgbToHex(rgba) } : {}),
  }
}

// --- Renderers (spec 003, data-model.md) ----------------------------------

/** The color channel. */
export type Renderer = SingleRenderer | CategorizedRenderer | GraduatedRenderer | BivariateRenderer | RulesRenderer | HeatmapRenderer | ClusterRenderer

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
  /** The numeric column; with `expression`, the label shown for it (defaults to the expression text). */
  column: string
  /**
   * Spec 010: a SQL expression over the result's columns, classified instead
   * of `column` (e.g. `gdp_md * 1e6 / pop_est`). The engine computes it per
   * feature as EXPRESSION_VALUE_COLUMN.
   */
  expression?: string
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
  /**
   * Proportional only: how sizes follow values. `linear` (lines: width) or
   * `area` (markers: QGIS's size assistant "Area", r = min + (max - min)·√t).
   * Set from the geometry when the channel starts; absent means linear.
   */
  scale?: 'linear' | 'area'
}

// --- Spec 010: rule-based styling --------------------------------------------

/** One rule: a SQL condition over the result's columns and its color. */
export interface RuleDef {
  /** Stable across edits (legend keys, reorder). */
  id: string
  /** Empty: the legend shows the condition (truncated). */
  label: string
  /** A SQL boolean expression, e.g. `pop_est > 1e8 AND continent = 'Asia'`. */
  where: string
  /** `#rrggbb` */
  color: string
  visible: boolean
}

/** Spec 010: the first matching rule colors a feature; the rest are "Everything else". */
export interface RulesRenderer {
  kind: 'rules'
  rules: RuleDef[]
  elseColor: string
  elseVisible: boolean
  elseLabel: string
}

/** The engine-computed class of each feature under a rules renderer: the matching rule's index, or -1. */
export const RULE_CLASS_COLUMN = '__se_cls'
/** The engine-computed value of a graduated renderer's expression. */
export const EXPRESSION_VALUE_COLUMN = '__se_val'
export const DEFAULT_ELSE_LABEL = 'Everything else'

/** A rule's legend label: its own, or its condition shortened to 40 characters. */
export function ruleLabel(rule: Pick<RuleDef, 'label' | 'where'>): string {
  if (rule.label.trim()) return rule.label.trim()
  const w = rule.where.trim().replace(/\s+/g, ' ')
  return w.length > 40 ? `${w.slice(0, 39)}…` : w || 'Rule'
}

// --- Heatmap -----------------------------------------------------------------

/**
 * Point density as a smooth color surface (MapLibre's heatmap layer; QGIS's
 * heatmap renderer). Points only: lines and polygons keep the single symbol.
 */
export interface HeatmapRenderer {
  kind: 'heatmap'
  /** A numeric column weighting each point (weights are value / the column's largest value); '' = each point counts once. */
  weight: string
  /** px: how far each point spreads on screen (MapLibre `heatmap-radius`; QGIS's radius in pixels). */
  radius: number
  /**
   * How the radius is measured. 'px' (absent): on screen, so zooming out
   * piles points together and the map gets hotter. 'm': on the ground, so a
   * place keeps its density, and its color, at every zoom.
   */
  radiusUnit?: 'px' | 'm'
  /** Ground radius in meters (radiusUnit 'm'). */
  radiusMeters?: number
  /**
   * Where meters are converted to pixels (Web Mercator's scale changes with
   * latitude; MapLibre can scale a radius by zoom, not by each point's
   * latitude). Set when meters are chosen; absent: the layer's center.
   */
  latitude?: number
  /** Multiplies the density (MapLibre `heatmap-intensity`). */
  intensity: number
  /** Low to high density; zero density is transparent. */
  ramp: RampRef
  /**
   * Intensity from the data: the densest spot takes the ramp's last color.
   * Only with the radius in meters (on screen, the densest spot changes
   * with zoom); `intensity` is kept for when it's turned off.
   */
  autoIntensity?: boolean
}

/** Spec 011: the heatmap's settings (`draw.points = 'heatmap'`). */
export type HeatmapSettings = Omit<HeatmapRenderer, 'kind'>

export const HEATMAP_RADIUS = { min: 2, max: 100, default: 20 } as const
/** Dense data needs far less than 1 (MapLibre adds the points up, and nothing scales to the densest spot). */
export const HEATMAP_INTENSITY = { min: 0.01, max: 5, default: 1 } as const
export const HEATMAP_METERS = { min: 1, max: 1_000_000, default: 1000 } as const

/** Web Mercator ground meters per CSS pixel at a zoom and latitude (MapLibre's 512 px tiles). */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180)) / (512 * 2 ** zoom)
}
export const DEFAULT_HEATMAP_RAMP = 'brewer-ylorrd'

// --- Clusters (bubbles) ------------------------------------------------------

/**
 * Nearby points grouped into bubbles, sized and colored by how many points
 * each holds, with the count on it; a click zooms in until it breaks apart.
 * After mapgl's cluster_options (R, walkerke/mapgl): three steps (#51bbd6,
 * #f1f075, #f28cb1 at 20, 30 and 40 px, from 100 and 750 points), a 50 px
 * radius, grouping up to zoom 14, abbreviated counts. Points not in a group
 * keep the single symbol; lines and polygons are never grouped.
 */
export interface ClusterRenderer {
  kind: 'clusters'
  /** px on screen: how close points must be to group (MapLibre `clusterRadius`). */
  radius: number
  /** Points stop grouping above this zoom (MapLibre `clusterMaxZoom`). */
  maxZoom: number
  /** Smallest groups first: the count each step starts at (the first is 2), its color and its bubble radius (px). */
  steps: ClusterStep[]
  /** How counts read on the bubbles: 12.3k, 12,345 or 12345. */
  countFormat: ClusterCountFormat
  /** The counts' color. */
  textColor: string
  /** The bubbles' opacity, 0..1. */
  opacity: number
  /** The bubbles' outline (width 0: none). */
  strokeColor: string
  strokeWidth: number
}

export interface ClusterStep {
  /** Groups of at least this many points (the first step: 2, the smallest group). */
  from: number
  color: string
  /** The bubble's radius, px. */
  radius: number
}

export type ClusterCountFormat = 'abbreviated' | 'grouped' | 'raw'

/** The clusters' settings (`draw.points = 'clusters'`). */
export type ClusterSettings = Omit<ClusterRenderer, 'kind'>

export const CLUSTER_RADIUS = { min: 10, max: 200, default: 50 } as const
export const CLUSTER_MAX_ZOOM = { min: 0, max: 17, default: 14 } as const
export const CLUSTER_BUBBLE = { min: 4, max: 100 } as const
export const CLUSTER_STEP_COUNT = { min: 1, max: 6 } as const

/** mapgl's cluster_options defaults. */
export const DEFAULT_CLUSTERS: Readonly<ClusterSettings> = Object.freeze({
  radius: CLUSTER_RADIUS.default,
  maxZoom: CLUSTER_MAX_ZOOM.default,
  steps: [
    { from: 2, color: '#51bbd6', radius: 20 },
    { from: 100, color: '#f1f075', radius: 30 },
    { from: 750, color: '#f28cb1', radius: 40 },
  ],
  countFormat: 'abbreviated',
  textColor: '#000000',
  opacity: 1,
  strokeColor: '#ffffff',
  strokeWidth: 0,
})

export type BivariateMethod = Exclude<GraduatedMethod, 'manual'>

/** Classes along a bivariate axis: 2, 3 (the default) or 4. The two axes may differ (2 x 3, 3 x 4, ...). */
export const BIVARIATE_CLASS_COUNTS = [2, 3, 4] as const

export interface BivariateAxis {
  column: string
  method: BivariateMethod
  /** Absent: 3. An axis with fewer distinct values has fewer. */
  classes?: number
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
  /** The legend (on the map and on a printed page) is a diamond, its axes along the two lower edges. Absent: a square. */
  tilted?: boolean
}

/** What the map, legend and panel draw. Recomputed on every style or data change; never saved. */
export interface ResolvedStyle {
  /** 'fallback' (FR-012): the styled column is missing or no longer fits; the single symbol is drawn. */
  status: 'ok' | 'fallback'
  reason?: string
  /** Spec 011 US6: why the label expression can't be used (the labels are not drawn). */
  labelError?: string
  /** Legend header, e.g. 'value · Quantile, 5 classes'. Empty for single. */
  caption: string
  /** Legend order: value or range classes, then "Other", then "No value". */
  classes: ResolvedClass[]
  /** e.g. 'Only 3 distinct values: 3 classes.' */
  notes: string[]
  /** Spec 009, bivariate only: both axes' classes. */
  grid?: { x: AxisInfo; y: AxisInfo; /** The legend is drawn as a diamond. */ tilted?: boolean }
  /** Spec 009: the size channel, when one applies. */
  size?: ResolvedSizeChannel
  /** Heatmap: the density ramp (low to high) and, when weighted, the weight column's largest value. */
  heat?: { colors: string[]; weight?: { column: string; max: number }; intensity?: number }
  /** Clusters: each step's bubble, smallest groups first, with the counts it covers. */
  clusters?: { steps: Array<{ color: string; radius: number; label: string }> }
  /** Spec 011: every channel that varies by data, as resolved. */
  channels?: Partial<Record<ChannelId, ResolvedChannel>>
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
  kind: 'single' | 'value' | 'range' | 'other' | 'noValue' | 'cell' | 'rule'
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
  /** Spec 010, kind 'rule': the rule's id, and why its condition can't be used (it then matches nothing). */
  ruleId?: string
  error?: string
  /** Spec 011: what this class draws in its channel (color channels also keep `color`, size classes `size`). */
  output?: Output
}

/** Spec 011: one channel as resolved. Recomputed with the style; never saved. */
export interface ResolvedChannel {
  channel: ChannelId
  /** 'fallback': drawn with the fixed value; `reason` says why. */
  status: 'ok' | 'fallback'
  reason?: string
  scale: ScaleKind
  /** Legend group header, e.g. 'los · Categories'. */
  caption: string
  /** Categories, classes, conditions and bivariate cells, then Other and No value; each with its `output`. */
  classes: ResolvedClass[]
  /** Continuous: the domain drawn. */
  domain?: { min: number; max: number }
  /** Continuous: legend samples, smallest first. */
  samples?: Array<{ value: number; output: Output; label: string }>
  /** The feature property the map reads (a column, or an engine-computed one). */
  dataColumn: string
  /** Bivariate: both axes. */
  grid?: { x: AxisInfo; y: AxisInfo }
  notes: string[]
}

/** Spec 011: one legend group: one channel, or several merged (same source, scale and classes). */
export interface LegendGroupModel {
  key: string
  channels: ChannelId[]
  title: string
  kind: 'classes' | 'gradient' | 'samples' | 'bivariate'
  hidden: boolean
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


/** The columns the color channel reads: none, one, or both bivariate axes (spec 009). */
export function rendererColumns(renderer: Renderer): string[] {
  if (renderer.kind === 'single') return []
  if (renderer.kind === 'heatmap') return renderer.weight ? [renderer.weight] : []
  if (renderer.kind === 'clusters') return []
  if (renderer.kind === 'bivariate') return [renderer.x.column, renderer.y.column].filter(Boolean)
  // Spec 010: rules and expressions draw from a column the engine computes per feature.
  if (renderer.kind === 'rules') return [RULE_CLASS_COLUMN]
  if (renderer.kind === 'graduated' && renderer.expression) return [EXPRESSION_VALUE_COLUMN]
  return renderer.column ? [renderer.column] : []
}

/** Every attribute a style's channels read (color, then size), deduplicated. Map views fetch only these (spec 007). */
export function styleDataColumns(style: LayerStyle): string[] {
  const cols = rendererColumns(rendererOf(style))
  const size = sizeOf(style)?.column
  const out = size && !cols.includes(size) ? [...cols, size] : [...cols]
  // Spec 011: every other property set by a column (height is the extrusion's, listed by the viewer).
  for (const [id, enc] of Object.entries(style.channels ?? {}) as Array<[ChannelId, NonNullable<Channels[ChannelId]>]>) {
    // Spec 011 US4: a continuous or as-is color has no pre-011 renderer, so its column is listed here.
    if (id === 'height' || (id === 'color' && enc.scale.kind !== 'continuous' && enc.scale.kind !== 'identity')) continue
    for (const c of channelDataColumns(id, enc)) if (!out.includes(c)) out.push(c)
  }
  // Spec 011 US6: the label text, while labels are on (a column, or the engine-computed text).
  const l = style.labels
  if (l?.enabled) {
    const c = l.source.kind === 'column' ? l.source.column : LABEL_COLUMN
    if (!out.includes(c)) out.push(c)
  }
  return out
}

/** A short title for the color channel's columns: `zone`, `poverty_rate × obesity_rate`, or '' (single). */
export function rendererTitle(renderer: Renderer): string {
  if (renderer.kind === 'rules') return 'Rules'
  if (renderer.kind === 'heatmap') return 'Heatmap'
  if (renderer.kind === 'clusters') return 'Clusters'
  if (renderer.kind === 'graduated' && renderer.expression) return renderer.column || renderer.expression
  return rendererColumns(renderer).join(' × ')
}

/**
 * Data colors are fixed and theme-independent (CLAUDE.md): the "tide" blue-teal
 * (spec 015, the fourth step of the landing page's ramp), muted enough to sit on
 * light, dark and satellite basemaps alike, with a darker outline.
 */
export const DEFAULT_LAYER_STYLE: Readonly<LayerStyle> = Object.freeze({
  fillColor: '#3f8fa8',
  fillOpacity: 0.45,
  strokeColor: '#1b5470',
  strokeOpacity: 1,
  strokeWidth: 1.5,
  pointRadius: 5,
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

/**
 * Spec 009 FR-009: a graduated renderer saved with "Vary: Size" (2026-10-12
 * build; also what the QML/SLD importers read from QGIS GraduatedSize) is a
 * single color plus a classed size channel on the same column.
 */
function migrateVarySize(style: Partial<LayerStyle>): Partial<LayerStyle> {
  const r = style.renderer as Partial<GraduatedRenderer> | undefined
  if (!r || r.kind !== 'graduated' || r.vary !== 'size') return style
  if (style.size) return { ...style, renderer: { kind: 'single' } }
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const size: Partial<SizeChannel> = {
    column: r.column,
    mode: 'classed',
    method: r.method,
    classCount: r.classCount,
    classes: (r.classes ?? []).map((c) => {
      const o = { ...c }
      delete o.color
      return o
    }),
    noValue: { ...(r.noValue?.label !== undefined ? { label: r.noValue.label } : {}), ...(r.noValue?.visible === false ? { visible: false } : {}) },
    sizeMin: n(r.sizeMin, 2),
    sizeMax: n(r.sizeMax, 10),
  }
  return { ...style, renderer: { kind: 'single' }, size: size as SizeChannel }
}

/**
 * A stored, imported or patched style made valid, in channel form (spec 011):
 * every legacy key present (`renderer`, `size`, `extrusion`; a pre-011 sidecar,
 * a patch from an edit) is applied over the channels and removed (research §9).
 */
export function sanitizeStyle(raw: Partial<LayerStyle>): LayerStyle {
  const style = migrateVarySize(raw)
  const has = (k: string) => Object.prototype.hasOwnProperty.call(style, k)
  const pick = (c: string | undefined, fallback: string): string => {
    const rgba = parseColor(c)
    return rgba ? rgbToHex(rgba) : fallback
  }
  const num = (n: number | undefined, fallback: number, lo: number, hi: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fallback
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  const channels = sanitizeChannels(style.channels)
  const draw = sanitizeDraw(style.draw)
  const heatmapRaw = style.heatmap ?? (draw.points === 'heatmap' ? {} : undefined)
  const heatmap = heatmapRaw && typeof heatmapRaw === 'object' ? heatmapSettings(sanitizeRenderer({ ...heatmapRaw, kind: 'heatmap' } as Partial<Renderer>) as HeatmapRenderer) : undefined
  const clustersRaw = style.clusters ?? (draw.points === 'clusters' ? {} : undefined)
  const clusters = clustersRaw && typeof clustersRaw === 'object' ? clusterSettings(sanitizeRenderer({ ...clustersRaw, kind: 'clusters' } as Partial<Renderer>) as ClusterRenderer) : undefined
  const labels = sanitizeLabels(style.labels)
  const arrows = sanitizeArrows(style.arrows)
  let out: LayerStyle = {
    fillColor: pick(style.fillColor, DEFAULT_LAYER_STYLE.fillColor),
    fillOpacity: num(style.fillOpacity, DEFAULT_LAYER_STYLE.fillOpacity, 0, 1),
    strokeColor: pick(style.strokeColor, DEFAULT_LAYER_STYLE.strokeColor),
    strokeOpacity: num(style.strokeOpacity, DEFAULT_LAYER_STYLE.strokeOpacity, 0, 1),
    strokeWidth: num(style.strokeWidth, DEFAULT_LAYER_STYLE.strokeWidth, 0, 50),
    pointRadius: num(style.pointRadius, DEFAULT_LAYER_STYLE.pointRadius, 0.5, 100),
    ...(finite(style.layerOpacity) && style.layerOpacity < 1 ? { layerOpacity: clamp(style.layerOpacity, 0, 1) } : {}),
    ...(isMarkerShape(style.markerShape) && style.markerShape !== 'circle' ? { markerShape: style.markerShape } : {}),
    ...(isLineDash(style.lineDash) && style.lineDash !== 'solid' ? { lineDash: style.lineDash } : {}),
    ...(finite(style.lineWidth) ? { lineWidth: clamp(style.lineWidth, 0, 100) } : {}),
    ...(finite(style.rotation) && style.rotation % 360 !== 0 ? { rotation: style.rotation } : {}),
    ...(finite(style.opacity) && style.opacity < 1 ? { opacity: clamp(style.opacity, 0, 1) } : {}),
    ...(Object.keys(draw).length ? { draw } : {}),
    ...(Object.keys(channels).length ? { channels } : {}),
    ...(heatmap ? { heatmap } : {}),
    ...(clusters ? { clusters } : {}),
    ...(style.height && finite(style.height.meters)
      ? { height: { meters: Math.max(0, style.height.meters), ...(finite(style.height.scale) && style.height.scale > 0 && style.height.scale !== 1 ? { scale: style.height.scale } : {}) } }
      : {}),
    ...(labels ? { labels } : {}),
    ...(arrows ? { arrows } : {}),
  }
  // Pre-011 keys win over the channels they map to (a sidecar, or a patch from an edit).
  if (has('renderer')) out = withRenderer(out, sanitizeRenderer(style.renderer))
  if (has('size')) out = withSize(out, sanitizeSizeChannel(style.size))
  if (has('extrusion')) out = withExtrusion(out, sanitizeExtrusion(style.extrusion))
  return out
}

function heatmapSettings(r: HeatmapRenderer): HeatmapSettings {
  const { kind: _k, ...settings } = r
  void _k
  return settings
}

function clusterSettings(r: ClusterRenderer): ClusterSettings {
  const { kind: _k, ...settings } = r
  void _k
  return settings
}

/** Cluster steps made valid: 1 to 6, starting at 2, counts rising, radii within 4..100 px. */
export function sanitizeClusterSteps(raw: unknown): ClusterStep[] {
  const list = Array.isArray(raw) ? raw : []
  const out: ClusterStep[] = []
  for (const item of list.slice(0, CLUSTER_STEP_COUNT.max)) {
    if (!item || typeof item !== 'object') continue
    const st = item as Partial<ClusterStep>
    const rgba = typeof st.color === 'string' ? parseColor(st.color) : null
    const from = typeof st.from === 'number' && Number.isFinite(st.from) ? Math.max(2, Math.round(st.from)) : null
    const radius = typeof st.radius === 'number' && Number.isFinite(st.radius) ? clamp(st.radius, CLUSTER_BUBBLE.min, CLUSTER_BUBBLE.max) : null
    if (!rgba || from === null || radius === null) continue
    if (out.length && from <= out[out.length - 1].from) continue
    out.push({ from, color: rgbToHex(rgba), radius })
  }
  if (!out.length) return DEFAULT_CLUSTERS.steps.map((x) => ({ ...x }))
  out[0] = { ...out[0], from: 2 }
  return out
}

/** Spec 009: a stored or imported size channel made valid, or undefined (none). */
export function sanitizeSizeChannel(raw: Partial<SizeChannel> | undefined | null): SizeChannel | undefined {
  if (!raw || typeof raw !== 'object' || typeof raw.column !== 'string' || !raw.column) return undefined
  const method: GraduatedMethod = raw.method === 'equal' || raw.method === 'quantile' || raw.method === 'jenks' || raw.method === 'manual' ? raw.method : 'quantile'
  const sizes = sanitizeSizes({ sizeMin: raw.sizeMin, sizeMax: raw.sizeMax })
  const noValue = sanitizeOverride(raw.noValue)
  delete noValue.color
  return {
    column: raw.column,
    mode: raw.mode === 'proportional' ? 'proportional' : 'classed',
    method,
    classCount: clamp(Math.round(Number(raw.classCount ?? DEFAULT_CLASS_COUNT)) || DEFAULT_CLASS_COUNT, MIN_CLASS_COUNT, MAX_CLASS_COUNT),
    classes: (Array.isArray(raw.classes) ? raw.classes : [])
      .filter((k) => k && Number.isInteger(k.index))
      .map((k) => {
        const o = sanitizeOverride(k)
        delete o.color
        const out: RangeClassDef = { index: k.index, ...o }
        if (typeof k.lower === 'number' && Number.isFinite(k.lower)) out.lower = k.lower
        if (typeof k.upper === 'number' && Number.isFinite(k.upper)) out.upper = k.upper
        return out
      }),
    noValue,
    sizeMin: sizes.sizeMin,
    sizeMax: sizes.sizeMax,
    ...(raw.scale === 'area' || raw.scale === 'linear' ? { scale: raw.scale } : {}),
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

/** A size range made valid (min <= max, both within 0.5..100 px). */
function sanitizeSizes(g: { sizeMin?: unknown; sizeMax?: unknown }): { sizeMin: number; sizeMax: number } {
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, SIZE_LO, SIZE_HI) : fallback)
  const min = n(g.sizeMin, 2)
  const max = n(g.sizeMax, Math.max(min, 10))
  return { sizeMin: Math.min(min, max), sizeMax: Math.max(min, max) }
}

/**
 * Coerces a stored or imported renderer into a valid one: unknown kinds
 * become single, numbers are clamped, overrides keep only valid fields.
 * Structural rules a user edit can break (order, duplicates) are checked by
 * `validateStyle`, not silently repaired here.
 */
export function sanitizeRenderer(r: Partial<Renderer> | undefined): Renderer {
  if (!r || typeof r !== 'object') return { kind: 'single' }
  if (r.kind === 'clusters') {
    const c = r as Partial<ClusterRenderer>
    const num = (v: unknown, b: { min: number; max: number; default: number }) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, b.min, b.max) : b.default)
    const color = (v: unknown, fallback: string): string => {
      const rgba = typeof v === 'string' ? parseColor(v) : null
      return rgba ? rgbToHex(rgba) : fallback
    }
    return {
      kind: 'clusters',
      radius: num(c.radius, CLUSTER_RADIUS),
      maxZoom: Math.round(num(c.maxZoom, CLUSTER_MAX_ZOOM)),
      steps: sanitizeClusterSteps(c.steps),
      countFormat: c.countFormat === 'grouped' || c.countFormat === 'raw' ? c.countFormat : 'abbreviated',
      textColor: color(c.textColor, DEFAULT_CLUSTERS.textColor),
      opacity: typeof c.opacity === 'number' && Number.isFinite(c.opacity) ? clamp(c.opacity, 0, 1) : DEFAULT_CLUSTERS.opacity,
      strokeColor: color(c.strokeColor, DEFAULT_CLUSTERS.strokeColor),
      strokeWidth: typeof c.strokeWidth === 'number' && Number.isFinite(c.strokeWidth) ? clamp(c.strokeWidth, 0, 10) : DEFAULT_CLUSTERS.strokeWidth,
    }
  }
  if (r.kind === 'heatmap') {
    const h = r as Partial<HeatmapRenderer>
    const num = (v: unknown, b: { min: number; max: number; default: number }) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, b.min, b.max) : b.default)
    return {
      kind: 'heatmap',
      weight: typeof h.weight === 'string' ? h.weight : '',
      radius: num(h.radius, HEATMAP_RADIUS),
      intensity: num(h.intensity, HEATMAP_INTENSITY),
      ramp: sanitizeRamp(h.ramp, DEFAULT_HEATMAP_RAMP),
      ...(h.radiusUnit === 'm' ? { radiusUnit: 'm' as const } : {}),
      ...(typeof h.radiusMeters === 'number' && Number.isFinite(h.radiusMeters) ? { radiusMeters: num(h.radiusMeters, HEATMAP_METERS) } : h.radiusUnit === 'm' ? { radiusMeters: HEATMAP_METERS.default } : {}),
      ...(typeof h.latitude === 'number' && Number.isFinite(h.latitude) ? { latitude: clamp(h.latitude, -85, 85) } : {}),
      ...(h.autoIntensity === true && h.radiusUnit === 'm' ? { autoIntensity: true } : {}),
    }
  }
  if (r.kind === 'rules') {
    const x = r as Partial<RulesRenderer>
    const color = (c: unknown, fallback: string): string => {
      const rgba = typeof c === 'string' ? parseColor(c) : null
      return rgba ? rgbToHex(rgba) : fallback
    }
    const seen = new Set<string>()
    const rules = (Array.isArray(x.rules) ? x.rules : [])
      .filter((k) => k && typeof k === 'object')
      .map((k, i) => {
        let id = typeof k.id === 'string' && k.id ? k.id : `r${i + 1}`
        while (seen.has(id)) id = `${id}_`
        seen.add(id)
        return { id, label: typeof k.label === 'string' ? k.label : '', where: typeof k.where === 'string' ? k.where : '', color: color(k.color, DEFAULT_LAYER_STYLE.fillColor), visible: k.visible !== false }
      })
    return {
      kind: 'rules',
      rules,
      elseColor: color(x.elseColor, OTHER_COLOR),
      elseVisible: x.elseVisible !== false,
      elseLabel: typeof x.elseLabel === 'string' && x.elseLabel.trim() ? x.elseLabel : DEFAULT_ELSE_LABEL,
    }
  }
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
  if (r.kind === 'bivariate') {
    const b = r as Partial<BivariateRenderer>
    const axis = (a: Partial<BivariateAxis> | undefined): BivariateAxis => ({
      column: typeof a?.column === 'string' ? a.column : '',
      method: a?.method === 'equal' || a?.method === 'jenks' || a?.method === 'quantile' ? a.method : 'quantile',
      ...(a?.classes === 2 || a?.classes === 4 ? { classes: a.classes } : {}),
    })
    const noValue = sanitizeOverride(b.noValue)
    delete noValue.color
    return {
      kind: 'bivariate',
      x: axis(b.x),
      y: axis(b.y),
      palette: typeof b.palette === 'string' && b.palette ? b.palette : DEFAULT_BIVARIATE_PALETTE,
      ...(b.tilted === true ? { tilted: true } : {}),
      hidden: (Array.isArray(b.hidden) ? b.hidden : []).filter((k): k is string => typeof k === 'string' && /^[0-3]-[0-3]$/.test(k)),
      noValue,
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
      ...(typeof g.expression === 'string' && g.expression.trim() ? { expression: g.expression.trim() } : {}),
      classes: (Array.isArray(g.classes) ? g.classes : [])
        .filter((k) => k && Number.isInteger(k.index))
        .map((k) => {
          const out: RangeClassDef = { index: k.index, ...sanitizeOverride(k) }
          if (typeof k.lower === 'number' && Number.isFinite(k.lower)) out.lower = k.lower
          if (typeof k.upper === 'number' && Number.isFinite(k.upper)) out.upper = k.upper
          return out
        }),
      noValue: sanitizeOverride(g.noValue),
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
    if (!r.column && !r.expression) errors.push('Choose a column.')
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
  }
  if (r.kind === 'bivariate' && (!r.x.column || !r.y.column || r.x.column === r.y.column)) errors.push('Choose two different numeric columns.')
  if (r.kind === 'rules') for (const k of [...r.rules.map((x) => x.color), r.elseColor]) if (!colorOk(k)) errors.push(`"${k}" is not a #rrggbb color.`)
  // Spec 009: the size channel.
  const size = sizeOf(style)
  if (size) {
    const ok = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v >= SIZE_LO && v <= SIZE_HI
    if (!size.column) errors.push('Choose a column to size by.')
    if (!ok(size.sizeMin) || !ok(size.sizeMax)) errors.push(`Sizes must be between ${SIZE_LO} and ${SIZE_HI} px.`)
    else if (size.sizeMin > size.sizeMax) errors.push('The smallest size must not be larger than the largest.')
    if (size.mode === 'classed' && size.method === 'manual') {
      const ranges = [...size.classes].sort((a, b) => a.index - b.index)
      ranges.forEach((k, i) => {
        if (k.lower === undefined || k.upper === undefined) errors.push(`Size class ${i + 1} needs both bounds.`)
        else if (!(k.lower < k.upper)) errors.push(`Size class ${i + 1}: the lower bound must be below the upper bound.`)
      })
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
