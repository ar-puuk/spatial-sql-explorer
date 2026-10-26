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

## 4. TODO spike A: real runtimes (first task)
Run in Chrome (web shell) and in a VS Code webview (extension host):
1. Does `cog-tiler-wasm` + `whitebox-wasm` load under our webview CSP (`script-src 'wasm-unsafe-eval'`, `worker-src blob:`)? Does it spawn workers or fetch its wasm by URL we must pin?
2. Can the wasm files be fetched from pinned URLs and hash-checked (constitution v1.2.0), instead of bundled? Which files exactly (jsDelivr npm URLs), and total download size. Can the 22 MB `whitebox-wasm` be avoided (a tiler without it, or `geotiff.js` alone)?
3. A `File` (web) or a range-served local file (VS Code, loopback server as for vector files) of 2 GB or more: first view time, bytes read, memory.
4. Remote-SSH / WSL: ranges over the loopback server.
5. Compare readers on the same files: `cog-tiler-wasm`, `geotiff.js` + our own tile cutter, `maplibre-cog-protocol`. Criteria: first view, CRS coverage (reprojection of non-3857), codecs (deflate, lzw, zstd, lerc, jpeg), palettes, 16-bit and float, nodata, bottom-up, size, license.
6. Position check against QGIS (SC-005) in five coordinate systems.
7. Measure the size limit for striped-to-COG conversion (memory and time) and set the limit.

## 5. TODO spike B: pixel values, histogram, style
- `point()` cost per hover at 60 fps; throttling; band names; color tables and class names.
- Histogram source (from `statistics()` decimated overview vs a full read): accuracy and cost.
- Style sidecar: QGIS raster QML (`singlebandpseudocolor`, `multibandcolor`, `paletted`) readable by QGIS 4.2 at `C:\OSGeo4W`; compare with our own JSON entry like the vector sidecar.

## 6. Decisions to take in the plan
- VS Code priority for `.tif` / `.tiff`: `default` or `option`. A GeoTIFF is almost never opened in a text editor, but `default` takes over image previews; prefer `default` for `.tif`, `.tiff` only after checking the built-in Image Preview does not claim them.
- Raster engine file in `engineAssets.json` and `scripts/engine-assets.mjs` (hash, mirror for tests).
- How a raster is held in the store: a `Layer` of `kind: 'raster'` that replaces the vector `Layer`, versus a second store; which vector-only UI is hidden by a single capability flag.
