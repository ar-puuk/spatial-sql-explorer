// From a style + the displayed result to what the map, legend and panel
// draw (spec 003 data-model.md ResolvedStyle). Pure; recomputed whenever the
// style or the result changes. Classes cover every row of the displayed
// result and nothing else (FR-005).
import type { Feature, Layer } from '../models.js'
import { EXPRESSION_VALUE_COLUMN, NO_VALUE_COLOR, OTHER_COLOR, parseColor, rgbToHex, round, rendererColumns, ruleLabel, HEATMAP_METERS, type ClusterRenderer, type HeatmapRenderer, type RulesRenderer, type BivariateRenderer, type CategorizedRenderer, type GraduatedMethod, type GraduatedRenderer, type LayerStyle, type ResolvedChannel, type ResolvedClass, type ResolvedSizeChannel, type ResolvedStyle, type SizeChannel } from './model.js'
import { legacyView, rendererFromEncoding, rendererOf, sizeChannelFromEncoding } from './legacy.js'
import { JENKS_EXACT_LIMIT, classOf, compareCategories, equalIntervalBreaks, jenksBreaks, quantileBreaks, toCategory, toNumber } from './classify.js'
import { rampById, rampColors } from './ramps.js'
import { classSizes, proportionalSize } from './symbol.js'
import { bivariateColor, bivariatePalette } from './bivariate.js'
import { checkExpression } from './sqlExpression.js'
import { heatmapPeak, mercatorRadius } from '../view/heat.js'
import { CHANNEL_NAMES, CHANNEL_ORDER, OUTPUT_KIND, channelDataColumns, fixedValue, isColorChannel, isOutputFor, type ChannelId, type ClassDef, type ConditionsScale, type ContinuousScale, type Encoding, type IdentityScale, type Output } from './channels.js'
import { MARKER_SHAPES, LINE_DASHES } from './symbol.js'

/**
 * The styled column's data (spec 007 research §11). `values`: every row's
 * value (results up to STYLE_VALUES_CAP rows; classified exactly as in spec
 * 003). For bigger results, from SQL: `categories` (exact per-category
 * counts) or `numbers` (evenly spaced order statistics, exact quantile order
 * statistics; class counts are filled in afterwards, also exactly).
 */
export type ColumnData =
  | { kind: 'values'; column: string; values: Array<Feature['attributes'][string]> }
  | { kind: 'categories'; column: string; top: Array<{ value: string; count: number }>; distinct: number; nonNull: number; nulls: number; /** Spec 011 US4, As-is colors: values that aren't `#rgb`/`#rrggbb`. */ invalid?: number }
  | { kind: 'numbers'; column: string; sample: number[]; n: number; nulls: number; quantileStats?: Record<number, number> }

/**
 * What a style is resolved against: the result's columns, plus its features
 * (spec 003; small in-memory results and tests) or, since spec 007, its row
 * count and the styled column's data computed by the engine.
 */
export interface ResolveInput {
  columns: Layer['columns']
  features?: Feature[]
  rowCount?: number
  data?: ColumnData | null
  /**
   * Spec 009: the engine's data for every channel column (color, bivariate
   * axes, size), keyed by column. `data` stays as an alias for one column.
   */
  dataByColumn?: Record<string, ColumnData>
  /** Distinct-value counts per column, when known (renderer suggestions). */
  distinct?: Record<string, number>
  /** Spec 010, rules: features per rule index (-1: everything else), counted by the engine. */
  ruleCounts?: ReadonlyMap<number, number>
  /** Spec 010, rules: why a rule's condition can't be used, by rule id (from the engine). */
  ruleErrors?: Readonly<Record<string, string>>
  /** Spec 010, graduated by expression: why the expression can't be used (from the engine). */
  expressionError?: string
  /** Heatmap, automatic intensity: the peak density at intensity 1 (from the engine, view/heat.ts). */
  heatPeak?: number
  /** Spec 011: rule counts and errors of each conditions channel (`ruleCounts`/`ruleErrors` are the color channel's). */
  ruleCountsByChannel?: Partial<Record<ChannelId, ReadonlyMap<number, number>>>
  ruleErrorsByChannel?: Partial<Record<ChannelId, Readonly<Record<string, string>>>>
  /** Spec 011: why a channel's expression source can't be used (`expressionError` is the color channel's). */
  expressionErrors?: Partial<Record<ChannelId, string>>
  /** Spec 011 US6: why the label expression can't be used. */
  labelError?: string
}

/** Rows in the result. */
export function rowsOf(input: ResolveInput | null): number {
  return input?.rowCount ?? input?.features?.length ?? 0
}

/**
 * Spec 009: where the engine puts the size channel's data. A size channel on
 * the color channel's own column needs its own statistics (other classes, or
 * numbers for a categorized column), under `size:<column>`.
 */
export const sizeDataKey = (column: string, shared: boolean): string => (shared ? `size:${column}` : column)

/** The engine's data for `column`, if it was fetched (spec 009: per channel column). */
export function columnData(input: ResolveInput, column: string): ColumnData | null {
  const byColumn = input.dataByColumn?.[column]
  if (byColumn) return byColumn
  return input.data && input.data.column === column ? input.data : null
}

/** Every value of `column`, from the fetched data or the features. */
export function valuesOf(input: ResolveInput, column: string): Array<Feature['attributes'][string] | undefined> {
  const d = columnData(input, column)
  if (d?.kind === 'values') return d.values
  return (input.features ?? []).map((f) => f.attributes[column])
}

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL(\(.*\))?|NUMERIC(\(.*\))?|INT[1248]?|FLOAT[48])$/i

/** True for DuckDB numeric types (research §5). */
export function isNumericType(type: string): boolean {
  return NUMERIC.test(type.trim())
}

/** Identifier-like column names (feature ids, keys): numbers, but rarely what a map is about. */
const ID_LIKE = /^(id|fid|gid|oid|ogc_fid|objectid|object_id|rowid)$|_id$|^id_/i

/**
 * Spec 009: numeric columns worth mapping first, for default picks
 * (bivariate axes, the size column): identifier-like columns go last.
 */
export function measureColumns(columns: ResolveInput['columns'] | undefined): Array<{ name: string; type: string }> {
  const numeric = eligibleColumns(columns, 'graduated')
  return [...numeric.filter((c) => !ID_LIKE.test(c.name)), ...numeric.filter((c) => ID_LIKE.test(c.name))]
}

/** Columns a renderer can use: every attribute for categorized, numeric ones for graduated. */
export function eligibleColumns(columns: ResolveInput['columns'] | undefined, kind: 'categorized' | 'graduated'): Array<{ name: string; type: string }> {
  return (columns ?? []).filter((c) => kind === 'categorized' || isNumericType(c.type))
}

/** The single symbol as one legend class. */
function single(style: LayerStyle, layer: ResolveInput | null, extra: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return {
    status: 'ok',
    caption: '',
    notes: [],
    ...extra,
    classes: [{ key: 'single', kind: 'single', label: 'All features', color: style.fillColor, visible: true, count: rowsOf(layer) }],
  }
}

/** Shared by the renderer branches: the fallback when the styled column can't be used (FR-012). */
export function fallback(style: LayerStyle, layer: ResolveInput | null, reason: string): ResolvedStyle {
  style = legacyView(style)
  return single(style, layer, { status: 'fallback', reason })
}

export function resolveStyle(style: LayerStyle, layer: ResolveInput | null): ResolvedStyle {
  style = legacyView(style)
  const color = resolveColor(style, layer)
  // Spec 009: the size channel, next to any color channel but bivariate.
  const size = resolveSizeChannel(style, layer)
  const out = size ? { ...color, size } : color
  layerOf.set(out, layer)
  const channels = resolvedChannels(style, out)
  return channels ? { ...out, channels } : out
}

/**
 * Spec 011 slice 1: the channels as resolved, from the pre-011 color and size
 * results (the same classes, each with its `output`). Slice 3 resolves every
 * channel on its own.
 */
function resolvedChannels(style: LayerStyle, r: ResolvedStyle): ResolvedStyle['channels'] {
  const enc = style.channels
  if (!enc) return undefined
  const out: NonNullable<ResolvedStyle['channels']> = {}
  const color = enc.color
  if (color && style.draw?.points !== 'heatmap' && style.draw?.points !== 'clusters' && !isGenericChannel('color', color)) {
    out.color = {
      channel: 'color',
      status: r.status,
      ...(r.reason ? { reason: r.reason } : {}),
      scale: color.scale.kind,
      caption: r.caption,
      classes: r.classes.map((c) => ({ ...c, output: c.color })),
      dataColumn: channelDataColumns('color', color)[0] ?? '',
      ...(r.grid ? { grid: r.grid } : {}),
      notes: r.notes,
    }
  }
  const size = r.size
  for (const id of ['size', 'width'] as const) {
    const e = enc[id]
    if (!e || !size || !sizeChannelFromEncoding(e)) continue
    out[id] = {
      channel: id,
      status: size.status,
      ...(size.reason ? { reason: size.reason } : {}),
      scale: e.scale.kind,
      caption: size.caption,
      classes: size.classes.map((c) => (c.size !== undefined ? { ...c, output: c.size } : c)),
      ...(size.domain ? { domain: size.domain } : {}),
      ...(size.samples ? { samples: size.samples.map((x) => ({ value: x.value, output: x.size, label: x.label })) } : {}),
      dataColumn: channelDataColumns(id, e)[0] ?? '',
      notes: size.notes,
    }
  }
  // Spec 011: every other channel with categories or classes (slice 2).
  for (const id of CHANNEL_ORDER) {
    const e = enc[id]
    if (!e || out[id] || !isGenericChannel(id, e)) continue
    out[id] = genericChannel(style, id, e, layerOf.get(r) ?? null)
  }
  const height = enc.height
  if (height && style.draw?.polygons === '3d') {
    const column = channelDataColumns('height', height)[0] ?? ''
    out.height = { channel: 'height', status: 'ok', scale: height.scale.kind, caption: column, classes: [], dataColumn: column, notes: [] }
  }
  return Object.keys(out).length ? out : undefined
}

/** The layer a resolved style was made from (resolvedChannels needs it for the generic channels). */
const layerOf = new WeakMap<ResolvedStyle, ResolveInput | null>()

/**
 * Spec 011: whether a channel resolves on its own here (rather than through
 * the pre-011 color and size code): any channel but color with categories,
 * classes, continuous (US4) or as is (US4), except size and width with
 * classes or continuous (spec 009's size channel).
 */
export function isGenericChannel(id: ChannelId, enc: Encoding): boolean {
  if (id === 'height') return false
  const k = enc.scale.kind
  // Spec 011 US4: color is the style type's, except continuous and as is, which resolve here too.
  if (id === 'color') return k === 'continuous' || k === 'identity'
  if (k !== 'categories' && k !== 'classes' && k !== 'continuous' && k !== 'identity' && k !== 'conditions') return false
  // Spec 009's size channel draws size and width by classes or continuously (proportional).
  if ((id === 'size' || id === 'width') && sizeChannelFromEncoding(enc)) return false
  return true
}

/** Default output ranges when a numeric channel has none of its own. */
const DEFAULT_RANGES: Partial<Record<ChannelId, { min: number; max: number }>> = {
  strokeWidth: { min: 0.5, max: 4 },
  size: { min: 2, max: 10 },
  width: { min: 1, max: 6 },
  opacity: { min: 0.3, max: 1 },
  rotation: { min: 0, max: 315 },
  height: { min: 0, max: 100 },
}

/** Shapes and patterns in the order classes take them; "Other" takes the last one (FR-013). */
const SHAPE_ORDER = MARKER_SHAPES
const DASH_ORDER = LINE_DASHES

/**
 * Spec 011: a channel with categories or classes, resolved with the same
 * classification as a categorized or graduated color (the same classes,
 * counts, keys and labels), each class with its output: its own, or one
 * spread from the ramp, the range, or the shape and pattern lists.
 */
function genericChannel(style: LayerStyle, id: ChannelId, enc: Encoding, layer: ResolveInput | null): ResolvedChannel {
  if (enc.scale.kind === 'continuous') return continuousChannel(style, id, enc, layer)
  if (enc.scale.kind === 'identity') return identityChannel(style, id, enc, layer)
  if (enc.scale.kind === 'conditions') return conditionsChannel(id, enc, layer)
  const r = rendererFromEncoding(enc)
  const res = r.kind === 'categorized' ? categorized(style, r, layer) : r.kind === 'graduated' ? graduated(style, r, layer) : single(style, layer)
  const dataColumn = channelDataColumns(id, enc)[0] ?? ''
  const fixed = fixedValue(style, id, id === 'width' || id === 'dash' ? 'line' : 'marker')
  if (res.status !== 'ok') {
    return { channel: id, status: 'fallback', ...(res.reason ? { reason: res.reason } : {}), scale: enc.scale.kind, caption: res.caption, classes: res.classes.map((c) => ({ ...c, output: fixed })), dataColumn, notes: res.notes }
  }
  const scale = enc.scale
  const defOf = (c: ResolvedClass): ClassDef | undefined => {
    if (scale.kind === 'categories') {
      if (c.kind === 'value') return scale.categories.find((k) => k.value === c.value)
      if (c.kind === 'other') return scale.other
      if (c.kind === 'noValue') return scale.noValue
    }
    if (scale.kind === 'classes') {
      if (c.kind === 'range') return scale.classes.find((k) => k.index === Number(c.key.slice('range:'.length)))
      if (c.kind === 'noValue') return scale.noValue
    }
    return undefined
  }
  const valued = res.classes.filter((c) => c.kind === 'value' || c.kind === 'range')
  const kind = OUTPUT_KIND[id]
  const range = (scale.kind === 'categories' || scale.kind === 'classes' ? scale.range : undefined) ?? DEFAULT_RANGES[id] ?? { min: 0, max: 1 }
  const spread = classSizes(valued.length, range.min, range.max)
  const notes = [...res.notes]
  const defaultOutput = (c: ResolvedClass): Output => {
    const i = valued.indexOf(c)
    if (isColorChannel(id)) return c.color
    if (kind === 'shape') return c.kind === 'other' ? SHAPE_ORDER[SHAPE_ORDER.length - 1] : i >= 0 ? SHAPE_ORDER[i % (SHAPE_ORDER.length - 1)] : fixed
    if (kind === 'dash') return c.kind === 'other' ? DASH_ORDER[DASH_ORDER.length - 1] : i >= 0 ? DASH_ORDER[i % (DASH_ORDER.length - 1)] : fixed
    return i >= 0 ? spread[i] : fixed
  }
  const classes = res.classes.map((c) => {
    const own = defOf(c)?.output
    const output = own !== undefined && isOutputFor(id, own) ? own : defaultOutput(c)
    return { ...c, output }
  })
  if ((kind === 'shape' || kind === 'dash') && classes.some((c) => c.kind === 'other')) {
    notes.push(`Only ${kind === 'shape' ? SHAPE_ORDER.length - 1 : DASH_ORDER.length - 1} values get their own ${kind === 'shape' ? 'shape' : 'pattern'}: the rest share "Other".`)
  }
  return { channel: id, status: 'ok', scale: scale.kind, caption: res.caption, classes, dataColumn, notes }
}


// --- Spec 011 US4: Continuous and As is on any property but color ---

/**
 * Spec 011 US4: a property by conditions, spec 010's rules for any
 * property: SQL conditions in order (the first that holds wins), then
 * "Everything else". The engine counts the features per rule and says why a
 * condition can't be used (`ruleCountsByChannel`, `ruleErrorsByChannel`).
 */
function conditionsChannel(id: ChannelId, enc: Encoding, layer: ResolveInput | null): ResolvedChannel {
  const scale = enc.scale as ConditionsScale
  const dataColumn = channelDataColumns(id, enc)[0] ?? ''
  const counts = layer?.ruleCountsByChannel?.[id]
  const errors = layer?.ruleErrorsByChannel?.[id]
  const classes: ResolvedClass[] = scale.rules.map((rule, i) => {
    const error = checkExpression(rule.where, 'condition') ?? errors?.[rule.id]
    return { key: `rule:${rule.id}`, kind: 'rule', ruleId: rule.id, label: rule.label || rule.where || `Rule ${i + 1}`, color: '', visible: rule.visible, count: error ? 0 : (counts?.get(i) ?? 0), output: rule.output, ...(error ? { error } : {}) }
  })
  classes.push({ key: '__else', kind: 'other', label: scale.else.label, color: '', visible: scale.else.visible, count: counts ? (counts.get(-1) ?? 0) : rowsOf(layer), output: scale.else.output })
  const n = scale.rules.length
  // Conditions read no one column: the caption names the property.
  return { channel: id, status: 'ok', scale: 'conditions', caption: `${CHANNEL_NAMES[id]} · ${n} ${n === 1 ? 'condition' : 'conditions'}`, classes, dataColumn, notes: [] }
}

/** Ramp stops a continuous color runs through (also written to QML, so QGIS and the map agree). */
export const CONTINUOUS_STOPS = 7

/** Continuous colors on marker icons: this many steps (each step is an icon; research §2). */
export const ICON_COLOR_STEPS = 32

/** Colors an As-is color can show on shaped markers: each needs its own map icon (research §2). */
export const IDENTITY_ICON_CAP = 256

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** A continuous property's output at `value` (clamped to the domain): along the ramp, or min–max (linear or by area). */
export function continuousOutput(id: ChannelId, scale: ContinuousScale, domain: { min: number; max: number }, value: number): Output {
  const span = domain.max - domain.min
  const t = span > 0 ? Math.min(1, Math.max(0, (value - domain.min) / span)) : 1
  if (isColorChannel(id)) {
    const ordered = rampColors(scale.ramp ?? { id: 'viridis', reversed: false }, CONTINUOUS_STOPS)
    const x = t * (ordered.length - 1)
    const i = Math.min(ordered.length - 2, Math.floor(x))
    return mixHex(ordered[i], ordered[i + 1], x - i)
  }
  const range = scale.range ?? DEFAULT_RANGES[id] ?? { min: 0, max: 1 }
  const k = scale.curve === 'area' ? Math.sqrt(t) : t
  return round(range.min + (range.max - range.min) * k, 4)
}

/** Two `#rrggbb` colors mixed in RGB, as MapLibre's `interpolate` and QGIS's color ramps do. */
function mixHex(a: string, b: string, t: number): string {
  const ca = parseColor(a) ?? { r: 0, g: 0, b: 0, a: 1 }
  const cb = parseColor(b) ?? ca
  return rgbToHex({ r: Math.round(ca.r + (cb.r - ca.r) * t), g: Math.round(ca.g + (cb.g - ca.g) * t), b: Math.round(ca.b + (cb.b - ca.b) * t) })
}

/** The domain of a numeric column (the scale's own, else the data's), the nulls, or why there is none. */
function numericDomain(layer: ResolveInput, column: string): { min: number; max: number; nulls: number } | null {
  const known = columnData(layer, column)
  if (known?.kind === 'numbers') return known.sample.length ? { min: known.sample[0], max: known.sample[known.sample.length - 1], nulls: known.nulls } : null
  let min = Infinity
  let max = -Infinity
  let nulls = 0
  for (const raw of valuesOf(layer, column)) {
    const v = toNumber(raw)
    if (v === null) nulls++
    else {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return min <= max ? { min, max, nulls } : null
}

/** A property's "No value" class, when some features have none. */
function noValueClass(def: ClassDef, output: Output, count: number): ResolvedClass[] {
  return count > 0 ? [{ key: '__null', kind: 'noValue', label: def.label ?? 'No value', color: NO_VALUE_COLOR, visible: def.visible !== false, count, output: def.output !== undefined ? def.output : output }] : []
}

/**
 * Spec 011 US4: a property along a continuous scale: the domain (the scale's
 * own, else the column's minimum to maximum), three legend samples, and No
 * value at the fixed value unless set.
 */
function continuousChannel(style: LayerStyle, id: ChannelId, enc: Encoding, layer: ResolveInput | null): ResolvedChannel {
  const scale = enc.scale as ContinuousScale
  const column = channelDataColumns(id, enc)[0] ?? ''
  const fixed = fixedValue(style, id, id === 'width' ? 'line' : 'marker')
  const caption = `${column} · Continuous`
  const off = (reason: string): ResolvedChannel => ({ channel: id, status: 'fallback', reason, scale: 'continuous', caption, classes: [], dataColumn: column, notes: [] })
  if (!layer) return off('No data to read.')
  const why = notNumeric(layer, column)
  if (why) return off(`${why} Every feature has the fixed ${CHANNEL_NAMES[id].toLowerCase()}.`)
  const data = numericDomain(layer, column)
  if (!data) return off(`Column "${column}" has no numeric values in this result.`)
  const domain = scale.domain ?? { min: data.min, max: data.max }
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
  const values = domain.max > domain.min ? [domain.min, (domain.min + domain.max) / 2, domain.max] : [domain.min]
  const samples = values.map((value) => ({ value, output: continuousOutput(id, scale, domain, value), label: fmt.format(value) }))
  const notes = domain.max > domain.min ? [] : [`Every value is ${fmt.format(domain.min)}: every feature has the last output.`]
  // Shaped markers are icons: a continuous fill or outline color takes steps there (circles stay smooth).
  const shaped = (legacyView(style).markerShape ?? 'circle') !== 'circle' || !!style.channels?.shape
  if (shaped && (id === 'color' || id === 'strokeColor')) notes.push(`Shaped markers show these colors in ${ICON_COLOR_STEPS} steps (each is a map icon); circles are smooth.`)
  return { channel: id, status: 'ok', scale: 'continuous', caption, classes: noValueClass(scale.noValue, fixed, data.nulls), domain, samples, dataColumn: column, notes }
}

/**
 * Spec 011 US4: a property read as is: colors (`#rgb` or `#rrggbb`; others
 * get the fixed color, counted), or numbers (px, 0–1, degrees). On shaped
 * markers, at most IDENTITY_ICON_CAP distinct colors (each is an icon).
 */
function identityChannel(style: LayerStyle, id: ChannelId, enc: Encoding, layer: ResolveInput | null): ResolvedChannel {
  const scale = enc.scale as IdentityScale
  const column = channelDataColumns(id, enc)[0] ?? ''
  const fixed = fixedValue(style, id, id === 'width' ? 'line' : 'marker')
  const name = CHANNEL_NAMES[id].toLowerCase()
  const caption = `${column} · As is`
  const off = (reason: string): ResolvedChannel => ({ channel: id, status: 'fallback', reason, scale: 'identity', caption, classes: [], dataColumn: column, notes: [] })
  if (!layer) return off('No data to read.')
  if (!layer.columns.some((c) => c.name === column)) return off(`Column "${column}" is not in this result.`)
  const notes: string[] = []
  if (isColorChannel(id)) {
    const known = columnData(layer, column)
    let nulls = 0
    let invalid = 0
    const distinct = new Set<string>()
    if (known?.kind === 'categories') {
      nulls = known.nulls
      for (const t of known.top) if (HEX_COLOR.test(t.value)) distinct.add(t.value.toLowerCase())
      else invalid += t.count
      if (known.distinct > known.top.length) distinct.add(`+${known.distinct - known.top.length}`)
      if (known.invalid !== undefined) invalid = known.invalid
    } else {
      for (const raw of valuesOf(layer, column)) {
        if (raw === null || raw === undefined || raw === '') nulls++
        else if (typeof raw === 'string' && HEX_COLOR.test(raw.trim())) distinct.add(raw.trim().toLowerCase())
        else invalid++
      }
    }
    const shapedMarkers = (legacyView(style).markerShape ?? 'circle') !== 'circle' || !!style.channels?.shape
    const many = known?.kind === 'categories' ? known.distinct : distinct.size
    if (id === 'strokeColor' && shapedMarkers && many > IDENTITY_ICON_CAP) {
      return off(`${many.toLocaleString('en-US')} different colors: shaped markers can show at most ${IDENTITY_ICON_CAP}. Every feature has the fixed ${name}.`)
    }
    if (invalid > 0) notes.push(`${invalid.toLocaleString('en-US')} ${invalid === 1 ? 'value is' : 'values are'} not a color (#rrggbb): ${invalid === 1 ? 'it has' : 'they have'} the fixed ${name}.`)
    return { channel: id, status: 'ok', scale: 'identity', caption, classes: noValueClass(scale.noValue, fixed, nulls), dataColumn: column, notes }
  }
  const why = notNumeric(layer, column)
  if (why) return off(`${why} Every feature has the fixed ${name}.`)
  const data = numericDomain(layer, column)
  return { channel: id, status: 'ok', scale: 'identity', caption, classes: noValueClass(scale.noValue, fixed, data?.nulls ?? 0), ...(data ? { domain: { min: data.min, max: data.max } } : {}), dataColumn: column, notes }
}

function resolveColor(style: LayerStyle, layer: ResolveInput | null): ResolvedStyle {
  const r = rendererOf(style)
  switch (r.kind) {
    case 'single':
      return single(style, layer)
    case 'categorized':
      return categorized(style, r, layer)
    case 'graduated':
      return graduated(style, r, layer)
    case 'bivariate':
      return bivariate(style, r, layer)
    case 'rules':
      return rules(style, r, layer)
    case 'heatmap':
      return heatmap(style, r, layer)
    case 'clusters':
      return clusters(style, r, layer)
  }
}

/**
 * Clusters: the points left alone (the single symbol) and the bubbles' steps,
 * smallest groups first, each with the counts it covers (`2–99`, `750+`).
 */
function clusters(style: LayerStyle, r: ClusterRenderer, layer: ResolveInput | null): ResolvedStyle {
  const nf = new Intl.NumberFormat('en-US')
  const steps = r.steps.map((st, i) => {
    const next = r.steps[i + 1]
    const label = next ? (next.from - 1 === st.from ? nf.format(st.from) : `${nf.format(st.from)}–${nf.format(next.from - 1)}`) : `${nf.format(st.from)}+`
    return { color: st.color, radius: st.radius, label: `${label} points` }
  })
  return {
    status: 'ok',
    caption: 'Clusters',
    notes: [],
    classes: [{ key: 'single', kind: 'single', label: 'Single points', color: style.fillColor, visible: true, count: rowsOf(layer) }],
    clusters: { steps },
  }
}

/** Heatmap ramps are sampled at this many stops (density 0 is transparent, below the first). */
export const HEATMAP_STOPS = 7

/**
 * Heatmap: one legend entry (every point) and the ramp. A weight column is
 * read for its largest value, so weights run 0..1 (MapLibre adds weights up:
 * raw populations would saturate every pixel). A weight column that can't be
 * used leaves each point counting once, with a note.
 */
function heatmap(style: LayerStyle, r: HeatmapRenderer, layer: ResolveInput | null): ResolvedStyle {
  const colors = rampColors(r.ramp, HEATMAP_STOPS)
  const notes: string[] = []
  let weight: { column: string; max: number } | undefined
  if (r.weight && layer) {
    const why = notNumeric(layer, r.weight)
    let max = -Infinity
    if (!why) {
      const known = columnData(layer, r.weight)
      if (known?.kind === 'numbers') max = known.sample.length ? known.sample[known.sample.length - 1] : -Infinity
      else for (const raw of valuesOf(layer, r.weight)) {
        const v = toNumber(raw)
        if (v !== null && v > max) max = v
      }
    }
    if (max > 0) weight = { column: r.weight, max }
    else notes.push(why ? `${why} Each point counts once.` : `Column "${r.weight}" has no positive values: each point counts once.`)
  }
  // Automatic intensity (radius in meters): the engine's peak, or the features' own.
  let intensity: number | undefined
  if (r.autoIntensity && r.radiusUnit === 'm' && layer) {
    const peak = layer.heatPeak ?? featuresPeak(r, layer, weight)
    if (peak !== null && peak > 0) intensity = 1 / peak
  }
  const caption = weight ? `Density · weighted by ${weight.column}` : 'Density'
  return {
    status: 'ok',
    caption,
    notes,
    classes: [{ key: 'single', kind: 'single', label: 'All points', color: colors[colors.length - 1] ?? style.fillColor, visible: true, count: rowsOf(layer) }],
    heat: { colors, ...(weight ? { weight } : {}), ...(intensity !== undefined ? { intensity } : {}) },
  }
}

/** The peak density of features held in memory (WGS84 points), or null (no geometry: the engine's job). */
function featuresPeak(r: HeatmapRenderer, layer: ResolveInput, weight: { column: string; max: number } | undefined): number | null {
  const points: Array<[number, number, number]> = []
  for (const f of layer.features ?? []) {
    const g = f.geometry
    if (g?.type !== 'Point') continue
    const v = weight ? toNumber(f.attributes[weight.column]) : 1
    points.push([g.coordinates[0], g.coordinates[1], weight ? Math.max(v ?? 0, 0) / weight.max : 1])
  }
  if (!points.length) return null
  return heatmapPeak(points, mercatorRadius(r.radiusMeters ?? HEATMAP_METERS.default, r.latitude ?? 0))
}

/**
 * Spec 010: rules. One class per rule, in order (the first matching rule
 * colors a feature), then "Everything else". Counts come from the engine;
 * a rule whose condition can't be used keeps its place, with its error, and
 * matches nothing.
 */
function rules(style: LayerStyle, r: RulesRenderer, layer: ResolveInput | null): ResolvedStyle {
  if (!layer) return single(style, layer)
  const counts = layer.ruleCounts
  const classes: ResolvedClass[] = r.rules.map((rule, i) => {
    const error = checkExpression(rule.where, 'condition') ?? layer.ruleErrors?.[rule.id]
    return {
      key: `rule:${rule.id}`,
      kind: 'rule',
      ruleId: rule.id,
      label: ruleLabel(rule),
      color: rule.color,
      visible: rule.visible,
      count: error ? 0 : (counts?.get(i) ?? 0),
      ...(error ? { error } : {}),
    }
  })
  classes.push({ key: '__else', kind: 'other', label: r.elseLabel, color: r.elseColor, visible: r.elseVisible, count: counts ? (counts.get(-1) ?? 0) : rowsOf(layer) })
  const n = r.rules.length
  return { status: 'ok', caption: `Rules · ${n} ${n === 1 ? 'rule' : 'rules'}`, classes, notes: [] }
}

const nf = new Intl.NumberFormat('en-US')

function missingColumn(style: LayerStyle, layer: ResolveInput | null, column: string): ResolvedStyle | null {
  if (!layer) return single(style, layer)
  if (!column) return fallback(style, layer, 'Choose a column to style by.')
  if (!layer.columns.some((c) => c.name === column)) return fallback(style, layer, `Column "${column}" is not in this result.`)
  return null
}

/**
 * Categorized (FR-003): a class per distinct value, most frequent first
 * (ties alphabetical), up to the cap; the rest share "Other"; nulls and ""
 * are "No value". Manual mode keeps the stored class list in its order.
 */
function categorized(style: LayerStyle, r: CategorizedRenderer, layer: ResolveInput | null): ResolvedStyle {
  const missing = missingColumn(style, layer, r.column)
  if (missing || !layer) return missing ?? single(style, layer)

  const counts = new Map<string, number>()
  let nulls = 0
  // Spec 007: a big result's exact counts from SQL (the top categories, plus totals).
  const known = columnData(layer, r.column)
  const sql = known?.kind === 'categories' ? known : null
  if (sql) {
    for (const c of sql.top) counts.set(c.value, c.count)
    nulls = sql.nulls
  } else {
    for (const value of valuesOf(layer, r.column)) {
      const v = toCategory(value)
      if (v === null) nulls++
      else counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  }

  const ordered = r.manual
    ? r.classes.map((c) => c.value)
    : [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || compareCategories(a, b)).slice(0, r.cap)
  const inClasses = new Set(ordered)
  let otherCount = 0
  let otherGroups = 0
  for (const [v, n] of counts) {
    if (!inClasses.has(v)) {
      otherCount += n
      otherGroups++
    }
  }
  if (sql) {
    // Categories beyond the fetched top ones are "Other" too.
    let fetched = 0
    for (const n of counts.values()) fetched += n
    otherCount += Math.max(0, sql.nonNull - fetched)
    otherGroups += Math.max(0, sql.distinct - counts.size)
  }

  const colors = rampColors(r.ramp, ordered.length)
  const overrides = new Map(r.classes.map((c) => [c.value, c]))
  const classes: ResolvedClass[] = ordered.map((value, i) => {
    const o = overrides.get(value)
    return {
      key: `v:${value}`,
      kind: 'value',
      value,
      label: o?.label ?? value,
      color: o?.color ?? colors[i],
      visible: o?.visible !== false,
      count: counts.get(value) ?? 0,
    }
  })
  if (otherCount > 0) {
    classes.push({
      key: '__other',
      kind: 'other',
      label: r.other.label ?? `Other (${nf.format(otherGroups)} ${otherGroups === 1 ? 'value' : 'values'})`,
      color: r.other.color ?? OTHER_COLOR,
      visible: r.other.visible !== false,
      count: otherCount,
      groups: otherGroups,
    })
  }
  if (nulls > 0) {
    classes.push({ key: '__null', kind: 'noValue', label: r.noValue.label ?? 'No value', color: r.noValue.color ?? NO_VALUE_COLOR, visible: r.noValue.visible !== false, count: nulls })
  }

  const notes: string[] = []
  const max = rampById(r.ramp.id)?.maxClasses
  if (max !== undefined && ordered.length > max) notes.push(`${rampById(r.ramp.id)?.name} has ${max} colors; colors repeat after ${max} classes.`)
  const n = ordered.length
  return { status: 'ok', caption: `${r.column} · ${nf.format(n)} ${n === 1 ? 'category' : 'categories'}`, classes, notes }
}

export const METHOD_NAMES: Record<GraduatedMethod, string> = {
  equal: 'Equal interval',
  quantile: 'Quantile',
  jenks: 'Natural breaks',
  manual: 'Manual',
}

/** Decimals that show the class width with about two significant digits. */
function labelFormat(min: number, max: number, k: number): Intl.NumberFormat {
  const step = (max - min) / Math.max(k, 1)
  const decimals = step > 0 && Number.isFinite(step) ? Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(step)))) : 2
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals })
}

/** Ranges from inner breaks: [min, b1], (b1, b2], ... (bk, max]; equal and out-of-range breaks collapse. */
function rangesFrom(sorted: number[], breaks: number[]): Array<{ lower: number; upper: number }> {
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const inner = [...new Set(breaks.filter((b) => b >= min && b < max))].sort((a, b) => a - b)
  const bounds = [min, ...inner, max]
  if (bounds.length === 2 && min === max) return [{ lower: min, upper: max }]
  const ranges: Array<{ lower: number; upper: number }> = []
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i] < bounds[i + 1] || ranges.length === 0) ranges.push({ lower: bounds[i], upper: bounds[i + 1] })
  return ranges
}

/**
 * Graduated (FR-004): a numeric column split into classes by a method (or
 * manual ranges); upper-inclusive classes (research §2); nulls and
 * non-numbers are "No value"; values outside manual ranges are "Other".
 */
/** A numeric column split into ranges, with counts (shared by graduated colors, the size channel and bivariate axes). */
interface Classified {
  ranges: Array<{ lower: number; upper: number }>
  counts: number[]
  nulls: number
  outside: number
  /** Fewer distinct values than classes: one class per value, labeled by it. */
  perValue: boolean
  /** Natural breaks computed on a sample. */
  estimated: boolean
  /** From SQL statistics (counts arrive afterwards, QuerySession.resolveStyle). */
  fromStats: boolean
  sampleSize: number
  notes: string[]
  /** The label a range gets unless overridden. */
  label: (range: { lower: number; upper: number }) => string
}

/**
 * Spec 003 FR-004 / spec 009: a numeric column split by a method (or manual
 * ranges): upper-inclusive classes, the first including its lower bound
 * (research §2); nulls and non-numbers are "No value"; values outside
 * manual ranges are "outside".
 */
export function classifyRanges(
  column: string,
  method: GraduatedMethod,
  classCount: number,
  manual: ReadonlyArray<{ index: number; lower?: number; upper?: number }>,
  layer: ResolveInput,
  dataKey = column
): Classified {
  // Spec 007: a big result's order statistics from SQL (counts filled in afterwards).
  const known = columnData(layer, dataKey)
  const stats = known?.kind === 'numbers' ? known : null
  const numbers: Array<number | null> = stats ? [] : valuesOf(layer, column).map((v) => toNumber(v))
  const sorted = stats ? stats.sample : numbers.filter((v): v is number => v !== null).sort((a, b) => a - b)
  const total = stats ? stats.n : sorted.length
  const notes: string[] = []
  let estimated = false
  let perValue = false

  let ranges: Array<{ lower: number; upper: number }> = []
  if (method === 'manual') {
    ranges = [...manual]
      .filter((c) => c.lower !== undefined && c.upper !== undefined)
      .sort((a, b) => a.index - b.index)
      .map((c) => ({ lower: c.lower as number, upper: c.upper as number }))
  } else if (sorted.length) {
    const distinct = [...new Set(sorted)]
    if (distinct.length === 1) {
      ranges = [{ lower: distinct[0], upper: distinct[0] }]
      notes.push(`Every value is ${distinct[0]}: the range can't be divided.`)
    } else if (distinct.length < classCount) {
      perValue = true
      ranges = distinct.map((v, i) => ({ lower: i === 0 ? v : distinct[i - 1], upper: v }))
      notes.push(`Only ${distinct.length} distinct values: ${distinct.length} classes.`)
    } else {
      const breaks =
        method === 'equal'
          ? equalIntervalBreaks(sorted, classCount)
          : method === 'quantile'
            ? stats?.quantileStats
              ? quantileFromStats(total, classCount, stats.quantileStats)
              : quantileBreaks(sorted, classCount)
            : jenksBreaks(sorted, classCount)
      estimated = method === 'jenks' && (stats ? stats.sample.length < total : total > JENKS_EXACT_LIMIT)
      ranges = rangesFrom(sorted, breaks)
      if (ranges.length < classCount) notes.push(`${classCount - ranges.length} of ${classCount} classes merged: many values are identical.`)
    }
  } else {
    notes.push(`Column "${column}" has no numeric values in this result.`)
  }

  const counts = ranges.map(() => 0)
  let nulls = stats ? stats.nulls : 0
  let outside = 0
  for (const v of numbers) {
    if (v === null) nulls++
    else {
      const i = classOf(v, ranges)
      if (i === -1) outside++
      else counts[i]++
    }
  }
  const fmt = labelFormat(ranges[0]?.lower ?? 0, ranges[ranges.length - 1]?.upper ?? 0, ranges.length)
  const label = (range: { lower: number; upper: number }) =>
    perValue || range.lower === range.upper ? fmt.format(range.upper) : `${fmt.format(range.lower)} – ${fmt.format(range.upper)}`
  return { ranges, counts, nulls, outside, perValue, estimated, fromStats: !!stats, sampleSize: stats ? stats.sample.length : JENKS_EXACT_LIMIT, notes, label }
}

/** The legend caption of a classified column: `value · Quantile, 5 classes` (+ an estimate note). */
function rangesCaption(column: string, method: GraduatedMethod, c: Classified): string {
  const n = c.ranges.length
  let caption = `${column} · ${METHOD_NAMES[method]}, ${n} ${n === 1 ? 'class' : 'classes'}`
  if (c.estimated) caption += ` (estimated from ${nf.format(c.sampleSize)} values)`
  return caption
}

/** Why a column can't be classified as numbers, or null. */
function notNumeric(layer: ResolveInput, column: string): string | null {
  if (!column) return 'Choose a column to style by.'
  const col = layer.columns.find((c) => c.name === column)
  if (!col) return `Column "${column}" is not in this result.`
  return isNumericType(col.type) ? null : `Column "${column}" is not numeric in this result.`
}

/**
 * Graduated (FR-004): a numeric column split into classes by a method (or
 * manual ranges); upper-inclusive classes (research §2); nulls and
 * non-numbers are "No value"; values outside manual ranges are "Other".
 */
function graduated(style: LayerStyle, r: GraduatedRenderer, layer: ResolveInput | null): ResolvedStyle {
  // Spec 010: an expression is classified from the value the engine computes for it.
  const column = r.expression ? EXPRESSION_VALUE_COLUMN : r.column
  if (r.expression && layer) {
    const why = checkExpression(r.expression, 'value') ?? layer.expressionError
    if (why) return fallback(style, layer, why)
    if (!layer.columns.some((c) => c.name === column)) return fallback(style, layer, 'The expression is computed by the engine.')
  }
  const missing = missingColumn(style, layer, column)
  if (missing || !layer) return missing ?? single(style, layer)
  const type = layer.columns.find((c) => c.name === column)?.type ?? ''
  if (!isNumericType(type)) return fallback(style, layer, `Column "${r.column}" is not numeric in this result.`)

  const c = classifyRanges(column, r.method, r.classCount, r.classes, layer)
  const colors = rampColors(r.ramp, c.ranges.length)
  const overrides = new Map(r.classes.map((o) => [o.index, o]))
  const classes: ResolvedClass[] = c.ranges.map((range, i) => {
    const o = overrides.get(i)
    return { key: `range:${i}`, kind: 'range', lower: range.lower, upper: range.upper, label: o?.label ?? c.label(range), color: o?.color ?? colors[i], visible: o?.visible !== false, count: c.counts[i] }
  })
  // A big result's class counts arrive from SQL afterwards (QuerySession.resolveStyle), "Other" included.
  if (c.outside > 0 || (c.fromStats && r.method === 'manual')) classes.push({ key: '__other', kind: 'other', label: 'Other (outside the classes)', color: OTHER_COLOR, visible: true, count: c.outside })
  if (c.nulls > 0) classes.push({ key: '__null', kind: 'noValue', label: r.noValue.label ?? 'No value', color: r.noValue.color ?? NO_VALUE_COLOR, visible: r.noValue.visible !== false, count: c.nulls })
  return { status: 'ok', caption: rangesCaption(r.expression ? r.column || r.expression : r.column, r.method, c), classes, notes: c.notes }
}

/**
 * Spec 009 US4: bivariate. Each axis is classified like a graduated column
 * (3 classes, fewer when it has fewer distinct values: FR-015); cells are the
 * pairs, row-major from low/low (i + nx * j), then "No value" (either value
 * missing). Counts are joint: from the rows (small results), or filled in by
 * QuerySession from one GROUP BY (big ones).
 */
function bivariate(style: LayerStyle, r: BivariateRenderer, layer: ResolveInput | null): ResolvedStyle {
  if (!layer) return single(style, layer)
  if (r.x.column && r.x.column === r.y.column) return fallback(style, layer, 'Choose two different numeric columns.')
  const why = notNumeric(layer, r.x.column) ?? notNumeric(layer, r.y.column)
  if (why) return fallback(style, layer, why)
  const cx = classifyRanges(r.x.column, r.x.method, 3, [], layer)
  const cy = classifyRanges(r.y.column, r.y.method, 3, [], layer)
  if (!cx.ranges.length || !cy.ranges.length) return fallback(style, layer, `Column "${!cx.ranges.length ? r.x.column : r.y.column}" has no numeric values in this result.`)
  const nx = cx.ranges.length
  const ny = cy.ranges.length

  // Joint counts from the rows (the two columns' values are row-aligned).
  const counts = Array.from({ length: nx * ny }, () => 0)
  let noValue = 0
  if (!cx.fromStats || !cy.fromStats) {
    const xs = valuesOf(layer, r.x.column)
    const ys = valuesOf(layer, r.y.column)
    for (let k = 0; k < xs.length; k++) {
      const vx = toNumber(xs[k])
      const vy = toNumber(ys[k])
      const i = vx === null ? -1 : classOf(vx, cx.ranges)
      const j = vy === null ? -1 : classOf(vy, cy.ranges)
      if (i < 0 || j < 0) noValue++
      else counts[i + nx * j]++
    }
  } else noValue = Math.max(cx.nulls, cy.nulls) // a lower bound; QuerySession sets the exact count

  const palette = bivariatePalette(r.palette)
  const hidden = new Set(r.hidden)
  const classes: ResolvedClass[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = cx.ranges[i]
      const y = cy.ranges[j]
      classes.push({
        key: `cell:${i}-${j}`,
        kind: 'cell',
        col: i,
        row: j,
        x: { lower: x.lower, upper: x.upper },
        y: { lower: y.lower, upper: y.upper },
        label: `${cx.label(x)} · ${cy.label(y)}`,
        color: bivariateColor(palette, i, j, nx, ny),
        visible: !hidden.has(`${i}-${j}`),
        count: counts[i + nx * j],
      })
    }
  }
  if (noValue > 0 || cx.fromStats) classes.push({ key: '__null', kind: 'noValue', label: r.noValue.label ?? 'No value', color: NO_VALUE_COLOR, visible: r.noValue.visible !== false, count: noValue })
  const axis = (column: string, method: BivariateRenderer['x']['method'], c: Classified) => ({ column, method, ranges: c.ranges.map((range) => ({ ...range, label: c.label(range) })) })
  const methods = r.x.method === r.y.method ? METHOD_NAMES[r.x.method] : `${METHOD_NAMES[r.x.method]} / ${METHOD_NAMES[r.y.method]}`
  const notes = [...cx.notes.map((n) => `${r.x.column}: ${n}`), ...cy.notes.map((n) => `${r.y.column}: ${n}`)]
  return { status: 'ok', caption: `${r.x.column} × ${r.y.column} · ${methods}`, classes, notes, grid: { x: axis(r.x.column, r.x.method, cx), y: axis(r.y.column, r.y.method, cy) } }
}

/** Size channel class keys: `size:range:<i>`, `size:__other`, `size:__null` (legend and edits). */
export const SIZE_KEY_PREFIX = 'size:'

/**
 * Spec 009: the size channel, classified like a graduated renderer whose
 * class colors are replaced by sizes from `sizeMin` to `sizeMax`. Features
 * with no value (or outside manual classes) keep the single size.
 */
export function resolveSizeChannel(style: LayerStyle, layer: ResolveInput | null): ResolvedSizeChannel | undefined {
  style = legacyView(style)
  const s = style.size
  if (!s || rendererOf(style).kind === 'bivariate' || rendererOf(style).kind === 'heatmap' || rendererOf(style).kind === 'clusters') return undefined
  const off = (reason: string): ResolvedSizeChannel => ({ status: 'fallback', reason, caption: `${s.column} · not available`, mode: s.mode, column: s.column, classes: [], notes: [] })
  if (!layer) return off('No data to size by.')
  const why = notNumeric(layer, s.column)
  if (why) return off(`${why} Every feature has the single size.`)
  const shared = rendererColumns(rendererOf(style)).includes(s.column)
  if (s.mode === 'proportional') return proportionalChannel(style, layer, sizeDataKey(s.column, shared))
  const c = classifyRanges(s.column, s.method, s.classCount, s.classes, layer, sizeDataKey(s.column, shared))
  const sizes = classSizes(c.ranges.length, s.sizeMin, s.sizeMax)
  const overrides = new Map(s.classes.map((o) => [o.index, o]))
  const classes: ResolvedClass[] = c.ranges.map((range, i) => {
    const o = overrides.get(i)
    return { key: `${SIZE_KEY_PREFIX}range:${i}`, kind: 'range', lower: range.lower, upper: range.upper, label: o?.label ?? c.label(range), color: style.fillColor, visible: o?.visible !== false, count: c.counts[i], size: sizes[i] }
  })
  if (c.outside > 0 || (c.fromStats && s.method === 'manual')) classes.push({ key: `${SIZE_KEY_PREFIX}__other`, kind: 'other', label: 'Other (outside the classes)', color: style.fillColor, visible: true, count: c.outside })
  if (c.nulls > 0) classes.push({ key: `${SIZE_KEY_PREFIX}__null`, kind: 'noValue', label: s.noValue.label ?? 'No value', color: style.fillColor, visible: s.noValue.visible !== false, count: c.nulls })
  return { status: 'ok', caption: rangesCaption(s.column, s.method, c), mode: 'classed', column: s.column, classes, notes: c.notes }
}

/**
 * Spec 009 US2: proportional sizes. The domain is the column's range over the
 * displayed result (SQL min/max for big results); the legend gets 3-5
 * reference sizes, the ends exact and the middle ones at round values.
 */
function proportionalChannel(style: LayerStyle, layer: ResolveInput, dataKey: string): ResolvedSizeChannel {
  const s = style.size as SizeChannel
  const known = columnData(layer, dataKey)
  const stats = known?.kind === 'numbers' ? known : null
  let min = Infinity
  let max = -Infinity
  let nulls = stats ? stats.nulls : 0
  if (stats) {
    if (stats.sample.length) {
      min = stats.sample[0]
      max = stats.sample[stats.sample.length - 1]
    }
  } else {
    for (const raw of valuesOf(layer, s.column)) {
      const v = toNumber(raw)
      if (v === null) nulls++
      else {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  const caption = `${s.column} · Proportional`
  if (!(min <= max)) {
    return { status: 'fallback', reason: `Column "${s.column}" has no numeric values in this result. Every feature has the single size.`, caption, mode: 'proportional', column: s.column, classes: [], notes: [] }
  }
  const domain = { min, max }
  const scale = s.scale ?? 'linear'
  const fmt = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 })
  const round2 = (v: number) => Number(v.toPrecision(2))
  const values = max > min ? [...new Set([min, round2(min + (max - min) / 3), round2(min + ((max - min) * 2) / 3), max])].filter((v) => v >= min && v <= max).sort((a, b) => a - b) : [min]
  const samples = values.map((value) => ({ value, size: proportionalSize(value, domain, s.sizeMin, s.sizeMax, scale), label: fmt.format(value) }))
  const classes: ResolvedClass[] = nulls > 0 ? [{ key: `${SIZE_KEY_PREFIX}__null`, kind: 'noValue', label: s.noValue.label ?? 'No value', color: style.fillColor, visible: s.noValue.visible !== false, count: nulls }] : []
  const notes = max > min ? [] : [`Every value is ${fmt.format(min)}: every feature has the largest size.`]
  return { status: 'ok', caption, mode: 'proportional', column: s.column, classes, domain, samples, notes }
}

/** QGIS's quantile from just the order statistics around each break (stats.ts quantilePositions). */
function quantileFromStats(n: number, k: number, stats: Record<number, number>): number[] {
  return Array.from({ length: k - 1 }, (_, i) => {
    const a = ((i + 1) / k) * (n - 1)
    const lo = Math.floor(a)
    const r = a - lo
    return (1 - r) * (stats[lo] ?? 0) + r * (stats[Math.min(lo + 1, n - 1)] ?? stats[lo] ?? 0)
  })
}
