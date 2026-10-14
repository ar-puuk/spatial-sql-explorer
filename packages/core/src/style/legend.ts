// Spec 011: the legend's groups for properties set by a column (US1: one per
// property, titled with its column; US5 merges groups that share a column and
// classes). Each class's swatch is the layer's symbol with that property's
// output, so the legend shows what the map draws.
import { CHANNEL_NAMES, CHANNEL_ORDER, channelDataColumns, isColorChannel, type ChannelId, type ContinuousScale, type Output } from './channels.js'
import { legacyView, rendererOf } from './legacy.js'
import { EXPRESSION_VALUE_COLUMN, type LayerStyle, type ResolvedClass, type ResolvedStyle } from './model.js'
import { CONTINUOUS_STOPS, continuousOutput, isGenericChannel } from './resolve.js'
import { baseSymbol, classSymbols, sizeSymbols, type LineDash, type MarkerShape, type SymbolSpec } from './symbol.js'

export interface ChannelLegendGroup {
  channel: ChannelId
  /** e.g. 'crash_type · 6 categories' */
  title: string
  classes: ResolvedClass[]
  /** One per class: the layer symbol with the class's output. */
  symbols: SymbolSpec[]
  /** Spec 011 US4, continuous colors: the ramp drawn as a bar, with the domain's ends. */
  gradient?: { stops: string[]; min: string; max: string }
  /** Spec 011 US4, as is: what the property reads. */
  note?: string
}

/** Spec 011 US4: legend samples of a continuous property are drawn, not toggled (their keys start so). */
export const SAMPLE_KEY_PREFIX = 'sample:'

/** The symbol of a class of `channel`: the layer's own, with this output. */
export function withOutput(base: SymbolSpec, channel: ChannelId, output: Output | undefined): SymbolSpec {
  if (output === undefined) return base
  switch (channel) {
    case 'color':
      return { ...base, fillColor: String(output), lineColor: String(output) }
    case 'strokeColor':
      return { ...base, strokeColor: String(output) }
    case 'strokeWidth':
      return { ...base, strokeWidth: Number(output) }
    case 'size':
      return { ...base, radius: Number(output) }
    case 'width':
      return { ...base, lineWidth: Number(output) }
    case 'shape':
      return { ...base, shape: output as MarkerShape }
    case 'dash':
      return { ...base, dash: output as LineDash }
    case 'opacity':
      return { ...base, opacity: Number(output) }
    case 'rotation':
      return { ...base, rotation: Number(output) }
    case 'height':
      return base
  }
}

/**
 * The legend groups of the properties that vary by data with categories or
 * classes (beyond color and the spec 009 size channel, which have their own),
 * in panel order; a property hidden from the legend has none.
 */
export function channelLegendGroups(style: LayerStyle, resolved: ResolvedStyle): ChannelLegendGroup[] {
  const s = legacyView(style)
  const base = baseSymbol(s)
  return CHANNEL_ORDER.flatMap((id) => {
    const enc = s.channels?.[id]
    const rc = resolved.channels?.[id]
    if (!enc || !rc || rc.status !== 'ok' || !isGenericChannel(id, enc) || enc.legend?.hidden) return []
    // Size and width share one encoding (markers and lines alike): one group.
    if (id === 'width' && s.channels?.size && JSON.stringify(s.channels.size) === JSON.stringify(enc)) return []
    // A turned circle looks the same: rotation swatches use a triangle unless the shape is another.
    const shown = id === 'rotation' && base.shape === 'circle' ? { ...base, shape: 'triangle' as MarkerShape } : base
    const title = enc.legend?.title ? `${enc.legend.title} · ${rc.caption.split(' · ').slice(1).join(' · ')}` : rc.caption
    // Spec 011 US4: continuous colors as a bar; continuous numbers as three samples; as is, said in words.
    let classes = rc.classes
    let gradient: ChannelLegendGroup['gradient']
    let note: string | undefined
    if (rc.scale === 'continuous' && rc.domain && enc.scale.kind === 'continuous') {
      const domain = rc.domain
      const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
      if (isColorChannel(id)) {
        const span = domain.max - domain.min
        const stops = Array.from({ length: CONTINUOUS_STOPS }, (_, i) => String(continuousOutput(id, enc.scale as ContinuousScale, domain, domain.min + (span * i) / (CONTINUOUS_STOPS - 1))))
        gradient = { stops, min: fmt.format(domain.min), max: fmt.format(domain.max) }
      } else {
        const samples: ResolvedClass[] = (rc.samples ?? []).map((x, i) => ({ key: `${SAMPLE_KEY_PREFIX}${i}`, kind: 'value', label: x.label, color: base.fillColor, visible: true, count: -1, output: x.output }))
        classes = [...samples, ...rc.classes]
      }
    } else if (rc.scale === 'identity') note = isColorChannel(id) ? 'Colors read from the column' : `Read from the column${id === 'opacity' ? ' (0–1)' : id === 'rotation' ? ' (degrees)' : ' (pixels)'}`
    return [{ channel: id, title, classes, symbols: classes.map((c) => withOutput(shown, id, c.output)), ...(gradient ? { gradient } : {}), ...(note ? { note } : {}) }]
  })
}

// --- Spec 011 US5: legend groups, merged when they read the same classes -------

/** A class in a legend group, with the classes it stands for in every merged property. */
export interface LegendEntry {
  key: string
  kind: ResolvedClass['kind']
  label: string
  count: number
  visible: boolean
  /** Drawn with every merged property's output (color, size, shape…). */
  symbol: SymbolSpec
  /** What hiding this entry toggles: one class per merged property (`size` is spec 009's size channel). */
  toggles: Array<{ channel: ChannelId; key: string }>
}

export interface LegendGroup {
  key: string
  /** The properties drawn in this group, color first; one unless merged. */
  channels: ChannelId[]
  title: string
  entries: LegendEntry[]
  /** Spec 011 US4: a continuous color's bar. */
  gradient?: { stops: string[]; min: string; max: string }
  /** Spec 011 US4: an as-is property's line. */
  note?: string
}

interface Member {
  channel: ChannelId
  title: string
  gradient?: LegendGroup['gradient']
  note?: string
  column: string
  scale: 'categories' | 'classes' | 'other'
  classes: ResolvedClass[]
  symbols: SymbolSpec[]
  /** Spec 009's size channel (sizes from `ResolvedClass.size`; markers and lines alike). */
  bridgedSize?: boolean
}

/** What makes two properties' classes the same: column, kind of scale, the classes in order, and which are hidden. */
function signature(m: Member): string | null {
  if (m.scale === 'other' || !m.column) return null
  const classes = m.classes.map((c) => (c.kind === 'value' ? `v:${c.value}` : c.kind === 'range' ? `r:${c.lower}:${c.upper}` : c.kind) + (c.visible ? '' : '!'))
  return `${m.scale}\u0000${m.column}\u0000${classes.join('\u0001')}`
}

/** A class's output in a member, applied to a symbol. */
function apply(symbol: SymbolSpec, m: Member, c: ResolvedClass): SymbolSpec {
  if (m.bridgedSize) return c.size === undefined ? symbol : { ...symbol, radius: c.size, lineWidth: c.size }
  return withOutput(symbol, m.channel, c.output)
}

/**
 * Every legend group with classes, in panel order: the color (unless
 * bivariate, a heatmap or the single symbol), spec 009's classed size, and
 * the other properties that vary. Groups that read the same column with the
 * same classes (the same values or bounds, the same ones hidden) merge into
 * one, each entry drawn with all of their outputs (research §10).
 * Proportional sizes, bivariate squares and heatmap ramps aren't classes:
 * the legend draws them on their own.
 */
export function legendGroups(style: LayerStyle, resolved: ResolvedStyle): LegendGroup[] {
  const s = legacyView(style)
  const members: Member[] = []
  const r = rendererOf(s)
  if (resolved.status === 'ok' && !resolved.grid && !resolved.heat && (r.kind === 'categorized' || r.kind === 'graduated' || r.kind === 'rules')) {
    const column = r.kind === 'categorized' ? r.column : r.kind === 'graduated' ? (r.expression ? EXPRESSION_VALUE_COLUMN : r.column) : ''
    members.push({ channel: 'color', title: resolved.caption, column, scale: r.kind === 'categorized' ? 'categories' : r.kind === 'graduated' ? 'classes' : 'other', classes: resolved.classes, symbols: classSymbols(s, resolved) })
  }
  const size = resolved.size
  const sizeChannel = s.size
  if (size?.status === 'ok' && size.mode === 'classed' && sizeChannel && r.kind !== 'bivariate' && r.kind !== 'heatmap') {
    const symbols = sizeSymbols(s, resolved).slice(size.samples?.length ?? 0)
    members.push({ channel: 'size', title: size.caption, column: size.column, scale: 'classes', classes: size.classes, symbols, bridgedSize: true })
  }
  for (const g of channelLegendGroups(s, resolved)) {
    const enc = s.channels?.[g.channel]
    const column = enc ? (channelDataColumns(g.channel, enc)[0] ?? '') : ''
    members.push({ channel: g.channel, title: g.title, column, scale: enc?.scale.kind === 'categories' ? 'categories' : enc?.scale.kind === 'classes' ? 'classes' : 'other', classes: g.classes, symbols: g.symbols, ...(g.gradient ? { gradient: g.gradient } : {}), ...(g.note ? { note: g.note } : {}) })
  }

  const groups: Array<{ first: Member; rest: Member[] }> = []
  const bySignature = new Map<string, { first: Member; rest: Member[] }>()
  for (const m of members) {
    const sig = signature(m)
    const into = sig === null ? undefined : bySignature.get(sig)
    if (into) into.rest.push(m)
    else {
      const g = { first: m, rest: [] as Member[] }
      groups.push(g)
      if (sig !== null) bySignature.set(sig, g)
    }
  }
  // Two groups with the same title (two properties on one column, by different scales): each names its properties.
  const titles = new Map<string, number>()
  for (const g of groups) titles.set(g.first.title, (titles.get(g.first.title) ?? 0) + 1)
  const titleOf = (first: Member, rest: Member[]): string =>
    (titles.get(first.title) ?? 0) > 1 ? `${[first, ...rest].map((m) => CHANNEL_NAMES[m.channel]).join(', ')} · ${first.title}` : first.title
  return groups.map(({ first, rest }) => ({
    key: [first, ...rest].map((m) => m.channel).join('+'),
    channels: [first, ...rest].map((m) => m.channel),
    title: titleOf(first, rest),
    ...(first.gradient ? { gradient: first.gradient } : {}),
    ...(first.note ? { note: first.note } : {}),
    entries: first.classes.map((c, i) => ({
      key: c.key,
      kind: c.kind,
      label: c.label,
      count: c.count,
      visible: c.visible,
      symbol: rest.reduce((sym, m) => apply(sym, m, m.classes[i]), first.symbols[i]),
      // Samples of a continuous property are drawn, not hidden.
      toggles: c.key.startsWith(SAMPLE_KEY_PREFIX) ? [] : [first, ...rest].map((m) => ({ channel: m.channel, key: m.classes[i].key })),
    })),
  }))
}
