// Spec 026: the facts card, as rows of words. Pure, so what the card says is tested without a browser.
// No all-caps labels and no dot-joined strings (spec 015): one fact per row.
// Adapted from GeoLibre (MIT): apps/geolibre-desktop/src/lib/raster-info.ts (which facts a raster card lists).
import type { CrsUnits } from '../models.js'
import type { RasterDataType, RasterFacts, RasterStyle } from './types.js'

export interface FactRow {
  label: string
  value: string
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const fixed = (n: number, digits: number): string => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n).replace('-', '−')

export const DATA_TYPE_NAMES: Record<RasterDataType, string> = {
  uint8: '8-bit unsigned integer',
  int8: '8-bit signed integer',
  uint16: '16-bit unsigned integer',
  int16: '16-bit signed integer',
  uint32: '32-bit unsigned integer',
  int32: '32-bit signed integer',
  float32: '32-bit floating point',
  float64: '64-bit floating point',
}

const unitWord = (u: CrsUnits | undefined, many = true): string => (u === 'metres' ? (many ? 'metres' : 'metre') : u === 'feet' ? (many ? 'feet' : 'foot') : u === 'degrees' ? (many ? 'degrees' : 'degree') : '')

/** Digits that show a coordinate to about a metre (degrees) or a decimetre (projected units). */
const digitsFor = (u: CrsUnits | undefined): number => (u === 'degrees' ? 6 : 1)

export function nodataText(nodata: RasterFacts['nodata']): string {
  if (nodata === null) return 'None recorded'
  if (nodata === 'nan') return 'NaN (not a number)'
  return Number.isInteger(nodata) ? nf.format(nodata).replace('-', '−') : String(nodata)
}

/** "3 bands: Band 1, Band 2, Band 3"; past six only the count. */
export function bandsText(facts: Pick<RasterFacts, 'bands'>): string {
  const n = facts.bands.length
  if (n > 6) return `${nf.format(n)} bands`
  return `${n} ${n === 1 ? 'band' : 'bands'}: ${facts.bands.map((b) => b.name).join(', ')}`
}

/** The card's rows, in the order they are shown. */
export function describeRaster(facts: RasterFacts): FactRow[] {
  const u = facts.crs.units
  const d = digitsFor(u)
  const geographic = u === 'degrees'
  const rows: FactRow[] = [
    { label: 'Coordinate system', value: facts.crs.label },
    { label: 'Size', value: `${nf.format(facts.width)} × ${nf.format(facts.height)} pixels` },
    { label: 'Bands', value: bandsText(facts) },
    { label: 'Data type', value: facts.originalDataType ? `${DATA_TYPE_NAMES[facts.dataType]} (the file holds ${DATA_TYPE_NAMES[facts.originalDataType]})` : DATA_TYPE_NAMES[facts.dataType] },
    { label: 'No data', value: nodataText(facts.nodata) },
  ]
  if (facts.pixelSize) {
    const [px, py] = facts.pixelSize
    const same = Math.abs(px - py) < Math.max(px, py) * 1e-6
    const pd = geographic ? 8 : 2
    rows.push({ label: 'Pixel size', value: `${same ? fixed(px, pd) : `${fixed(px, pd)} × ${fixed(py, pd)}`} ${unitWord(u) || 'units'}`.trim() })
  }
  const [x0, y0, x1, y1] = facts.extent
  rows.push({ label: geographic ? 'Longitude' : 'X range', value: `${fixed(x0, d)} to ${fixed(x1, d)}${geographic ? '' : ` ${unitWord(u)}`}`.trimEnd() })
  rows.push({ label: geographic ? 'Latitude' : 'Y range', value: `${fixed(y0, d)} to ${fixed(y1, d)}${geographic ? '' : ` ${unitWord(u)}`}`.trimEnd() })
  rows.push({ label: 'Compression', value: facts.compression })
  rows.push({
    label: 'Storage',
    value: facts.origin === 'converted' ? 'Prepared in memory as a COG' : facts.tiled && facts.tileSize ? `Tiled, ${facts.tileSize[0]} × ${facts.tileSize[1]} pixels` : 'Not tiled',
  })
  rows.push({ label: 'Overviews', value: facts.overviews === 0 ? 'None' : `${facts.overviews} ${facts.overviews === 1 ? 'level' : 'levels'}` })
  rows.push({ label: 'Drawn', value: facts.mode === '3857' ? 'As stored (Web Mercator)' : 'Reprojected for the map' })
  return rows
}

/** One band's value as shown under the cursor: the stored value, or "no data". */
export function valueText(value: number | null): string {
  if (value === null) return 'no data'
  if (Number.isInteger(value)) return nf.format(value).replace('-', '−')
  const a = Math.abs(value)
  // Enough digits to tell neighbouring pixels apart without a wall of decimals.
  const digits = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 4
  return fixed(value, digits)
}

/** A legend group as the print page and the map draw it (the same shape as the UI's `LegendGroup`). */
export interface RasterLegendGroup {
  title: string
  shape: 'area'
  alpha: number
  rows: Array<{ color: string; label: string }>
  ramp?: { colors: string[]; min: string; max: string }
  note?: string
}

/**
 * The legend of a raster for the print page (spec 026 FR-012): a gradient with its lowest and highest value for a color
 * ramp, a row per class for a colour table, the three band names for a colour image. `ramp` is the colormap sampled from
 * low to high (null before the engine is up: the title and ends still print).
 */
export function rasterLegendGroup(facts: Pick<RasterFacts, 'bands' | 'palette'>, style: Pick<RasterStyle, 'mode' | 'bands' | 'min' | 'max' | 'opacity'>, ramp: readonly string[] | null): RasterLegendGroup {
  const bandName = (i: number): string => facts.bands[(style.bands[i] ?? i + 1) - 1]?.name ?? `Band ${style.bands[i] ?? i + 1}`
  const base = { shape: 'area' as const, alpha: style.opacity }
  if (style.mode === 'rgb') return { ...base, title: 'Colors', rows: [], note: `Red: ${bandName(0)}, green: ${bandName(1)}, blue: ${bandName(2)}` }
  if (style.mode === 'paletted') return { ...base, title: bandName(0), rows: (facts.palette ?? []).map((p) => ({ color: p.color, label: String(p.value) })) }
  return { ...base, title: bandName(0), rows: [], ...(ramp && ramp.length > 1 ? { ramp: { colors: [...ramp], min: valueText(style.min), max: valueText(style.max) } } : {}) }
}
