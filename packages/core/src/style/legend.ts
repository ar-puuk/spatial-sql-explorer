// Spec 011: the legend's groups for properties set by a column (US1: one per
// property, titled with its column; US5 merges groups that share a column and
// classes). Each class's swatch is the layer's symbol with that property's
// output, so the legend shows what the map draws.
import { CHANNEL_ORDER, type ChannelId, type Output } from './channels.js'
import { legacyView } from './legacy.js'
import type { LayerStyle, ResolvedClass, ResolvedStyle } from './model.js'
import { isGenericChannel } from './resolve.js'
import { baseSymbol, type LineDash, type MarkerShape, type SymbolSpec } from './symbol.js'

export interface ChannelLegendGroup {
  channel: ChannelId
  /** e.g. 'crash_type · 6 categories' */
  title: string
  classes: ResolvedClass[]
  /** One per class: the layer symbol with the class's output. */
  symbols: SymbolSpec[]
}

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
    // A turned circle looks the same: rotation swatches use a triangle unless the shape is another.
    const shown = id === 'rotation' && base.shape === 'circle' ? { ...base, shape: 'triangle' as MarkerShape } : base
    return [{ channel: id, title: enc.legend?.title ? `${enc.legend.title} · ${rc.caption.split(' · ').slice(1).join(' · ')}` : rc.caption, classes: rc.classes, symbols: rc.classes.map((c) => withOutput(shown, id, c.output)) }]
  })
}
