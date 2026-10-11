# Contract: host delivery, VS Code command and the export dialog

## HostAdapter (CHANGED semantics, same signature)

`saveFile(name: string, content: Uint8Array | string, options?: { kind?: 'style' | 'data' }): Promise<SaveResult>`

- **Web**: unchanged (a Blob download).
- **VS Code**: binary content travels to the host in **32 MB chunks**, using
  these messages:
  - `saveFileBegin { requestId, name, totalBytes, kind }`
  - `saveFileChunk { requestId, index, bytes: Uint8Array }`
  - `saveFileEnd { requestId }`

  Text content keeps today's single `saveFile` message. The host:
  - shows the save dialog. Data exports default next to the source, with
    filters for the format's extension;
  - refuses the source document URI (FR-012) with "Choose a different file:
    this is the opened source.";
  - writes only after `saveFileEnd`, so a cancelled or failed transfer never
    creates a file;
  - replies `{ saved, location }`.

## VS Code command (FR-013)

`spatialExplorer.exportData`, titled **"Spatial Explorer: Export Data…"**,
appears in the command palette when a Spatial Explorer editor is active
(`activeCustomEditorId == spatialExplorer.editor || spatialExplorer.editorOption`).
It posts `{ type: 'openExport' }` to the active viewer. With no viewer
active, it shows the message "Open a file in Spatial Explorer to export its
data." Test hooks: `_runExport(request)` and `_getExportState`.

## Export dialog (NEW `ExportDialog.svelte`; FR-001, FR-014)

It opens from an **Export** button in the attribute table's header (the
download icon, labeled "Export data…"). In VS Code it also opens from the
command.

```
┌ EXPORT DATA ───────────────────────────────────── ✕ ┐
│ Rows    (•) All 22,000 rows   ( ) Only the 1,000 shown │   only when display-limited
│ Format  (•) GeoParquet  ( ) GeoJSON  ( ) CSV            │   radio group; table results: CSV, Parquet
│ CRS     [ EPSG:26912 (result) ▾ ]                       │   GeoJSON: "WGS84 (required by GeoJSON)", disabled
│ Geometry (CSV) (•) WKT  ( ) X / Y columns               │   X/Y only for points
│ ⓘ 3 rows have no valid geometry: written with an empty geometry.
│ ⓘ Other geometry columns are written as WKT text: centroid.
├─────────────────────────────────────────────────────────┤
│                                [Cancel]  [Export…]      │   Export… opens the save dialog / download
└─────────────────────────────────────────────────────────┘
While running:  ▓▓▓▓░░░░ 41,000 rows written · 1.2 s      [Cancel export]
Done:           ✓ Saved parcels-export.parquet: 22,000 rows (18.6 MB), plus notices
```

- It is a modal `dialog` labeled "Export data", with focus trapped while
  open.
- **Keys**: Esc closes it (or cancels a running export), Enter runs it, and
  arrows move within radio groups.
- The last choices are remembered (`export.prefs`). A remembered format that
  isn't available for this result falls back to the first available one.
- Export is disabled with a reason while a query is running or the result
  has 0 columns.
- **Chrome** uses `--se-*` tokens, so it is theme-native in all VS Code
  themes and web light/dark.
