// Spec 026: the raster tiler (cog-tiler-wasm) and the striped-file converter (geolibre-wasm) run in a worker, so the page never
// waits on them: measured at 6x CPU, a tile took 190 to 240 ms and a style change held the main thread for up to 500 ms; the
// conversion of a big striped file holds it for 17 s. The main thread sends small requests and gets finished results back.
// This file is the messages, shared by the worker (tilerWorker.ts) and the client (tilerClient.ts).
import type { RasterRenderOptions, TilerBandStats, TilerInfo, TilerLevel } from '@spatial-explorer/core'

/** Something the tiler can read: a URL (HTTP ranges), a `File` or `Blob` (slices), or bytes. */
export type CogInput = string | File | Blob | Uint8Array

/** What the page needs to know of an opened raster; the reader itself stays in the worker, named by `handle`. */
export interface OpenedCog {
  handle: number
  info: TilerInfo
  levels: TilerLevel[]
  mode: '3857' | 'warp'
  hasPalette: boolean
}

/** A striped file made into a COG in the worker and opened there. */
export interface ConvertedCog extends OpenedCog {
  /** The sample type the original had ('uint8' stays; anything else became float32). */
  sourceType: string
  hadPalette: boolean
}

/** The colormaps sampled from the tiler itself, low to high, as `#rrggbb` (reversed is these turned round). */
export type ColormapTable = Record<string, { s16: string[]; s32: string[] }>

export interface StripedInfo {
  width: number
  height: number
  bands: number
  bitsPerSample: number
  sampleFormat: number
  palette: boolean
}

export type ToWorker =
  | { id: number; type: 'init'; whitebox: ArrayBuffer; cogTiler: ArrayBuffer }
  | { id: number; type: 'initConverter'; wasm: ArrayBuffer }
  | { id: number; type: 'open'; handle: number; source: CogInput }
  | { id: number; type: 'convert'; handle: number; source: Exclude<CogInput, Uint8Array>; striped: StripedInfo }
  | { id: number; type: 'statistics'; handle: number; maxSize: number }
  | { id: number; type: 'point'; handle: number; lon: number; lat: number }
  | { id: number; type: 'profile'; handle: number; /** lon0, lat0, lon1, lat1, … */ points: Float64Array; bands: number[] }
  | { id: number; type: 'tile'; handle: number; z: number; x: number; y: number; options: RasterRenderOptions }
  | { id: number; type: 'close'; handle: number }

/** A reply to request `id`: `note` messages come first for a long one (converting), then one `ok` or `error`. */
export type FromWorker =
  | { id: number; kind: 'ok'; result: unknown }
  | { id: number; kind: 'error'; message: string; code?: string }
  | { id: number; kind: 'note'; text: string }

export interface PointAnswer {
  coordinates: [number, number]
  values: number[]
  band_names: string[]
  outside?: boolean
}

export type StatisticsAnswer = Record<string, TilerBandStats>
