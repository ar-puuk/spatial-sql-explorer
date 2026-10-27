// Spec 026: how a raster is drawn. Defaults come from the file (an image or a measurement, percentile
// stretch), and `toRenderOptions` turns a style into what the tiler's `renderTileRGBA` takes.
import { isNeutralDisplay, sanitizeDisplay } from './display.js'
import { isReliefStored, sanitizeRelief } from './relief.js'
import type { NodataTreatment, RasterBand, RasterFacts, RasterStretch, RasterStyle } from './types.js'

/** Every colormap the tiler (cog-tiler-wasm 0.5.0 `colormaps()`) can draw a single band with. A name not in it is refused. */
export const RASTER_COLORMAPS = [
  'accent', 'afmhot', 'algae', 'amp', 'autumn', 'balance', 'binary', 'blues', 'bone', 'brbg', 'brg', 'bugn', 'bupu', 'bwr', 'cfastie', 'cividis', 'cmrmap', 'cool', 'coolwarm', 'copper', 'cubehelix', 'curl', 'dark2', 'deep', 'delta', 'dense', 'diff', 'flag', 'gist_earth', 'gist_gray', 'gist_heat', 'gist_ncar', 'gist_rainbow', 'gist_stern', 'gist_yarg', 'gnbu', 'gnuplot', 'gnuplot2', 'gray', 'greens', 'greys', 'haline', 'hot', 'hsv', 'ice', 'inferno', 'jet', 'magma', 'matter', 'nipy_spectral', 'ocean', 'oranges', 'orrd', 'oxy', 'paired', 'pastel1', 'pastel2', 'phase', 'pink', 'piyg', 'plasma', 'prgn', 'prism', 'pubu', 'pubugn', 'puor', 'purd', 'purples', 'rain', 'rainbow', 'rdbu', 'rdgy', 'rdpu', 'rdylbu', 'rdylgn', 'reds', 'rplumbo', 'schwarzwald', 'seismic', 'set1', 'set2', 'set3', 'solar', 'spectral', 'speed', 'spring', 'summer', 'tab10', 'tab20', 'tab20b', 'tab20c', 'tarn', 'tempo', 'terrain', 'thermal', 'topo', 'turbid', 'turbo', 'twilight', 'twilight_shifted', 'viridis', 'winter', 'wistia', 'ylgn', 'ylgnbu', 'ylorbr', 'ylorrd',
] as const

/** The short list the picker shows first; "more" shows all of `RASTER_COLORMAPS`. */
export const COLORMAP_GROUPS: Array<{ id: string; label: string; names: string[] }> = [
  { id: 'sequential', label: 'Sequential', names: ['viridis', 'magma', 'inferno', 'plasma', 'cividis', 'turbo', 'gray', 'blues', 'greens', 'reds', 'oranges', 'purples', 'ylorrd', 'ylgnbu'] },
  { id: 'terrain', label: 'Terrain and water', names: ['terrain', 'gist_earth', 'ocean', 'topo', 'haline', 'thermal'] },
  { id: 'diverging', label: 'Diverging', names: ['rdbu', 'rdylgn', 'spectral', 'coolwarm', 'bwr', 'piyg', 'brbg', 'seismic'] },
  { id: 'cyclic', label: 'Cyclic', names: ['twilight', 'hsv', 'phase'] },
]

export type RasterColormap = (typeof RASTER_COLORMAPS)[number]
export const isColormap = (name: unknown): name is RasterColormap => typeof name === 'string' && (RASTER_COLORMAPS as readonly string[]).includes(name)

/**
 * "Do not treat any value as no data": the tiler takes an override of the file's nodata value, so a value no sample
 * can have turns the transparency off (measured: with 1e30 the holes of a DEM are drawn as ordinary values).
 */
export const NO_NODATA_VALUE = 1e30

const STRETCHES: RasterStretch[] = ['linear', 'sqrt', 'log']

/** The range a band's colors run between by default: the 2nd to 98th percentile, else min to max, else the sample type's own range. */
export function defaultRange(band: RasterBand | undefined, dataType: RasterFacts['dataType']): [number, number] {
  const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
  const { p2, p98, min, max } = band ?? {}
  const range: [number, number] | null = finite(p2) && finite(p98) && p2 < p98 ? [p2, p98] : finite(min) && finite(max) ? [min, max] : null
  if (!range) return dataType === 'uint8' ? [0, 255] : dataType === 'uint16' ? [0, 65535] : [0, 1]
  // A flat band (one value everywhere) still needs a range.
  return range[0] < range[1] ? range : [range[0], range[0] + 1]
}

/** The style a raster starts with, chosen from the file (spec US3: an image is drawn as an image, a measurement with a ramp). */
export function defaultRasterStyle(facts: RasterFacts): RasterStyle {
  const base = { stretch: 'linear' as const, gamma: 1, reversed: false, nodata: { mode: 'file' } as NodataTreatment, opacity: 1 }
  if (facts.hasPalette) return { ...base, mode: 'paletted', bands: [1], min: 0, max: 255, colormap: 'viridis' }
  // What the file holds decides whether it is an image: a converted 16-bit file is float here, and is still an image.
  const sampleType = facts.originalDataType ?? facts.dataType
  const colorBands = facts.bands.length >= 3 && (sampleType === 'uint8' || sampleType === 'uint16')
  if (colorBands) {
    // Bands tagged red, green and blue say which ones; otherwise the first three.
    const idx = (c: 'red' | 'green' | 'blue', fallback: number) => facts.bands.find((b) => b.interpretation === c)?.index ?? fallback
    const bands = [idx('red', 1), idx('green', 2), idx('blue', 3)]
    const ranges = bands.map((b) => (facts.dataType === 'uint8' ? ([0, 255] as [number, number]) : defaultRange(facts.bands[b - 1], facts.dataType)))
    return { ...base, mode: 'rgb', bands, min: ranges[0][0], max: ranges[0][1], rescale: ranges, colormap: 'viridis' }
  }
  const band = facts.bands[0]
  const [min, max] = defaultRange(band, facts.dataType)
  // One 8-bit band is an image (a hillshade, a scan): gray. Anything else is a measurement: a ramp.
  return { ...base, mode: 'single', bands: [1], min, max, colormap: facts.dataType === 'uint8' ? 'gray' : 'viridis' }
}

/** The options `CogSource.renderTileRGBA` takes (a subset of cog-tiler-wasm's `RenderOptions`). */
export interface RasterRenderOptions {
  bidx: number[]
  min?: number
  max?: number
  rescale?: [number, number][]
  colormap?: string
  reversed?: boolean
  stretch?: RasterStretch
  gamma?: number
  nodata?: number
}

/** A style as the tiler wants it. Opacity is not here: it is the map layer's `raster-opacity`. */
export function toRenderOptions(style: RasterStyle, facts: Pick<RasterFacts, 'bands'>): RasterRenderOptions {
  const last = Math.max(1, facts.bands.length)
  const clamp = (b: number) => Math.min(last, Math.max(1, Math.round(b) || 1))
  const nodata = style.nodata.mode === 'value' ? { nodata: style.nodata.value } : style.nodata.mode === 'none' ? { nodata: NO_NODATA_VALUE } : {}
  if (style.mode === 'paletted') return { bidx: [clamp(style.bands[0])], ...nodata }
  const common = { stretch: style.stretch, gamma: style.gamma, ...nodata }
  if (style.mode === 'rgb') {
    const bidx = [0, 1, 2].map((i) => clamp(style.bands[i] ?? i + 1))
    const rescale = style.rescale && style.rescale.length >= 3 ? style.rescale.slice(0, 3) : ([0, 1, 2].map(() => [style.min, style.max]) as [number, number][])
    return { bidx, rescale, ...common }
  }
  return { bidx: [clamp(style.bands[0])], min: style.min, max: style.max, colormap: style.colormap, reversed: style.reversed, ...common }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * A style read from a sidecar or saved state, made safe for this file: unknown fields dropped, bands brought into range,
 * a colormap the tiler does not know replaced, `min` below `max`. Returns null when `raw` is not a style at all.
 */
export function sanitizeRasterStyle(raw: unknown, facts: RasterFacts): RasterStyle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const fallback = defaultRasterStyle(facts)
  const count = facts.bands.length
  const mode = r.mode === 'single' || r.mode === 'rgb' || (r.mode === 'paletted' && facts.hasPalette) ? r.mode : fallback.mode
  const want = mode === 'rgb' ? 3 : 1
  const bandsRaw = Array.isArray(r.bands) ? r.bands.filter((b): b is number => Number.isInteger(b) && b >= 1 && b <= count) : []
  const bands = bandsRaw.length >= want ? bandsRaw.slice(0, want) : mode === fallback.mode ? fallback.bands : mode === 'rgb' ? [1, Math.min(2, count), Math.min(3, count)] : [1]
  let min = finite(r.min) ? r.min : fallback.min
  let max = finite(r.max) ? r.max : fallback.max
  if (min >= max) [min, max] = [fallback.min, fallback.max]
  const rescale = Array.isArray(r.rescale) && r.rescale.length >= 3 && r.rescale.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) && p[0] < p[1]) ? (r.rescale.slice(0, 3) as [number, number][]) : undefined
  const nd = r.nodata as { mode?: unknown; value?: unknown } | undefined
  const display = r.display === undefined ? undefined : sanitizeDisplay(r.display)
  const relief = r.relief === undefined ? undefined : sanitizeRelief(r.relief)
  const nodata: NodataTreatment = nd?.mode === 'none' ? { mode: 'none' } : nd?.mode === 'value' && finite(nd.value) ? { mode: 'value', value: nd.value } : { mode: 'file' }
  return {
    mode,
    bands,
    min,
    max,
    ...(rescale ? { rescale } : {}),
    stretch: STRETCHES.includes(r.stretch as RasterStretch) ? (r.stretch as RasterStretch) : 'linear',
    gamma: finite(r.gamma) && r.gamma > 0 && r.gamma <= 10 ? r.gamma : 1,
    colormap: isColormap(r.colormap) ? r.colormap : fallback.colormap,
    reversed: r.reversed === true,
    nodata,
    opacity: finite(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : 1,
    ...(display && !isNeutralDisplay(display) ? { display } : {}),
    ...(relief && isReliefStored(relief) ? { relief } : {}),
  }
}

/** True when two styles draw the same picture (so a tile cache can be kept). Opacity does not matter to the tiles. */
export function sameRender(a: RasterStyle, b: RasterStyle, facts: Pick<RasterFacts, 'bands'>): boolean {
  return JSON.stringify(toRenderOptions(a, facts)) === JSON.stringify(toRenderOptions(b, facts))
}

// --- the edits the style panel makes (pure, so each is tested) ----------------------------------------------------

export type RangePreset = 'percentile' | 'full'

/** A band's range under a preset: its 2nd to 98th percentile, or its lowest to highest value. */
export function presetRange(band: RasterBand | undefined, dataType: RasterFacts['dataType'], preset: RangePreset): [number, number] {
  if (preset === 'full' && band && typeof band.min === 'number' && typeof band.max === 'number' && band.min < band.max) return [band.min, band.max]
  return defaultRange(band, dataType)
}

/** The style without its per-band ranges (they only mean something for colour bands). */
function withoutRescale(style: RasterStyle): RasterStyle {
  const next = { ...style }
  delete next.rescale
  return next
}

/** One band drawn with a color ramp, or three bands as a colour image; the range follows the file's percentiles. */
export function withMode(style: RasterStyle, facts: RasterFacts, mode: 'single' | 'rgb'): RasterStyle {
  if (mode === 'single') {
    const band = facts.bands[(style.bands[0] ?? 1) - 1]
    const [min, max] = defaultRange(band, facts.dataType)
    return { ...withoutRescale(style), mode: 'single', bands: [Math.min(Math.max(1, style.bands[0] ?? 1), facts.bands.length)], min, max, colormap: style.colormap }
  }
  const base = defaultRasterStyle({ ...facts, hasPalette: false, dataType: facts.dataType })
  const bands = base.mode === 'rgb' ? base.bands : [1, Math.min(2, facts.bands.length), Math.min(3, facts.bands.length)]
  const ranges = bands.map((b) => (facts.dataType === 'uint8' ? ([0, 255] as [number, number]) : defaultRange(facts.bands[b - 1], facts.dataType)))
  return { ...style, mode: 'rgb', bands, rescale: ranges, min: ranges[0][0], max: ranges[0][1] }
}

/** Another band for a ramp: the range moves to that band's own percentiles. */
export function withBand(style: RasterStyle, facts: RasterFacts, band: number): RasterStyle {
  const [min, max] = defaultRange(facts.bands[band - 1], facts.dataType)
  return { ...style, bands: [band], min, max }
}

/** Another band for one of red, green and blue (0, 1, 2): that channel's range follows the band. */
export function withChannel(style: RasterStyle, facts: RasterFacts, channel: 0 | 1 | 2, band: number): RasterStyle {
  const bands = [...style.bands]
  bands[channel] = band
  const rescale = [0, 1, 2].map((i) => (i === channel ? (facts.dataType === 'uint8' ? ([0, 255] as [number, number]) : defaultRange(facts.bands[band - 1], facts.dataType)) : (style.rescale?.[i] ?? [style.min, style.max]))) as [number, number][]
  return { ...style, bands, rescale }
}

/** The range from a preset: one band for a ramp, each band's own for a colour image. */
export function withRangePreset(style: RasterStyle, facts: RasterFacts, preset: RangePreset): RasterStyle {
  if (style.mode === 'rgb') {
    const rescale = style.bands.map((b) => (facts.dataType === 'uint8' && preset === 'percentile' ? ([0, 255] as [number, number]) : presetRange(facts.bands[b - 1], facts.dataType, preset)))
    return { ...style, rescale, min: rescale[0][0], max: rescale[0][1] }
  }
  const [min, max] = presetRange(facts.bands[(style.bands[0] ?? 1) - 1], facts.dataType, preset)
  return { ...style, min, max }
}

/** One range for every colour band (what typing a minimum and maximum does): the per-band ranges are dropped. */
export function withCommonRange(style: RasterStyle, min: number, max: number): RasterStyle {
  return { ...withoutRescale(style), min, max }
}
