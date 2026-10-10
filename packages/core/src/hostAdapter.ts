// HostAdapter — the only way packages/core and packages/ui touch the host
// platform (Constitution Principle II). See
// specs/001-quick-look/contracts/host-adapter.md for the full contract.

export type ThemeKind = 'light' | 'dark' | 'high-contrast'

export interface OpenedFileRef {
  /** Opaque to packages/core and packages/ui — never a raw filesystem path or File object. */
  id: string
  /** Display name only (e.g. for error messages); not a path to read from directly. */
  displayName: string
}

export interface FileSource {
  bytes: ArrayBuffer
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

  saveFile(name: string, content: Uint8Array | string): Promise<void>

  setStatus(fields: StatusFields): void
}
