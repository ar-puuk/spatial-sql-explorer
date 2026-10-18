# Plan: File Geodatabase (.gdb) and zipped data

Spec: `spec.md`. Evidence: `research.md` §3, §8, §9 (spikes in `spikes/`).

## Approach

gdal3.js (GDAL 3.8.4, WebAssembly, LGPL-2.1+) reads the geodatabase and writes **FlatGeobuf** (it has no Parquet writer). The FlatGeobuf then goes through the existing FGB pipeline, so map, table, SQL, styles and export need no new code. The SQL engine cannot read geodatabases or zips (spikes), so reading is a separate module with one interface in core and two hosts.

```
core/src/gdb/
  reader.ts        GdbReader interface: list(source) -> GdbLayerInfo[]; convert(source, layer, onProgress, signal) -> {fgb: FileSource, domains}
  catalog.ts       types: layers (name, geometry, count, crs, featureDataset, spatial), domains
  domains.ts       DomainMap, describe(column, value), pure
  zip.ts           listZip(bytes|File) -> entries; pickDataset(entries) -> kind; unzipTo(source) (fflate)
  assets          gdal3.js entries in engineAssets.json (url + sha256), scripts/engine-assets.mjs
apps/vscode-ext/src/gdb/
  nodeReader.ts    gdal3.js in the extension host (Node, NODEFS), cache in globalStorage
apps/web / packages/ui
  gdbWorker.ts     Web Worker: gdal3.js with useWorker:false, WORKERFS, copy-to-memory, OPFS output
```

### The two readers (behind one interface)

- **VS Code (extension host, Node)**: `Gdal.open(<folder>)` with NODEFS (lazy reads, 87-160 ms to list); convert with output mounted on a NODEFS cache directory so memory stays low (spike: 4M parcels in 34 s, 500 MB). A `.gdb.zip` opens by path. Works over Remote-SSH, WSL and containers because it runs where the files are. The webview asks the host through the existing message channel; the cache file is then handed to the webview like any file (a range-readable URL).
- **Web (worker)**: our own worker (not gdal3.js's); mount the picked files with `WORKERFS` at `/input/<name>.gdb`; list through `ogrinfo -json`; to convert, look up the layer's file number in `GDB_SystemCatalog` (row id = `a<8 hex>`), copy the layer's files and all files under 2 MB into `/output/<name>.gdb` in memory, convert (25x faster than reading the picked files directly), write the FlatGeobuf to OPFS. A `.gdb.zip` is mounted as one file with the `vsizip` handler. Memory ceiling stated in the spec.

### Listing and naming

`ogrinfo -json -so -al` gives layers, geometry types, extents, CRS WKT, fields, `domainName`, domains. System tables (`GDB_*`) are dropped; non-spatial tables are kept (convert with `-lco SPATIAL_INDEX=NO`). Feature datasets (`rootGroup`/layer groups) become picker groups only. SQL names reuse `source/layers.ts` (the file is a schema, each layer a view). A view over an unconverted layer cannot convert itself: the existing "others read only when a query uses them" scan converts a named layer before the query runs, then points the view at the cached FlatGeobuf.

### Domains

`domains.json` is stored beside each converted layer: `{ column: { code: description } }` for coded domains only. A pure `describe()` is applied at display: the table cell renderer, the hover tooltip, the feature card, the column-filter value list (label shown, code filtered). A table-header switch "Show domain descriptions / codes" is a remembered global preference (`HostAdapter.saveState`). Nothing in SQL, `__se_` queries, filters, export, saved styles or search changes. (Searching a description's text matching rows is a possible later addition; not in v1.)

### Zips (all shells)

Core `zip.ts` lists entries without extracting (fflate), decides the dataset kind (a `.gdb` folder -> reader; a shapefile's parts; a single data file; several datasets -> ask). Non-geodatabase zips are unzipped into the cache and registered as the inner files (the engine cannot do `/vsizip/`). VS Code: a zip never opens in Spatial Explorer by itself. The way in is the right-click "Open in Spatial Explorer" command on a `.zip` (and on a `.gdb` folder), plus a custom editor for `.zip` at priority `option` so it also appears under "Open With…". Large zips stream entry by entry.

### Asset, cache, UX

- `engineAssets.json` gains gdal3.js (js, wasm, data) with SHA-256 from `scripts/engine-assets.mjs`; fetched on first use through `HostAdapter.engineFile` (existing local copy: VS Code global storage, web Cache Storage), with one progress step. The engine worker is untouched.
- Cache key: hash(path + size + mtimes of the `.gdbtable` files used). Cleared by a command "Clear geodatabase cache" and by an LRU size cap (default 2 GiB, setting).
- Open flow: a `GdbLayerPicker` (kit components, like the layer picker; experimental badge), progress with cancel (`AbortSignal` into the reader).
- Errors map to messages in `core/src/gdb/errors.ts` (compressed, 64-bit OID, no CRS, too large, offline asset).

## Constitution and CLAUDE.md changes

Amend the constitution (new version) and CLAUDE.md: GDAL (gdal3.js) is allowed in the extension host and a worker for geodatabases only, downloaded and hash-pinned like the engine; the product decision "no native GDAL in the extension host" now reads "no native GDAL binary; gdal3.js (WebAssembly) for geodatabases". Add the THIRD-PARTY-NOTICES.md entry (LGPL, unmodified, separate file).

## Tests

- Core (Vitest): `domains.describe`, name cleaning for geodatabase layers, `zip.ts` kind detection, error mapping, catalog parsing from saved `ogrinfo` JSON (use `spikes/` outputs as fixtures).
- Web (Playwright, Chrome channel): fixture geodatabase with domains (generated by `make-domains-gdb.py`, small, committed) as folder pick and `.gdb.zip`; layers listed; layer opens; join of two layers; domain switch; each format zipped. The 111 MB sample is not committed; a manual acceptance step.
- Extension (@vscode/test-electron): the folder command lists and opens the same fixture; remote not testable here.
- Performance: conversion off the main thread (a 6x CPU test that typing stays responsive while converting).

## Risks

1. Memory ceiling in the browser for very large layers (mitigated: message; later a streaming path).
2. 64-bit ObjectIDs untested (message; revisit with gdal3.js built on GDAL 3.9+ if it appears).
3. gdal3.js is unmaintained-ish (2.8.1); pin by hash, keep the interface thin so a newer build or the native driver in duckdb-spatial can replace it. If DuckDB gains OpenFileGDB for WASM, delete the reader and keep the picker.
4. WORKERFS reading is slow without the copy-to-memory step; the copy rule (files under 2 MB plus the layer's own) is a heuristic to measure on a second real file.

## Phases

1. Asset and core: engineAssets entries, `GdbReader`, catalog, domains, zip (all unit-tested).
2. VS Code reader and command, then the picker and SQL names (US1, US2).
3. Web worker reader (US1, US2 on the web).
4. Domain display and switch (US3).
5. Zips (US4), cache clear and cap (US5), error messages (US6).
6. Docs, constitution amendment, notices, CHANGELOG, experimental label.

## As built (2026-10-18)

Everything in the spec is implemented, in both shells. Where it differs from the plan above:

- **VS Code runs gdal3.js in a child process, not a worker thread.** gdal3.js's Node build reads its `.data` file relative to the working directory, which a thread cannot change; a process can (`fork(..., { cwd })`). It also means a layer too big for memory ends that process, not VS Code, and Cancel is `kill()`. Files: `apps/vscode-ext/src/gdbReader.ts` (host side, cache, zip table of contents), `gdbWorker.ts` (the process; bundled to `out/gdbWorker.cjs`).
- **Reading the geodatabase in a zip uses the zip's table of contents only** (`listZipNames` in core, ranges of the file), to find the `.gdb` folder inside; the zip is never read whole by the reader.
- **The web reader's cache uses a `.done` marker** next to each converted layer, because `FileSystemFileHandle.move` is not available in every browser: a layer is usable once its marker exists.
- **Lazy layers are placeholder views** with the layer's columns (OGR types mapped to DuckDB types) and no rows, so autocomplete and DESCRIBE work before a layer is read; `QuerySession.prepareLazyLayers` converts a layer named by a statement (found by a case-insensitive, quote-tolerant match on the schema-qualified name) and replaces the view. A non-spatial layer's view leaves out the reader's empty `geom` column.
- **A layer over 100 MB goes through the existing whole-read prompt** ("Geodatabase layers must be read in full…"), like any big FlatGeobuf.
- **Domains** reach the table, the selected feature's card, the hover tooltip and the column filter (a list of descriptions that filters on the code); not the legend, the print layout or the export. A range domain changes nothing.
- **Layer picker**: feature datasets are `optgroup`s, and an "experimental" badge shows for geodatabases.
- **Web**: "Choose a geodatabase folder" (landing page), "Open geodatabase" (header), folder drops, and "Clear stored layers (N MB)" in the header while layers are stored. The browser cache has a fixed 2 GiB limit (least recently used first); VS Code's is `spatialExplorer.gdb.cacheLimitMB`.
- **Measured** (Chrome, the 111 MB sample, reader already cached): first layer on the map in 5.0 s from picking the folder, the 58,195-line Link layer (109 MB) in 3.8 s, another layer read by name in a query in a few seconds; VS Code's host reads a layer of that size in 1.9 s.
- **Still untested**: 64-bit ObjectIDs (ArcGIS Pro 3.2+), subtypes, tables over about 3 GB in the browser. A compressed geodatabase is refused with the instruction to uncompress it.
- **Tests**: `tests/core/gdb.test.ts`, `zip.test.ts`, `engine-assets.test.ts`; `tests/web/specs/gdb-013.spec.ts` (14 tests) and the `SE_GDB_SAMPLE` acceptance spec; `tests/vscode-ext/src/suite/layers.test.ts` (geodatabase folder, `.gdb.zip`, a file inside the folder, zipped data, another geodatabase, the cache).
