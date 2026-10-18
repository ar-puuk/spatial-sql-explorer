# Spec 021: Grid extras (covering and smoothing)

**Status:** built (2026-10-17), branch `021-grid-extras`. **Request (user):** the grid extras left out of spec 017: polyfill of polygons,
aggregating up, neighbor analysis. This spec reverses spec 017's "centroid only" rule for lines and polygons as an option.

## What was asked, and what was built

| Asked | Built |
|---|---|
| Polyfill | **Every cell touched** (H3 and A5): a line or polygon is in every cell it touches. |
| Neighbor analysis | **Smooth** (H3): each cell takes in its neighbors within a number of rings you choose. |
| Aggregating up | **Not built**: the dialog bins from the rows at any resolution, so a coarser grid is the Size slider moved; rolling up cells would only matter for a table of cells that is no longer the layer. |

## Behavior
- The Bin into cells dialog gains **Features** (Center, or Every cell touched), for a layer with lines or polygons, and **Smooth**, for H3: a switch, and when it is on
  a whole number of rings (an integer field with themed up and down buttons and the arrow keys; 1 to 50, a safety limit. A disk has 3k(k+1)+1 cells: over 10 rings the dialog warns what it costs, and the estimate asks before a huge result). The query it writes is the product, as before: the SQL tab holds it and it can be edited.
- **Every cell touched.** A feature counts once in each cell it touches (so a count adds up to more than the features, and a sum counts a
  feature's value in every cell). A polygon smaller than a cell gets its center's cell. Points are in one cell either way. A shape outside the
  world is left out and counted, as before.
- **Smooth.** The value of a cell is that of its neighborhood: counts and sums add, minimum and maximum combine, an average is the neighborhood's
  sum over its values. The cells spread past the data, so the result has more cells; the legend title says "with neighbors within N rings".
  Not for a median (it cannot be combined across cells) and not together with Every cell touched (a feature would count in every
  cell it touches, in every neighborhood): choosing one clears the other.
- The estimate of how many cells (and so whether the preview draws at once) follows both: covering from the layer's average feature size (read
  once when the dialog opens, the first 5,000 rows), smoothing from the disk (3k(k+1)+1 cells per ring count k), so a large number of rings asks before it draws.

## Findings from the spikes (the real engine; why it is built this way)
- H3 `h3_polygon_wkt_to_cells` keeps cells whose center is inside and gives none for a small polygon; `h3_polygon_wkt_to_cells_experimental(..., 'overlap')`
  gives every touched cell. It reads one polygon (a multi-polygon gives none): parts go one by one through `ST_Dump`. H3 has no function for lines.
- **A5's `a5_geometry_to_cells` is not reliable**: for a 0.4 by 0.3 degree polygon it found 8 cells at resolution 9, where thousands lie inside; for a line,
  gaps; for a polygon smaller than a cell, none. **A5's `a5_grid_disk` returns 3 cells for one ring and 11 for two** (a pentagon has 5 edge neighbors).
  So A5 is covered by sampling (cells of points along the boundary and lines, a quarter of an edge apart, and of a grid of points inside, a third of an
  edge apart; both capped) and has no smoothing. The tests check every point of a fine grid inside the polygon (and along the line) lies in a cell of the cover.
- A5's drawn cells are approximations: their union does not exactly cover a polygon, and a cell's lon/lat centroid is not always in the cell.
- Lambda names in the generated SQL are prefixed `_`: a lambda parameter named `g` or `v` silently lost to the query's own columns.

## Out of scope
Cover for a polygon crossing the date line (read as outside the world), smoothing for A5 (until its neighbor function is complete), kernel weights,
joins between grids, distinct counting of features in a neighborhood.
