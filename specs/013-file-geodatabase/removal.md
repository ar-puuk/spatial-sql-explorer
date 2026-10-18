# Removing the geodatabase workaround

File Geodatabase support is **experimental** (user decision 2026-10-18). It exists only because the SQL engine
(DuckDB-WASM's spatial extension) has no OpenFileGDB driver. When the engine reads a `.gdb` itself, this
workaround is deleted and the open path reads the folder like any other multi-layer file
(`ST_Read('x.gdb', layer=…)`).

The workaround is kept apart so that removal is deleting files plus a few marked lines. Everything is tagged
"Spec 013" in comments; `grep -rn "Spec 013\|spec 013"` finds the lines.

## Delete whole files and folders

| What | Path |
| --- | --- |
| Core reader logic (catalog, domains, GDAL calls, open, glue to `openFile`) | `packages/core/src/gdb/` |
| Web reader (worker, host, protocol) | `apps/web/src/gdb/` |
| VS Code reader (child process and its worker) | `apps/vscode-ext/src/gdbReader.ts`, `gdbWorker.ts` |
| CRS question | `packages/ui/src/GdbCrsDialog.svelte` |
| Fixtures and generators | `scripts/fixtures-013.mjs`, `scripts/fixtures-013.py`, the `*.gdb`, `*.gdb.zip` files in `tests/vscode-ext/fixtures/` |
| Tests | `tests/core/gdb.test.ts`, `tests/web/specs/gdb-013*.spec.ts`, `tests/core/fixtures/gdb-ogrinfo-*.json`, the geodatabase cases in `tests/vscode-ext/src/suite/layers.test.ts` |

## Delete the marked lines

- `packages/core/src/openFile.ts`: the `isFileGeodatabase` and `contents.kind === 'gdb'` branches, `gdb` in
  `openFileOnce` (the `gdb ?` conditions, `refetchWhole`, the `experimental` and `columnDomains` facts), and the
  imports from `./gdb/`.
- `packages/core/src/query/session.ts`: `LazyLayers`, `setLazyLayers`, `prepareLazyLayers`, `adoptPaths` and the
  call in `run` (the placeholder-view mechanism is only used by geodatabases).
- `packages/core/src/hostAdapter.ts`: `gdb?: GdbHost`. `packages/core/src/index.ts`: `export * from './gdb/index.js'`.
- `packages/core/src/engineAssets.ts`, `engineAssets.json`, `scripts/engine-assets.mjs`: the `gdal` block (gdal3.js,
  about 40 MB, its mirror, and its entries in `engineHashes()`). Rerun `scripts/engine-assets.mjs`.
- `packages/core/src/source/layers.ts`: `isFileGeodatabase`. `source/zip.ts`: the `gdb` kind of `inspectZip`,
  `gdbFolderOf`, `listZipNames` (zips of ordinary data stay).
- `packages/core/src/models.ts`: `experimental` on the facts and the `group` on layers.
- Web: `apps/web/src/hostAdapter.ts` (`pickFolder`, the `.gdb` handling in `provideFiles`), `dropFiles.ts` (folder
  drops), `App.svelte` ("Open geodatabase", stored layers), `Landing.svelte` ("Choose a geodatabase folder").
- VS Code: `extension.ts` (the `.gdb` folder command, cache commands), `webview/hostAdapter.ts`, `package.json`
  (`spatialExplorer.gdb.cacheLimitMB`, `clearGdbCache`, the `*.gdbtable` editor, the folder menu entry),
  `esbuild.js` and `tsconfig.json` (the worker bundle, `geojson` types if nothing else needs them).
- UI: the `LayerPicker` experimental badge, `OpenProgress` converting note, `ReadWholeDialog` "geodatabase" label,
  the `crsPrompt`, `chooseCrs` and `datasetPrompt`-free parts of `viewerStore.svelte.ts` and `ViewerLayout.svelte`.

## Keep (useful on their own)

- Zipped data (`source/zip.ts`, `ZipChoiceDialog`, `OpenHooks.chooseDataset`): the engine cannot read inside zips
  either. Check it again at the same time; if it can, remove this too.
- Domain display (`Layer.columnDomains`, `describeCode`, the table, card, tooltip and filter display, the toolbar
  switch, `domainDisplay`): nothing here is specific to the geodatabase reader. Its only source today is the reader,
  so keep it if the native driver exposes domains, otherwise delete it with the rest.
- The grouped layer picker.

## Check first

1. DuckDB-WASM's spatial extension lists `OpenFileGDB` in `ST_Drivers()`, and reads the sample
   (`SE_GDB_SAMPLE`) through `ST_Read`, including from a picked folder (it must be mounted as a directory) and from
   a handle.
2. Domains, 64-bit ObjectIDs and compressed geodatabases still behave as documented in `spec.md`.
3. Update `CLAUDE.md`, the constitution (the gdal3.js allowance, v1.5.0), `THIRD-PARTY-NOTICES.md`, the READMEs and
   the changelog in the same change.
