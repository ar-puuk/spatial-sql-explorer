# Contract delta: HostAdapter (spec 002)

These are additions to `specs/001-quick-look/contracts/host-adapter.md`.
Nothing is removed or renamed.

```ts
export interface OpenedFileRef {
  id: string
  displayName: string
  /**
   * NEW. A stable identity for per-file persisted state (query history). Must
   * be the same when the same file is opened again later.
   *   VS Code: the document URI string.
   *   Web: `${name}|${size}|${lastModified}` (no path is available).
   * Opaque to core/ui: used only as part of a state key.
   */
  stateKey: string
}

export interface HostAdapter {
  // …spec 001 members unchanged (getTheme, onThemeChange, openFiles,
  //   getFileSource, saveFile, saveSidecar?, pickTextFile, setStatus,
  //   loadState, saveState, onSourceChanged?, reloadSource?)

  /**
   * NEW, optional. One line of diagnostic output (query text, outcome,
   * timing). VS Code writes it to the "Spatial Explorer" output channel; the
   * web shell omits it. Never carries file contents.
   */
  log?(line: string): void
}
```

**Persisted keys** (through `loadState`/`saveState`):

| Key | Value | Spec |
|---|---|---|
| `history.<stateKey>` | `QueryHistoryEntry[]` (≤ 20) | FR-016 |
| `basemap.blankColor` | `string \| null` | spec 001 (unchanged) |
