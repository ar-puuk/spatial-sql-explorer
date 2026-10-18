// Spec 013: the messages between the web app and its geodatabase worker.
import type { GdbCatalog, GdbProgress } from '@spatial-explorer/core'

/** The geodatabase's files as the browser picked them (a folder's files, or the one zip). */
export interface GdbFiles {
  kind: 'folder' | 'zip'
  files: File[]
  /** The geodatabase's folder name inside a zip (`net.gdb`), or null. */
  zipFolder: string | null
  /** `network.gdb` */
  name: string
}

export type ToWorker =
  | { op: 'init'; id: number; glue: string; wasm: ArrayBuffer; data: ArrayBuffer }
  | { op: 'list'; id: number; source: GdbFiles; key: string }
  | { op: 'convert'; id: number; source: GdbFiles; key: string; layer: { name: string; spatial: boolean }; file: string }

export type FromWorker =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string; code: string }
  | { id: number; progress: GdbProgress }

export type ListResult = GdbCatalog
export interface ConvertResult {
  /** The converted file's name inside the OPFS folder `gdb-cache/<key>/`. */
  file: string
}

/** OPFS: where converted layers live. */
export const CACHE_DIR = 'gdb-cache'
