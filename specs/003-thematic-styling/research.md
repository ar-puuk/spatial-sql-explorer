# Research: Thematic Styling (spec 003)

Phase 0 of `/speckit-plan`. Each item gives the **decision**, the
**evidence** (spikes run on 2026-10-10 against the real tools) and the
**alternatives** considered. The spike scripts' outputs are kept in
`spikes/` and become test fixtures.

---

## 1. QGIS compatibility of the sidecar (FR-013, SC-003)

**Decision**: write QGIS's own `renderer-v2` structures:
- `categorizedSymbol` with one `<category>` per class:
  - "No value" is `type="NULL" value="NULL"`;
  - "Other" is the empty value `value=""`, which QGIS treats as "all other
    values";
  - hidden classes have `render="false"`.
- `graduatedSymbol` (`graduatedMethod="GraduatedColor"`) with one `<range>`
  per class (`lower`, `upper`, `label`, `render`) and
  `<classificationMethod id="EqualInterval|Quantile|Jenks">`.

Every class gets its own `<symbol>`, built the same way as today's single
symbol, with only the color changed.

**Evidence** (`spikes/categorized.qml`, `spikes/graduated.qml`, written by
QGIS 4.2.3 via PyQGIS from `C:\OSGeo4W`):
- QGIS saved, and then reloaded:
  - a categorized renderer with R1, a hidden R2, a NULL category and an
    "all other values" category;
  - a graduated renderer with 5 quantile ranges, one of them hidden.
- After reloading, every value, color, label, `render` flag and the
  classification method came back unchanged.

These two files are QGIS's own output, so they become the import fixtures
and the targets of the export comparison.

**Manual classes**: QGIS has no "manual" method id. On export, the method
element is omitted and a `<customproperties>` option
`spatialExplorer/method = manual` is added. QGIS keeps the explicit ranges
and ignores the unknown property. Import reads the property back. The plan
includes a PyQGIS check that such a file loads (quickstart Scenario 4).

**Alternatives**: our own JSON sidecar (rejected in spec 001, which chose
QML for QGIS interop), and writing a rule-based renderer instead (it loses
the categorized/graduated editing UI in QGIS).

---

## 2. Class boundaries: upper-inclusive, as in QGIS (spec amendment)

**Decision**:
- A graduated class covers `lower < value ≤ upper`, and the first class
  also includes its lower bound.
- This is QGIS's convention. A value exactly on a break belongs to the
  class below, and the map, the legend counts, the QML and QGIS all agree.

**Evidence**:
- QGIS's ranges in `spikes/graduated.qml` share bounds (each `upper` equals
  the next `lower`).
- QGIS's Jenks breaks are data values, the largest value of each class. With
  "≥ lower bound" semantics (GeoLibre's `step` approach), every
  break-valued feature would land one class higher than in QGIS.

**Spec impact**: FR-004 said "each class is defined by its lower bound".
That wording is amended to the upper-inclusive rule above. GeoLibre's real
fix, flat-color classes with no gradient blending, is kept.

**Alternatives**: lower-bound semantics with MapLibre `step`. It is simpler
to express, but disagrees with QGIS on boundary values.

---

## 3. Classification methods: clean-room, verified against QGIS (FR-004, SC-002)

**Decision**: pure functions in `packages/core/src/style/classify.ts`, run
over the displayed result's non-null numeric values.
- **Equal interval**: `min + i·(max−min)/k`.
- **Quantile**: QGIS's linear interpolation, `a = q·(n−1)`, interpolated
  between the sorted values at `⌊a⌋` and `⌊a⌋+1`.
- **Natural breaks (Jenks)**: the exact optimum, the minimum within-class
  sum of squares, using a 1-D dynamic program with divide-and-conquer
  optimization (O(k·n·log n)). Written from the published algorithm, not
  from any library.

Duplicate breaks collapse (FR-004). Fewer distinct values than classes
yields one class per value.

**Evidence** (`spikes/values.json`: 500 log-normal values; `spikes/qgis-breaks.json`: QGIS 4.2.3's breaks, k = 5):

| Method | Ours vs QGIS |
|---|---|
| Equal interval | **identical** (to 1e-6) |
| Quantile | **identical** |
| Jenks | 3 of 4 breaks identical. The 2nd break is 43,248.04 (ours) vs 42,720.28 (QGIS), adjacent sorted values |

On that one difference, our breaks have a **lower** within-class sum of
squares (2.574883e10 vs 2.575343e10), so ours are the better fit.

QGIS's Jenks is therefore not an exact-optimum reference. The SC-002
reference for natural breaks is redefined accordingly:
- the provable optimum, checked by brute force on small sets;
- plus QGIS's breaks on the fixture where they agree;
- plus the one documented difference, asserted as "ours has the lower
  within-class sum of squares".

QGIS's quantile also counts nulls as 0 (seen in the first spike run). Ours
excludes them into the "No value" class (FR-004).

**Timing** (Node 26, k = 10): 50,000 values **49 ms**; 200,000 values
**231 ms**. Natural breaks therefore run exactly up to 200,000 non-null
values. Above that, they run on 200,000 evenly spaced order statistics
(quantile-preserving), and the legend caption says "estimated from
200,000 values". Equal interval and quantile are always exact.

**Alternatives**:
- A dependency such as simple-statistics' `ckmeans`, rejected by
  Constitution X: it is about 60 lines of our own code, unit-tested.
- Copying QGIS's Jenks: it is GPL, Constitution VIII forbids copying, and
  it is less accurate.
- Sampling to 1,000 values like GeoLibre: needless, since exact is fast
  enough.

---

## 4. Where classification runs, and how the map draws it (FR-005, FR-016, SC-001, SC-007)

**Decision**:
- Classes are computed in `packages/core` from `layer.features`, which
  already holds every row of the displayed result in memory (spec 002).
  This needs no extra engine queries and is host-agnostic.
- The map gets **data-driven paint expressions** built in core
  (`style/expressions.ts`). This means:
  - a new ramp, a reversed ramp or a color edit only updates paint
    properties, with no GeoJSON re-upload;
  - a hidden class changes the layer filter.

**Expression rules** (spike: MapLibre style-spec 26.4.4 in Node):
- `to-string` on numbers and booleans equals JS `String()` in every case
  tried (`1`, `1.5`, `0.1+0.2`, `1e21`, `true`, `-0`, `1/3`), so
  categories match by string, as the classifier does.
- **`to-number` turns `null` and `""` into 0.** That is how GeoLibre ended
  up painting nulls in the first class. Every expression therefore checks
  null and empty first, and the classifier's `toNumber()` uses the same
  rules ("12.50" gives 12.5, "abc" gives no value, booleans give no value).
- Graduated uses a `case` chain of `<=` tests (upper-inclusive, §2), not
  `step`.

**Verification design**: core unit tests evaluate the generated expressions
with `@maplibre/maplibre-gl-style-spec`, which is already installed with
MapLibre and added as a dev dependency of `tests/core`. They do this for
every feature in the fixtures and assert the same class as the classifier.
This proves "legend = map" (SC-006) without a browser.

**Timing budget** (SC-001, ~22,000 features):
- Measured: categorize (one pass with a `Map`) and quantile (sort) take a
  few ms; Jenks takes under 50 ms at 50,000 values.
- Repaint is a `setPaintProperty` / `setFilter`, as for spec 001 styles.
- To be measured in the performance spec: whether the whole change lands
  under 1 s.

**Alternatives**:
- A precomputed class-index property per feature: always exact, but every
  class change needs a GeoJSON `setData`, which is slow on 50,000 rows.
- SQL in DuckDB: needs the session and is slower for a 1,000-row result.
  Kept as a later option for viewport loading.

---

## 5. Column eligibility and types

**Decision**:
- `Layer` gains `columns: {name, type}[]`, the attribute columns of the
  result. It is already computed by `DESCRIBE` in `query/run.ts` and in
  `openFile.ts`, but not passed on today.
- Graduated offers columns whose DuckDB type is numeric:
  `TINYINT…HUGEINT`, `U*INT`, `FLOAT`, `DOUBLE`, `DECIMAL(p,s)`.
- Categorized offers every non-geometry column: text, numbers, booleans and
  dates.
- Values reach the UI already sanitized: DECIMAL may arrive as a numeric
  string, and very large HUGEINT values as strings. They go through the
  shared `toNumber()` from §4.

**Alternatives**: sniffing JS value types. It is wrong for an all-null
first page, and for DECIMAL-as-string.

---

## 6. Ramps and palettes (FR-007, FR-008, FR-019)

**Decision**: a fixed catalog as **data** (`style/ramps.ts`: id, name,
kind, colors), in the same spirit as the basemap catalog.

- **Sequential**: Viridis (default for Graduated), Cividis, Magma, plus
  ColorBrewer Blues, Greens, Oranges, Reds, Purples, YlOrRd, YlGnBu.
- **Diverging**: ColorBrewer RdBu, RdYlBu, BrBG, PiYG, Spectral.
- **Qualitative**: ColorBrewer Set2 (default for Categorized up to 8
  classes), Dark2, Set1 and Paired. Set3 and Paired cover 12 classes.

**Default categorized palette**: Set2 up to 8 classes and Paired from 9 to
12. If the user picks a palette with fewer colors than classes, colors
repeat in order, with a notice in the panel.

**Color counts**:
- Sequential and diverging ramps are sampled to the class count. For
  ColorBrewer, its own n-class definitions are used, up to its maximum,
  then interpolated in Lab space.
- Viridis, Cividis and Magma are stored as 11 anchor colors and
  interpolated.

**"Other" and "No value"**: neutral grays, `#bdbdbd` and `#8c8c8c`,
outside every palette.

**Licenses**:
- ColorBrewer color specifications are Apache-2.0 (Cynthia Brewer, Penn
  State). The notice goes in THIRD-PARTY-NOTICES. They are data, not code.
- Viridis, Magma and Cividis are CC0.

**Readability on both basemaps (FR-008)**:
- The polygon outline (the shared symbol settings) separates pale
  low-end colors from light basemaps.
- The default Viridis already has a dark low end and a bright high end.
- The implementation's screenshot review checks every default on Positron
  and Dark.

**Selection (FR-019)**: the selected feature already gets a thick outline
in the theme's selection color. For thematic styles, the outline gains a
second contrasting halo ring (dark under light, light under dark), so the
selection never depends on hue alone. The axe/visual check covers Blues,
the worst case against a blue selection color.

**Alternatives**:
- GeoLibre's 20 ramps (including jet and turbo): jet is not
  perceptually ordered, and there is no qualitative set.
- User-defined ramps: out of scope (spec Assumptions).

---

## 7. SLD and Mapbox GL interchange (FR-014, FR-015, SC-004)

**SLD** (OGC SE 1.1, as the spec 001 writer already uses):
- **Categorized**: one `<Rule>` per class, carrying the class label in
  `<Title>`, and filters as follows:
  - `PropertyIsEqualTo` for values;
  - `PropertyIsNull` for "No value";
  - `<ElseFilter/>` for "Other".
- **Graduated**: one `<Rule>` per class with
  `And(PropertyIsGreaterThan lower, PropertyIsLessThanOrEqualTo upper)`.
  The first class uses `GreaterThanOrEqualTo`.
- **Lost in SLD, with a notice** (FR-015):
  - the method;
  - hidden classes, which are left out of the file;
  - Manual. Import yields fixed classes.
- **Import** recognises exactly these shapes, plus GeoLibre's leading
  "< first" guard rule, which it skips. Anything else becomes a notice
  item.

**Mapbox GL style JSON**:
- **Paint**: the same expressions as the map (§4). Foreign tools draw the
  style correctly, null handling included.
- **Metadata**: the whole renderer (method, ramp, reversed, labels, hidden
  classes, manual) goes in the layer's `metadata` under
  `"spatial-explorer:renderer"`. The Style Specification allows arbitrary
  metadata keys, so Mapbox and MapLibre styles round-trip losslessly here.
  GeoLibre exports no metadata.
- **Foreign styles** without that key: `match`, `step`, `case` and the
  legacy `interpolate` (read as stops) are parsed into classes. Anything
  else becomes a notice item.

**Export notices are computed before writing**, so the export menu can show
them ("SLD can't store the classification method or hidden classes: 1
hidden class will be left out").

---

## 8. Legend placement and behavior (FR-010)

**Decision**:
- An on-map card in the **top-left** corner. Zoom and style controls are
  top-right, the scale bar bottom-left and the attribution bottom-right.
- It is collapsible to its header, and the collapsed state is remembered
  through `HostAdapter.saveState('legend.collapsed')`.
- **Contents**: column and caption (e.g. `value · Quantile, 5 classes`),
  then rows of swatch, label and count. The "No value" and "Other" rows
  come last.
- **Limits**: at most 14 rows (12 classes plus "Other" and "No value").
  It scrolls if the map is short.
- **Interaction**:
  - each row's swatch toggles visibility (FR-009), and the row dims when
    hidden;
  - the rest of the map stays interactive.
- **Hidden** in Single-symbol mode with the default style. With a custom
  single symbol it shows one row.

GeoLibre's "edit mode" legend (renaming classes in the legend) is not
copied. Labels are edited in the style panel's class list, so there is one
place to edit.

---

## 9. State: what is saved, what is derived

**Decision**:
- The persisted style model holds the settings, plus classes only when they
  can't be derived:
  - **Manual** classes are stored in full;
  - otherwise only **user overrides** are stored: per-class color, label
    and visibility, keyed by category value or by class index.
- Counts and method-computed breaks are **derived** on every data change
  (FR-011). That is why new query results reclassify while edits survive.
- A **missing or incompatible column** (FR-012) is a derived state
  `{status: 'fallback', reason}`. The renderer settings stay untouched, and
  the map draws the single symbol until the column returns.

---

## Residual risks

- **Very large "Show all" results** (more than 200,000 rows): Jenks is
  estimated (§3) and the other methods are exact. Memory is bounded by the
  rows already loaded (spec 002).
- **QGIS 3.x LTR compatibility**: the spikes used QGIS 4.2.3. The
  `renderer-v2` category/range format is unchanged since QGIS 3.10. One
  PyQGIS read check on whichever QGIS is installed runs in the quickstart.
