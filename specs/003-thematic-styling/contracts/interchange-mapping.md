# Contract: thematic style interchange (FR-013 to FR-015, SC-003, SC-004)

✅ = round-trips. ⚠️ = written or read with a notice item. ✗ = not
representable; it appears in the notice.

| Style element | QGIS QML (sidecar) | OGC SLD 1.1 | Mapbox GL style JSON |
|---|---|---|---|
| Renderer kind | ✅ `renderer-v2 type` | ⚠️ inferred from filters | ✅ metadata + expression shape |
| Column | ✅ `attr` | ✅ `PropertyName` | ✅ `["get", col]` + metadata |
| Category values | ✅ `<category value type>` | ✅ `PropertyIsEqualTo` | ✅ `match` |
| "No value" class | ✅ `type="NULL" value="NULL"` | ✅ `PropertyIsNull` | ✅ `case` null guard |
| "Other" class | ✅ `value=""` (all other values) | ✅ `ElseFilter` | ✅ `match` fallback |
| Ranges / breaks | ✅ `<range lower upper>` | ✅ `And(>, <=)` (first `>=`) | ✅ `case` with `<=` |
| Class colors | ✅ per-class `<symbol>` | ✅ per-rule symbolizer | ✅ expression outputs |
| Class labels | ✅ `label` | ✅ `<Title>` | ✅ metadata only (⚠️ foreign tools ignore it) |
| Hidden classes | ✅ `render="false"` | ⚠️ left out, with a notice | ✅ metadata + layer `filter` |
| Method (equal/quantile/jenks) | ✅ `<classificationMethod id>` | ✗ imports as fixed classes | ✅ metadata |
| Manual method | ✅ custom property `spatialExplorer/method=manual` | ✗ imports as fixed classes | ✅ metadata |
| Ramp id / reversed | ⚠️ colors kept, ramp name not | ✗ colors kept | ✅ metadata |
| Symbol settings (outline, opacity, width, size) | ✅ as spec 001 | ✅ as spec 001 | ✅ as spec 001 |

**Import of foreign files**:
- **QGIS** `ruleBased`, `pointCluster`, `heatmapRenderer`,
  `25dRenderer` and others: import the first symbol as a single symbol,
  with the notice "Rule-based renderer imported as a single symbol".
- **QGIS** size-varying graduated (`graduatedMethod="GraduatedSize"`):
  import the ranges with the class color only, with the notice "Size by
  value isn't supported; sizes were ignored".
- **QGIS** data-defined properties and labeling: notice items.
- **SLD**: rules that don't match the shapes above give the notice "N rules
  couldn't be read". If none match, the style imports as a single symbol.
  GeoLibre's leading "< first value" guard rule is recognised and skipped.
- **Mapbox**: when `metadata["spatial-explorer:renderer"]` is present, it
  wins. Otherwise:
  - `match` on `get` imports as categorized;
  - `step`, and a `case` chain of `<`/`<=` comparisons, import as
    graduated (fixed classes);
  - `interpolate` imports its stops as graduated breaks, with the notice
    "Smooth gradient imported as classes";
  - anything else is a notice item.

**Fixtures** (`tests/core/fixtures/style/`):
- `spikes/categorized.qml` and `spikes/graduated.qml`, written by QGIS 4.2.3;
- one hand-written SLD and one Mapbox file per renderer;
- one GeoLibre-shaped SLD (with the guard rule) and one GeoLibre-shaped
  Mapbox file (with `step` and no metadata).
