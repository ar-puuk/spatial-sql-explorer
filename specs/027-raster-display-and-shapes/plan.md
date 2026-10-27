# Implementation Plan: Raster display options and values under a drawn shape

**Branch**: `027-raster-display-and-shapes` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)
**Base**: spec 026 as merged (worker tiler, `se-raster://` protocol, `RasterStyle`, QML writer/reader, Terra Draw controller).

## Summary
Four additions on the one open raster, built easiest first: (1) MapLibre raster paint properties (brightness, contrast, saturation, hue, resampling) as style fields applied with `setPaintProperty`, no tile re-read; (2) a profile along a drawn line; (3) statistics inside a drawn area; (4) hillshade through MapLibre's `hillshade` layer fed by a second tile protocol that serves the raster's values encoded as RGB (custom DEM encoding). Viewshed and the whitebox tool suite are deferred (user decision 2026-10-26).

## Technical Context
**Language/Version**: TypeScript (strict), Svelte 5, Vite; MapLibre GL 6.13.0 (style spec 26.4.4).
**Dependencies**: none new. `cog-tiler-wasm` 0.5.0 (pinned exactly) is used through its public API plus a few documented-by-reading members (see D4).
**Testing**: vitest `tests/core`; Playwright `tests/web` via `npm run test:web:chrome`; `tests/vscode-ext` raster suite; QGIS read-back `tests/qgis/check_raster.py` for the new QML elements; 6x CPU performance spec.
**Performance Goals**: spec SC-001 to SC-006.
**Constraints**: all pixel reading in the worker; main thread receives small results (arrays of at most 2,000 samples, a statistics object, PNG tiles); no wasm download beyond round one's.

## Constitution Check
Gate: constitution 1.8.0 lists raster analysis as out of scope (hillshade, zonal statistics named). The amendment is task T001 (v1.9.0, MINOR): display functions of the open raster (adjustments, relief shading) are STYLE; values read along or inside a drawn scratch shape are LOOK (inspection), not analysis. Still out: derived rasters, band math, reclassify, viewshed, contours, flow tools, whitebox, several rasters, vector over raster.

| Principle | Status |
|---|---|
| I Scope | Amend (v1.9.0) as above. |
| II Host-agnostic core | Pass. Pure code (style fields, sampling math, statistics reducers, QML) in `packages/core/src/raster/`; worker and map code in `packages/ui`. |
| III Native VS Code feel | Pass. Panels from the kit and tokens. |
| IV Local-first | Pass. No new download or network. |
| V Bounded resources | Pass. Profile at most 2,000 samples; statistics at most 16.7 M cells (overview level chosen); hillshade tiles are the same size as colour tiles. |
| VI Verified claims | Hillshade is spiked in Chrome first (T015) and the result recorded in research.md before building on it. |
| VII Accessibility | Pass by design: kit controls with names; chart has a table alternative; results are text. |
| VIII Clean-room | No third-party code copied. The value-tile routine is written by us from reading `cog-tiler-wasm` (MIT, a dependency already); noted in THIRD-PARTY-NOTICES.md only if code is adapted. |
| IX Testing | Per layer, below. |
| X Simplicity | No new package, one new protocol, one new worker message pair. |

## Design

### D1. Display adjustments (US1)
`RasterStyle` gains `display?: { brightnessMin; brightnessMax; contrast; saturation; hue; resampling }` (neutral: 0, 1, 0, 0, 0, 'linear'; ranges as MapLibre). `sanitizeRasterStyle` clamps; `isNeutralDisplay`. MapView's `applyRaster` already has the layer; it sets the five paint properties on change (never a new tile URL, so no re-read). The existing `resampling` prop moves into `display`. Style panel: an "Appearance" group of sliders (kit Slider) with a Reset. QML: QGIS `<brightnesscontrast brightness= contrast=>` and `<huesaturation saturation= colorizeOn=0>` inside `<pipe>`, brightness and contrast mapped from MapLibre's scales; our JSON entry keeps the exact values. The legend/colour bar do not change.

### D2. Profile along a line (US3)
A new draw purpose `profile` (palette: line, freehand) and `area` (polygon, rectangle, circle, freehand), shown as map controls `rasterProfile` and `rasterArea` available only for a raster (`controlAvailable` rule inverted: `layerKinds: ['raster']`). A finished shape goes to the store; core `profileSamples(coords, n)` returns evenly spaced points along the great circle (n = min(2000, ceil(length / cell size))). The worker gets message `profile { handle, points, bands }` and answers `Float64Array` values (`point()` for each would be 2,000 round trips; instead the worker reads the needed level windows once: `cog._assembleWindow` over the points' bounding window at the level whose cell is about the sample spacing, sampling nearest). Result panel (`RasterProfile.svelte`): an SVG chart (distance on x, value on y, gaps), min/max/rise/fall, hover linked to a marker on the map, CSV save. Values at five checked places must equal `point()` (SC-003); the nearest-cell choice is the same one `point()` makes.

### D3. Statistics inside an area (US4)
Message `areaStats { handle, ring(s), bands }`. Worker: choose the level whose window for the polygon's bounding box has at most 16.7 M cells (else a coarser overview, `approximate: true`); read the window per band; for each cell test its center against the polygon (point-in-polygon in JS over the ring in the raster's CRS, ring transformed once with the tiler's `toSource`); accumulate count, excluded, sum, sumsq, min, max and a 64-bin histogram. Core `reduceAreaStats` merges and finishes (mean, std). Area from the existing spherical `measureShape`. Panel `RasterAreaStats.svelte`: table per band plus a tiny histogram.

### D4. Hillshade (US2)
MapLibre's `hillshade` layer needs a `raster-dem` source. A second protocol `se-raster-dem://<key>/<version>/{z}/{x}/{y}` serves PNG tiles where RGB encodes the value as `base + (R*65536 + G*256 + B) * step` (MapLibre `encoding: 'custom'` with `redFactor = 65536*step`, `greenFactor = 256*step`, `blueFactor = step`, `baseShift = base`), `base` and the range from the file statistics' min and max so a 24-bit step is under 1e-3 of a unit for any realistic range. The worker produces the values: it reproduces `_renderExtent`'s warp (grid of mercator points to source coordinates, level choice, window read) without the colour step, using the source's `toSource`, `gt`, `levels`, `_chooseLevel`, `_levelPixelSize` and `_assembleWindow` members. These are not in the package's type definitions: they are used behind one adapter (`valueTile.ts`) with a startup check that each exists (else hillshade is not offered, with the reason), the package is pinned exactly, and a test with the fixture fails if an upgrade changes them. No-data cells are filled with the tile's lowest valid value (no tile border effects from empty values). Layer `se-raster-relief` (hillshade) sits above `se-raster`; paint from the style (method, illumination direction/altitude, exaggeration, shadow/highlight/accent colors). Changing only the paint needs no new tiles; changing the encoding range (new file) bumps the version. Only single-band, non-palette rasters are offered it. Values are taken as meters (documented in the panel). Gate: T015 spike proves a custom-protocol DEM source drives `hillshade` correctly in Chrome (and in a VS Code webview via the existing suite) before T016 onward.

### D5. Store, panel and persistence
`RasterStyle` additions: `display`, `relief?: { on; method; direction; altitude; exaggeration; shadow; highlight; accent }`. `sanitizeRasterStyle`, `defaultRasterStyle`, saved state key (`raster:<stateKey>`) and the QML JSON entry carry them (old saved styles read as neutral). Style panel gets "Appearance" and "Relief" groups; Profile and Area are opened from map controls and show a results panel at the bottom of the map (the raster has no bottom panel).

## Project Structure
```text
specs/027-raster-display-and-shapes/ spec.md plan.md tasks.md research.md
packages/core/src/raster/  display.ts (new) profile.ts (new) areaStats.ts (new) relief.ts (new) style.ts qml.ts types.ts
packages/ui/src/raster/    valueTile.ts (new, worker side) tilerWorker.ts tilerProtocol.ts tilerClient.ts rasterTiles.ts
                           RasterProfile.svelte RasterAreaStats.svelte (new) RasterStylePanel.svelte
packages/ui/src/MapView.svelte  (paint props, DEM source/layer, two controls)
tests/core/raster-display.test.ts raster-profile.test.ts raster-area.test.ts raster-relief.test.ts
tests/web/specs/raster-027.spec.ts raster-027-performance.spec.ts
```

## Test strategy
Core: style sanitize/migration, display mapping to MapLibre and QML values, profile sampling geometry, area-stat reducers against a naive computation, relief paint mapping, QML round trip. Web (Chrome): each control changes the map (`getPaintProperty`), reset, persistence, profile on the DEM fixture equals `point()` at five places, area stats equal an independent computation from the file read with geotiff.js, hillshade layer present with a custom DEM source and the relief visible (pixel check against a flat shade), accessibility (axe) for new panels, 6x CPU performance. VS Code suite: one test each for display persistence and profile. QGIS: read-back of brightness/contrast/saturation.

## Risks
- **Hillshade source** (D4) uses undocumented members of a pinned dependency: mitigated by the adapter, the check and the pinned version; fallback is to ship US1, profile and statistics and leave relief for the next release.
- **Adjustments on a color-mapped band** change the look, not the data, and the legend does not follow: stated in the panel.
- **Profile on huge rasters** reads one window at an overview level: bounded by the 16.7 M sample limit.
