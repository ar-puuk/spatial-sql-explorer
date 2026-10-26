// Spec 026: what a raster file is, from what the tiler and the file header report. Pure: the UI glue
// (packages/ui/src/raster/rasterSource.ts) reads `cog.info()`, `cog.levels` and the GeoKeys and hands
// them in. The idea of a `gdalinfo`-style summary is adapted from GeoLibre (raster-info.ts).
// Adapted from GeoLibre (MIT): apps/geolibre-desktop/src/lib/raster-info.ts (facts shown in the card).
import type { Bbox, CrsInfo, CrsUnits, Layer } from '../models.js'
import type { BandInterpretation, RasterBand, RasterDataType, RasterFacts } from './types.js'

/** `CogSource.info()`: the fields used (others ignored). */
export interface TilerInfo {
  bounds: number[]
  width: number
  height: number
  count: number
  dtype: string
  nodata: number | null
  colorinterp: string[] | null
  overviews: number
  tile_size: [number, number] | null
  band_descriptions?: string[]
  compression: string
}

/** One entry of `CogSource.levels`. */
export interface TilerLevel {
  level: number
  width: number
  height: number
  tile_width: number
  tile_height: number
  bands: number
  bits_per_sample: number
  sample_format: string
  compression: string
}

/** `CogSource.statistics()` for one band. */
export interface TilerBandStats {
  min?: number
  max?: number
  mean?: number
  std?: number
  median?: number
  percentile_2?: number
  percentile_98?: number
  histogram?: number[][] | number[]
}

/** The file's own header, read by the glue (geotiff.js): the GeoKeys, the extent in the file's system, the pixel size. */
export interface GeoHeader {
  geoKeys: Record<string, unknown>
  bbox: number[] | null
  resolution: number[] | null
}

/** The tiler draws at most this many samples in one read; a file with no overviews above it cannot be drawn zoomed out. */
export const MAX_SAMPLES_WITHOUT_OVERVIEWS = 16_777_216

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
/** GeoTIFF's "user defined" (32767) and "undefined" (0) codes are not EPSG codes. */
const epsgOf = (v: unknown): number | undefined => {
  const n = num(v)
  return n !== undefined && n > 0 && n < 32767 ? n : undefined
}

/** The coordinate system of a file from its GeoKeys: the EPSG code, the name the file gives, the units. */
export function crsFromGeoKeys(keys: Record<string, unknown>): CrsInfo {
  const projected = epsgOf(keys.ProjectedCSTypeGeoKey)
  const geographic = epsgOf(keys.GeographicTypeGeoKey)
  const code = projected ?? geographic
  const isGeographic = projected === undefined && (geographic !== undefined || num(keys.GTModelTypeGeoKey) === 2)
  let units: CrsUnits = 'other'
  if (isGeographic) units = 'degrees'
  else {
    const u = num(keys.ProjLinearUnitsGeoKey)
    // 9001 metre, 9002 international foot, 9003 US survey foot
    units = u === 9001 ? 'metres' : u === 9002 || u === 9003 ? 'feet' : 'other'
  }
  const name = isGeographic ? (str(keys.GeogCitationGeoKey) ?? str(keys.GTCitationGeoKey)) : (str(keys.PCSCitationGeoKey) ?? str(keys.GTCitationGeoKey))
  const label = code !== undefined ? `EPSG:${code}${name ? ` (${name})` : ''}` : `User-defined${name ? `: ${name}` : ' coordinate system'}`
  return { label, isWgs84: code === 4326, ...(code !== undefined ? { code } : {}), units }
}

const DATA_TYPES: Record<string, RasterDataType> = {
  uint8: 'uint8',
  int8: 'int8',
  uint16: 'uint16',
  int16: 'int16',
  uint32: 'uint32',
  int32: 'int32',
  float32: 'float32',
  float64: 'float64',
}

/** The sample type, from the tiler's `dtype`, else from the level's format and width. */
export function dataTypeOf(dtype: string | undefined, level?: Pick<TilerLevel, 'bits_per_sample' | 'sample_format'>): RasterDataType {
  const known = dtype ? DATA_TYPES[dtype.toLowerCase()] : undefined
  if (known) return known
  const bits = level?.bits_per_sample ?? 8
  const f = level?.sample_format ?? 'uint'
  if (f === 'ieeefloat') return bits === 64 ? 'float64' : 'float32'
  if (f === 'int') return bits === 8 ? 'int8' : bits === 16 ? 'int16' : 'int32'
  return bits === 16 ? 'uint16' : bits === 32 ? 'uint32' : 'uint8'
}

const INTERPRETATIONS: Record<string, BandInterpretation> = {
  gray: 'gray',
  grey: 'gray',
  red: 'red',
  green: 'green',
  blue: 'blue',
  alpha: 'alpha',
  palette: 'palette',
}

/** The bands, with the statistics when they were read (`stats` is keyed by the tiler's band names, `b1`, `b2`, ...). */
export function bandsFrom(info: Pick<TilerInfo, 'count' | 'colorinterp' | 'band_descriptions'>, stats?: Record<string, TilerBandStats> | null): RasterBand[] {
  const bands: RasterBand[] = []
  for (let i = 0; i < info.count; i++) {
    const raw = info.band_descriptions?.[i]
    // The tiler names a band without a description 'b1'; the card says 'Band 1'.
    const name = raw && !/^b\d+$/i.test(raw) ? raw : `Band ${i + 1}`
    const s = stats?.[`b${i + 1}`]
    const hist = s?.histogram
    const counts = Array.isArray(hist) ? (Array.isArray(hist[0]) ? (hist[0] as number[]) : (hist as number[])) : undefined
    bands.push({
      index: i + 1,
      name,
      interpretation: INTERPRETATIONS[(info.colorinterp?.[i] ?? '').toLowerCase()] ?? 'undefined',
      ...(num(s?.min) !== undefined ? { min: s!.min } : {}),
      ...(num(s?.max) !== undefined ? { max: s!.max } : {}),
      ...(num(s?.mean) !== undefined ? { mean: s!.mean } : {}),
      ...(num(s?.std) !== undefined ? { std: s!.std } : {}),
      ...(num(s?.median) !== undefined ? { median: s!.median } : {}),
      ...(num(s?.percentile_2) !== undefined ? { p2: s!.percentile_2 } : {}),
      ...(num(s?.percentile_98) !== undefined ? { p98: s!.percentile_98 } : {}),
      ...(counts ? { histogram: counts } : {}),
    })
  }
  return bands
}

export interface FactsInput {
  info: TilerInfo
  levels: TilerLevel[]
  mode: '3857' | 'warp'
  hasPalette: boolean
  header: GeoHeader
  stats?: Record<string, TilerBandStats> | null
  origin?: 'file' | 'converted'
  /** Extra lines for the card (a file the glue found something to say about). */
  warnings?: string[]
}

/** The facts of an opened raster. */
export function factsFromTiler(input: FactsInput): RasterFacts {
  const { info, levels, header } = input
  const level0 = levels[0]
  const extentWgs84 = info.bounds.slice(0, 4) as Bbox
  const bbox = header.bbox && header.bbox.length >= 4 && header.bbox.every(Number.isFinite) ? (header.bbox.slice(0, 4) as Bbox) : extentWgs84
  const res = header.resolution
  const pixelSize: [number, number] | null =
    res && res.length >= 2 && Number.isFinite(res[0]) && Number.isFinite(res[1]) ? [Math.abs(res[0]), Math.abs(res[1])] : info.width > 0 && info.height > 0 ? [(bbox[2] - bbox[0]) / info.width, (bbox[3] - bbox[1]) / info.height] : null
  const nodata = typeof info.nodata === 'number' ? (Number.isNaN(info.nodata) ? 'nan' : info.nodata) : null
  const overviews = Math.max(0, input.levels.length - 1)
  const warnings = [...(input.warnings ?? [])]
  if (overviews === 0 && info.width * info.height > MAX_SAMPLES_WITHOUT_OVERVIEWS) {
    warnings.push('This file has no overviews. It can only be drawn zoomed in; zoomed out needs overviews (for example gdal_translate -of COG).')
  }
  return {
    origin: input.origin ?? 'file',
    width: info.width,
    height: info.height,
    bands: bandsFrom(info, input.stats),
    dataType: dataTypeOf(info.dtype, level0),
    crs: crsFromGeoKeys(header.geoKeys),
    extent: bbox,
    extentWgs84,
    pixelSize,
    nodata,
    compression: info.compression || level0?.compression || 'Unknown',
    tiled: info.tile_size != null,
    tileSize: info.tile_size,
    overviews,
    mode: input.mode,
    hasPalette: input.hasPalette,
    warnings,
  }
}

/**
 * The `Layer` the store holds for a raster: neutral vector fields (like a PMTiles archive), the raster in `raster`.
 * Nothing reads rows from it; `capabilities` says what is shown.
 */
export function placeholderLayer(id: string, facts: RasterFacts, styleSidecar: Layer['styleSidecar'] = null): Layer {
  return {
    id,
    sourceUri: id,
    sourceFormat: 'geotiff',
    geometryType: 'Mixed',
    sourceCrs: facts.crs,
    crsAssumed: false,
    rowCount: 0,
    featureCount: 0,
    invalidGeometryCount: 0,
    truncated: false,
    totalRows: 0,
    extent: facts.extentWgs84,
    columns: [],
    source: { rows: 0, features: 0, invalid: 0 },
    styleSidecar,
    raster: facts,
  }
}

/**
 * `maxSize` for `CogSource.statistics`: the tiler takes the first level, in the file's own order, that is at most that
 * wide, else the coarsest. We want a level of up to about a million cells (hundreds of pixels wide): small enough to
 * read in a fraction of a second, large enough for percentiles that mean something. The coarsest level of a file made
 * by a converter can be 7 x 7 cells, so the size is chosen from the real levels and never fixed.
 */
export function statsMaxSize(levels: Array<Pick<TilerLevel, 'width' | 'height'>>, targetCells = 1_000_000): number {
  const sorted = [...levels].sort((a, b) => b.width * b.height - a.width * a.height)
  const pick = sorted.find((l) => l.width * l.height <= targetCells) ?? sorted[sorted.length - 1]
  return pick ? pick.width : 512
}
