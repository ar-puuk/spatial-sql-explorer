# Spec 014: Map controls and quality-of-life tools

**Status:** in progress, branch `014-map-controls` (started 2026-10-15).
**Request (user, 2026-10-15):** mapgl-style quality-of-life improvements: select by polygon, a measure tool, draw
tools; a right-rail panel to choose which map buttons show; a position control for the buttons; a terrain on/off
switch with an exaggeration slider and a cursor elevation readout. Not feature enhancements: no flow maps, no `.gdb`.
Research: the mapgl R package (MIT) and GeoLibre's Controls menu and terrain dialog. Terra Draw (MIT) for drawing.

## Decisions (user, 2026-10-15)

- Scratch shapes for querying and filtering are fine (not feature editing). They are per session; the user can export them
  (GeoJSON and, through the existing Export dialog, other formats) if they want to keep them.
- Shapes are exposed to SQL as a `drawn` view (recommended; user agreed), plus "Insert as SQL" with the geometry inlined.
- A shape can both **select** rows (ids into the existing Selection) and **filter** them (a standing predicate). The
  predicate defaults to *intersects*; the user can change it (within, contains, centroid within).
- The controls panel is a fourth right-rail tab with a sliders icon ("Map controls"), not a gear. The choice is global
  (a user preference through `HostAdapter.saveState`), not per file.
- A position control: the user picks the corner for each group of map buttons, with defaults that avoid the search box,
  the legend and the attribution.
- Terrain: an on/off switch with hillshade shading, a vertical exaggeration slider, and a cursor elevation readout.
  A DEM is a height source, not a second basemap: exactly one basemap is still drawn (CLAUDE.md amended).
- Defaults on: zoom, zoom to layer, reset view (shown when the map is tilted or rotated, as today), globe, export
  image, scale bar (as today), draw, measure, select by shape. Off: coordinates, terrain.

## Order of work (least complicated first; similar features together)

1. **Controls registry, panel and positions** (this is the foundation; every later control is one row in it).
   Existing buttons (zoom, zoom to layer, globe, export image, reset view) and the scale bar move onto the registry.
2. **Display controls**: reset view always available when enabled, scale bar toggle, on-map coordinates with
   click-to-copy.
3. **Hover tooltips** with a column picker.
4. **Terrain**: switch, hillshade, exaggeration, elevation readout.
5. **Draw and measure**: toolbar on Terra Draw, live distance, area and perimeter.
6. **Select and filter by shape**, the `drawn` view, Insert as SQL, export of shapes.

Already present and therefore not built: map image export, place search, cursor coordinates in the status bar, the
globe toggle, clicking a legend class to hide it.

## Constraints

- `core` and `ui` stay free of `vscode`, File API and IndexedDB; preferences go through `HostAdapter`.
- Chrome uses VS Code tokens; canvas colors (Terra Draw, hillshade) are read with `getComputedStyle` and re-applied on theme change.
- Keyboard access for every control (toolbar arrow keys, Esc and Enter while drawing).
- Heavy libraries (Terra Draw) are lazy-loaded; nothing is paid until used.
- Spike before building on a risky assumption (research.md): Terra Draw on maplibre-gl 6.x; terrain draping of our
  layer types and the globe; the keyless Terrarium DEM under the webview CSP.
