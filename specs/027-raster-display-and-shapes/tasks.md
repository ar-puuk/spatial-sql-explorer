# Tasks: Raster display options and values under a drawn shape (spec 027)

**Input**: `specs/027-raster-display-and-shapes/` (spec.md, plan.md)
**Rules**: one commit per task, tests run before the next task. Built easiest first: gate, US1 display adjustments, US3 profile, US4 area statistics, US2 hillshade (spiked first), polish. Never push or publish unless asked.

## Phase 1: Gate
- [x] T001 Constitution v1.9.0 in `.specify/memory/constitution.md` (Sync Impact Report; principle I: display functions of the open raster are STYLE, values read along or inside a drawn scratch shape are LOOK; derived rasters, band math, reclassify, viewshed, contours, flow tools, whitebox tools, several rasters and vector over raster stay out), `CLAUDE.md` scope paragraph, `THIRD-PARTY-NOTICES.md` unchanged unless code is adapted.

## Phase 2: US1 display adjustments (P1)
- [x] T002 Core `packages/core/src/raster/display.ts`: `RasterDisplay` type, `NEUTRAL_DISPLAY`, `sanitizeDisplay`, `isNeutralDisplay`, MapLibre paint mapping, QGIS mapping (`toQgisBrightnessContrast`, `toQgisSaturation`); `RasterStyle.display?` in `types.ts`; `sanitizeRasterStyle`/`defaultRasterStyle` in `style.ts`; export from index. Test `tests/core/raster-display.test.ts`.
- [x] T003 QML: write `brightnesscontrast` and `huesaturation` in `qml.ts` (only when not neutral), keep exact values in the JSON entry, read back; update `contracts` note in research.md; extend `tests/core/qgis-raster-cases.test.ts` and `tests/qgis/check_raster.py`.
- [x] T004 Map: `applyRaster` in `MapView.svelte` sets the five paint properties from `display` without a new tile URL; the `raster` prop carries `display`; remove the separate `resampling` prop path.
- [x] T005 Style panel: "Appearance" group in `RasterStylePanel.svelte` (brightness low/high, contrast, saturation, hue, Smooth/Sharp pixels, Reset) using the kit; note that the legend does not follow.
- [x] T006 Web test `tests/web/specs/raster-027.spec.ts` (US1): each control changes the paint property, no tile read (tile stats unchanged), Reset, persistence after reopen, axe. VS Code test for persistence.

## Phase 3: US3 profile (P2)
- [ ] T007 Core `profile.ts`: `profileSamples(line, maxPoints, cellMeters)` (great-circle spacing, distances), `summarizeProfile` (min, max, rise, fall, gaps), `profileCsv`. Test `tests/core/raster-profile.test.ts`.
- [x] T008 Worker: message `profile` in `tilerProtocol.ts`, `tilerWorker.ts` (one window read at a suitable level, nearest sampling the way `point()` does, no-data and outside as NaN), `tilerClient.ts` method. Test against `point()` at five places in the web spec.
- [x] T009 Draw: purposes `profile` and `area` in `packages/core/src/draw/shapes.ts`, controller palettes in `MapView.svelte` (line/freehand and polygon/rectangle/circle/freehand), map controls `rasterProfile` and `rasterArea` in `mapControls.ts` (`layerKinds` available only for a raster; vector layers never see them), store `toggleDrawPurpose` wiring.
- [x] T010 UI `RasterProfile.svelte`: SVG chart with gaps, summary, hover marker on the map, CSV through `saveFile`, table alternative for screen readers; shown at the foot of the map while a profile shape exists. Web tests: profile equals `point()`, gap outside raster, CSV, keyboard.

## Phase 4: US4 area statistics (P2)
- [x] T011 Core `areaStats.ts`: `AreaStatsAccumulator` (count, excluded, sum, sumsq, min, max, 64-bin histogram), `finishAreaStats`, `pointInRing`, `chooseStatsLevel(levels, bboxCells)`; test against a naive computation `tests/core/raster-area.test.ts`.
- [x] T012 Worker message `areaStats` (level choice, window read per band, centers tested against the ring transformed to the source CRS, `approximate` flag), client method.
- [x] T013 UI `RasterAreaStats.svelte` (table per band, area, histogram, approximate note), wired to the `area` shapes; web tests: exact count and mean against geotiff.js over the fixture, no-data only polygon, polygon partly outside.

## Phase 5: US2 hillshade (P1, last because it carries the risk)
- [x] T014 Record in `research.md` how `cog-tiler-wasm` 0.5.0 builds a tile (members used: `toSource`, `gt`, `levels`, `_chooseLevel`, `_levelPixelSize`, `_assembleWindow`, `nodata`, `flipY`).
- [x] T015 SPIKE (gate): in Chrome through the real app, a custom-protocol `raster-dem` source with `encoding: 'custom'` drives a `hillshade` layer over the DEM fixture; precision check of the 24-bit encoding against file values; record in `research.md`. If it fails, stop and report; US1, US3 and US4 ship without relief.
- [x] T016 Worker `valueTile.ts` (adapter with member check, warp to mercator without colors, nodata fill, 24-bit encoding, PNG), message `demTile`, client, protocol `se-raster-dem` in `rasterTiles.ts`.
- [x] T017 Core `relief.ts` (`RasterRelief` type, defaults, sanitize, MapLibre paint mapping, `canOfferRelief(facts)`), `RasterStyle.relief`, QML JSON entry; tests `tests/core/raster-relief.test.ts`.
- [x] T018 Map: DEM source `se-raster-dem` and layer `se-raster-relief` above `se-raster`, removed on layer change, paint updates without new tiles, version bump when the file's range changes; keep the terrain feature's ids untouched.
- [x] T019 Style panel "Relief" group (switch, method, direction, height, strength, colors, "values are taken as meters" note, not offered with the reason for colour or palette rasters).
- [x] T020 Web tests: relief on/off, light changes the paint only (no tile build), flat vs sloped pixel check, persistence, axe; 6x CPU performance spec (`raster-027-performance.spec.ts`: light change under 300 ms, no task over 200 ms).

## Phase 6: Polish
- [x] T021 Docs: `README.md`, `apps/vscode-ext/README.md` (raster section), `CHANGELOG.md` (Unreleased, Added), `CLAUDE.md` raster section (new capabilities, the value-tile adapter and its pin), `tests/vscode-ext/fixtures/README.md` if fixtures are added, memory note.
- [ ] T022 Full verification: core suite, lint, svelte-check, raster web specs, VS Code raster suite, QGIS read-back; record in this file.
