// Spec 026 data model (specs/026-raster-view/data-model.md). Pure types and constants.
import type { Bbox, CrsInfo } from '../models.js'

import type { RasterDisplay } from './display.js'
import type { RasterRelief } from './relief.js'

export type RasterDataType = 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32' | 'float64'

export type BandInterpretation = 'gray' | 'red' | 'green' | 'blue' | 'alpha' | 'palette' | 'undefined'

/** One band of the file. Statistics are estimates from a reduced-resolution level (see `stats`). */
export interface RasterBand {
  /** 1-based, as the tiler and QGIS number them. */
  index: number
  /** The file's name for the band, else 'Band N'. */
  name: string
  interpretation?: BandInterpretation
  min?: number
  max?: number
  mean?: number
  std?: number
  median?: number
  /** 2nd and 98th percentile: the default stretch. */
  p2?: number
  p98?: number
  /** Counts per equal-width bin from `min` to `max`. */
  histogram?: number[]
}

/** One class of a colour table raster: the cell value and its colour. */
export interface RasterPaletteEntry {
  value: number
  /** `#rrggbb` */
  color: string
}

/** What the file is: read once when it opens, never edited. */
export interface RasterFacts {
  /** `converted`: a striped GeoTIFF turned into a COG in memory (the card says so). */
  origin: 'file' | 'converted'
  width: number
  height: number
  bands: RasterBand[]
  dataType: RasterDataType
  /** A converted file (striped, prepared in memory) is held as 32-bit floating point; this is what the file itself holds, when that differs. */
  originalDataType?: RasterDataType
  /** The file's own system; `code` and `units` are set when known. */
  crs: CrsInfo
  /** In the file's CRS. */
  extent: Bbox
  /** WGS84, as the map uses it. */
  extentWgs84: Bbox
  /** [x, y] in CRS units, both positive. */
  pixelSize: [number, number] | null
  /** NaN is the string 'nan' so the value survives JSON. */
  nodata: number | 'nan' | null
  compression: string
  tiled: boolean
  tileSize: [number, number] | null
  /** Reduced-resolution levels the file has (not counting the full-size one). */
  overviews: number
  /** How the tiler draws it: the Web Mercator fast path, or warped from the file's system. */
  mode: '3857' | 'warp'
  /** A colour table (classes). */
  hasPalette: boolean
  /** The classes of a colour table, from the lowest to the highest value in the band (at most 256). */
  palette?: RasterPaletteEntry[]
  /** Said in the card: no overviews, a file too big to draw zoomed out, parts of the file ignored. */
  warnings: string[]
}

export type RasterMode = 'single' | 'rgb' | 'paletted'
export type RasterStretch = 'linear' | 'sqrt' | 'log'
export type NodataTreatment = { mode: 'file' } | { mode: 'none' } | { mode: 'value'; value: number }

/** How the raster is drawn: remembered per file (the `.qml` sidecar, or saved state). */
export interface RasterStyle {
  mode: RasterMode
  /** 1-based band numbers: one for `single` and `paletted`, three (red, green, blue) for `rgb`. */
  bands: number[]
  /** The range the colors run between (`single`; `rgb` uses `rescale` when set). */
  min: number
  max: number
  /** One [min, max] per band of an `rgb` style; overrides `min` and `max`. */
  rescale?: [number, number][]
  stretch: RasterStretch
  /** 1 = off. */
  gamma: number
  /** A name from the tiler's list (`RASTER_COLORMAPS`). */
  colormap: string
  reversed: boolean
  nodata: NodataTreatment
  /** 0 to 1, drawn as the map layer's opacity. */
  opacity: number
  /** Spec 027: picture adjustments and resampling, applied by the graphics card; absent means neutral. */
  display?: RasterDisplay
  /** Spec 027: shaded relief drawn from one band of heights; absent means none. */
  relief?: RasterRelief
}

/** The value of each band at one place. `value: null` is no data. */
export interface PixelReading {
  lon: number
  lat: number
  /** True when the place is off the raster (nothing to show). */
  outside: boolean
  values: Array<{ band: number; name: string; value: number | null }>
  /** A colour table raster: the class name when the file gives one. */
  classLabel?: string
}
