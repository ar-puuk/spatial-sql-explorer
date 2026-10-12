# Contract: Style File Mapping

How the new styles are written to each format, and read back from it.
"Ours" means a file this product wrote. Research references: §5–§7.

## QGIS QML (sidecar)

| Style | Written as | Read back here |
|---|---|---|
| Color + **classed** size | The color renderer as today. Every class symbol's symbol layer gets a data-defined size: `outlineWidth` (lines) or `size` (markers, diameter = 2 × radius), `type` 3, a `CASE` expression over the size column with our class rules; null and out-of-range values get the single size. Custom property `spatialExplorer/size` = the size channel JSON. | Ours: from the custom property (lossless). Foreign expression: the color renderer only, with a note. |
| Color + **proportional** size | As above, but `type` 2: `field` plus a size scale transformer (`t` 1). Lines use scaleType Linear with exponent 1; points use scaleType Area with exponent 0.5. `minValue`/`maxValue` is the domain, `minSize`/`maxSize` the size range, `nullSize` the single size. | Ours: the custom property. Foreign transformer: a Proportional channel with its parameters (Linear or Area; other scale types with a note). |
| Graduated "Vary: Size" (2026-10-12 files) | — | Migrated (FR-009), drawing the same. |
| **Bivariate** | `RuleRenderer`: 9 cell rules (fewer for smaller grids), filter `"x" <op> a AND "x" <= b AND "y" <op> c AND "y" <= d` (`>=` for the first class, `>` otherwise), plus a "No value" rule `"x" IS NULL OR "y" IS NULL`. Hidden cells use `checkstate="0"`. Labels are both range labels. Custom property `spatialExplorer/bivariate` = the renderer JSON. | Ours: bivariate from the custom property. A foreign `RuleRenderer`: today's behavior (first symbol, notice). |

QGIS draws all of the above natively (SC-005, checked by a QGIS render
comparison in the tests).

## OGC SLD 1.0

| Style | Written as | Notice |
|---|---|---|
| Color + classed size | One rule per (color class × size class) pair, the filter ANDing both tests. | — |
| Color + proportional size | As classed, with 5 equal steps over the domain. | "Proportional sizes are written as 5 steps." |
| Bivariate | One rule per visible cell, plus "No value". | Hidden cells left out; "SLD has no bivariate palette: it reloads as a single symbol." |
| Import of the above | The single symbol, with "Classes on two columns can't be read from SLD; use QML or Mapbox GL to keep them." | |

## Mapbox GL style JSON

| Style | Written as |
|---|---|
| Color + size | `line-width` / `circle-radius` (and `icon-size` for shaped markers) from the viewer's own expressions: `match` on the size class, or `interpolate` / `sqrt` for proportional. |
| Bivariate | `fill-color` / `line-color` / `circle-color` from the bivariate cell `match`; hidden cells in the layer filter. |
| Read back | Ours: lossless from `metadata` (as today). Foreign: a linear `interpolate` on one property with two stops in `line-width` / `circle-radius` becomes a Proportional size channel; otherwise today's note. |

## Notices (FR-024)

`previewExportNotice(style, format, resolved)` lists everything above
before saving, and the Save menu shows it, as it does today.
