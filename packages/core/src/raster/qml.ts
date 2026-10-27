// Spec 026 US3: a raster's style as a QGIS raster QML sidecar (`<basename>.qml`, which QGIS loads by itself), and back.
// Contract: specs/026-raster-view/contracts/raster-style-qml.md. As for vectors, QGIS's own elements carry what they can
// (renderer type, band, range, colors, opacity, transparency) and our whole style rides in a custom property
// (`spatialExplorer/raster`, JSON), so nothing is lost on a round trip through us. A file written by QGIS alone is read from
// its elements, with a note for what could not be matched.
import { fromQgis, isNeutralAdjustment, toQgisBrightnessContrast, toQgisSaturation } from './display.js'
import type { RasterFacts, RasterPaletteEntry, RasterStyle } from './types.js'
import { RASTER_COLORMAPS, defaultRasterStyle, isColormap, sanitizeRasterStyle } from './style.js'

/** The custom property our JSON is kept in. */
export const RASTER_QML_PROPERTY = 'spatialExplorer/raster'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(9))))

/** True when the text is a QGIS raster style (a raster renderer), as opposed to a vector one (`<renderer-v2>`). */
export function isRasterQml(text: string): boolean {
  return /<rasterrenderer[\s>]/i.test(text)
}

export interface RasterQmlOptions {
  /** The colormap sampled from low to high as `#rrggbb`, 9 to 16 colors: QGIS draws the same look from these. Without them only our JSON carries it. */
  ramp?: readonly string[] | null
  /** A colour table's classes (for a paletted renderer). */
  palette?: readonly RasterPaletteEntry[] | null
  /** QGIS version to claim in the header. */
  version?: string
}

/** Notes shown when a style is exported: what the QML cannot say (it is kept in our JSON). */
export function rasterQmlNotes(style: RasterStyle): string[] {
  const notes: string[] = []
  if (style.mode !== 'paletted' && (style.stretch !== 'linear' || style.gamma !== 1)) notes.push('QGIS draws this with a linear stretch: the curve and gamma are kept in the file for Spatial Explorer only.')
  if (style.display && !isNeutralAdjustment(style.display)) notes.push('QGIS shows the brightness, contrast and saturation; the hue turn, and the exact brightness range, are kept in the file for Spatial Explorer only.')
  if (style.nodata.mode === 'none') notes.push('"No nodata" is kept in the file for Spatial Explorer only; QGIS uses the file\'s own nodata value.')
  return notes
}

function transparency(style: RasterStyle): string {
  if (style.nodata.mode === 'value') return `<rasterTransparency><singleValuePixelList><pixelListEntry min="${num(style.nodata.value)}" max="${num(style.nodata.value)}" percentTransparent="100"/></singleValuePixelList></rasterTransparency>`
  return '<rasterTransparency/>'
}

const contrast = (tag: string, min: number, max: number): string => `<${tag}><minValue>${num(min)}</minValue><maxValue>${num(max)}</maxValue><algorithm>StretchToMinimumMaximum</algorithm></${tag}>`

/** The sidecar text for a style. */
export function rasterStyleToQml(style: RasterStyle, facts: Pick<RasterFacts, 'bands'>, options: RasterQmlOptions = {}): string {
  const opacity = num(style.opacity)
  const count = Math.max(1, facts.bands.length)
  const band = Math.min(count, Math.max(1, style.bands[0] ?? 1))
  let renderer: string
  if (style.mode === 'rgb') {
    const [r, g, b] = [0, 1, 2].map((i) => Math.min(count, Math.max(1, style.bands[i] ?? i + 1)))
    const ranges = [0, 1, 2].map((i) => style.rescale?.[i] ?? [style.min, style.max])
    renderer = `<rasterrenderer type="multibandcolor" redBand="${r}" greenBand="${g}" blueBand="${b}" alphaBand="-1" opacity="${opacity}" nodataColor="">${transparency(style)}${contrast('redContrastEnhancement', ranges[0][0], ranges[0][1])}${contrast('greenContrastEnhancement', ranges[1][0], ranges[1][1])}${contrast('blueContrastEnhancement', ranges[2][0], ranges[2][1])}</rasterrenderer>`
  } else if (style.mode === 'paletted') {
    const entries = (options.palette ?? []).map((p) => `<paletteEntry value="${p.value}" color="${esc(p.color)}" alpha="255" label="${p.value}"/>`).join('')
    renderer = `<rasterrenderer type="paletted" band="${band}" alphaBand="-1" opacity="${opacity}" nodataColor="">${transparency(style)}${entries ? `<colorPalette>${entries}</colorPalette>` : ''}</rasterrenderer>`
  } else if (style.colormap === 'gray') {
    renderer = `<rasterrenderer type="singlebandgray" grayBand="${band}" gradient="${style.reversed ? 'WhiteToBlack' : 'BlackToWhite'}" alphaBand="-1" opacity="${opacity}" nodataColor="">${transparency(style)}${contrast('contrastEnhancement', style.min, style.max)}</rasterrenderer>`
  } else {
    const ramp = options.ramp && options.ramp.length >= 2 ? (style.reversed ? [...options.ramp].reverse() : [...options.ramp]) : []
    const items = ramp
      .map((color, i) => {
        const value = style.min + ((style.max - style.min) * i) / (ramp.length - 1)
        return `<item value="${num(value)}" color="${esc(color)}" alpha="255" label="${num(value)}"/>`
      })
      .join('')
    renderer = `<rasterrenderer type="singlebandpseudocolor" band="${band}" alphaBand="-1" opacity="${opacity}" classificationMin="${num(style.min)}" classificationMax="${num(style.max)}" nodataColor="">${transparency(style)}<rastershader><colorrampshader colorRampType="INTERPOLATED" classificationMode="1" clip="0" minimumValue="${num(style.min)}" maximumValue="${num(style.max)}" labelPrecision="4">${items}</colorrampshader></rastershader></rasterrenderer>`
  }
  const json = esc(JSON.stringify(style))
  const display = style.display && !isNeutralAdjustment(style.display) ? style.display : null
  const filters = display
    ? `
    <brightnesscontrast brightness="${toQgisBrightnessContrast(display).brightness}" contrast="${toQgisBrightnessContrast(display).contrast}" gamma="1"/>
    <huesaturation colorizeBlue="128" colorizeGreen="128" colorizeOn="0" colorizeRed="255" colorizeStrength="100" grayscaleMode="0" invertColors="0" saturation="${toQgisSaturation(display)}"/>`
    : ''
  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="${esc(options.version ?? '3.34.0')}">
  <pipe>
    ${renderer}${filters}
  </pipe>
  <blendMode>0</blendMode>
  <customproperties>
    <Option type="Map">
      <Option name="${RASTER_QML_PROPERTY}" type="QString" value="${json}"/>
    </Option>
  </customproperties>
</qgis>
`
}

// --- reading ---------------------------------------------------------------------------------------

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null
}
const numAttr = (tag: string, name: string): number | null => {
  const v = attr(tag, name)
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
}
const element = (text: string, name: string): string | null => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(text)
  return m ? m[1] : null
}
const minMax = (text: string, name: string): [number, number] | null => {
  const body = element(text, name)
  if (!body) return null
  const lo = Number(element(body, 'minValue'))
  const hi = Number(element(body, 'maxValue'))
  return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi] : null
}

export interface RasterQmlResult {
  style: RasterStyle
  notes: string[]
}

/** The style in a raster QML: ours when it is there, else what QGIS's own elements say. Throws when it is not a raster style. */
export function rasterStyleFromQml(text: string, facts: RasterFacts): RasterQmlResult {
  if (!isRasterQml(text)) throw new Error('This is not a raster style (it has no raster renderer).')
  const notes: string[] = []
  // 1. Our own JSON, when it is there and valid.
  const own = new RegExp(`<Option\\s+name="${RASTER_QML_PROPERTY.replace('/', '\\/')}"[^>]*\\bvalue="([^"]*)"`, 'i').exec(text)
  if (own) {
    try {
      const json = JSON.parse(own[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      const style = sanitizeRasterStyle(json, facts)
      if (style) return { style, notes }
    } catch {
      notes.push('The Spatial Explorer part of this style could not be read; QGIS\'s own settings are used.')
    }
  }
  // 2. QGIS's elements.
  const tag = /<rasterrenderer\b[^>]*>/i.exec(text)?.[0] ?? ''
  const body = element(text, 'rasterrenderer') ?? ''
  const type = attr(tag, 'type')
  const base = defaultRasterStyle(facts)
  const count = facts.bands.length
  const inFile = (b: number | null, fallback: number): number => (b !== null && b >= 1 && b <= count ? b : fallback)
  const opacity = numAttr(tag, 'opacity')
  const style: RasterStyle = { ...base, opacity: opacity === null ? 1 : Math.min(1, Math.max(0, opacity)) }
  const entry = /<pixelListEntry\b[^>]*>/i.exec(body)?.[0]
  if (entry) {
    const v = numAttr(entry, 'min')
    if (v !== null) style.nodata = { mode: 'value', value: v }
  }
  if (type === 'multibandcolor' && count >= 3) {
    style.mode = 'rgb'
    style.bands = [inFile(numAttr(tag, 'redBand'), 1), inFile(numAttr(tag, 'greenBand'), 2), inFile(numAttr(tag, 'blueBand'), 3)]
    const [red, green, blue] = (['red', 'green', 'blue'] as const).map((c) => minMax(body, `${c}ContrastEnhancement`))
    if (red && green && blue) {
      style.rescale = [red, green, blue]
      style.min = red[0]
      style.max = red[1]
    } else notes.push('The color ranges of this style could not be read; the file\'s own percentiles are used.')
  } else if (type === 'singlebandgray') {
    style.mode = 'single'
    style.bands = [inFile(numAttr(tag, 'grayBand'), 1)]
    style.colormap = 'gray'
    style.reversed = attr(tag, 'gradient') === 'WhiteToBlack'
    const r = minMax(body, 'contrastEnhancement')
    if (r) [style.min, style.max] = r
  } else if (type === 'singlebandpseudocolor') {
    style.mode = 'single'
    style.bands = [inFile(numAttr(tag, 'band'), 1)]
    const lo = numAttr(tag, 'classificationMin')
    const hi = numAttr(tag, 'classificationMax')
    if (lo !== null && hi !== null && lo < hi) [style.min, style.max] = [lo, hi]
    notes.push('The color ramp of this style is not one of Spatial Explorer\'s colormaps; viridis is used.')
    style.colormap = isColormap('viridis') ? 'viridis' : RASTER_COLORMAPS[0]
  } else if (type === 'paletted') {
    if (facts.hasPalette) {
      style.mode = 'paletted'
      style.bands = [inFile(numAttr(tag, 'band'), 1)]
    } else notes.push('This style uses a color table the file does not have; the default style is used.')
  } else {
    notes.push(`This style uses a renderer ("${type ?? 'unknown'}") Spatial Explorer does not draw; the default style is used.`)
  }
  const bc = /<brightnesscontrast[^>]*>/i.exec(text)?.[0]
  const hs = /<huesaturation[^>]*>/i.exec(text)?.[0]
  if (bc || hs) {
    const q = fromQgis(bc ? (numAttr(bc, 'brightness') ?? 0) : 0, bc ? (numAttr(bc, 'contrast') ?? 0) : 0, hs ? (numAttr(hs, 'saturation') ?? 0) : 0)
    style.display = { brightnessMin: 0, brightnessMax: 1, contrast: 0, saturation: 0, hue: 0, resampling: 'auto', ...q }
  }
  const checked = sanitizeRasterStyle(style, facts) ?? base
  return { style: checked, notes }
}
