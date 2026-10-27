# Spike A harness (2026-10-26)

Throwaway scripts, kept so the numbers in ../research.md can be reproduced. Not part of the build.

Setup, in an empty scratch folder (not in the repo):
- `npm i cog-tiler-wasm@0.5.0 whitebox-wasm@0.6.1 geolibre-wasm@1.7.1 geotiff proj4 geotiff-geokeys-to-proj4 maplibre-gl pako zstddec lerc`
- copy these files, plus a `web/` folder holding `index.html`, `convert.html`, `maplibre-gl.css` and `engine/` (`whitebox_wasm_bg.wasm`, `cog_tiler_wasm_bg.wasm`, `geolibre_wasm_bg.wasm`)
- a `data/` folder of test rasters made with GDAL 3.13: `gdalwarp -of COG` to EPSG 4326, 32612, 3857, 5070 and 3567; a striped copy; an RGB; an 8.8 GB uncompressed COG.

Run: `node build.mjs && node build2.mjs`, then `node runbrowser.mjs <file>` (or `local:<file>` to go through a file input) in Chrome (channel `chrome`) under a VS Code-like CSP, and `node runconvert.mjs <file>` for the striped-to-COG conversion. `pos.mjs` needs `gdallocationinfo` on PATH.

The VS Code runner (`tests/vscode-ext/src/suite/raster-spike.test.ts`, with the extension's own `sourceServer`) was replaced by `tests/vscode-ext/src/suite/raster.test.ts` when the feature landed; `vscode-webview-entry.js` and `build-vscode.mjs` here are its webview side. The runner is in git history at commit f8200ba.
