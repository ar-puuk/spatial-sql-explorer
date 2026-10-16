// Spec 011 slice 1 (research §9): styles are stored as channels; these convert
// between channels and the pre-011 shapes (`renderer`, `size`, `extrusion`),
// both ways and losslessly for every pre-011 style:
//   - `renderer` ↔ the `color` channel, or `draw.points = 'heatmap'` + `heatmap`;
//   - `size` ↔ the `size` and `width` channels (one encoding: it sized markers and lines alike);
//   - `extrusion` ↔ `draw.polygons = '3d'` + the `height` channel (As is × scale) or `height.meters`.
// The readers accept either shape: a legacy key, when present, wins (a style
// patch from the pre-011 UI, a raw test style, an importer's partial style).
import {
  DEFAULT_CATEGORY_CAP,
  type BivariateRenderer,
  type CategorizedRenderer,
  type ClassOverride,
  type GraduatedRenderer,
  type HeatmapRenderer,
  type HeatmapSettings,
  type LayerStyle,
  type Renderer,
  type RulesRenderer,
  type SizeChannel,
} from './model.js'
import type { ClassDef, ClassesScale, ContinuousScale, Encoding, IdentityScale } from './channels.js'
import type { Extrusion } from './extrusion.js'

const SINGLE: Renderer = Object.freeze({ kind: 'single' }) as Renderer

const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key)

// --- class overrides --------------------------------------------------------

function toClassDef(o: ClassOverride | undefined): ClassDef {
  const out: ClassDef = {}
  if (!o) return out
  if (o.color !== undefined) out.output = o.color
  if (o.label !== undefined) out.label = o.label
  if (o.visible === false) out.visible = false
  return out
}

function toOverride(o: ClassDef | undefined, withColor = true): ClassOverride {
  const out: ClassOverride = {}
  if (!o) return out
  if (withColor && typeof o.output === 'string') out.color = o.output
  if (o.label !== undefined) out.label = o.label
  if (o.visible === false) out.visible = false
  return out
}

// --- renderer ↔ color channel ----------------------------------------------

/** The color channel of a pre-011 renderer (none for single and heatmap). */
export function colorEncodingOf(r: Renderer): Encoding | undefined {
  switch (r.kind) {
    case 'categorized':
      return {
        source: { kind: 'column', column: r.column },
        scale: {
          kind: 'categories',
          manual: r.manual,
          categories: r.classes.map((c) => ({ value: c.value, ...toClassDef(c) })),
          other: toClassDef(r.other),
          noValue: toClassDef(r.noValue),
          cap: r.cap,
          ramp: r.ramp,
        },
      }
    case 'graduated':
      return {
        source: r.expression ? { kind: 'expression', expression: r.expression, ...(r.column ? { label: r.column } : {}) } : { kind: 'column', column: r.column },
        scale: {
          kind: 'classes',
          method: r.method,
          classCount: r.classCount,
          classes: r.classes.map((c) => ({ index: c.index, ...toClassDef(c), ...(c.lower !== undefined ? { lower: c.lower } : {}), ...(c.upper !== undefined ? { upper: c.upper } : {}) })),
          noValue: toClassDef(r.noValue),
          ramp: r.ramp,
        },
      }
    case 'rules':
      return {
        source: { kind: 'column', column: '' },
        scale: {
          kind: 'conditions',
          rules: r.rules.map((k) => ({ id: k.id, label: k.label, where: k.where, output: k.color, visible: k.visible })),
          else: { label: r.elseLabel, output: r.elseColor, visible: r.elseVisible },
        },
      }
    case 'bivariate':
      return {
        source: { kind: 'pair', x: r.x.column, y: r.y.column },
        scale: { kind: 'bivariate', x: { method: r.x.method, ...(r.x.classes ? { classes: r.x.classes } : {}) }, y: { method: r.y.method, ...(r.y.classes ? { classes: r.y.classes } : {}) }, palette: r.palette, hidden: [...r.hidden], noValue: toClassDef(r.noValue) },
      }
    default:
      return undefined
  }
}

/** A color channel as the pre-011 renderer that draws it. */
export function rendererFromEncoding(enc: Encoding | undefined): Renderer {
  if (!enc) return SINGLE
  const s = enc.scale
  const src = enc.source
  switch (s.kind) {
    case 'categories': {
      const r: CategorizedRenderer = {
        kind: 'categorized',
        column: src.kind === 'column' ? src.column : '',
        ramp: s.ramp ?? { id: 'brewer-set2', reversed: false },
        cap: s.cap ?? DEFAULT_CATEGORY_CAP,
        manual: s.manual,
        classes: s.categories.map((c) => ({ value: c.value, ...toOverride(c) })),
        other: toOverride(s.other),
        noValue: toOverride(s.noValue),
      }
      return r
    }
    case 'classes': {
      const r: GraduatedRenderer = {
        kind: 'graduated',
        column: src.kind === 'column' ? src.column : src.kind === 'expression' ? (src.label ?? '') : '',
        ...(src.kind === 'expression' ? { expression: src.expression } : {}),
        method: s.method,
        classCount: s.classCount,
        ramp: s.ramp ?? { id: 'viridis', reversed: false },
        classes: s.classes.map((c) => ({ index: c.index, ...toOverride(c), ...(c.lower !== undefined ? { lower: c.lower } : {}), ...(c.upper !== undefined ? { upper: c.upper } : {}) })),
        noValue: toOverride(s.noValue),
      }
      return r
    }
    case 'conditions': {
      const r: RulesRenderer = {
        kind: 'rules',
        rules: s.rules.map((k) => ({ id: k.id, label: k.label, where: k.where, color: String(k.output), visible: k.visible })),
        elseColor: String(s.else.output),
        elseVisible: s.else.visible,
        elseLabel: s.else.label,
      }
      return r
    }
    case 'bivariate': {
      const r: BivariateRenderer = {
        kind: 'bivariate',
        x: { column: src.kind === 'pair' ? src.x : '', method: s.x.method, ...(s.x.classes ? { classes: s.x.classes } : {}) },
        y: { column: src.kind === 'pair' ? src.y : '', method: s.y.method, ...(s.y.classes ? { classes: s.y.classes } : {}) },
        palette: s.palette,
        hidden: [...s.hidden],
        noValue: toOverride(s.noValue, false),
      }
      return r
    }
    // Continuous and As-is colors have no pre-011 renderer (slice 3).
    default:
      return SINGLE
  }
}

function heatmapSettingsOf(r: HeatmapRenderer): HeatmapSettings {
  const { kind: _k, ...settings } = r
  void _k
  return settings
}

/** The style's color renderer, as the pre-011 code reads it. */
export function rendererOf(style: Pick<LayerStyle, 'renderer' | 'draw' | 'heatmap' | 'clusters' | 'channels'>): Renderer {
  if (has(style, 'renderer')) return style.renderer ?? SINGLE
  if (style.draw?.points === 'heatmap' && style.heatmap) return { kind: 'heatmap', ...style.heatmap }
  if (style.draw?.points === 'clusters' && style.clusters) return { kind: 'clusters', ...style.clusters }
  return rendererFromEncoding(style.channels?.color)
}

/** The style with `r` as its color channel (or heatmap), in channel form. */
export function withRenderer(style: LayerStyle, r: Renderer): LayerStyle {
  const s = toChannelShape(style)
  const channels = { ...s.channels }
  const draw = { ...s.draw }
  let heatmap = s.heatmap
  let clusters = s.clusters
  if (r.kind === 'heatmap') {
    draw.points = 'heatmap'
    heatmap = heatmapSettingsOf(r)
    // The pre-011 heatmap replaced the color renderer (its colors were the single symbol's).
    delete channels.color
  } else if (r.kind === 'clusters') {
    draw.points = 'clusters'
    const { kind: _k, ...settings } = r
    void _k
    clusters = settings
    // Points left out of a group keep the single symbol.
    delete channels.color
  } else {
    delete draw.points
    const color = colorEncodingOf(r)
    if (color) channels.color = color
    else delete channels.color
  }
  return tidy({ ...s, channels, draw, ...(heatmap ? { heatmap } : {}), ...(clusters ? { clusters } : {}) })
}

// --- size ↔ size and width channels ----------------------------------------

/** The size and width channels' shared encoding of a pre-011 size channel. */
export function sizeEncodingOf(sc: SizeChannel): Encoding {
  const range = { min: sc.sizeMin, max: sc.sizeMax }
  const noValue = toClassDef(sc.noValue)
  if (sc.mode === 'proportional') {
    const scale: ContinuousScale = { kind: 'continuous', range, noValue, ...(sc.scale ? { curve: sc.scale } : {}) }
    return { source: { kind: 'column', column: sc.column }, scale }
  }
  const scale: ClassesScale = {
    kind: 'classes',
    method: sc.method,
    classCount: sc.classCount,
    classes: sc.classes.map((c) => ({ index: c.index, ...toClassDef(c), ...(c.lower !== undefined ? { lower: c.lower } : {}), ...(c.upper !== undefined ? { upper: c.upper } : {}) })),
    noValue,
    range,
    ...(sc.scale ? { curve: sc.scale } : {}),
  }
  return { source: { kind: 'column', column: sc.column }, scale }
}

/** A size or width encoding as the pre-011 size channel, when it is one (a column, classes or continuous). */
export function sizeChannelFromEncoding(enc: Encoding | undefined): SizeChannel | undefined {
  if (!enc || enc.source.kind !== 'column') return undefined
  const s = enc.scale
  const noValue = toOverride(s.kind === 'classes' || s.kind === 'continuous' ? s.noValue : undefined, false)
  if (s.kind === 'continuous') {
    const range = s.range ?? { min: 2, max: 10 }
    return { column: enc.source.column, mode: 'proportional', method: 'quantile', classCount: 5, classes: [], noValue, sizeMin: range.min, sizeMax: range.max, ...(s.curve ? { scale: s.curve } : {}) }
  }
  if (s.kind === 'classes') {
    const range = s.range ?? { min: 2, max: 10 }
    return {
      column: enc.source.column,
      mode: 'classed',
      method: s.method,
      classCount: s.classCount,
      classes: s.classes.map((c) => ({ index: c.index, ...toOverride(c, false), ...(c.lower !== undefined ? { lower: c.lower } : {}), ...(c.upper !== undefined ? { upper: c.upper } : {}) })),
      noValue,
      sizeMin: range.min,
      sizeMax: range.max,
      ...(s.curve ? { scale: s.curve } : {}),
    }
  }
  return undefined
}

/** The style's size channel, as the pre-011 code reads it. */
export function sizeOf(style: Pick<LayerStyle, 'size' | 'channels'>): SizeChannel | undefined {
  if (has(style, 'size')) return style.size
  return sizeChannelFromEncoding(style.channels?.size) ?? sizeChannelFromEncoding(style.channels?.width)
}

/** The style with `size` as its marker size and line width channels (undefined: both fixed). */
export function withSize(style: LayerStyle, size: SizeChannel | undefined): LayerStyle {
  const s = toChannelShape(style)
  const channels = { ...s.channels }
  if (size) {
    const enc = sizeEncodingOf(size)
    channels.size = enc
    channels.width = structuredClone(enc)
  } else {
    delete channels.size
    delete channels.width
  }
  return tidy({ ...s, channels })
}

// --- extrusion ↔ 3D + height -------------------------------------------------

/** The style's extrusion, as the pre-011 code reads it. */
export function extrusionOf(style: Pick<LayerStyle, 'extrusion' | 'draw' | 'channels' | 'height'>): Extrusion | undefined {
  if (has(style, 'extrusion')) return style.extrusion
  const enabled = style.draw?.polygons === '3d'
  const h = style.channels?.height
  if (h && h.source.kind === 'column' && h.scale.kind === 'identity') return { enabled, source: { kind: 'column', column: h.source.column }, scale: h.scale.multiply ?? 1 }
  if (style.height) return { enabled, source: { kind: 'constant', meters: style.height.meters }, scale: style.height.scale ?? 1 }
  return enabled ? { enabled, source: { kind: 'constant', meters: 0 }, scale: 1 } : undefined
}

/** The style with `e` as its 3D drawing and height (undefined: flat, no height). */
export function withExtrusion(style: LayerStyle, e: Extrusion | undefined): LayerStyle {
  const s = toChannelShape(style)
  const channels = { ...s.channels }
  const draw = { ...s.draw }
  let height: LayerStyle['height']
  delete channels.height
  if (e) {
    if (e.source.kind === 'column') {
      const scale: IdentityScale = { kind: 'identity', noValue: {}, ...(e.scale !== 1 ? { multiply: e.scale } : {}) }
      channels.height = { source: { kind: 'column', column: e.source.column }, scale }
    } else height = { meters: e.source.meters, ...(e.scale !== 1 ? { scale: e.scale } : {}) }
  }
  if (e?.enabled) draw.polygons = '3d'
  else delete draw.polygons
  const out: LayerStyle = { ...s, channels, draw }
  if (height) out.height = height
  else delete out.height
  return tidy(out)
}

// --- shape -------------------------------------------------------------------

/**
 * The style in channel form: legacy keys that are present are applied (they
 * win) and removed. A style already in channel form is returned unchanged.
 */
export function toChannelShape(style: LayerStyle): LayerStyle {
  if (!has(style, 'renderer') && !has(style, 'size') && !has(style, 'extrusion')) return style
  const { renderer, size, extrusion, ...rest } = style
  let out: LayerStyle = rest as LayerStyle
  if (has(style, 'renderer')) out = withRenderer(out, renderer ?? SINGLE)
  if (has(style, 'size')) out = withSize(out, size)
  if (has(style, 'extrusion')) out = withExtrusion(out, extrusion)
  return out
}

/** Drops empty `channels` and `draw` objects, so a single style stays as small as before. */
function tidy(style: LayerStyle): LayerStyle {
  const out = { ...style }
  if (out.channels && Object.keys(out.channels).length === 0) delete out.channels
  if (out.draw && Object.keys(out.draw).length === 0) delete out.draw
  return out
}


/**
 * Slice 1 bridge: the style with its pre-011 fields filled in from the
 * channels, for code that still reads `renderer`, `size` and `extrusion`
 * (resolve, paint, the file formats). Never stored: the store keeps channels.
 */
export function legacyView(style: LayerStyle): LayerStyle {
  if (has(style, 'renderer') && has(style, 'size') && has(style, 'extrusion')) return style
  return { ...style, renderer: rendererOf(style), size: sizeOf(style), extrusion: extrusionOf(style) }
}
