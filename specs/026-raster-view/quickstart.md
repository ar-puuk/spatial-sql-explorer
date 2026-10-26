# Quickstart: validating spec 026

Prerequisites: `npm ci`; GDAL 3.x for fixtures (`C:\OSGeo4W` or `OSGEO4W_ROOT`); `node scripts/engine-assets.mjs --mirror` once (hashes and mirror, now includes the raster files); Chrome installed (bundled Playwright browsers are blocked, see memory).

1. **Fixtures**: `node scripts/fixtures-026.mjs` (writes `tests/vscode-ext/fixtures/raster/*.tif`; skips existing files). Large COG for the range-read test: `npm run large-data` (writes `tests/.large-data/raster-big.tif`).
2. **Core**: `npm run test:core` (raster style, QML, facts, convert limits, engine hashes, controls, capabilities).
3. **Web**: `npm run test:web:chrome -- raster-026` then the whole suite once (`npm run test:web:chrome`) to check vector paths did not regress.
4. **Extension**: `npm run test:vscode-ext` (needs the network for the engine; opens rasters through Open With).
5. **QGIS read-back**: `C:\OSGeo4W\bin\python-qgis.bat tests/qgis/raster_qml.py` (our `.qml` into QGIS and back).
6. **By hand** (web: `npm run dev`; VS Code: F5 the extension host):
   - Open `dem-utm12.tif`: it fits, the card lists CRS UTM 12N (EPSG:32612), size, 1 band, float32, nodata, Deflate, tiled 512, overviews; hover shows the elevation; edge pixels say "no data".
   - Style: pick a colormap, narrow the range with the histogram handles; the map and color bar change while dragging without freezing (also at 6x CPU slowdown in DevTools).
   - Open `ortho-rgb.tif`: a color image; switch to one band and back.
   - Open `classes.tif`: its own colors; legend shows classes; hover shows the class number.
   - Open `striped.tif`: "preparing" then the picture, and a note that it was converted; open the over-limit file: a message, previous layer unchanged.
   - Open a vector file, then a raster, then a vector: query panel, table and shape tools disappear and return.
   - Basemap blank, globe, terrain, Print layout PNG: all work with the raster.
   - Offline (DevTools): after one raster, reload and open another: no network needed.
7. **Large file**: open `raster-big.tif` (8 GB COG): first view under 5 s; DevTools Network (web, URL source) or the extension's `_getSourceStats` shows under 10% of the file read.

Expected outcome: all suites green; SC-001 to SC-008 hold on the checks above.
