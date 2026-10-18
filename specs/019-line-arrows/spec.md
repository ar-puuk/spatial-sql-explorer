# Spec 019: Direction arrows on lines

**Status:** built (2026-10-17), branch `019-line-arrows`. **Request (user):** direction arrows on lines, from the pipeline list (PIPELINE.md §3).

## Purpose
A line has a direction (first vertex to last): a flow, a one-way street, a river, a route. Arrowheads along it show which way.

## Behavior
- Style panel, line layers (and mixed layers): **Arrows** = None, Along the line, Middle of the line. Along adds **Spacing** (20 to 300 px);
  both add **Arrow size** (0.5 to 4 times).
- The head follows the line's width (a thin line still gets a visible head), turns with the line, and takes the line's color and opacity,
  also when the color varies by data (`style.arrows.color` can fix another color; no control yet). A selected line's arrows take the
  selection color. Hidden classes hide their arrows.
- Works from GeoJSON and from engine tiles; the Print layout draws them with the map.
- Files: our own QML keeps them (`spatialExplorer/style`), with a note that QGIS does not draw them; SLD and Mapbox GL export say they are left out.

## Out of scope
An arrow at the end only (MapLibre places line symbols along or at the center), arrows from a direction column, reversing a line's direction,
QGIS marker-line arrows.

## How
`LayerStyle.arrows` (`ArrowSettings`, model.ts) -> one more MapLibre layer `se-line-arrow` (symbol, `symbol-placement: line | line-center`)
with an SDF chevron (markerIcon.ts `drawArrowIcon`) tinted by `icon-color`; layout and paint in expressions.ts (`arrowLayout`, `paintFor`).
