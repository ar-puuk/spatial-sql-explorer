# Changelog

All notable changes to Spatial Explorer are documented here. The VS Code
extension and the web app share one engine (`packages/core`, `packages/ui`)
and are versioned together. The pre-rebuild single-page app is tagged
`legacy-v1`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **GeoTIFF and Cloud-Optimized GeoTIFF (view and inspect).** A `.tif` or `.tiff` opens as the one layer (replacing the vector layer, and replaced by one). It is drawn on the map from the parts in view only (byte ranges: a 4.9 GB COG shows its first view in 1.4 s having read 0.1% of the file), in any common coordinate system. A card lists its facts (coordinate system, size, bands, data type, no data, compression, tiling, overviews), the value of every band under the cursor shows beside the coordinates and in the status bar (no data as "no data"), and the right-click menu copies the location and the values. The style panel draws one band with a color ramp (107 colormaps, picked from previews) or three bands as a colour image, with a range that starts at the 2nd and 98th percentile and is marked on a histogram, a curve and gamma, how no data is shown, and opacity; a colour table raster is drawn with its own classes. A color bar sits on the map and on the print page. The style is saved as a QGIS `.qml` (QGIS loads it with the data; ours carries the full style too) and remembered for the file. A GeoTIFF that is not stored in tiles is prepared as a COG in memory up to 100 million cells. In VS Code, `.tif` and `.tiff` open in Spatial Explorer by default. Nothing that needs rows (SQL, the table, filters, Draw and Select by shape, the grid and dot tools, the time slider) is shown for a raster; Measure is. The raster engine (about 4.6 MB, and 6.7 MB more for the preparing step) is downloaded once, checked against recorded hashes and kept, like the SQL engine. Raster analysis (slope, hillshade, band math, zonal statistics and the like), several rasters and vector data over a raster are not part of it.

### Fixed

- **Bin into cells and Dot density used every row of the layer after a query** (issue #2). When the table showed a query result (for example `SELECT * FROM layer WHERE state = 'UT'`), the cells and the dots were still made from the whole layer, with no hint. They now read the rows on show: the query behind the result is written into the generated SQL as a subquery, and the column filters on that result apply too. What the dialog reads is fixed when it opens, so changing the resolution or the amount per dot after the preview keeps working. "Selected rows only" is offered for the layer itself, not for a result; a result with no geometry cannot be put in cells.
- **A GeoPackage or GML file in EPSG:27700 (British National Grid) or EPSG:31467 failed to open** with "Transformation cannot be formatted as WKT1 TOWGS84 parameters" (issue #1). In the browser build of the engine, listing a file's layers (`ST_Read_Meta`) raises an error PROJ would otherwise handle for these systems, although reading and reprojecting the data work. The layers of a GeoPackage are now read from its own catalog tables when that happens, a GML file opens as its first layer, and the output log says why. A placeholder until the engine is fixed (reported as duckdb/duckdb-spatial#901); findings in `specs/issue-1-towgs84.md`.

## [1.0.1] - 2026-10-19

A patch release: a GTFS feed is now two layers, drawn together, instead of one combined table.

### Changed

- **A GTFS feed is two layers, drawn together.** Opening a feed now gives the layers `routes` (lines) and `stops` (points), each its own table with every column (`gtfs.routes`, `gtfs.stops`, and `gtfs.shapes` for the raw shape points), instead of one combined table. Both are on the map at once: the layer picker (or `layer` in SQL) chooses which one is open, and that one has the table, the filters, the selection and the export; the other is drawn beside it with the same style (one style for the feed: the line settings for routes, the marker settings for stops). Choosing the other layer opens the feed again for it (a few seconds). Both layers have `color` (`#RRGGBB`, what the default style paints with) and `name` (what labels read). The layer picker shows how many routes and stops there are.

## [1.0.0] - 2026-10-19

The first stable release: the scope the project set out with (look at a file, query it with SQL, style it, export it, in VS Code and in the browser) is complete. This release adds GTFS transit feeds and visibility by zoom, and cleans up the development warnings. File Geodatabase support stays marked experimental.

### Added

- **GTFS transit feeds.** Open a feed (a `.zip`, a folder of its text files, or the loose `.txt` files) and see the network at once: every route as a line in its own `route_color` (direction arrows are one switch away in the style panel, off by default), and every stop as a dot in the color of a route that serves it; names show from zoom 13. A feed is recognized by what is inside it (stops, routes, trips and stop times, then their columns), never by its name, so `GTFS.zip`, `google_transit.zip` and `data.zip` all work, and a zip holding a feed and another zip opens the feed. On the web: Open file, "GTFS folder…" in the menu, or drop a folder or the files. In VS Code: right-click the `.zip`, a folder, or one of the feed's `.txt` files and choose Open in Spatial Explorer. The feed is a schema named after it: the open layer `network` (routes and stops together), `routes`, `stops` (with the routes serving each one), and every other table (`calendar`, `stop_times`, ...), all queryable and exportable. The look follows GTFS-X's decisions. Line geometry is read by GDAL's GTFS driver (the gdal3.js reader a geodatabase also uses, downloaded once) and, where that is not available, built in SQL from the feed's own tables. A notice says when routes without a shape are drawn through one trip's stops, and counts routes with no trips and stops with no coordinates. Routes and stops only: no timetables, service-day filter or analysis.
- **Visibility by zoom.** The style panel has a two-handle "Zoom" slider beside Opacity: the layer shows from the first zoom up to the second (0 and 24 mean no limit), two small triangles, above and below the track, mark the map's current zoom (grey when the layer is hidden there). "Sizes follow zoom" (Appearance) makes marker size, outline and line widths grow from a fraction of their size at a low zoom to full size at a higher one, with separate fractions for markers and lines. Both are part of the style: saved in the QGIS file (also as QGIS's scale-based visibility, so QGIS shows the layer in the same range), written to Mapbox GL as `minzoom`, `maxzoom` and zoom curves, and kept in the share link.
- Labels can start at a zoom level (`minZoom`), kept in the QGIS style file.
- GTFS feeds start with sizes that follow the zoom, so a city-wide view reads as lines, not a chain of stops: stops a third of their size and lines 60% at zoom 10 and below, full from zoom 14; stops are radius 5 with a 1.5 px white outline, lines 3 px.

### Changed

- Development: `npm run lint` no longer reports the built output (it printed about 33,000 errors for `dist` and `out`), and the three non-null assertions in the grid code are gone, so it reports nothing. The dev server no longer tries to watch the test engine copy (an `EBUSY` error on every start on Windows). A `.gitattributes` keeps one line ending in the repository. `package.json` records which install scripts may run (esbuild and vsce-sign: yes; core-js: no).

### Fixed

- A folder named like a data file (`feed/` beside `feed.zip`) was served to the viewer as if it were one of its sidecar files, which stopped VS Code's file server.

## [0.9.1] - 2026-10-18

A fix for the heatmap's Automatic setting.

### Fixed

- **Heatmap, Automatic.** On dense data it drew one huge blob. Automatic now also sizes the radius from how close the points lie (kept editable), sets the intensity so the densest 2% of points take the last color (one hot spot no longer sets the scale), and spreads the ramp so sparse areas stay distinguishable. Manual heatmaps are unchanged.

## [0.9.0] - 2026-10-18

File Geodatabases and zipped data (experimental), and a fix for Firefox.

### Added

- **File Geodatabase (experimental).** Open an Esri `.gdb` folder or a `.gdb.zip`: in VS Code, right-click it and choose Open in Spatial Explorer; on the web, choose or drop the folder. A layer that records no coordinate system asks for one. Its layers (and attribute tables) are listed, grouped by feature dataset, and each layer is a table in the geodatabase's schema (`network.roads`), read the first time a query names it, so layers can be joined. Every column is kept. Converted layers are cached (VS Code's storage, the browser's origin-private storage) so opening one again is immediate, and can be cleared (Spatial Explorer: Clear Geodatabase Cache; "Clear stored layers" in the web header). The reader is gdal3.js (GDAL in WebAssembly, LGPL, about 40 MB): downloaded once the first time, checked against a recorded hash, kept for offline use, run in a separate process in VS Code and in a worker on the web.
- **Domain descriptions.** A geodatabase column with a coded domain shows its description in the table, the selected feature's card, the hover tooltip and the column filter; a switch in the table toolbar shows the stored codes instead (remembered). SQL, filters and exports always use the code.
- **Zipped data.** A zip holding a Shapefile (with its parts), GeoPackage, GeoJSON, FlatGeobuf, GeoParquet, CSV, GML, SQLite or Excel opens as if unzipped; a zip with several datasets asks which. A zip never opens by itself: right-click it or use Open With.

### Changed

- The web app has one Open button with a menu: the label opens the file picker, the arrow offers **Geodatabase folder** (marked Experimental), which a file picker cannot choose. The separate geodatabase button is gone. Chrome and Edge use the directory picker for it, whose prompt is accurate (Firefox still shows its "upload" wording, which the landing page explains: nothing leaves the tab).

### Fixed

- **Firefox.** The web app's SQL engine never finished starting in Firefox (every file stuck on "Reading file facts…"): the block on the a5 extension's phone-home was a POST to a blob: URL, which Firefox never answers. It now goes to a URL that fails at once in every browser.
- **Geodatabases without browser storage.** Where the browser refuses origin-private storage (Firefox private windows, blocked site data: "Security error when calling GetDirectory"), a converted layer is kept in memory for the tab's life instead of failing; nothing is cached across visits there.

### Notes

- Compressed geodatabases can't be read by any open-source reader (uncompress them in ArcGIS first); tables with 64-bit ObjectIDs (ArcGIS Pro 3.2+) are untested. In the browser a layer's table files and its converted copy must fit in memory (about 3 GB).
- Firefox prints "The WebAssembly exception handling 'try' instruction is deprecated" for the SQL engine: it comes from the engine's build and goes away with an upstream rebuild.

## [0.8.0] - 2026-10-18

Queries and maps: a snippet library, dot density, a time slider, and more ways to use grid cells.

### Added

- Snippet library: a button in the query panel opens a searchable list of 24 ready-made queries for the open layer (buffer, dissolve, area in km², nearest feature in another file, and more), filled with the layer's own table and column names. Choosing one fills the editor; Tab moves between the values to change.
- Dot density: a map button for polygon layers draws a count as dots placed at random inside each polygon. Choose up to six number columns (each its own color) and what one dot stands for; the query is in the SQL tab and the same layer always gives the same dots. Up to 100,000 dots draw without asking, 1,000,000 is the most.
- Bin into cells: **Every cell touched** puts a line or polygon in every cell it touches (H3 and A5), and **Smooth** (a switch and a number of rings) gives each cell the value of its neighborhood (H3). The A5 extension's own polygon and neighbor functions are incomplete, so A5 is covered by sampling and is not smoothed.
- Time slider: a map button opens a bar with a two-handle window over a date or timestamp column and a Play button. The window is that column's filter, so the map, table and counts follow it.
- Direction arrows on lines: Arrows in the style panel (None, Along the line, Middle of the line) draw arrowheads that follow each line's direction, in its color, from GeoJSON or engine tiles.
- Search by words: a switch in the search box ranks the rows of the open layer or result whose text has every word you type, in any form ("bridges" finds "bridge"), best match first. It uses the `fts` extension; the index is built on first use, per result, and follows the column filters. The query editor now colors function calls. Bin into cells is only on the map (the duplicate button in the query panel is gone).

### Changed

- **Print map** is in its own box on the map (its own group in the Map controls panel, "Output"), apart from the tools.
- On a short map, a box of more than six map buttons lies in two even rows.

## [0.7.0] - 2026-10-17

Grid cells: bin a layer into H3 hexagons or A5 equal-area pentagons.

### Added

- **Bin into cells (H3 and A5).** A button in the query panel and one on the map turn the open layer into a grid of hexagons (H3) or
  equal-area pentagons (A5) and color each cell by the number of features, or the sum, average, minimum, maximum or median of a number
  column. The dialog shows each size in your units and about how many cells it gives, previews on the map while the result is small
  (under 5,000 cells), warns before more than 100,000, and sends the SQL it writes to the SQL tab as it previews, to edit and rerun (Cancel brings your old query back). It
  follows the column filters and the shape filter, can use only the selected rows (as the table `selected_rows`), says how many rows
  have no location, and remembers the grid and measure you used last. Cells across the date line are split in two, and the cells over a
  pole are drawn as caps. A clicked cell shows its id, with a button to copy it.
- The `h3`, `a5` and `fts` DuckDB extensions are in the engine, so `h3_*`, `a5_*` and full-text functions work in SQL. They are downloaded
  once like the others, from pinned URLs and checked against SHA-256 hashes (H3 and A5 from community-extensions.duckdb.org), and the
  app starts without them if a download fails.

### Changed

- A color given a legend title now names the legend (the heading reads "Number of features · Quantile, 5 classes", not "value · ...").

### Security

- The A5 extension reports its name and version to Query.Farm when it loads. The engine blocks that request, so nothing leaves the
  machine but the pinned downloads.

## [0.6.1] - 2026-10-17

### Fixed

- **The globe's Milky Way no longer changes brightness as you turn the view.** The outlines were filled in screen space, so patches
  swapped brightness with small turns. It is now painted once in right ascension and declination and sampled per pixel, so each
  part of the sky keeps its own brightness.
- **No fake band across the Milky Way.** Two of its outlines go all the way around the sky; they were closed with a straight
  line, which drew a perfectly straight band and left a hole where it crossed the real one. They now close through the pole and
  fill between the two edges.

### Removed

- The "Polaris" and "Big Dipper" names on the globe's sky. The sky shows no text now.

## [0.6.0] - 2026-10-16

Print layouts, bivariate classes and legends, and the polish around them.

### Added

- **Print map.** The map's "Export map image" is now GeoLibre's Print Layout composer: the view as a page, with a live preview.
  - **Page:** paper (A4, A3, Letter, Legal, Tabloid) or screen sizes or a custom size, orientation and margins; a title and
    subtitle (outside or over the map; left, center or right); a date, footer text, a page border and a map frame.
  - **Furniture:** the legend (its classes renamed, hidden or reordered for the page), a scale bar, a north arrow, an info block,
    a colorbar and a custom legend. The north arrow is top right, the legend bottom left, the scale bar bottom right.
  - **Data:** an attribute table and a bar, pie or line chart of the rows, limited to what the page shows (read by the engine).
  - **Scale and extent:** a 1:N scale (typed, or a preset) and a print extent drawn on the map.
  - **Credit:** a small strip in the map's bottom-right corner, "MapLibre | the basemap's credit", like MapLibre's own attribution.
  - **Output:** PNG, PDF or SVG, or copy to the clipboard. The map's size on screen is one click ("Size of the map on screen").
  - Works on the flat map and the globe. The layout is remembered between sessions (a preference for every file).
  - The PDF is vector content, the same page as the SVG (svg2pdf.js): text, shapes, tables, charts and legends, with the map the one
    picture. Text is set in the PDF's built-in Helvetica; a page with text those fonts lack (such as Japanese) is a page image instead,
    with a note. The SVG keeps its text, legend, tables and charts editable in Inkscape or Illustrator.
- **Atlas.** One page per feature, or a page for each stretch of a line, each framed on its own part of the map (a margin, or a fixed
  scale), with the area outside a polygon dimmed if you like, sorted and filtered, with `{atlas.name}`, `{atlas.pagenumber}`,
  `{atlas.total}` and `{atlas.attr:FIELD}` in the title, subtitle, footer and file names. One multi-page PDF, or a zip of pictures.
- **Bivariate classes.** 2, 3 or 4 classes along each axis, unequal counts allowed (2 by 3, 3 by 4, ...): a "Classes" row in the
  Style panel. Palettes are 3 by 3; other sizes read them at evenly spaced places, mixing the colors in CIELAB.
- **Bivariate legend.** On the map and on a printed page: headed by the layer (not "a × b · Quantile"), cells that fill the box, each
  axis named with its lowest and highest value marked at the ends. **Legend shape** in the bivariate style (Square, the default, or
  Tilted: a diamond with its axes along the lower edges) is saved with the style and applies to the map and to every page. The cells
  still hide their features, by click and by keyboard.
- The README, the extension's README and the landing page link to the VS Code Marketplace and Open VSX, and credit GeoLibre and its
  author, Qiusheng Wu, for the inspiration and the code adapted from it.

### Changed

- The style types are listed in the order a user reaches for them: single color; by one column (categorized, graduated,
  continuous); by two (bivariate); by conditions (rules); as is; then the point-only heatmap and clusters.
- The **Map controls** tab moved to the foot of the right rail, as a settings button is.
- jsPDF, svg2pdf.js and svgcanvas (all MIT) load the first time they are used.

### Fixed

- On a short map, the legend, the logo and the scale bar no longer spill over the table. The feature card and then the legend
  collapse to their headers (and open again when the map is taller), and the table cannot take so much room that the map is
  shorter than 220 px.

## [0.5.0] - 2026-10-15

Map controls and drawing tools, terrain, and a new look.

### Added

- **Map controls** (a new right-rail tab, sliders icon): a row per control with an on/off switch, its name and where it sits.
  Each control offers the positions that suit it: the four corners for buttons, search, legend, scale bar and logo; the middle
  of the top or bottom edge for the coordinates readout. Search, zoom, zoom to layer, reset view, globe, terrain, the drawing
  tools, export image, legend, coordinates, the scale bar and the MapLibre logo (on by default) can each go anywhere. A user
  preference, for every file. The layer picker and the selected feature's card are not controls: they show whenever needed.
- **Draw, Measure and Select by shape.** Point, line, polygon, rectangle, circle and freehand tools, an edit tool, and Undo and
  Redo, on Terra Draw (loaded the first time a tool is opened). Distances, and areas with perimeters, show live and stay on the
  map (metric or imperial). A drawn line follows its great circle (the shortest path on the globe), live while you draw, so the
  line you see is the length shown.
  - A finished shape in Select by shape selects the rows it covers (Ctrl or Cmd adds). The condition is intersects, within,
    contains or centroid within, in the engine, so it covers rows off screen and in tiles mode.
  - A bar offers what to do with the shapes: select rows, keep the rows narrowed to them (a standing filter), write a query for
    them in the SQL editor, show them as a layer (every export format applies), save them as GeoJSON, or clear them.
  - The shapes are the table `drawn` in SQL (kind, geometry, area, length, perimeter); lines carry their great-circle path. They
    are scratch geometry, never edits to the data.
- **Terrain** on and off, with relief shading and an exaggeration slider (Basemap panel, and a button on the map). The cursor
  readout and the status bars show elevation in meters. The relief follows the basemap: shadows only over satellite imagery, a
  faint highlight over dark maps, a soft one elsewhere. Keyless Terrarium tiles; if they can't load, terrain turns itself off
  with a message.
- An optional **hover tooltip** with a choice of columns, an optional on-map **coordinates** readout, and a **right-click
  position menu** on the map: copy lat, lon, lon, lat or a WKT point (the live readout moves with the cursor; the menu keeps the
  place you pointed at).
- **More colors.** Ramps: Inferno, Cividis, Mako, Rocket, Turbo, eleven more ColorBrewer sequential and diverging schemes, Set 3,
  Accent, Pastel 1 and 2, Okabe-Ito (color-blind safe) and Tableau 10. Bivariate: the five palettes of the mapgl R package.
- A redesigned **ramp picker** (search, groups, a clear chosen row) and a **color field** that replaces the browser's own color
  picker everywhere: a themed popup with a saturation and hue area, a hex box, the eyedropper where the browser has one,
  suggested colors and the ones used lately.
- A feature picked on the map **scrolls the table to its row**, even on a page the table has not loaded.
- The globe's sky is the real one, where it is tonight (the device's clock gives the sidereal time): every star the eye can see (about 5,000) and the Milky Way, seen
  as the globe's camera would see them beyond the Earth (no lines join the stars; the constellation figures are in the data, switched off). So Polaris and the Big
  Dipper appear behind the Earth only when you look from the southern hemisphere, never with the Arctic in view.

### Changed

- **A new look** (spec 015). Every icon is Lucide (one library, replacing the hand-drawn set). The web app has its own identity:
  chart-ink text on a cool paper, ultramarine as the one accent, a deep navy for dark, IBM Plex Sans and Fira Code (self-hosted).
  The landing page types a query and colors a map in once, over a faint map sheet of contours and a graticule. In VS Code the
  colors and fonts still come from your theme.
- Switches, selects and tooltips are themed bits-ui components; map and rail buttons have tooltips; the warning about rows without
  geometry is a notice over the map. The default fill is a muted blue-teal.
- Overlays on the map no longer overlap on a short map (a big table panel): the buttons lie in rows, the legend shows only its
  title, and under a certain height the legend and card wait; the open drawing tools take as many columns as fit above the legend.
  The draw, measure and select tools open as a second column beside the buttons.
- The Color style list shows an icon for each type and marks the chosen one clearly. Heatmap "Automatic" has an info icon with the
  explanation. "Save style" is one label (it downloads in the browser). Reset style returns to "Default". Values in the table and
  the feature card are colored by type. The bivariate legend follows mapgl's: touching square cells with a hairline between.

## [0.4.0] - 2026-10-14

### Added

- A Copy button at the top right of the SQL editor copies the query.
- **Clusters style** for points (bubble aggregation), after the R package
  mapgl's `cluster_options`.
  - Nearby points group into bubbles, colored and sized by how many points
    each holds, with the count on it (1.2k, 1,234 or 1234). Points not in a
    group keep the single symbol; lines and polygons are never grouped.
  - mapgl's defaults: three steps (from 2, 100 and 750 points, at 20, 30 and
    40 px), a 50 px radius, grouping up to zoom 14. Up to six steps, each
    with its own count, color and size; bubble opacity and outline, and the
    counts' color.
  - A click on a bubble zooms in until it breaks apart.
  - Large results (drawn from the engine's tiles) are grouped by the engine,
    on a grid that lines up across tiles; neighbors within the radius merge.
  - The legend lists each step's counts with its bubble, then the single
    points; the map image includes it.
  - Saved as QGIS's point cluster renderer in QML (the bubble colored and
    sized by `@cluster_size`), checked in QGIS 4.2.3, and as a clustered
    source in Mapbox GL styles; both read back, as do clustered styles made
    with mapgl. SLD has no clusters, and the save menu says so.
- **Heatmap style** for points.
  - Shows where points cluster, as a smooth density surface. Zero density is
    transparent, and the densest areas take the ramp's last color.
  - Optionally weighted by a numeric column. Weights are scaled by the
    column's largest value, so big numbers don't flood the map.
  - Radius, intensity (0.01 to 5, on a logarithmic slider) and color ramp
    are adjustable.
  - The radius can be in pixels or in meters. In pixels it stays fixed on
    screen, so zooming out makes the map hotter. In meters it stays fixed on
    the map, so a place keeps its color at every zoom.
  - **Automatic intensity** (an option): the engine finds the densest spot
    of all the points once, and sets the intensity so that spot takes the
    ramp's last color. MapLibre has no such setting of its own, so dense
    data used to flood with the last color. It needs the radius in meters,
    because in pixels the densest spot changes with zoom; turning it on
    switches the radius to meters.
  - Points stay clickable, and their hover and selection still show.
  - The legend shows the ramp from sparse to dense, and the map image
    includes it.
  - Saved as QGIS's heatmap renderer in QML (pixels, or QGIS's meters at
    scale), and as a heatmap layer in Mapbox GL styles; both read back.
    Checked in QGIS 4.2.3. SLD has no heatmap, and the save menu says so.

- **Vary by attribute** (spec 011): under the style type, more properties
  can each follow their own column, so one map can show several variables at
  once: roads colored by level of service and widened by traffic, or crashes
  colored by severity, shaped by type and turned by heading.
  - Add… offers, for points: outline color, outline width, size, shape,
    opacity and rotation; for lines: width, pattern and opacity; for
    polygons: outline color, outline width and opacity.
  - Outline color and width, shape, pattern, opacity and rotation are new,
    by categories or by classes. Shapes give six values their own shape and
    the rest share "Other"; patterns give four.
  - Each property has its own legend group. Its swatches show what the map
    draws, and a class can be hidden from there.
  - A property removed and added again in the same session comes back with
    its column.
  - Properties that read the same column with the same classes share one
    legend group: graduated color and size by `pop` in the same quantiles
    show one list, each entry in its color and at its size. Hiding an entry
    hides that class in all of them. Different breaks keep separate groups.

- **Labels** (spec 011), from a Labels button on the side rail.
  - Text from a column, or a SQL expression the engine computes (its error
    shown in place); size, color, halo, and above, below, left, right or
    center of points, with an offset. Lines are labeled just above the line
    and never upside down; polygons inside. Labels never overlap, skip
    features hidden through the legend, and work on layers drawn from tiles
    without reloading them.
  - Drawn with the system's sans-serif font: no fonts are downloaded, on any
    basemap, offline too.
  - Saved with the style; written as QGIS labeling in QML (QGIS reads it
    back), a TextSymbolizer in SLD and a symbol layer in Mapbox GL, and read
    back from all three. The map image includes them.
- **More scales** (spec 011): every property under Vary by attribute can be
  continuous (along a ramp, or between two sizes, linear or by area, over the
  column's values or your own), set by SQL conditions (first match wins,
  with Everything else), or read as is from the column (colors, pixels,
  degrees, opacities). Color gets **Continuous** and **As is** types too.
  Legends show a ramp bar or three samples. QML writes each as a QGIS
  expression, checked feature by feature in QGIS 4.2.3; SLD writes
  continuous as 10 classes; Mapbox GL writes the map's own expressions.

### Changed

- **Basemap panel redesigned, with real previews.**
  - Every basemap preview now shows the real map, all framed on the same place
    (around Zurich, at city scale), so styles can be told apart. Keyless vector
    styles use small thumbnails bundled with the app (about 110 KB, loaded when
    first shown), which also work offline. Raster basemaps load one live tile of
    the same place. Basemaps that need an API key say so instead of showing a
    made-up map.
  - The panel shows the current basemap with its provider, a "Follow the theme"
    checkbox, and the featured basemaps as a grid of previews (arrow keys move
    through it).
  - A search box finds any of the 130 basemaps from the panel, with previews;
    Enter takes the first. "More basemaps…" opens the gallery with the same
    search.
  - The gallery opens centered over the map, not the whole window, so the
    panel stays in view beside it (in a narrow window it still centers on the
    window).
  - Fixed: the OpenStreetMap preview showed "Access blocked", because preview
    tiles were requested without a referrer, which OpenStreetMap's tile policy
    requires.
- **Labels: one per polygon.** A polygon made of several parts (Canada,
  Indonesia) is labeled once, on its largest part, as QGIS does by default;
  a big polygon spread over several map tiles no longer repeats its label in
  each. The label sits at the polygon's representative point (always inside
  it), which the engine computes only while labels are on.
- Web app header: Copy link and Open file (now the primary button) are
  grouped, and a divider sets them apart from the theme menu and a new link
  to the source code on GitHub.
- The style type's heading is **Color**, and "Single" is **Single color**: it
  sets only the color; Vary by attribute sets the rest.
- The Size section moved into Vary by attribute ("Add… → Size", or Width on
  lines); it works as before.
- Styles are saved in a new form that holds every property, and still load
  from 0.3.0 sidecars and saved states exactly as before. QML files also carry
  the whole style in a `spatialExplorer/style` property.
- The side rail's icons are slightly smaller (18 px), still a touch larger than the map's controls.
- The Basemap button on the side rail shows a folded map (it showed a layer stack, which suggested a layer list).
- Feature details are a card on the map again, under the search box: a map
  click, a table row or a search result shows it, whatever side panel is open
  (so you can style and inspect at once). It closes with × or Escape. The
  side rail is Style, Labels and Basemap. The search box is as wide as its
  placeholder, and the card matches it.
- SQL names the opened file by its own name: `us-counties.parquet` is
  `us_counties` (lower case, other characters as `_`; quoted when it starts
  with a digit or is a reserved word, as in `"2020_tracts"`). The default query
  uses it. The layers of a GeoPackage or SQLite file are `<file>.<layer>`
  (`us_boundaries.counties`, `us_boundaries.states`), and autocomplete offers
  them after the dot. `layer` still works for the open file or layer.
- Legend groups are headings (`h2`) and name their property when two would
  share a title; dashed lines show their gaps in swatches.
- Globe view: the lit rim on the globe's top-left edge is half as strong; the
  stars are one large random field, so their pattern no longer repeats across
  the view; and a faint comet crosses the sky now and then (none with reduced
  motion; never in the map image).
- Opening a file draws the map sooner: the geometry is read before the SQL
  editor's catalog, and the dots that keep tiny features visible are a source
  of their own, tiled alongside the features on a second map worker (77k
  parcels: everything drawn 0.9 s sooner, the first polygons 1.1 s sooner).

### Fixed

- After the engine ran out of memory, opening the next file could freeze the
  page while it recovered.
- With "Show selected only" on, a click on empty map cleared the selection
  but left the rows narrowed, with no way back to every row. Now the filter
  follows the selection: clearing it shows every row again.
- Opening another file left the previous one on the map, with its feature
  count and Export button, until the new file had opened. It now goes the
  moment the next file is chosen.
- QML: colors that vary by data keep the fill or outline opacity in QGIS
  (they were drawn opaque).
- Categorized styles on columns with many distinct values (an id column) are
  several times faster to classify.

## [0.3.0] - 2026-10-13

### Added

- **Rule-based styling** (spec 010).
  - Color features by SQL conditions, such as `continent = 'Africa'` or
    `pop_est > 1e8`. The first rule a feature matches colors it; the rest are
    "Everything else". Each rule shows its feature count and can be hidden,
    relabeled or moved up and down.
  - A first rules style starts with two examples taken from the data.
  - A condition that can't be used says why under its field (for example,
    `No column "nope" in this layer. Closest: …`) and matches nothing; the
    rest of the map still draws.
  - Saved to QML as QGIS's rule-based renderer, which QGIS draws the same
    (first match included), and reopens here as rules. Rule-based styles made
    in QGIS open as rules. SLD and Mapbox GL keep the rules when every
    condition is a simple comparison.
- **Graduated by expression** (spec 010): classify a SQL expression, such as
  `gdp_md * 1e6 / pop_est`, instead of a column ("Expression…" in the Column
  list), with its value distribution. Saved to QML as the class attribute.
- **SQL across files** (spec 010).
  - VS Code: a query reads other files in the workspace by their path from
    the workspace root, for example `ST_Read('data/links.shp')` joined with
    `layer`; the result is drawn.
  - Web: add files (SQL tab, Add files… or drop them) and read them by name.
  - The Files list beside the SQL editor inserts a file's reader call, and
    paths are suggested inside quotes.
- **One search box** on the map (spec 010) for values in the layer (one
  result per value, with its count; choosing it selects and zooms to the
  feature), coordinates (`-111.9, 40.7`, or `40.7, -111.9` pasted from a web
  map), and places (still sent only when you ask, after the one-time notice).
- **More basemaps** (spec 010): a gallery of 129 basemaps from 26 providers,
  grouped by provider, with previews and a search. Keyless CARTO GL and
  VersaTiles vector styles. Keyed providers (MapTiler, Stadia, Protomaps,
  CARTO, Google, Mapbox, Amazon and others) ask for a key, kept in VS Code's
  secret storage or the browser.
- **Load all**: a big result drawn from tiles can be loaded whole (status
  bar), for exact rendering at every zoom.
- **Excel input**: `.xlsx` files open like a CSV with coordinates.

### Changed

- **Faster maps** (spec 010).
  - Results under 100,000 rows are read once and drawn from memory: panning
    and zooming do no engine work. Bigger results are drawn from vector tiles
    the engine builds as they come into view. Spec 007's re-query on every pan
    is gone.
  - Lines and polygons too small to see at the current zoom are drawn as
    dots instead of disappearing.
  - At 6× CPU slowdown, 5 pans over 10,000 parcels show no long task.
- **New layout** (spec 010): an activity rail opens a side panel (Style,
  Details, Basemap); the table and SQL are tabs of a bottom panel that can be
  maximized or hidden; the layout is remembered.
- **FlatGeobuf is read whole** into the engine, like GeoJSON (big files are
  announced first), instead of in parts.
- The map can always be tilted and rotated (right-drag), so a basemap's own
  3D buildings show. Reset view flattens it.
- Switching basemaps never reloads the data.
- GeoPackage and SQLite are read by the engine (sqlite_scanner); feature ids
  are the file's own.
- The SQL engine is DuckDB 1.5.6 (DuckDB-WASM 1.33.1-dev65).

### Removed

- The separate place search button and popover (the search box covers it).

## [0.2.0] - 2026-10-12

### Added

- **Bivariate maps** (spec 009).
  - Color features by two numeric columns at once, from a 3×3 square. Each
    column is split into 3 classes (quantile, equal interval or natural
    breaks).
  - Four color-blind-checked palettes. Swap the axes with one click.
  - The legend is a keyboard grid: arrow keys move between cells, Enter
    hides a cell's features, and each cell names both value ranges and its
    count.
  - Saved to QML as QGIS's rule-based renderer (one rule per cell), which
    QGIS draws the same, and which reopens here as bivariate. SLD and
    Mapbox GL export too.
- **Size by a column** (spec 009).
  - Set line width or marker size from a numeric column, next to any
    single, categorized or graduated colors (for example, roads colored by
    class and drawn wider with traffic).
  - Classed (2–10 steps) or proportional (smooth). Proportional markers
    follow QGIS's "Area" size scale.
  - The legend shows the size classes as their own group, and the map
    image includes it.
  - Saved to QML as QGIS data-defined sizes, so QGIS draws the same widths.
- **Marker shapes and line patterns.**
  - Points can be circles, squares, triangles, diamonds, stars, crosses or
    x's.
  - Lines and polygon outlines can be solid, dashed, dotted, dash-dot or
    dash-dot-dot.
  - The legend and the map image draw them, and QML, SLD and Mapbox GL
    keep them.
- **SQLite and SpatiaLite databases** (`.sqlite`, `.db`), such as Bentley
  Cube 7 networks: spatial tables open as layers with their CRS, and
  attribute-only tables (transit modes, tolls, junctions) can be queried by
  name. In VS Code they open under **Open With…**, so SQLite viewers keep them.

### Fixed

- **GeoPackage layers whose feature ids don't run 1..N** (for example a
  subset exported with its original ids) failed to open: the map stayed grey,
  or showed the basemap without data, with "thread constructor failed". They
  now open.
- **Feature ids are kept**: a GeoPackage's `fid` and a SQLite table's integer
  primary key (a Cube node's `n`) are columns again; they were dropped.

### Changed

- New bivariate maps and size channels start on measure columns: id-like
  columns (`id`, `fid`, `objectid`, `*_id`) are offered last.
- The style panel is slightly wider (344 px), to fit four style types.

## [0.1.0] - 2026-10-11

The first release of the VS Code extension (VS Code Marketplace and Open VSX)
and the web app (GitHub Pages).

### Added

- **Quick Look (spec 001).** Open a vector file and see it on a map and in an
  attribute table, in VS Code (custom editor) and in the web app (file
  picker or drag and drop). Formats: GeoJSON, GeoPackage, FlatGeobuf,
  Shapefile (with sidecars), GeoParquet, Parquet with a WKB column, GML, and
  CSV with `lon`/`lat`, `longitude`/`latitude` or `wkt` columns.
- **CRS handling.**
  - The source CRS is read from the file and the layer is reprojected to WGS84
    for display; the status bar reports the original CRS.
  - Files without a CRS are disclosed as "WGS84 assumed".
- **Basemaps.**
  - OpenFreeMap basemaps (Positron, Liberty, Bright, Dark, Fiord), with
    previews in the picker, plus keyless raster basemaps: Satellite (Esri),
    Topographic (OpenTopoMap) and OpenStreetMap (spec 008).
  - The default follows the light/dark theme, including theme changes while
    the viewer is open.
  - Blank background whose color can be customized; the choice is remembered.
  - If a basemap fails to load, the map falls back to blank and shows a short
    message; the data is unaffected.
- **Attribute table.**
  - A resizable, collapsible drawer under the map.
  - Fast with large files: only visible rows are rendered.
  - Sortable, resizable columns, with a header that stays in place while
    scrolling.
  - Keyboard navigation.
  - Selection stays in sync with the map; double-click a row to zoom to it.
- **Map.**
  - Zoom, fit-to-layer, layer style and basemap controls, plus a scale bar.
  - Clicking a feature selects it and opens a feature inspector listing all
    of its attributes.
- **Layer styles.**
  - Fill, outline, width and point size.
  - Saved as a QGIS `.qml` sidecar next to the data. QGIS loads it too, and
    it is applied automatically on open.
  - Export and import as QGIS QML, OGC SLD, or Mapbox GL style JSON.
- **VS Code integration.**
  - Native look under every color theme, including high contrast.
  - Native status bar items: CRS, feature count, cursor coordinates.
  - "Open in Spatial Explorer" in the Explorer and editor-tab context menus.
  - A "Spatial Explorer" output channel with per-open timings.
  - A notice, with Reload, when the open file changes on disk.
- **Web app.** Branded header, a landing page with a world population map,
  **Try sample data** (US counties) and the SQL engine's status, and a
  status bar docked to the map. A theme menu offers System, Light and Dark
  (remembered).
- **Developer tooling.** `npm run screenshots` captures the real VS Code
  extension (three themes) and the web app (light and dark).
- **Spatial SQL query (spec 002).** A query panel docked beside the
  attribute table (Ctrl/Cmd+Shift+Q). It runs DuckDB spatial SQL against the
  opened file, in both the extension and the web app.
  - The file is the ready-made table `layer`, also aliased by its file name,
    in its original CRS. The initial view is the editable query
    `SELECT * FROM layer`: the whole file (spec 007).
  - Results with a geometry column replace the map layer and the table;
    results without one show in the table, with the last map dimmed. The
    result's CRS is resolved automatically and shown in a chip that can be
    overridden.
  - Ctrl/Cmd+Enter runs the selection or the statement under the cursor.
  - Editor: SQL highlighting in theme colors, and autocomplete from the live
    catalog (tables, columns with types, spatial functions with signatures
    and descriptions, keywords, and temp tables you create).
  - Errors name the problem, underline it in the editor, and keep the
    previous result. A typo in the first keyword suggests the fix.
  - Read-only by design: queries plus `CREATE TEMP TABLE/VIEW`. Writes,
    exports, extensions and settings are refused with a reason, and the
    engine itself is locked to the opened file (no file or network access).
  - Cancel a running query with the Cancel button or Esc. Results of any
    size report their exact row count (spec 007).
  - Timing in the panel and in the "Spatial Explorer" output channel.
  - Reset returns to the original view and style. Per-file history keeps the
    20 most recent queries across reopening; picking one loads it without
    running.

- **Thematic styling (spec 003).** Style the displayed layer by its data.
  - **Categorized**: a color per value, most frequent first, up to 12 classes
    plus "Other"; nulls get a "No value" class.
  - **Graduated**: a numeric column in 2–10 classes by equal interval,
    quantile or natural breaks (Jenks, the exact optimum). Breaks match
    QGIS's; values on a break fall in the class below, as in QGIS.
  - **Color ramps** with previews (Viridis, Magma, Plasma and ColorBrewer
    sequential, diverging and qualitative), reversible.
  - **Per-class editing**: color, label, visibility (hides features on the
    map), values or bounds, add and delete. Editing values or bounds fixes
    the classes (Manual).
  - **Legend** on the map with counts. It is collapsible, and a swatch hides
    or shows its class.
  - **Follows queries**: classes are recomputed for each result. If the
    styled column disappears, the single symbol is shown with the reason, and
    the style comes back with the column.
  - **QGIS-compatible**: the `.qml` sidecar now holds categorized and
    graduated styles, verified in QGIS 4.2.3. QML and Mapbox GL round-trip
    losslessly. SLD loses the method and hidden classes, and the Export menu
    says so before writing.
- **Accessibility**: closing a map popover with Esc returns focus to its
  button (unless you were typing elsewhere).
- **Export (spec 005).** Save the displayed result to a new file from the
  **Export** button above the attribute table, or with **Spatial Explorer:
  Export Data…** in the VS Code command palette.
  - **Formats**: GeoParquet, GeoJSON and CSV (geometry as WKT, or X/Y
    columns for points); results without geometry export as CSV or Parquet.
    Spec 008 adds more formats (below).
  - **Which rows**: the whole result (spec 007), or since spec 008 the
    filtered or selected rows.
  - **CRS**: the result's own CRS by default, or WGS84. GeoParquet carries the
    full CRS definition, so QGIS reads projected exports in the right place
    (verified in QGIS 4.2.3). GeoJSON is always WGS84 (RFC 7946).
  - **Nothing lost silently**: a notice lists what the format changes
    (invalid geometries written empty, nested values as JSON text, other
    geometry columns as WKT, reprojection).
  - **Large exports** show rows written and can be cancelled; nothing is
    saved and nothing is left behind. In VS Code the file is saved next to the
    data by default; the opened source can never be overwritten.

- **Large files and viewport loading (spec 007).** Files of several GB open
  in both shells without freezing.
  - **Facts first**: row count, extent, CRS, geometry type and columns for the
    whole file appear within seconds, with progress and a Cancel that always
    ends the open within 3 s.
  - **The map draws what's in view**: up to 25,000 features, refreshed as you
    pan and zoom. Above that, an even, stable sample with a notice ("Showing
    25,000 of 310,412 in view"); tiny features are drawn as dots so the
    overview shows where the data is.
  - **Read in parts where the format allows it**: GeoParquet/Parquet through
    range reads (a loopback server in VS Code, file slices on the web);
    FlatGeobuf through its spatial index, read in JavaScript; PMTiles tile by
    tile.
  - **Formats that must be read whole** (GeoJSON, Shapefile, CSV, GML,
    GeoPackage) are parsed once into an indexed table, and files over 100 MB
    are announced first with an estimate and a pointer to GeoParquet.
  - **Whole-data pillars**: the attribute table pages through any number of
    rows and sorts them in SQL; styles classify the whole result with exact
    counts; export writes every row. FlatGeobuf files read in parts offer
    **Load the whole file** before queries.
  - **PMTiles (vector)**: view-only, with the archive's facts and an
    inspector; SQL, table, styling and export say why they don't apply.
  - **Out of memory** at any stage ends in a clear message, and the viewer
    keeps working.

- **UX polish and legacy parity (spec 008).**
  - **Style panel**: sections for style type, column, classification,
    colors and appearance; a chart of the column's values with the class
    breaks; ramps previewed on the map while browsing; a layer opacity
    slider; one split **Save style (QML)** button whose menu saves SLD or
    Mapbox GL; a visible **Load…** button.
  - **Attribute table**: a **Columns** chooser to show or hide columns
    (remembered per file), a filter in each column header (text, numbers,
    dates, true/false), and row checkboxes with **Zoom to selection** and
    **Show selected only**. Map clicks select too (Ctrl/Cmd+click adds).
  - **Files with several layers**: a GeoPackage's layers are listed with
    their geometry type and count, and each one can be shown. A File
    Geodatabase folder explains that it can't be read here and offers an
    `ogr2ogr` command to convert it.
  - **Export**: an **Include geometry** switch; new formats GeoPackage,
    FlatGeobuf, Shapefile (zipped), KML, newline-delimited GeoJSON, Excel
    workbook and JSON, each checked by reading the file back; any EPSG CRS
    from a searchable list grouped like QGIS and ArcGIS, with the usual ones
    pinned and suggestions for the data; an editable file name; all,
    filtered or selected rows. Shapefile field renames and per-type splits
    are listed before export. GeoPackage and Shapefile exports open in QGIS
    with their CRS.
  - **Globe view**: a Mercator/Globe toggle, with a night sky and an earth
    glow around the globe. Every map opens flat.
  - **3D extrusion**: polygons raised by a numeric column times a scale
    (set automatically for columns that aren't heights) or by a constant,
    in the style's colors; polygons with no height are counted. Tilt and
    rotate with right-drag or Shift+arrows, and **Reset view**. Saved in the
    QML (QGIS's 3D renderer) and in Mapbox GL style JSON.
  - **Map image**: **Export map image…** saves the view as a PNG at 1x or
    2x, with the legend and the basemap's attribution.
  - **Share link** (web): **Copy link** holds the query, style, basemap,
    projection and view, never the data. Opening it asks for the same file,
    or opens the sample.
  - **Place search**: find a place and fit the map to it (OpenStreetMap
    Nominatim). Only the typed text is sent, on Enter, after a one-time
    notice; it can be turned off (`spatialExplorer.placeSearch.enabled`).
  - **Sample data**: **Try sample data** on the web landing page, and
    **Spatial Explorer: Open Sample Data (US Counties)** in VS Code.
  - **Feature inspector**: wide records scroll at a readable size, with a
    filter for many attributes. Dates and times show as dates everywhere.
  - The map attribution's "i" is visible on dark themes, and its text is a
    standard size.

### Changed

- The default query no longer has `LIMIT 1000`, the "Show first 50,000"
  prompt is gone, and every pillar works on the whole data (spec 007).
- **The SQL engine is downloaded, not bundled.** DuckDB-WASM, its spatial,
  parquet and json extensions, and sql.js come from pinned URLs (jsDelivr
  and extensions.duckdb.org). Each file is checked against a SHA-256
  recorded at build time and refused if it doesn't match. The extension
  package went from 8.7 MB to 1.4 MB, and the web app from 39 MB to 4 MB.
- **Works offline after the first start.** Each shell keeps a checked local
  copy of the engine (VS Code: the extension's storage; web: the browser's
  Cache Storage). The first start needs a connection.

### Performance

- Large files (spec 007, measured in the web build on a laptop):
  - 1.1 GB GeoParquet (6M rows): facts 2.0 s, overview 4.9 s, every city view
    within 1.9 s; no task blocks the viewer for more than 0.15 s.
  - 1.45 GB FlatGeobuf (4M rows): facts 2.0 s, overview 2.7 s, city views
    0.4 s.
  - 5 GB GeoParquet (27M rows): overview 9.5 s, and engine memory stays under
    60 MB through pans, a filter, a style and an export.
  - A 1,000,166-row filter on 4M rows: 11.6 s, exact; its GeoParquet export
    (189 MB) has every row.


- About 10 MB opens in ~1.2 s with the engine already started. DuckDB starts
  in the background (pre-warm) and is reused between opens. Each file is
  parsed once, then its memory is released.

- A filtering query on a ~10 MB file returns in ~0.1 s, and cancelling takes
  ~0.1 s (spec 002 quickstart, Results).
- Restyling 22,000 features takes ~0.1 s, and natural breaks on 50,000 values
  take ~0.2 s with no long tasks (spec 003 quickstart, Results).
- Exporting 100,000 polygons to GeoParquet takes ~2 s with no long tasks, and
  cancelling an export takes ~0.1 s (spec 005 quickstart, Results).
