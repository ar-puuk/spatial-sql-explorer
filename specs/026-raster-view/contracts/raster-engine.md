# Contract: raster engine, tile protocol, host additions

## Engine files (`packages/core/src/engineAssets.json` → `raster`)
| Key | File | Version | Size | Loaded |
|---|---|---|---|---|
| `whitebox` | `whitebox_wasm_bg.wasm` from `whitebox-wasm` | 0.6.1 | 4.46 MB | first raster |
| `cogTiler` | `cog_tiler_wasm_bg.wasm` from `cog-tiler-wasm` | 0.5.0 | 133 KB | first raster |
| `converter` | `geolibre_wasm_bg.wasm` from `geolibre-wasm` | 1.7.1 | 6.7 MB | first striped file only |

- URL: `https://cdn.jsdelivr.net/npm/<pkg>@<version>/<file>` (host already allowed by `engineUrl` and the VS Code host allowlist). `sha256` recorded by `scripts/engine-assets.mjs` from `node_modules`; `--mirror` copies them under `npm/` for tests.
- `engineHashes()` MUST include all three (else `pruneEngineFiles` deletes them at the next DuckDB start).
- Load: `fetchVerified` (existing; retry with refresh on a bad hash; `EngineLoadError` `network` or `integrity`). Never executed before the check passes.

## Init order (per webview/page)
1. bytes ← `fetchVerified(whitebox)`, `fetchVerified(cogTiler)`
2. `initWhitebox({ module_or_path: bytes })` (default export of `whitebox-wasm`)
3. `initTiler({ module_or_path: bytes })` (default export of `cog-tiler-wasm/wasm`)
4. `init()` from `cog-tiler-wasm` (now a no-op; idempotent)
5. `setSourceCrsResolver(null)` unless a datum hook is added later.
Errors: a failed step surfaces as the open error and leaves the previous layer.

## Reader input (`openCog(source)`)
- `FileSource.kind === 'handle'` → the `File` (read by slices).
- `FileSource.kind === 'url'` → the URL string (HTTP Range). Request headers: `Range` only.
- `FileSource.kind === 'bytes'` → refused for a raster (`rangeOnly`).
Failure messages (mapped to plain text): striped/not tiled → convert path; no overviews over 16,777,216 samples → "needs overviews, zoom in"; unsupported compression → name it; unreadable CRS → name it; not georeferenced → say so.

## Tile protocol
`se-raster://<key>/<v>/<z>/<x>/<y>` registered once with `maplibregl.addProtocol('se-raster', handler)`.
- Handler: parse → `RasterHandle` by `key` (else empty `ArrayBuffer`) → `cog.renderTileRGBA(z, x, y, toRenderOptions(style))` → PNG bytes (core `encodePng`, `fflate` `zlibSync` level 1; no canvas) → `{ data }`. A null tile (no data) → a 1x1 transparent PNG.
- Serial queue (one render at a time), `AbortSignal` honoured, LRU 256 tiles keyed by `key/v/z/x/y`. `unregister(key)` clears them.
- MapLibre source: `{ type: 'raster', tiles: ['se-raster://<key>/<v>/{z}/{x}/{y}'], tileSize: 256, bounds: extentWgs84, minzoom: 0, maxzoom: 22 }`; layer `se-raster` (`raster-opacity`, `raster-resampling`).
- Style change → `version++` → source re-added in the same frame as the old one is removed (no flash: `raster-fade-duration: 0`).

## Pixel reading
`cog.point(lon, lat, { bidx? })` → `{ coordinates, values, band_names, outside? }`. Callers: at most one in flight, 50 ms throttle, latest wins; skip outside `extentWgs84`. A `nodata` equal value or NaN → `null`.

## HostAdapter additions (`packages/core/src/hostAdapter.ts`)
- `getFileSource(ref, { whole?, rangeOnly? })`: with `rangeOnly: true`, an adapter that cannot serve ranges MUST throw `RangeNotSupportedError` and MUST NOT fall back to a whole-file transfer. Web: unchanged (a `File` always works). VS Code webview: throw instead of `requestWholeTransfer` (`webview/hostAdapter.ts:395-397`).
- `StatusFields.pixel?: string` (optional): the formatted band values for a status bar item. The web adapter ignores it; the VS Code adapter shows it next to the cursor item (`extension.ts:601-606`).
No other adapter change. `FileSource.styleSidecar` already carries the `.qml`.

## Store surface (`ViewerStore`)
`layerKind`, `capabilities`, `raster` (`RasterHandle | null`), `rasterStyle`, `pixel`, `setRasterStyle(patch)`, `saveRasterStyle()`, `setPixel(reading | null)`, `rasterCardOpen`. Open path: `prepareRaster(ref)` then the shared teardown then `installRaster(prepared)`.

## Test hooks (when `?e2e=1` or webdriver)
`__spatialExplorerE2E.raster = { ready: boolean, tilesLoaded: number, version: number, renderOptions }`, and `data-raster-ready` on `.canvas-host`. VS Code: `spatialExplorer._getLoadState` returns `kind: 'raster'` with width, height, bands, crs.
