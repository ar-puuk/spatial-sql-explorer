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
}

export interface FileSource {
  /** All bytes needed to read this layer, keyed by basename (e.g. "sample.shp", "sample.shx") — more than one entry for sidecar-based formats. */
  files: Record<string, ArrayBuffer>
  /** Which key in `files` is the primary file to hand to ST_Read/read_parquet. */
  primaryFileName: string
  totalBytes: number
}

export interface StatusFields {
  crs?: string
  featureCount?: number
  cursor?: { lon: number; lat: number } | null
}

export interface HostAdapter {
  getTheme(): ThemeKind

  /** Returns an unsubscribe function. */
  onThemeChange(cb: (theme: ThemeKind) => void): () => void

  openFiles(): Promise<OpenedFileRef[]>

  getFileSource(ref: OpenedFileRef): Promise<FileSource>

  /**
   * Saves content to a user-chosen location: VS Code shows a save dialog
   * defaulting to `name` next to the opened file; the web shell downloads it.
   * Resolves `{ saved: false }` if the user cancels.
   */
  saveFile(name: string, content: Uint8Array | string): Promise<SaveResult>

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
}

export interface SaveResult {
  saved: boolean
  /** Display location for confirmation messages (a file name or path). */
  location?: string
}
