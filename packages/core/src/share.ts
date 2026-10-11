// Spec 008 US7 (FR-031, research §13, data-model.md ShareState): the web
// app's share link. `#v1=` + base64url(deflate(JSON)) of what the user
// set up: the query, the style, the basemap, the projection and the view,
// with the file's name and size so the receiver can pick the same file.
// Never rows, column values outside the query and style, or file paths.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { BASEMAP_CATALOG } from './basemapCatalog.js'
import { sanitizeStyle, type LayerStyle } from './style/model.js'

export interface ShareState {
  v: 1
  source: { kind: 'file'; name: string; size: number } | { kind: 'sample' }
  /** The layer of a multi-layer file. */
  layer?: string
  query: string
  style?: LayerStyle
  /** A basemap catalog id. */
  basemap: string
  projection: 'mercator' | 'globe'
  view: { center: [number, number]; zoom: number; pitch: number; bearing: number }
}

/** Longer links are refused; the app offers "Copy query" instead (spec edge case). */
export const SHARE_MAX_LENGTH = 8000
const PREFIX = 'v1='

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** `v1=…`, to put after `#`. */
export function encodeShareState(s: ShareState): string {
  const plain: ShareState = {
    v: 1,
    source: s.source.kind === 'sample' ? { kind: 'sample' } : { kind: 'file', name: s.source.name, size: s.source.size },
    ...(s.layer ? { layer: s.layer } : {}),
    query: s.query,
    ...(s.style ? { style: s.style } : {}),
    basemap: s.basemap,
    projection: s.projection,
    view: s.view,
  }
  return PREFIX + toBase64Url(deflateSync(strToU8(JSON.stringify(plain)), { level: 9 }))
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * Reads `#v1=…` (with or without `#`). Every field is checked: invalid ones
 * are dropped and named in `dropped`. Null when it isn't a share link at all.
 */
export function decodeShareState(hash: string): { state: Partial<ShareState>; dropped: string[] } | null {
  const text = hash.replace(/^#/, '')
  if (!text.startsWith(PREFIX)) return null
  let raw: unknown
  try {
    raw = JSON.parse(strFromU8(inflateSync(fromBase64Url(text.slice(PREFIX.length)))))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return null
  const r = raw as Record<string, unknown>
  const state: Partial<ShareState> = { v: 1 }
  const dropped: string[] = []

  const src = r.source as Record<string, unknown> | undefined
  if (src?.kind === 'sample') state.source = { kind: 'sample' }
  else if (src?.kind === 'file' && typeof src.name === 'string' && src.name && !/[\\/]/.test(src.name) && finite(src.size) && src.size >= 0) {
    state.source = { kind: 'file', name: src.name, size: src.size }
  } else dropped.push('file')

  if (r.layer !== undefined) {
    if (typeof r.layer === 'string' && r.layer) state.layer = r.layer
    else dropped.push('layer')
  }
  if (typeof r.query === 'string') state.query = r.query
  else dropped.push('query')
  if (r.style !== undefined) {
    if (r.style && typeof r.style === 'object') state.style = sanitizeStyle(r.style as Partial<LayerStyle>)
    else dropped.push('style')
  }
  if (typeof r.basemap === 'string' && BASEMAP_CATALOG.some((b) => b.id === r.basemap)) state.basemap = r.basemap
  else if (r.basemap !== undefined) dropped.push('basemap')
  if (r.projection === 'mercator' || r.projection === 'globe') state.projection = r.projection
  else if (r.projection !== undefined) dropped.push('projection')

  const v = r.view as Record<string, unknown> | undefined
  const c = v?.center as unknown[] | undefined
  if (
    v &&
    Array.isArray(c) &&
    c.length === 2 &&
    finite(c[0]) &&
    finite(c[1]) &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90 &&
    finite(v.zoom) &&
    v.zoom >= 0 &&
    v.zoom <= 24 &&
    finite(v.pitch) &&
    v.pitch >= 0 &&
    v.pitch <= 85 &&
    finite(v.bearing)
  ) {
    state.view = { center: [c[0], c[1]], zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }
  } else if (v !== undefined) dropped.push('view')
  return { state, dropped }
}
