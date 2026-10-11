// Basemap selection + style loading (User Story 4, FR-009/FR-016/FR-017).
// Pure logic with an injectable fetch, so failure handling is unit-tested
// (tests/core/basemap.test.ts) without a browser or network.
import { BASEMAP_CATALOG, getDefaultBasemap, type BasemapCatalogEntry } from './basemapCatalog.js'

/** `'auto'` follows the host theme (FR-017); anything else is a catalog id. */
export type BasemapChoice = 'auto' | string

export function resolveBasemap(choice: BasemapChoice, appearance: 'light' | 'dark'): BasemapCatalogEntry {
  if (choice === 'auto') return getDefaultBasemap(appearance)
  return BASEMAP_CATALOG.find((e) => e.id === choice) ?? getDefaultBasemap(appearance)
}

/** A loaded MapLibre style document (style spec v8), kept opaque here. */
export interface BasemapStyle {
  version: 8
  sources: Record<string, unknown>
  layers: Array<{ id: string; type: string; [k: string]: unknown }>
  [k: string]: unknown
}

export type BasemapLoadResult =
  | { ok: true; entry: BasemapCatalogEntry; style: BasemapStyle | null }
  | { ok: false; entry: BasemapCatalogEntry; message: string }

export const BASEMAP_TIMEOUT_MS = 8000

/** The FR-016 message: short, visible, and says what the user now sees. */
export function basemapFailureMessage(entry: BasemapCatalogEntry, reason: string): string {
  return `${entry.name} basemap unavailable (${reason}). Showing a blank background.`
}

/**
 * Fetches a vector basemap's style document. Never throws: offline, blocked
 * (CSP), slow, missing or malformed styles all become `{ ok: false }` with
 * a short message, and the caller falls back to blank (FR-016). The data
 * layer never depends on this succeeding.
 */
export async function loadBasemapStyle(
  entry: BasemapCatalogEntry,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = BASEMAP_TIMEOUT_MS
): Promise<BasemapLoadResult> {
  if (entry.type === 'blank') return { ok: true, entry, style: null }
  if (entry.type !== 'vector') return { ok: false, entry, message: basemapFailureMessage(entry, 'unsupported basemap type') }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    try {
      response = await fetchImpl(entry.url, { signal: controller.signal })
    } catch {
      return { ok: false, entry, message: basemapFailureMessage(entry, controller.signal.aborted ? 'timed out' : 'offline or blocked') }
    }
    if (!response.ok) return { ok: false, entry, message: basemapFailureMessage(entry, `HTTP ${response.status}`) }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { ok: false, entry, message: basemapFailureMessage(entry, 'invalid style') }
    }
    const style = json as Partial<BasemapStyle>
    if (style?.version !== 8 || typeof style.sources !== 'object' || !Array.isArray(style.layers)) {
      return { ok: false, entry, message: basemapFailureMessage(entry, 'invalid style') }
    }
    return { ok: true, entry, style: style as BasemapStyle }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tile-level failure detection after a style loaded: the style document can
 * arrive while its tiles are blocked (CSP connect-src, a captive portal).
 * Falls back once enough tile/sprite/glyph requests have failed with none
 * succeeding, so a single flaky tile never blanks a working basemap.
 */
export class BasemapHealth {
  private failures = 0
  private successes = 0
  constructor(private readonly threshold = 4) {}
  recordSuccess(): void {
    this.successes++
  }
  /** Returns true when the basemap should be abandoned. */
  recordFailure(): boolean {
    this.failures++
    return this.successes === 0 && this.failures >= this.threshold
  }
}


