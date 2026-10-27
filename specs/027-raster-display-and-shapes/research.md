# Research: Raster display options and values under a drawn shape (spec 027)

Dates are 2026-10-26. Evidence is from the real app in Chrome (Playwright, `npm run test:web:chrome`), MapLibre 6.13.0, `cog-tiler-wasm` 0.5.0.

## 1. What MapLibre offers for a raster (checked in the style spec, v8.json of `@maplibre/maplibre-gl-style-spec` 26.4.4)
- `raster` layer paint: `raster-opacity`, `raster-hue-rotate`, `raster-brightness-min`, `raster-brightness-max`, `raster-saturation`, `raster-contrast`, `raster-resampling` (`linear`, `nearest`), `raster-fade-duration`. All are layer paint: changing one reads no tile.
- `hillshade` layer: `hillshade-method` (`standard`, `basic`, `combined`, `igor`, `multidirectional`), `hillshade-illumination-direction`, `-altitude`, `-anchor`, `hillshade-exaggeration`, `hillshade-shadow-color`, `-highlight-color`, `-accent-color`; source type `raster-dem` with `encoding` `terrarium`, `mapbox` or `custom` (`redFactor`, `greenFactor`, `blueFactor`, `baseShift`).
- `color-relief` layer (colors by elevation on the GPU): not used; our colors come from the tiler and a style change is already drawn in about 200 ms. Revisit if that ever matters.

## 2. How `cog-tiler-wasm` 0.5.0 makes a tile (T014)
It has no public call for the values of a window. `CogSource` keeps what a tile needs as members that are not in its type definitions: `gt` (the north-up geotransform of the full-size level), `levels` (width and height of each level), `toSource.forward` (Web Mercator meters to the file's system, identity for EPSG:3857), `_levelPixelSize(level)`, `_chooseLevel(metersPerPixel)`, `_assembleWindow(level, x, y, w, h, band)` (the values of a window, row-major, NaN for a missing tile, bottom-up files already flipped north-up), `nodata`. `_renderExtent` lays a 16 x 16 grid of mercator points over the tile, maps them into the file's system, picks the level whose cells are the coarsest still finer than a pixel, reads one window and interpolates per pixel; the colors come last, from the values.

`packages/ui/src/raster/cogInternals.ts` is the one file that uses these members. It checks each one exists and says "Update Spatial Explorer" when one does not (an upgrade), the package is pinned to the exact version (`packages/ui/package.json`), and the web tests (`raster-027-area`, `raster-027-relief`) read values through it, so an upgrade that changes them fails a test first. Used by: area statistics (`areaStats`) and the relief tiles (`demTile`).

## 3. Profile: why `point()` (T008)
The profile asks the tiler's own `point()` for each place, inside the worker, so a profile and a cursor reading cannot disagree. Neighboring places fall in the same decoded tile and the tiler caches decoded tiles, so a line reads each tile once. Places are at most 2,000 and about one per cell. Checked at five places along a line against the app's `point()`: equal.

## 4. Area statistics (T011 to T013)
The cells whose centers are inside the polygon are found by scanline (an even-odd fill of the polygon in the level's cell coordinates), not by testing every cell; the tests compare it with a per-cell test on 40 random polygons. The window is read at the finest level whose window has at most 2^24 cells per band; a coarser level is flagged approximate. Checked against the same figures worked out from the file with geotiff.js and proj4 (not the app's reader) for a rectangle over the DEM fixture: count, no-data count, minimum, maximum, sum and mean agree exactly (`raster-027-area.spec.ts`).

## 5. SPIKE: hillshade from our own tiles (T015) — passed
Question: can a custom protocol serve the raster's values, packed into red, green and blue, so MapLibre's `hillshade` layer draws the relief?

Method: a second protocol `se-raster-dem://<key>/<version>/{z}/{x}/{y}` (rasterTiles.ts) serves PNG tiles built in the worker by `valueTile.ts` (same warp as the tiler's colored tile, no colors). A `raster-dem` source with `encoding: 'custom'` (`redFactor = 65536 * step`, `greenFactor = 256 * step`, `blueFactor = step`, `baseShift = base`) and a `hillshade` layer above the picture.

Results (DEM fixture, UTM 12N, 428 x 450 cells):
- The hillshade layer draws relief in the right place and scale for a raster in a projected system; the map pixels differ from the plain picture and return to it when relief is switched off.
- A tile is 256 x 256, opaque, and unpacks to values inside the file's range with a step under 0.01 (24 bits over the band's range plus 10% each side; for the fixture about 1e-4).
- Changing the light direction, height and strength changes only the layer's paint: no tile is read again.
- Cells with no value must not be packed as the tile's own mean: each tile then has a different flat level and a step shows along every tile border (seen as long thin lines beyond the raster in the first run). Packing them as the band's mean, the same number in every tile, removes the seams. What stays is a step at the data's own edge and at a hole's edge (a dark rim). The panel says so.
- The fixture's surface is smooth, so the relief is soft; real terrain shows more. Not yet looked at: real terrain with sharp ridges, a raster at high latitude, the globe projection.

## 6. Not verified
Hillshade on the globe projection, in the VS Code webview, at the print page, on a file in feet (values are taken as meters), a big file with no overviews (the value tile is blank when one read would be too large, like the colored tile), and Firefox and Safari.
