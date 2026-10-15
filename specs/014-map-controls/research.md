# Research: spec 014 spikes and what they showed

**Date**: 2026-10-15 (all against the real web build in installed Chrome; tests in `tests/web/specs/*-014.spec.ts`).

## Terra Draw on maplibre-gl 6.13

`terra-draw` 1.37.0 with `terra-draw-maplibre-gl-adapter` 1.5.0 (peer `maplibre-gl >=4`, MIT) works on MapLibre 6.13 in the
app: all drawing tools, edit mode (select, delete), Escape to cancel, Enter to finish, and the map's own pan, tilt and
rotate untouched while no tool is open. It builds as its own lazy chunk (251 kB, 46 kB gzip), loaded the first time a
tool opens. Its helper features (closing, midpoint, coordinate points) carry `mode` too: the controller keeps only
finished `finish` events and the line or polygon being drawn (for the live label).

## Terrain

- `queryTerrainElevation` returns the exaggerated height: the readout divides by the exaggeration (checked: a flat 1,000 m
  DEM reads 1,000 m at 1× and at 2.5×).
- Terrain with the globe projection raised no error in the test (terrain stayed set across a globe toggle).
- The DEM source and the hillshade layer must not start with `se-`: `replaceDataSource` removes every `se-` layer and an error
  on a non-`se-` source counts as a basemap failure, so terrain has its own error path. `swapBasemap` inserts the new basemap
  under the hillshade.
- Keyless Terrarium tiles at `s3.amazonaws.com/elevation-tiles-prod/terrarium`; CSP `connect-src` and `img-src` gained
  `https://s3.amazonaws.com` (VS Code). Attribution links to the Tilezen list of sources (the full required credits are many
  national agencies; the compact attribution links to them).
- Hillshade is on with terrain (without it the surface barely reads on flat-colored basemaps). Its colors follow the basemap
  (`reliefKindFor`, `hillshadePaint` in terrain.ts): a white highlight over satellite imagery looked glossy (user report,
  2026-10-15), so imagery gets shadows only at a low exaggeration, dark maps a faint highlight, the rest a soft one.

## Measurements

The live labels and the `drawn` table use spherical formulas (within about half a percent of the spheroid: a 1° square on the
equator is 12,364 km² against 12,308 km²). DuckDB's `ST_*_Spheroid` functions were not used: they take lat/lon axis order
(a trap) and were not verified in the WASM build. Revisit if exact areas are wanted.

## Select and filter by shape

The shape is compared in the layer's CRS (`ST_Transform` of the union of shapes): a UTM 12N layer's selection equals an
independent WGS84 query (tests). Selection is by `__se_rowid` in the engine. A standing filter is a restriction beside the
column filters (`QuerySession.setSpatialFilter`), cleared with a new result.
