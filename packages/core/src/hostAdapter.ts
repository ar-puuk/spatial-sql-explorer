// HostAdapter — the only way packages/core and packages/ui touch the host
// platform (Constitution Principle II). See
// specs/001-quick-look/contracts/host-adapter.md for the full contract.

export type ThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'

/** Light or dark, for choices that only have two variants (e.g. the default basemap). */
export function themeAppearance(theme: ThemeKind): 'light' | 'dark' {
  return theme === 'dark' || theme === 'high-contrast' ? 'dark' : 'light'
}

export interface OpenedFileRef {
  /** Opaque to packages/core and packages/ui — never a raw filesystem path or File object. */
  id: string
  /** Display name only (e.g. for error messages); not a path to read from directly. */
  displayName: string
  /**
   * Stable identity for per-file persisted state, e.g. query history (spec
   * 002). The same value is returned when the same file is opened again later.
   * Opaque: used only as part of a state key, never read as a path.
   */
  stateKey: string
}

/** The QGIS-convention style file found next to the data (`<basename>.qml`), as text (spec 003). */
export interface StyleSidecarText {
  fileName: string
  text: string
}

/**
 * How a shell hands the opened file to core (spec 007, data-model.md). Core
 * passes `handle` and `url` straight to the engine, which reads them in parts
 * (research §2–§3); only `bytes` is ever held in memory whole.
 * - `handle`: web. An opaque File handle; core never calls the File API on it.
 * - `url`: VS Code. The extension host's loopback range server.
 * - `bytes`: the whole file (VS Code fallback, FlatGeobuf "load for queries").
 * Sidecars are the primary's same-basename data files (Shapefile .dbf/.shx/.prj/.cpg).
 */
export type FileSource =
  | { kind: 'handle'; name: string; size: number; handle: unknown; sidecars: Array<{ name: string; handle: unknown }>; styleSidecar: StyleSidecarText | null }
  | { kind: 'url'; name: string; size: number; url: string; sidecars: Array<{ name: string; url: string }>; styleSidecar: StyleSidecarText | null }
  | {
      kind: 'bytes'
      name: string
      size: number
      bytes: Uint8Array
      sidecars: Array<{ name: string; bytes: Uint8Array }>
      styleSidecar: StyleSidecarText | null
      /** Set when the shell fell back to a whole transfer because partial reads failed (FR-015). */
      fallbackReason?: string
    }

export interface StatusFields {
  crs?: string
  featureCount?: number
  /** Spec 007: `rows` when invalid geometry isn't known yet (large files read in parts), so the count never over-claims. */
  countLabel?: 'features' | 'rows'
  cursor?: { lon: number; lat: number } | null
}

export interface HostAdapter {
  getTheme(): ThemeKind

  /** Returns an unsubscribe function. */
  onThemeChange(cb: (theme: ThemeKind) => void): () => void

  openFiles(): Promise<OpenedFileRef[]>

  /**
   * The opened file for the engine (spec 007). `whole: true` asks for the
   * bytes (FlatGeobuf "load for queries"); otherwise shells return a handle
   * or a URL the engine reads in parts.
   */
  getFileSource(ref: OpenedFileRef, options?: { whole?: boolean }): Promise<FileSource>

  /** Bytes [offset, offset + length) of the opened file, without reading the rest (PMTiles, spec 007). */
  readRange(ref: OpenedFileRef, offset: number, length: number): Promise<Uint8Array>

  /**
   * Saves content to a user-chosen location: VS Code shows a save dialog
   * defaulting to `name` next to the opened file; the web shell downloads it.
   * Resolves `{ saved: false }` if the user cancels.
   */
  saveFile(name: string, content: Uint8Array | string, options?: SaveOptions): Promise<SaveResult>

  /**
   * Writes `name` directly next to the opened data file (the QGIS style
   * sidecar convention), asking before overwriting an existing file. Only
   * hosts with filesystem access implement it — the web shell cannot write
   * next to a picked file, so UI falls back to `saveFile` (a download).
   */
  saveSidecar?(name: string, content: string): Promise<SaveResult>

  /** Lets the user pick one text file (e.g. a style to import). Resolves null if cancelled. */
  pickTextFile(options: { title: string; extensions: readonly string[] }): Promise<{ name: string; text: string } | null>

  setStatus(fields: StatusFields): void

  /**
   * Small user preferences that must survive closing the viewer (e.g. the
   * blank basemap color). VS Code: the extension's globalState, so a choice
   * applies to every file and window. Web: localStorage. Never IndexedDB
   * inside the webview (CLAUDE.md). Values must be JSON-serializable.
   */
  loadState<T>(key: string): Promise<T | undefined>
  saveState(key: string, value: unknown): Promise<void>

  /**
   * Fires when the opened file changes on disk (spec.md edge case: stale data
   * must not be presented as current without an indication). Optional: only
   * hosts that can watch files implement it (VS Code). Returns unsubscribe.
   */
  onSourceChanged?(cb: () => void): () => void

  /** Re-opens the current file from disk. Paired with onSourceChanged. */
  reloadSource?(): void

  /**
   * One line of diagnostic output: query text, outcome, timing (spec 002,
   * FR-010). VS Code writes it to the "Spatial Explorer" output channel;
   * hosts without one omit it. Never carries file contents.
   */
  log?(line: string): void

  /**
   * A user setting the host owns (spec 008). VS Code: the
   * `spatialExplorer.placeSearch.enabled` setting. Hosts without settings
   * omit it, and callers treat `undefined` as the default (enabled).
   */
  getPreference?(key: 'placeSearch.enabled'): boolean | undefined

  /** Spec 008: called when a `getPreference` value changes (VS Code: the setting was edited). */
  onPreferenceChange?(cb: () => void): () => void
}

/** Spec 005: data exports may be large and binary; hosts pick a dialog default and filters by kind. */
export interface SaveOptions {
  /** Spec 008: `image` is a map PNG (VS Code: a PNG save dialog; web: a download). */
  kind?: 'style' | 'data' | 'image'
}

export interface SaveResult {
  saved: boolean
  /** Display location for confirmation messages (a file name or path). */
  location?: string
}
