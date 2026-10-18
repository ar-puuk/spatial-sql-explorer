# Feature Specification: File Geodatabase (.gdb) and zipped data

**Feature Branch**: `013-file-geodatabase`
**Created**: 2026-10-18
**Status**: Draft, for review (research and spikes: `research.md` §1-9)
**Experimental**: shown as experimental in both shells until the SQL engine reads the format natively.

## Summary

Open an Esri File Geodatabase (`.gdb` folder, or `.gdb.zip`) the same way as a GeoPackage: pick it, see its layers, open one on the map and in the table, query every layer with SQL by `geodatabase.layer`, style it, export it. Also open any supported GIS file inside a `.zip`. Both shells, same release. Nothing is uploaded.

## Decisions already made (user, 2026-10-18)

- gdal3.js (GDAL in WebAssembly, LGPL) is accepted for this format only; about 40 MB, downloaded once on first use and kept (like the SQL engine). It amends the constitution and CLAUDE.md.
- Layers are reached in SQL as `geodatabase.layer` (the file is a schema, as for a multi-layer GeoPackage). The `ST_Read('x.gdb', layer='y')` form works natively only for formats the engine reads, so it is not part of this feature.
- All columns are kept. Domains are an ArcGIS idea users do not write SQL against: they stay hidden (no tables or functions for them in SQL). Cells show the domain's **description** by default; a switch shows the **code** instead. SQL, filters, the search and exports always use the stored code.
- Both shells in the same release. Zips of all supported GIS formats, including `.gdb.zip`.
- Sample for acceptance: a 111 MB Cube transit network (56 layers in 14 feature datasets, UTM 12N).

## User scenarios

### US1 (P1): Open a geodatabase folder and a layer
As a GIS user I pick `network.gdb` (VS Code: right-click the folder, "Open in Spatial Explorer"; web: pick the folder or drop it), see its layers (name, geometry type, feature count), choose one, and it appears like any layer. Other layers open without picking the file again.
- Layers: geometry layers and non-spatial tables are listed; the geodatabase's own system tables (`GDB_*`) are not. Feature datasets are shown as groups.
- First open shows progress ("Reading layer…") and the result is kept, so opening it again is immediate (until the data changes).
- A layer without a CRS asks for one.
- **Independent test**: the 111 MB sample opens, `WFv1000_MasterNet_20260903_Link` (58,195 lines) is on the map in seconds, its table matches the source, SQL works.

### US2 (P1): Query across layers
In SQL, every layer of the open geodatabase is a table named `geodatabase.layer` (`wf.wfv1000_masternet_20260903_link`), usable in joins, with autocomplete. A layer is read from the file the first time a query names it.
- **Independent test**: a join between a link layer and a node layer returns the right rows.

### US3 (P1): Domain descriptions
Where a column has a coded-value domain, the table, the hover tooltip and the selected feature's card show the description (e.g. "Freeway"), with the code still reachable: a switch in the table (remembered) shows codes instead. Sorting, filtering by a value and the SQL see the code. Range domains change nothing.
- The filter list for such a column shows descriptions and filters on codes.
- **Independent test**: a layer with a coded domain shows descriptions by default, codes after the switch, and `SELECT class` returns the code.

### US4 (P2): Zipped data
Any supported GIS file in a `.zip` opens as if unzipped: Shapefile (all parts), GeoPackage, GeoJSON, FlatGeobuf, GeoParquet, KML, GML, CSV, and a `.gdb` inside a zip or a `.gdb.zip`. A zip that holds several datasets asks which one. Zips are never extracted to disk beyond the cache.
- **Independent test**: each format zipped opens with the same result as unzipped.

### US5 (P2): The one-time download and the cache
The first time a geodatabase is opened, the reader (about 40 MB) is downloaded, hash-checked, and kept; later starts work offline. Converted layers are cached and can be cleared ("Clear geodatabase cache"), with a size limit.

### US6 (P3): Clear failures
A compressed geodatabase (CDF/SDC), a 64-bit-ObjectID table the reader cannot read, a layer too large for memory, a cancelled or offline download, an unreadable folder: each gives a short message that says what to do (for compressed: "Uncompress File Geodatabase Data in ArcGIS"), and nothing is left half-open.

## Requirements

- **FR-001** Both shells open `.gdb` folders and `.gdb.zip`; the VS Code extension also on a remote host (SSH, WSL, containers), reading the files where they live.
- **FR-002** Layer listing shows name, geometry type, feature count, CRS and feature dataset without converting anything.
- **FR-003** A chosen layer is converted once to the format the app already opens fastest for big data (range reads; engine tiles over 100 MiB) and then behaves exactly like a file of that format.
- **FR-004** SQL names: `geodatabase.layer`, same cleaning rules as other multi-layer files; a layer is made available when a query names it.
- **FR-005** Every column of the source is kept, with its type (including 64-bit integers where the reader supports them).
- **FR-006** Coded-value domains are applied for display only, default on, with a remembered switch; never in SQL, filters, exports or saved styles.
- **FR-007** Zips of the supported formats open (US4).
- **FR-008** The reader is downloaded on first use, pinned by URL and SHA-256, cached, and loaded as a separate unmodified file; the notice is in THIRD-PARTY-NOTICES.md.
- **FR-009** The cache lives in the host's storage (global storage in VS Code, OPFS on the web), is keyed by the source's path and modification times, and is invalidated when they change.
- **FR-010** Opening a geodatabase must not freeze the interface (conversion off the main thread) and must show progress and allow cancel.
- **FR-011** Labelled experimental in the open dialog and the README; removing the label is a one-line change.

## Out of scope

Writing or editing geodatabases, rasters and mosaic datasets, relationships and topology, attachments, versioned or enterprise geodatabases, subtypes (shown as codes for now), `ST_Read('x.gdb', layer=…)`, compressed geodatabases, vscode.dev without a worker path (deferred).

## Limits to state in the documentation

- A layer's table files plus its converted file must fit in memory in the browser (about 3 GB at most); beyond that the message says to convert it elsewhere.
- Compressed geodatabases cannot be read by any open-source reader.
- 64-bit ObjectIDs (ArcGIS Pro 3.2+) are untested with the bundled GDAL 3.8.4.

## Success criteria

- SC-001 The 111 MB sample: layers listed in under a second, Link on the map in under 5 seconds after the reader is cached.
- SC-002 The first-time download is a single progress step, and a reload works offline.
- SC-003 Every format in US4 opens zipped with the same row count as unzipped.
- SC-004 With a coded domain, the displayed text is the description, the SQL value the code, and the switch round-trips without a reload.
