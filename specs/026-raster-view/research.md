# Research: Raster view and inspect (spec 026)

Status: seeded 2026-10-26 from the pre-spec spikes. Sections marked TODO are the first tasks (constitution VI: spike before building).

## 1. Can DuckDB read rasters in our engine? (answered 2026-10-26)
Probe: `https://community-extensions.duckdb.org/v1.5.6/wasm_eh/<name>.duckdb_extension.wasm` (the path `h3` and `a5` use).

| Extension | Reads | `wasm_eh` build for v1.5.6 |
|---|---|---|
| `raster` (`RT_Read`, GDAL) | rasters as tables | 404 (native only) |
| `geotiff` (`read_geotiff`, GDAL) | one row per cell `(cell_id, value)` | 404 |
| `s2raster` (pure Rust, `rs_*`) | GeoTIFF values, stats, histogram | 404 (its page lists no WASM) |
| `raquet` | needs GDAL for ingest | 404 |

Core `spatial` is vector only (`ST_Read`). Conclusion: no DuckDB route today. Recheck when the engine is upgraded. Rows-per-cell is also a poor model (10,000 x 10,000 = 100 M rows).

## 2. How GeoLibre does it (read 2026-10-26, `D:\GitHub\_refs\GeoLibre`, commit of 2026-10-12)
- The web build and the desktop build are one app. Desktop adds a Python sidecar (rasterio/GDAL) for most raster tools; `isTauri()` decides.
- Viewing: `cog-tiler-wasm` (npm, MIT, 0.5.0) feeds a native MapLibre raster source through `addProtocol`; `maplibre-gl-raster` holds the style state (mode rgb/single/index, bands, colormap, reversed, rescale, nodata, stretch, gamma); `packages/map/src/cog-imagery.ts`, `apps/geolibre-desktop/src/lib/raster-info.ts` (header facts), `raster-histogram.ts`, `raster-palette.ts` (legend), `non-tiled-raster-error.ts`.
- Striped GeoTIFF: the tiler refuses it ("not tiled"); `packages/processing/src/cog-convert.ts` converts in the browser with `geolibre-wasm`'s `GeoTiffReader` + `CogBuilder` (deflate, lzw, packbits, none; 512 px tiles; cap `MAX_BROWSER_COG_CONVERSION_SAMPLES = 100_000_000`).
- Analysis (not used here): 16 raster tools of its own (8 with a `geotiff.js` browser fallback) plus the Whitebox Next Gen open tier, 1,065 tools, run in the browser as a WASI binary (`geolibre-wasm/tools`, 24 MB). Zonal statistics there takes a zone raster and writes a raster.

## 3. Node spike (2026-10-26; Node 26; scratch only, NOT the real runtime)
Test file: 3000 x 3000 float32, 36 MB, striped, written with geotiff.js.
- `geolibre-wasm/tools` `slope`: 3.6 s, 38 MB COG out; `hillshade` 3.0 s; peak RSS about 450 MB. 1,065 tools listed.
- `cog-tiler-wasm` 0.5.0: striped file fails to open from bytes ("image is striped, not tiled; tile range streaming requires a tiled COG"). On the COG: `openCog` 10 ms, 4 levels, mode `warp`; `renderTileRGBA` 256 x 256 in 30 ms; `point()` returns the value; `statistics({maxSize:512})` returns min, max, mean, std, median. `renderTilePNG` needs browser `ImageData` (not a failure).
- Package sizes (npm unpacked): `cog-tiler-wasm` 133 KB wasm + glue, but it imports `whitebox-wasm` (22 MB); `geolibre-wasm` 6.7 MB wasm (+ 24 MB CLI wasm we do not need).

## 3b. Engine weight, corrected (2026-10-26)
The 22 MB figure above was the npm package total. `cog-tiler-wasm` loads only two wasm files, each by `new URL('<name>_bg.wasm', import.meta.url)` (so a pinned URL or cached bytes can be passed to `init`): `cog_tiler_wasm_bg.wasm` 133 KB and `whitebox_wasm_bg.wasm` 4.46 MB (from the `whitebox-wasm` dependency, MIT OR Apache-2.0). `whitebox-cli.wasm` (17.6 MB) is the tool runner and is not needed. Engine download is therefore about 4.6 MB plus the JS glue (bundled, small). Still to confirm in a real browser (spike A.1, A.2).

## 4. Spike A results: real Chrome (done 2026-10-26)
Harness: `spikes/` (Chrome stable through Playwright `channel: 'chrome'`, headless; a page served with a CSP like the extension's: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob: 'self'; connect-src 'self'; img-src 'self' blob: data:`). Reader under test: `cog-tiler-wasm` 0.5.0 with a MapLibre 6.16 raster layer through `addProtocol('cog')`.

1. **Loads under the CSP, from fetched bytes.** The page fetched the two wasm files, then passed them to `init({module_or_path: bytes})` of `whitebox-wasm` and `cog-tiler-wasm/wasm` first (wasm-bindgen inits are idempotent, so the package's own `init()` then does nothing). So the bytes can come from `HostAdapter.engineFile` after the SHA-256 check, like DuckDB-WASM: the tiler fetches nothing itself and starts no worker. Its JS makes no network call (grep for http(s) and epsg.io: none). Engine init 105 to 135 ms. `lerc` imports Node's `module`; aliased to a stub in the bundle (LERC and ZSTD decoders are optional peers).
2. **Download size**: 4.46 MB + 133 KB wasm (see 3b). JS dependencies get bundled: `proj4`, `geotiff`, `geotiff-geokeys-to-proj4`.
3. **Range reads, URL source** (a loopback server with Range support, as in the extension):

| File | Size | Open | First view | Bytes read |
|---|---|---|---|---|
| COG, EPSG:4326, 4 overview levels | 42 MB | 12 ms | under 300 ms | 8.5% (3.6 MB; small files are dominated by headers and the coarsest levels) |
| COG, EPSG:3857 | 41 MB | 12 ms | under 300 ms | 23% (fast path, mode `3857`) |
| COG, UTM 12N, Albers 5070, Utah Central ftUS | 41 MB | 10 to 12 ms | under 300 ms | 4 to 24% |
| RGB COG, 3 bands | 1.9 MB | 11 ms | 214 ms | 22% |
| COG, UTM, uncompressed, 8 overview levels | **8,787 MB** | 15 ms | **214 ms** | **12.1 MB = 0.14%**, 16 requests |
| striped GeoTIFF | 36 MB | fails | n/a | 106% (the whole file is fetched, then refused) |
| tiled GeoTIFF, uncompressed, **no overviews** | 6,544 MB | 16 ms | **refused**: "window 40000x40000 on level 0 is too large to read (limit 16777216 samples); this raster has no overviews, so add them" | 0.01% |

   SC-001 (500 MB or more, first view under 5 s, under 10% read) is met by a wide margin for a COG with overviews. A big file with no overviews cannot be drawn zoomed out: it needs a plain message (zooming in works). JS heap after the first view: 56 to 85 MB.
4. **A `File` from the file picker** (the web shell): the 8.8 GB COG opens in 14 ms and draws; 40 MB files the same. The tiler reads the `File` by slices, so nothing is loaded whole. Not run: a drag-and-drop `File` (same object) and a network URL with CORS from a web origin.
5. **Position against GDAL** (SC-005). Bounds in WGS84 equal `gdalinfo` `wgs84Extent` to 4 decimals for all five systems (4326, 32612, 3857, 5070, 3567). Pixel values from `point()` against `gdallocationinfo -wgs84` at 40 random places per system: identical in four systems, largest difference 1.6 units in the state plane (feet) file, which is under one pixel of this DEM's gradient. Reprojection is done in JS with `proj4` from the file's GeoKeys (`mode: "warp"`; EPSG:3857 has a fast path, `mode: "3857"`).
6. **Striped GeoTIFF to COG, in Chrome** (`geolibre-wasm` `GeoTiffReader` + `CogBuilder`, float32, deflate, 512 px tiles): 9 M samples 1.5 s; 49 M samples (176 MB file) 8.5 s, JS heap 1.0 GB; **100 M samples (354 MB file) 17 s, JS heap 2.0 GB**. The output is a valid COG in GDAL (512 x 512 blocks, overviews, nodata kept), opens in the tiler in 16 ms and reads 1.8% for a first view. Extra download: `geolibre_wasm_bg.wasm` 6.7 MB, only when a striped file is opened. Proposed limit: the 100 M sample cap GeoLibre uses, with a warning from 40 M (memory is about 20 bytes per sample). The 3.1 GiB engine ceiling belongs to DuckDB and does not apply, but the webview's process memory does.
   **Catches**: (a) every non-8-bit type is written as float32 and a colour table is dropped; (b) the converter's own overview ladder has a 7 x 7 level on a 7000 px raster, and the tiler's `statistics({maxSize: 512})` then took its statistics from that level (count 49: min, max and percentiles wrong). We must write our own overview levels (2, 4, 8, and so on down to about 256 px) and not use GeoLibre's helper unchanged.
7. **Other behaviour** (Node, same package): nodata and warp edges come out as transparent pixels (alpha 0); 16-bit RGB renders with a given min and max; a palette COG sets `hasPalette` and draws its own table, and `point()` returns the class number (not a class name). `point()` costs 4 to 10 ms; `statistics()` 8 to 60 ms (it carries a histogram and percentiles 2 and 98).

## 5. Spike A: still open
- **A real VS Code webview.** Not run yet. Why it should work: the CSP has the same shape (`script-src 'wasm-unsafe-eval'`, no `unsafe-eval`; `worker-src` allows blob and data; DuckDB-WASM already runs there), the extension's file server already answers `Range` preflights (`Access-Control-Allow-Headers: Range`, exposes `Content-Range`) and `connect-src` already allows the loopback host. To be checked in the first implementation task with `@vscode/test-electron`, including Remote-SSH (the same loopback arrangement as vector files).
- Not tested: LERC and ZSTD compressed files, bottom-up files, a raster across the date line, projections beyond the five above (user-defined, non-EPSG), multi-image (sub-dataset) files, rasters over 4 GB through the webview, a `.tif` with only a world file, JPEG-in-TIFF.
- **Reader comparison**: only `cog-tiler-wasm` was measured. It met every criterion above, so `geotiff.js` with our own tiler and `maplibre-cog-protocol` were not built; revisit only if a webview-specific blocker appears.

## 6. What the spike supports (for the plan)
- Reader: `cog-tiler-wasm` through our own `addProtocol` handler (not GeoLibre's `maplibre-gl-raster`, which brings deck.gl), bytes from `HostAdapter.engineFile`, hashes in `engineAssets.json`.
- Striped files: `geolibre-wasm` `CogBuilder`, limit 100 M samples, own overview ladder, a note when a colour table or a non-float type is lost.
- `.tif` and `.tiff`: `priority: default` (VS Code's built-in Image Preview claims only jpg, jpe, jpeg, png, bmp, gif, ico, webp, avif and svg).
- A file with no overviews over the sample limit: opens (zooming in works) with a notice that zoomed-out views need overviews; histogram and percentile stretch cannot come from the file's own overviews, so they use a window read at the current view.

## 7. Decisions to take in the plan
- Raster engine files in `engineAssets.json` and `scripts/engine-assets.mjs` (hash, mirror for tests).
- How a raster is held in the store: a `Layer` of `kind: 'raster'` that replaces the vector `Layer`, versus a second store; which vector-only UI one capability flag hides.
- Style sidecar: QGIS raster QML (`singlebandpseudocolor`, `multibandcolor`, `paletted`), checked against QGIS 4.2 at `C:\OSGeo4W`.
