// File Geodatabase (spec 013): what a shell's reader tells the core. The SQL
// engine cannot read a geodatabase (research §1), so each shell lists its
// layers and converts the chosen one to a FlatGeobuf the normal pipeline opens
// (gdal3.js: the extension host in VS Code, a worker on the web).
import type { FileSource, OpenedFileRef } from '../hostAdapter.js'
import type { FileLayer } from '../source/layers.js'

export interface GdbField {
  name: string
  /** OGR's type name: Integer, Integer64, Real, String, Date, DateTime, ... */
  type: string
  /** The geodatabase domain this column is restricted to, if any. */
  domain: string | null
}

export interface GdbLayerInfo extends FileLayer {
  /** The feature dataset (a folder in ArcGIS) holding the layer; null for a standalone table or feature class. */
  featureDataset: string | null
  /** False for an attribute-only table. */
  spatial: boolean
  fields: GdbField[]
  /** The CRS as WKT, for layers without an EPSG code. */
  crsWkt: string | null
}

/** A geodatabase domain: a coded list (code to description) or a range. */
export interface GdbDomain {
  name: string
  kind: 'coded' | 'range' | 'other'
  fieldType: string
  description: string
  /** Coded domains: code to description. */
  codes: Record<string, string>
}

export interface GdbCatalog {
  /** The geodatabase's own name, e.g. `network.gdb`. */
  name: string
  layers: GdbLayerInfo[]
  domains: Record<string, GdbDomain>
}

/** Column name to (code to description), for the coded domains of one layer. */
export type ColumnDomains = Record<string, Record<string, string>>

/** A converted layer: the FlatGeobuf to open, and what the layer's domains say. */
export interface GdbConverted {
  source: FileSource
  domains: ColumnDomains
}

export type GdbProgress =
  | { phase: 'download'; file: string; loaded: number; total: number }
  | { phase: 'list' }
  | { phase: 'copy'; layer: string }
  | { phase: 'convert'; layer: string }
  | { phase: 'cache'; layer: string }

export interface GdbCallOptions {
  /** The converted layer as bytes in memory, not a file to read in parts (FlatGeobuf "load for queries"). */
  whole?: boolean
  signal?: AbortSignal
  onProgress?: (step: GdbProgress) => void
}

/**
 * What a shell provides to open File Geodatabases (and zips of them). The
 * reader lives in the shell: it needs files only the shell can reach.
 */
export interface GdbHost {
  /** The layers and domains of a geodatabase, without reading any layer. */
  list(ref: OpenedFileRef, options?: GdbCallOptions): Promise<GdbCatalog>
  /** Reads one layer into a cached FlatGeobuf (once; later calls return the cache) and returns it with the layer's domains. */
  convert(ref: OpenedFileRef, layer: GdbLayerInfo, options?: GdbCallOptions): Promise<GdbConverted>
  /** Deletes every converted layer; resolves with what was removed. */
  clearCache?(): Promise<{ files: number; bytes: number }>
}

/** A geodatabase that cannot be read, with what to do about it. */
export class GdbError extends Error {
  constructor(
    message: string,
    readonly code: 'compressed' | 'oid64' | 'no-crs' | 'too-large' | 'unreadable' | 'offline' | 'cancelled' = 'unreadable'
  ) {
    super(message)
    this.name = 'GdbError'
  }
}
