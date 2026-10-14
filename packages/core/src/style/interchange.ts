// Shared by the QML, SLD and Mapbox serializers for thematic styles (spec 003
// FR-013..FR-015, contracts/interchange-mapping.md). Export works from the
// RESOLVED classes (formats store concrete values, bounds and colors); import
// rebuilds a renderer keeping only what differs from the defaults, so a
// round trip through any format reproduces what the user saw.
import { rampById, rampColors } from './ramps.js'
import { METHOD_NAMES } from './resolve.js'
import {
  DEFAULT_CATEGORY_CAP,
  DEFAULT_HEATMAP_RAMP,
  type CategorizedRenderer,
  type ClassOverride,
  type GraduatedMethod,
  type GraduatedRenderer,
  type LayerStyle,
  type RampRef,
  type ResolvedStyle,
  type RuleDef,
  type StyleFormat,
  type StyleNotice,
} from './model.js'
import { legacyView, rendererOf } from './legacy.js'
import { checkExpression } from './sqlExpression.js'
import { hasLike, parseSimpleWhere, type SimpleWhere } from './simpleWhere.js'

export interface ExportClass {
  kind: 'value' | 'range' | 'other' | 'noValue'
  value?: string
  lower?: number
  upper?: number
  color: string
  label: string
  visible: boolean
  /** Size classes: marker radius or line width, px. */
  size?: number
}

/**
 * One class's symbol as a LayerStyle, for formats that write a symbol per
 * class: the class color on the fill (markers, polygons) or the line, or the
 * class size on the marker or the line (size classes keep the colors).
 */
export function classLayerStyle(style: LayerStyle, kind: 'fill' | 'line' | 'marker', c: ExportClass): LayerStyle {
  style = legacyView(style)
  if (c.size !== undefined) return kind === 'line' ? { ...style, strokeWidth: c.size } : kind === 'marker' ? { ...style, pointRadius: c.size } : style
  return kind === 'line' ? { ...style, strokeColor: c.color } : { ...style, fillColor: c.color }
}

export interface Thematic {
  renderer: CategorizedRenderer | GraduatedRenderer
  classes: ExportClass[]
}

/**
 * The thematic part of a style, ready to write, or null for single symbols.
 * A style whose column isn't usable (FR-012) exports its single symbol, and
 * says why in `notes`.
 */
export function thematicForExport(style: LayerStyle, resolved: ResolvedStyle | undefined, format?: StyleFormat): { thematic: Thematic | null; notes: string[] } {
  style = legacyView(style)
  const r = rendererOf(style)
  // A heatmap is written by each format itself (or not at all: SLD).
  if (r.kind === 'single' || r.kind === 'heatmap') return { thematic: null, notes: [] }
  // Spec 010: only QML can classify an expression; SLD and Mapbox GL get the single symbol (previewExportNotice says so).
  if (r.kind === 'graduated' && r.expression && format && format !== 'qml') return { thematic: null, notes: [] }
  if (!resolved || resolved.status !== 'ok') {
    const why = resolved?.reason ?? 'The classes could not be computed.'
    return { thematic: null, notes: [`${why} The single symbol was exported instead of the ${r.kind} classes.`] }
  }
  // Spec 009: bivariate cells are written by each format itself (bivariateForExport); spec 010: so are rules.
  if (r.kind === 'bivariate' || r.kind === 'rules') return { thematic: null, notes: [] }
  const classes: ExportClass[] = resolved.classes.flatMap((c) =>
    c.kind === 'single' || c.kind === 'cell' || c.kind === 'rule' ? [] : [{ kind: c.kind, value: c.value, lower: c.lower, upper: c.upper, color: c.color, label: c.label, visible: c.visible, ...(c.size !== undefined ? { size: c.size } : {}) }]
  )
  return { thematic: { renderer: r, classes }, notes: [] }
}

/** A foreign heatmap's colors can't be matched to a ramp of ours. */
export const HEATMAP_RAMP_NOTE = `The heatmap's own colors were replaced by the ${rampById(DEFAULT_HEATMAP_RAMP)?.name ?? DEFAULT_HEATMAP_RAMP} ramp.`
/** SLD has no heatmap symbolizer. */
export const HEATMAP_SLD_NOTE = 'SLD has no heatmap: the points are written with the single symbol (QML and Mapbox GL keep the heatmap).'
/** QGIS's heatmap renderer has no intensity setting. */
export const HEATMAP_QML_NOTE = 'QGIS heatmaps have no intensity: QGIS draws it at 1 (Spatial Explorer keeps yours).'

/** Mapbox GL styles draw shaped markers only from a sprite, which a style file can't carry. */
export const MAPBOX_SHAPE_NOTE = (shape: string): string =>
  `Mapbox GL styles have no ${shape} marker without a sprite: other tools draw circles (Spatial Explorer keeps the ${shape}).`

/** What a format can't hold for this style (FR-015), known before writing. */
export function previewExportNotice(style: LayerStyle, format: StyleFormat, resolved: ResolvedStyle | undefined): StyleNotice {
  style = legacyView(style)
  const items: string[] = []
  const { thematic, notes } = thematicForExport(style, resolved, format)
  items.push(...notes)
  // Spec 010: rules and expressions outside QML.
  const r = rendererOf(style)
  if (format !== 'qml' && r.kind === 'graduated' && r.expression && resolved?.status === 'ok') items.push(EXPRESSION_NOTE(format))
  if (format !== 'qml' && r.kind === 'rules') {
    const portable = portableRules(style, resolved, format)
    if (!portable) items.push(COMPLEX_RULES_NOTE)
    else if (format === 'sld') {
      const hidden = portable.filter((p) => !p.rule.visible).length + (r.elseVisible ? 0 : 1)
      if (hidden) items.push(`SLD can't mark a rule as hidden: ${hidden} hidden ${hidden === 1 ? 'rule' : 'rules'} will be left out.`)
    }
  }
  // Heatmap: SLD has none; QGIS has no intensity.
  if (r.kind === 'heatmap' && format === 'sld') items.push(HEATMAP_SLD_NOTE)
  // Automatic intensity is QGIS's own default (its maximum follows the data).
  if (r.kind === 'heatmap' && format === 'qml' && !r.autoIntensity && r.intensity !== 1) items.push(HEATMAP_QML_NOTE)
  // Spec 008 FR-027: SLD has no 3D.
  if (format === 'sld' && style.extrusion?.enabled) items.push('SLD has no 3D: the extrusion is left out.')
  if (format === 'mapbox' && (style.markerShape ?? 'circle') !== 'circle') items.push(MAPBOX_SHAPE_NOTE(style.markerShape ?? 'circle'))
  // Spec 009: bivariate in SLD.
  if (format === 'sld' && rendererOf(style).kind === 'bivariate' && resolved?.status === 'ok') {
    items.push("SLD has no bivariate palette: it reloads as a single symbol (QML and Mapbox GL keep it).")
    const hidden = resolved.classes.filter((c) => !c.visible).length
    if (hidden) items.push(`SLD can't mark a cell as hidden: ${hidden} hidden ${hidden === 1 ? 'cell' : 'cells'} will be left out.`)
  }
  // Spec 009: the size channel in SLD.
  if (format === 'sld' && style.size && resolved?.size?.status === 'ok') {
    if (style.size.mode === 'proportional') items.push('Proportional sizes are written as 5 steps.')
    if (thematic) items.push("Classes on two columns can't be read back from SLD; use QML or Mapbox GL to keep them.")
  }
  if (thematic && format === 'sld') {
    if (thematic.renderer.kind === 'graduated') items.push("SLD can't store the classification method: the classes will import as fixed (Manual).")
    const hidden = thematic.classes.filter((c) => !c.visible).length
    if (hidden) items.push(`SLD can't mark a class as hidden: ${hidden} hidden ${hidden === 1 ? 'class' : 'classes'} will be left out.`)
  }
  return { direction: 'export', format, items }
}

// --- Spec 010: rules and expressions in SLD and Mapbox GL ------------------------

/** Shown when a rule set can't be written to SLD or Mapbox GL. */
export const COMPLEX_RULES_NOTE = 'Rules with complex conditions are only kept in QML.'
export const EXPRESSION_NOTE = (format: StyleFormat): string =>
  `${format === 'sld' ? 'SLD' : 'Mapbox GL styles'} can't classify an expression: the single symbol is exported (QML keeps the classes).`

/** A rule whose condition the format can carry. */
export interface PortableRule {
  rule: RuleDef
  /** The rule's index (its place in the first-match order). */
  index: number
  where: SimpleWhere
}

/**
 * The rules SLD (or Mapbox GL) can carry, in order, or null when one of them
 * isn't a simple comparison chain (Mapbox GL: or uses LIKE). Rules that match
 * nothing (an empty or invalid condition) are left out: they color nothing.
 */
export function portableRules(style: LayerStyle, resolved: ResolvedStyle | undefined, format: StyleFormat): PortableRule[] | null {
  style = legacyView(style)
  const r = rendererOf(style)
  if (r.kind !== 'rules') return null
  const errors = new Map((resolved?.classes ?? []).flatMap((c) => (c.kind === 'rule' && c.ruleId && c.error ? [[c.ruleId, c.error] as const] : [])))
  const out: PortableRule[] = []
  for (const [index, rule] of r.rules.entries()) {
    if (checkExpression(rule.where, 'condition') || errors.has(rule.id)) continue
    const where = parseSimpleWhere(rule.where)
    if (!where || (format === 'mapbox' && hasLike(where))) return null
    out.push({ rule, index, where })
  }
  return out
}

// --- import -------------------------------------------------------------------

/** A label we generate ourselves (a number or a range of numbers): dropped on import, regenerated on resolve. */
export function isGeneratedRangeLabel(label: string | undefined): boolean {
  return !label || /^[\s\d.,eE+\-–—<>=≥≤]+$/.test(label)
}

const DEFAULT_OTHER = /^Other( \(.*\))?$/

/** Overrides that differ from what resolve.ts would generate. */
function override(color: string | undefined, defaultColor: string | undefined, label: string | undefined, defaultLabel: (l: string) => boolean, visible: boolean | undefined): ClassOverride {
  const o: ClassOverride = {}
  if (color && color !== defaultColor) o.color = color
  if (label !== undefined && !defaultLabel(label)) o.label = label
  if (visible === false) o.visible = false
  return o
}

export interface ImportedCategory {
  /** null = "No value"; undefined = "Other" (all other values). */
  value: string | null | undefined
  color?: string
  label?: string
  visible?: boolean
}

/**
 * A categorized renderer from a format's class list. Foreign lists are fixed
 * (Manual); our own files say `auto` and keep only overrides.
 */
export function categorizedFrom(column: string, items: ImportedCategory[], opts: { ramp?: RampRef; auto?: boolean; cap?: number } = {}): CategorizedRenderer {
  const ramp = opts.ramp ?? { id: 'brewer-set2', reversed: false }
  const values = items.filter((i) => typeof i.value === 'string') as Array<ImportedCategory & { value: string }>
  const colors = rampColors(ramp, values.length)
  const classes = values
    .map((i, n) => ({ value: i.value, ...override(i.color, colors[n], i.label, (l) => l === i.value, i.visible) }))
    .filter((c) => !opts.auto || c.color !== undefined || c.label !== undefined || c.visible === false)
  const other = items.find((i) => i.value === undefined)
  const noValue = items.find((i) => i.value === null)
  return {
    kind: 'categorized',
    column,
    ramp,
    cap: Math.min(DEFAULT_CATEGORY_CAP, Math.max(1, opts.cap ?? (opts.auto ? DEFAULT_CATEGORY_CAP : Math.max(values.length, 1)))),
    manual: !opts.auto,
    classes,
    other: other ? override(other.color, undefined, other.label, (l) => DEFAULT_OTHER.test(l), other.visible) : {},
    noValue: noValue ? override(noValue.color, undefined, noValue.label, (l) => l === 'No value', noValue.visible) : {},
  }
}

export interface ImportedRange {
  lower: number
  upper: number
  color?: string
  label?: string
  visible?: boolean
}

/** A graduated renderer from a format's ranges. Without a method (SLD, foreign Mapbox) the ranges are fixed (Manual). */
export function graduatedFrom(column: string, ranges: ImportedRange[], opts: { method?: GraduatedMethod; ramp?: RampRef; noValue?: ImportedCategory; size?: { min: number; max: number } } = {}): GraduatedRenderer {
  const method = opts.method ?? 'manual'
  const ramp = opts.ramp ?? { id: 'viridis', reversed: false }
  const colors = rampColors(ramp, ranges.length)
  const classes = ranges
    .map((r, index) => ({
      index,
      ...(method === 'manual' ? { lower: r.lower, upper: r.upper } : {}),
      ...override(opts.size ? undefined : r.color, colors[index], r.label, isGeneratedRangeLabel, r.visible),
    }))
    .filter((c) => method === 'manual' || Object.keys(c).length > 1)
  const nv = opts.noValue
  return {
    kind: 'graduated',
    column,
    method,
    classCount: Math.max(2, Math.min(10, ranges.length)),
    ramp,
    classes,
    noValue: nv ? override(nv.color, undefined, nv.label, (l) => l === 'No value', nv.visible) : {},
    // Spec 009: size classes leave here in the legacy "Vary: Size" shape; sanitizeStyle makes them a size channel.
    ...(opts.size ? { vary: 'size' as const, sizeMin: opts.size.min, sizeMax: opts.size.max } : {}),
  }
}

/** QGIS classification method ids <-> ours. */
export const QGIS_METHODS: Record<string, Exclude<GraduatedMethod, 'manual'>> = { EqualInterval: 'equal', Quantile: 'quantile', Jenks: 'jenks' }
export const QGIS_METHOD_IDS: Record<Exclude<GraduatedMethod, 'manual'>, string> = { equal: 'EqualInterval', quantile: 'Quantile', jenks: 'Jenks' }

export const methodName = (m: GraduatedMethod): string => METHOD_NAMES[m]
