# Contract: HostAdapter

`packages/core` and `packages/ui` depend only on this interface for platform
access (Constitution Principle II). Scope here is limited to what spec 001
needs; `saveFile`, full `loadState`/`saveState` persistence semantics, and
`setStatus` detail are sketched for forward-compatibility with specs 002–006
but not exercised by spec 001's acceptance scenarios.

```ts
export interface HostAdapter {
  /** Current host theme kind, read once at startup. */
  getTheme(): 'light' | 'dark' | 'high-contrast';

  /** Fires whenever the host's theme changes while the viewer is open (FR-017). */
  onThemeChange(cb: (theme: 'light' | 'dark' | 'high-contrast') => void): () => void; // returns unsubscribe

  /**
   * Resolves the file(s) the user wants to open.
   *   - VS Code implementation: resolves immediately from the CustomDocument URI
   *     the extension host already received from VS Code's Open-With / default-editor flow.
   *   - Web implementation: resolves from a file-picker or drag-and-drop event.
   */
  openFiles(): Promise<OpenedFileRef[]>;

  /**
   * Returns the file's bytes for parsing. Spec 001 targets small files (~10MB,
   * per the clarified size target) loaded whole; the return shape leaves room
   * for a future range-capable source (research.md §2) without a breaking
   * change — callers in this spec always consume the whole `ArrayBuffer`.
   */
  getFileSource(ref: OpenedFileRef): Promise<{ bytes: ArrayBuffer; totalBytes: number }>;

  /** No-op on the web shell for spec 001 (styling/export persistence lands in specs 003/005). */
  saveFile(name: string, content: Uint8Array | string): Promise<void>;

  /** Status bar item content (VS Code) / no-op (web) — CRS, feature count, cursor coordinates (FR-006, FR-008). */
  setStatus(fields: { crs?: string; featureCount?: number; cursor?: { lon: number; lat: number } | null }): void;
}

export interface OpenedFileRef {
  /** Opaque to packages/core and packages/ui — never a raw filesystem path or File object. */
  id: string;
  /** Display name only (e.g. for error messages); not a path to read from directly. */
  displayName: string;
}
```

## Implementations

- **VS Code** (`apps/vscode-ext`): `getFileSource` reads via
  `vscode.workspace.fs.readFile` in the extension host and transfers bytes to
  the webview over the host↔webview message protocol (see
  `host-webview-protocol.md`) — it does NOT expose `vscode.workspace.fs`
  directly to `packages/core`.
- **Web** (`apps/web`): `getFileSource` reads via the File/Blob API from a
  picker or drop event, directly in the browser context — no message-passing
  boundary to cross.

## Constitution compliance

- `packages/core`/`packages/ui` import only this interface's types — never
  `vscode`, `acquireVsCodeApi`, the File API, or IndexedDB (Principle II).
  Enforced by lint rule (see Phase 2 task to add it).
- `getFileSource`'s `ArrayBuffer`-based return shape is intentionally
  transport-agnostic: the VS Code implementation's internal choice of binary
  vs. base64-chunked transfer (research.md §2) is entirely hidden behind this
  method and can change without affecting `packages/core`/`packages/ui`.
