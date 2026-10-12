# Quickstart: Validating Multi-Channel Styling and Bivariate Maps

## Prerequisites

- `npm install` at the repo root. The engine comes from the test mirror in
  browser tests (`ENGINE_MIRROR=1`, handled by the Playwright config).
- For the QGIS checks: QGIS 4.2.3 with PyQGIS at `C:\OSGeo4W`.
- Fixtures:
  - an existing line layer with a text and a numeric column, and a polygon
    layer with two numeric columns (`tests/vscode-ext/fixtures`, e.g.
    `parcels-10k.geojson`);
  - two new files, written by `scripts/fixtures-009.mjs`:
    - `roads-traffic.geojson`: lines with `functional_class` and `aadt`;
    - `counties-bivariate.geojson`: polygons with `poverty_rate` and
      `obesity_rate`, plus some nulls.

## Automated

```sh
npm run test:core          # resolve, expressions (map = legend per channel), migration, interchange, palettes
npm run test:web           # style-channels.spec.ts, style-bivariate.spec.ts, existing style specs unchanged
npm run test:vscode-ext    # sidecar save / reopen for both new styles
npm run typecheck:core && npm run typecheck:ui && npm run lint
```

QGIS parity (SC-005): run
`C:\OSGeo4W\bin\python-qgis.bat tests/qgis/check_009.py <out-dir>`. It
loads the QML files the tests saved, renders each in QGIS, and compares
colors and widths per feature against the app's expected values.

## Manual scenarios

1. **Color + width (US1)**: open `roads-traffic.geojson`, then Layer style →
   Categorized → `functional_class`, Size by column on → `aadt`.
   - Expect: lines keep their class colors; widths step through 5 classes;
     the legend shows two groups.
   - Turn Size off: widths return to the single width.
2. **Proportional (US2)**: switch Size to Proportional on a point layer.
   - Expect: a halfway value is drawn at the "Area" halfway size
     (rMin + (rMax − rMin)·√0.5); the legend shows 3–5 reference sizes.
3. **Migration (US3)**: open a file whose sidecar was saved with Graduated
   "Vary: Size" (fixture `tests/core/fixtures/style/symbols/pt_gradsize.qml`
   or one saved by the 2026-10-12 build).
   - Expect: the same sizes, shown as Single + a Classed size channel.
4. **Bivariate (US4)**: open `counties-bivariate.geojson`, then Layer style
   → Bivariate → `poverty_rate` × `obesity_rate`.
   - Expect: a 3×3 legend; the cell counts plus No value equal the feature
     count; hovering a cell shows both ranges.
   - Arrow keys move through the cells, and Enter hides one.
   - Swap the axes and change the palette: the map and legend stay
     consistent.
5. **Exchange (US5)**: Save (QML) and reopen; open the QML in QGIS; export
   SLD and Mapbox GL and re-import each.
   - Expect: the notices listed in
     [contracts/interchange-mapping.md](./contracts/interchange-mapping.md).
6. **Map image (US6)**: save a PNG of each style.
   - Expect: the legend groups and the bivariate square are in the image.
7. **Large result (SC-007)**: run a query giving ~1M rows (the spec 007
   large-data fixture), then style it bivariate.
   - Expect: classification takes ≤ 2× the time of a graduated style on one
     of the columns (the `Classifying …` note times it in e2e mode).
