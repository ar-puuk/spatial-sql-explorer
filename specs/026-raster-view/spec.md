# Feature Specification: Raster view and inspect

**Feature Branch**: `026-raster-view`
**Created**: 2026-10-26
**Status**: Draft
**Input**: User request 2026-10-26: "I have been receiving requests for raster support." Decisions the same day: first round is view and inspect only; a raster replaces the vector layer when opened.

## Summary
A person opens a GeoTIFF or Cloud-Optimized GeoTIFF and looks at it: it is drawn on the map, they read its facts, they read pixel values under the cursor, and they restyle it (bands, colors, stretch). There is no query and no analysis. This is LOOK and STYLE for a second kind of file, nothing more. Raster analysis, raster in SQL and drawing vector data over a raster are explicitly not part of this round.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a raster and see it (Priority: P1)
A person opens a `.tif` or `.tiff` file (picks or drops it in the web app; opens it in VS Code with Open With or "Open in Spatial Explorer") and sees it on the map, zoomed to its extent, over the current basemap. A large file shows quickly; the person never waits for the whole file to be read.

**Why this priority**: it is the request. Everything else builds on a raster being on the map.

**Independent Test**: open an elevation raster, an aerial photo (three bands) and a float raster with nodata; each appears in the right place within a few seconds, and a file of several hundred megabytes draws its first view without reading the whole file.

**Acceptance Scenarios**:
1. **Given** a georeferenced GeoTIFF in any common coordinate system, **When** it is opened, **Then** it is drawn in the right place on the map (same position as the data in QGIS) and the view fits its extent.
2. **Given** a raster is open, **When** the person opens a vector file, **Then** the vector layer replaces the raster, and the reverse.
3. **Given** a raster with a nodata value, **When** it is drawn, **Then** nodata pixels are transparent.
4. **Given** a file that is not georeferenced or has a coordinate system the app cannot place, **When** it is opened, **Then** the person is told so in plain words and the app stays usable.
5. **Given** a GeoTIFF that is not stored in tiles (the kind many desktop tools write), **When** it is opened and is under the size limit, **Then** it opens after a short "preparing" step; **When** it is over the limit, **Then** the message says it is too large to prepare here and how to convert it (for example as a Cloud-Optimized GeoTIFF).

---

### User Story 2 - Read the raster's facts and pixel values (Priority: P1)
A person reads what the file is (coordinate system, extent, pixel size, size in pixels, bands, data type, nodata, compression, tiling, overviews) in a card, and moves the cursor over the map to read the value of every band under it, next to the coordinates readout.

**Why this priority**: "inspect" is half of the request, and it is what separates a viewer from a picture.

**Independent Test**: open a four-band raster; the card lists the facts, hovering shows four values, the right-click menu offers to copy the location and values; outside the raster nothing is shown.

**Acceptance Scenarios**:
1. **Given** an open raster, **When** the person opens the card, **Then** every fact listed above is shown, with units (degrees or metres) and the coordinate system's name and code when it has one.
2. **Given** the cursor is over the raster, **When** it rests, **Then** each band's value is shown with its band name, and nodata is shown as "no data", not a number.
3. **Given** a raster with 16-bit or float values, **When** values are shown, **Then** they are the stored values, not the stretched colors.

---

### User Story 3 - Style the raster (Priority: P2)
A person changes how the raster looks: one band with a color ramp, or three bands as red, green and blue; the low and high values the colors run between (starting from sensible percentiles, not the extremes); the ramp; reversing it; opacity; and sees a histogram and a color bar that match. The style is remembered beside the file.

**Why this priority**: a float elevation raster is unreadable with default colors, so styling is what makes view useful; but a plain view already stands alone (Story 1).

**Independent Test**: open a DEM, choose a ramp and narrow the range; the map, the color bar and the histogram markers all update; reopen the file and the style is back.

**Acceptance Scenarios**:
1. **Given** a single-band raster, **When** it opens, **Then** it is drawn with a ramp stretched between the 2nd and 98th percentile, not min to max.
2. **Given** a raster with three or more bands of ordinary image type, **When** it opens, **Then** it is drawn as a color image (bands 1, 2, 3 as red, green, blue).
3. **Given** the style panel, **When** the person changes band, ramp, range, reverse or opacity, **Then** the map updates without reloading the file and without a visible freeze.
4. **Given** a style the person set, **When** the file is opened again, **Then** the same style is applied.

---

### User Story 4 - Keep working with the rest of the map (Priority: P2)
The map around the raster behaves as before: the basemap can be changed or blank, the globe and terrain switches work, the coordinates readout and the scale bar work, and the Print layout produces a page with the raster, its color bar as the legend and the usual map furniture.

**Why this priority**: a raster that breaks the basemap or printing would feel unfinished, but these are existing features being kept, not new ones.

**Independent Test**: with a raster open, switch the basemap, toggle globe, turn terrain on, and save a PNG and a PDF from the Print layout.

**Acceptance Scenarios**:
1. **Given** a raster is open, **When** the basemap is changed, **Then** the raster stays on top and unchanged.
2. **Given** a raster is open, **When** the person switches to globe, **Then** it is drawn on the globe.
3. **Given** a raster is open, **When** the person prints, **Then** the page shows the raster and its color bar (or legend for classes), and the info block can show its facts.

---

### User Story 5 - Understand what is not offered (Priority: P3)
The query panel, table, column filters, selection by shape, "Bin into cells" and the other vector-only tools are not shown for a raster (not disabled and left in place), and the person is not left wondering where SQL went: the layer area says it is a raster and that queries need a vector layer.

**Why this priority**: it is polish, but without it the interface contradicts itself.

**Independent Test**: open a raster; every vector-only control is gone or says why; open a vector file; all return.

**Acceptance Scenarios**:
1. **Given** a raster is open, **Then** no control that would run a query or read a table is shown.
2. **Given** a raster is open and the person opens a vector file, **Then** all vector controls come back with their previous state.

---

### Edge Cases
- A multi-gigabyte file on a network drive or under Remote-SSH: only the needed parts are read; the person can pan and zoom smoothly.
- A raster with a color table (classes such as land cover): drawn with its own colors, the legend shows the classes, and pixel values show the class number and its name when the file has one.
- A file with many bands (a satellite scene): the first view is a sensible default, the band picker lists all bands, and names come from the file when present.
- A raster that crosses the date line or covers the poles: drawn without a seam or a failure, or refused with a clear message.
- A raster with a vertical flip (stored bottom-up) or a rotated or sheared grid: drawn right, or refused with a clear message, never drawn wrongly.
- A coordinate system the app cannot convert: stated plainly in the card and as a message; the raster is not drawn at a guessed place.
- A compression the app cannot decode: stated with the name of the compression.
- Offline use: the first raster needs the raster engine; if it cannot be fetched, the message says so and the rest of the app still works (same rule as the SQL engine).
- Out of memory while preparing a non-tiled file: stops with a clear message and leaves the previous layer on the map.
- A `.tif` that is a plain image with no georeferencing (a scan, a photo): clear message, no drawing.
- Switching to the globe, terrain or another basemap while a file is still loading.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: The app MUST open GeoTIFF and Cloud-Optimized GeoTIFF files (`.tif`, `.tiff`) in both the VS Code extension and the web app, from a picker, a drop, Open With and "Open in Spatial Explorer", and from a web address wherever the shell already opens files from one.
- **FR-002**: A raster MUST be the open layer and replace any vector layer; opening a vector file MUST replace the raster. At most one layer is on the map at a time.
- **FR-003**: The app MUST NOT read a whole large file to show its first view; it MUST read only the parts it needs and keep memory bounded, and MUST fail with an actionable message when a limit is hit.
- **FR-004**: A raster MUST be drawn at the right place for any georeferenced file in a common coordinate system (geographic or projected), with nodata transparent; where the position cannot be determined the app MUST say so and draw nothing.
- **FR-005**: A raster not stored in tiles MUST be made readable automatically when it is under a size limit, and otherwise MUST produce a message that states the limit and a way to convert it.
- **FR-006**: The app MUST show a facts card for the raster: coordinate system (name and code), extent, pixel size, width and height in pixels, number of bands with their names, data type, nodata, compression, tiling and number of overview levels.
- **FR-007**: The app MUST show the stored value of every band under the cursor, with the coordinates, and MUST show nodata as "no data". The map's right-click position menu MUST offer to copy the location and the values.
- **FR-008**: The app MUST let the person choose between one band drawn with a color ramp and three bands drawn as red, green and blue; choose which bands; set the low and high values of the stretch; pick a ramp from previews and reverse it; set opacity; and choose how nodata is shown. Defaults MUST be chosen from the file (image type vs measurement, percentile stretch).
- **FR-009**: The app MUST show a histogram of the chosen band with the stretch's low and high marked, and a color bar (for a ramp), or a class legend (for a color table), that matches the map.
- **FR-010**: The raster's style MUST be remembered for the file (beside it where the shell allows) and restored when it is opened again.
- **FR-011**: A file with a color table MUST be drawn with that table, and its classes shown in the legend and in pixel values.
- **FR-012**: The basemap picker, blank background, globe and terrain switches, scale bar, coordinates readout and the Print layout MUST keep working with a raster open; the Print layout's legend MUST show the raster's color bar or classes and its info block MUST be able to show the raster's facts.
- **FR-013**: Controls that need a table or a query (query panel, table, column filters, search, selection, shape selection and filters, "Bin into cells", dot density, time slider, GTFS layer picker, snippets, export of rows) MUST NOT be offered for a raster, and the app MUST say in the layer area that the open layer is a raster.
- **FR-014**: The raster engine MUST be downloaded once from pinned addresses and checked against recorded hashes before it runs, kept locally afterwards, never bundled, and no file content, name or path MUST leave the machine (constitution IV).
- **FR-015**: Raster analysis or processing of any kind, raster in SQL, more than one raster, and vector data drawn over a raster MUST NOT be built in this round; where a person tries, the app MUST say it is not offered.
- **FR-016**: Everything the app says about a raster MUST be keyboard reachable and readable by a screen reader (the card, the pixel readout, the style controls); color MUST NOT be the only cue.

### Key Entities
- **Raster layer**: the open file seen as a picture of the Earth: its place (coordinate system, extent, pixel size), its bands (names, data type, nodata, optional color table), and how it is stored (tiling, compression, overviews).
- **Raster style**: which bands, ramp, low and high values, nodata treatment and opacity; remembered per file.
- **Pixel reading**: the value of each band at one location.

## Success Criteria *(mandatory)*

### Measurable Outcomes
- **SC-001**: A Cloud-Optimized GeoTIFF of 500 MB or more shows its first view in under 5 seconds on a typical laptop and a wired network, and never reads more than 10% of the file for that first view.
- **SC-002**: A tiled GeoTIFF of 100 MB shows its first view in under 3 seconds from a local disk, and panning and zooming stay smooth (no freeze over 200 ms) at 6x CPU slowdown.
- **SC-003**: Changing the band, ramp, range or opacity updates the map in under 300 ms for a 100-million-cell raster.
- **SC-004**: A person can go from "open the file" to "reading a value at a place" in under 15 seconds, without opening a menu other than the file picker.
- **SC-005**: The position of the raster matches QGIS within one pixel on a test set of files in at least five coordinate systems (a geographic one, UTM, a state plane, Web Mercator and an equal-area one).
- **SC-006**: A non-tiled GeoTIFF up to the size limit opens in under 30 seconds and the person is shown progress; over the limit the person gets a message at once, not after a wait.
- **SC-007**: With a raster open, zero controls that run a query or need a table are shown, and no keyboard shortcut for them does anything.
- **SC-008**: The extra download the first time a raster is opened is stated in the app before it starts and is no more than the size recorded in the research note; after that, opening a raster needs no network.

## Assumptions
- First round is GeoTIFF and COG only. Other raster formats (PNG with a world file, JPEG 2000, NetCDF, Zarr, STAC, WCS, MBTiles) are later requests.
- Only the first image in a file is shown; multi-page or sub-dataset files show the first and say so.
- A raster is drawn on the map in the Web Mercator picture the map already uses; a raster in another system is warped for display, and the card shows the file's own system.
- The size limit for making a non-tiled file readable is set in the plan from a measurement (the research spike), and is shown to the person.
- A style is saved beside the data in the same way as the vector style sidecar (spec 003 decision) wherever that is possible, with the QGIS raster style format as the aim; the exact file format is decided in the plan.
- Constitution amendment required before implementation: raster is the open layer and replaces vector (user decision 2026-10-26); scope line I stays LOOK, QUERY, STYLE, EXPORT but names raster VIEW as in scope and raster analysis as out; Technology and IV gain the raster engine download. CLAUDE.md gets the same note.
- Reference code from GeoLibre (MIT) may be adapted with an "Adapted from GeoLibre" comment and a notice in THIRD-PARTY-NOTICES.md; React code is ported, never added.
- A browser and VS Code webview spike is the first task, recorded in `research.md`. It covers the content security rules of the webview, worker use, reading a multi-gigabyte local file by ranges, the engine's download size, and a comparison of the candidate raster readers.
- Out of scope, raised for later: raster analysis (slope, hillshade, band math, reclassify, mosaic, zonal statistics, contours, polygonize), raster in SQL, vector over raster, more than one raster, and a DuckDB raster extension (no WebAssembly build exists for the engine version in use).
