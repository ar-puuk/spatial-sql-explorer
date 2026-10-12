// Shared by the QML, SLD and Mapbox serializers for thematic styles (spec 003
// FR-013..FR-015, contracts/interchange-mapping.md). Export works from the
// RESOLVED classes (formats store concrete values, bounds and colors); import
// rebuilds a renderer keeping only what differs from the defaults, so a
// round trip through any format reproduces what the user saw.
import { rampColors } from './ramps.js'
import { METHOD_NAMES } from './resolve.js'
import {
  DEFAULT_CATEGORY_CAP,
  rendererOf,
  type CategorizedRenderer,
  type ClassOverride,
  type GraduatedMethod,
  type GraduatedRenderer,
  type LayerStyle,
  type RampRef,
  type ResolvedStyle,
  type StyleFormat,
  type StyleNotice,
} from './model.js'

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
export function thematicForExport(style: LayerStyle, resolved: ResolvedStyle | undefined): { thematic: Thematic | null; notes: string[] } {
  const r = rendererOf(style)
  if (r.kind === 'single') return { thematic: null, notes: [] }
  if (!resolved || resolved.status !== 'ok') {
    const why = resolved?.reason ?? 'The classes could not be computed.'
    return { thematic: null, notes: [`${why} The single symbol was exported instead of the ${r.kind} classes.`] }
  }
  const classes: ExportClass[] = resolved.classes.flatMap((c) =>
    c.kind === 'single' ? [] : [{ kind: c.kind, value: c.value, lower: c.lower, upper: c.upper, color: c.color, label: c.label, visible: c.visible, ...(c.size !== undefined ? { size: c.size } : {}) }]
  )
  return { thematic: { renderer: r, classes }, notes: [] }
}

/** Mapbox GL styles draw shaped markers only from a sprite, which a style file can't carry. */
export const MAPBOX_SHAPE_NOTE = (shape: string): string =>
  `Mapbox GL styles have no ${shape} marker without a sprite: other tools draw circles (Spatial Explorer keeps the ${shape}).`

/** What a format can't hold for this style (FR-015), known before writing. */
export function previewExportNotice(style: LayerStyle, format: StyleFormat, resolved: ResolvedStyle | undefined): StyleNotice {
  const items: string[] = []
  const { thematic, notes } = thematicForExport(style, resolved)
  items.push(...notes)
  // Spec 008 FR-027: SLD has no 3D.
  if (format === 'sld' && style.extrusion?.enabled) items.push('SLD has no 3D: the extrusion is left out.')
  if (format === 'mapbox' && (style.markerShape ?? 'circle') !== 'circle') items.push(MAPBOX_SHAPE_NOTE(style.markerShape ?? 'circle'))
  if (thematic && format === 'sld') {
    if (thematic.renderer.kind === 'graduated') items.push("SLD can't store the classification method: the classes will import as fixed (Manual).")
    const hidden = thematic.classes.filter((c) => !c.visible).length
    if (hidden) items.push(`SLD can't mark a class as hidden: ${hidden} hidden ${hidden === 1 ? 'class' : 'classes'} will be left out.`)
  }
  return { direction: 'export', format, items }
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
    ...(opts.size ? { vary: 'size' as const, sizeMin: opts.size.min, sizeMax: opts.size.max } : {}),
  }
}

/** QGIS classification method ids <-> ours. */
export const QGIS_METHODS: Record<string, Exclude<GraduatedMethod, 'manual'>> = { EqualInterval: 'equal', Quantile: 'quantile', Jenks: 'jenks' }
export const QGIS_METHOD_IDS: Record<Exclude<GraduatedMethod, 'manual'>, string> = { equal: 'EqualInterval', quantile: 'Quantile', jenks: 'Jenks' }

export const methodName = (m: GraduatedMethod): string => METHOD_NAMES[m]
