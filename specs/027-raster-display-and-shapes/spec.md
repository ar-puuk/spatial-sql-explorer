# Feature Specification: Raster display options and values under a drawn shape

**Feature Branch**: `027-raster-display-and-shapes`
**Created**: 2026-10-26
**Status**: Draft
**Input**: User request 2026-10-26: after raster round one (spec 026, view and inspect), support "as much as MapLibre allows" of its own raster functions, and read values along or inside a shape drawn on the map, before the next release. Decisions the same day: no viewshed and no whitebox tools in this round (deferred); one raster at a time still holds.

## Summary
Round one draws a raster and lets a person restyle its bands and colors. Round two adds how the picture is shown (brightness, contrast, saturation, hue, sharp or smooth pixels), shaded relief for an elevation raster (hillshade) with a light a person can move, and two readings from a shape drawn on the map: an elevation (or value) profile along a line, and statistics over the area of a polygon. Nothing here changes the file or makes a new raster; every option is a way of looking at the one raster that is open, or a number read from it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adjust how the raster looks (Priority: P1)
A person opens a raster and, in the style panel, changes brightness, contrast, saturation and hue, and chooses between smooth and sharp (nearest) pixels, to make a dull image readable or to see the real cells. The change is immediate.

**Why this priority**: the cheapest, most visible gain; it is what MapLibre does for rasters on the graphics card.

**Independent Test**: open the RGB fixture; move each slider; the map changes at once and Reset puts every value back. Open the DEM; choose sharp pixels and zoom in: cells are squares.

**Acceptance Scenarios**:
1. **Given** a raster is open, **When** the person moves brightness, contrast, saturation or hue, **Then** the map changes without a visible delay and without re-reading the file.
2. **Given** any of these is changed, **When** the style is saved and the file reopened, **Then** the values are back.
3. **Given** the style was saved to a QGIS file, **When** QGIS loads it, **Then** QGIS shows the same brightness, contrast and saturation.
4. **Given** values are changed, **When** the person presses Reset, **Then** all return to neutral.

---

### User Story 2 - Shaded relief for an elevation raster (Priority: P1)
A person opens a DEM (one band of heights) and switches on hillshade: the terrain is lit from a direction they choose, drawn over or under the colors. They change the light direction and height, the strength, the method, and the shadow and highlight colors.

**Why this priority**: the first thing anyone does with a DEM.

**Independent Test**: open the DEM fixture; switch hillshade on; ridges and valleys show relief; moving the light changes which slopes are bright; switching it off restores the plain colors.

**Acceptance Scenarios**:
1. **Given** a single-band raster of numbers, **When** hillshade is switched on, **Then** relief is shown, in the right place and at the right scale, and zooming and panning keep it.
2. **Given** a colour image or a colour-table raster, **When** the style panel is shown, **Then** hillshade is not offered, with a short reason.
3. **Given** hillshade is on, **When** the person changes the light, method or strength, **Then** the relief changes without re-reading the file.
4. **Given** a raster in a projected coordinate system, **When** hillshade is on, **Then** the shading is correct in meters (not stretched by the map projection).
5. **Given** a raster whose values are not heights (a temperature, say), **When** hillshade is on, **Then** it still draws (the person chose it) and the panel says the values are taken as meters.

---

### User Story 3 - Elevation profile along a line (Priority: P2)
A person draws a line on the map over the raster and reads the raster's value along it as a chart, with the distance, the minimum, the maximum and the total rise and fall for a height raster.

**Why this priority**: the common question after looking at a DEM; reuses the drawing tools.

**Independent Test**: open the DEM, draw a line across a ridge; the chart shows the climb and descent; hovering the chart shows the place on the map; the numbers match values read by hand at the end points.

**Acceptance Scenarios**:
1. **Given** a raster is open, **When** a line is drawn with the profile tool, **Then** a chart of the value against distance appears, sampled along the line's great circle.
2. **Given** the line leaves the raster or crosses no-data, **When** the chart is drawn, **Then** those stretches are gaps, not zeros.
3. **Given** a multi-band raster, **When** the chart is drawn, **Then** it shows the band the style draws (one band) or one line per band (colour image).
4. **Given** the chart, **When** the person hovers it, **Then** the matching place is marked on the map and the value is read out.
5. **Given** the chart, **When** the person saves it, **Then** a CSV of distance, longitude, latitude and value is offered.

---

### User Story 4 - Statistics inside a polygon (Priority: P2)
A person draws a polygon (or rectangle or circle) and reads the number of cells, the area, the minimum, maximum, mean, sum and standard deviation of each band inside it, and a small histogram.

**Why this priority**: "how much / how high in this area", asked as often as the profile.

**Independent Test**: draw a rectangle over a part of the DEM; the figures equal those computed from the file for the same cells; a polygon over no-data only says there is nothing there.

**Acceptance Scenarios**:
1. **Given** a polygon over a raster, **When** it is finished, **Then** the statistics of the cells whose centers lie inside it appear, with the count of cells used.
2. **Given** no-data cells inside the polygon, **When** statistics are computed, **Then** they are left out and counted separately.
3. **Given** a very large raster and a large polygon, **When** statistics are computed, **Then** a coarser overview is read, and the panel says so and says the figures are approximate.
4. **Given** a polygon partly outside the raster, **When** statistics are computed, **Then** only the part inside counts.

---

### Edge Cases
- A raster with no overviews and a huge shape: the read is capped and the panel says it was limited.
- A shape across the date line, or a raster at the poles: handled or refused with a message, never a wrong figure.
- Hillshade or colour changes on a globe projection: they draw as the raster does.
- Hue, saturation and brightness act on the colored picture MapLibre receives; for a single band with a color ramp they change the ramp's look, not the data. The legend and color bar show the ramp as set in the style, and a note says the adjustments are not in them.
- Print layout: the page picture includes brightness, contrast, saturation, hue and hillshade because it is the map's picture.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: The style panel MUST offer brightness (low and high), contrast, saturation and hue rotation for the open raster, applied on the graphics card, each with a reset.
- **FR-002**: The style panel MUST offer smooth or sharp (nearest) resampling for the open raster (already used internally; now a choice).
- **FR-003**: For a single-band raster, the style panel MUST offer hillshade with method (the methods MapLibre offers), light direction, light height, strength, and shadow, highlight and accent colors, with a switch to turn it off.
- **FR-004**: Hillshade MUST be computed on cell sizes in meters, whatever the raster's coordinate system, and MUST not need a re-read of the file when only the light changes.
- **FR-005**: All of FR-001 to FR-003 MUST be saved with the style (QGIS file and remembered state) and restored; the QGIS file MUST carry brightness, contrast and saturation in QGIS's own elements and hillshade in our own entry.
- **FR-006**: A profile tool MUST let the person draw a line and show the value along it against distance, with gaps for no data and off-raster, and a CSV export.
- **FR-007**: A statistics tool MUST let the person draw a polygon, rectangle or circle and show count, area, minimum, maximum, mean, sum, standard deviation and a histogram per band, excluding no data and reporting how many cells were excluded.
- **FR-008**: Large reads MUST be bounded: the profile samples at most 2,000 points; statistics read at most 16.7 million cells, choosing an overview level when the shape is larger, and say when the result is approximate.
- **FR-009**: Profile and statistics MUST run off the main thread; the page MUST stay responsive at 6x CPU throttling (no task over 200 ms).
- **FR-010**: The profile and statistics tools MUST NOT change the file, create a raster, or add a map layer; the shapes are scratch shapes like the existing ones.
- **FR-011**: Viewshed, whitebox tools, derived rasters and band math MUST NOT be built in this round; where a person asks, the app says it is not offered.

### Key Entities
- **Display adjustments**: brightness low and high, contrast, saturation, hue, resampling; part of the raster style.
- **Relief setting**: on or off, method, light direction and height, strength, colors; part of the raster style.
- **Profile**: a list of points along a line (distance, place, value per band) with gaps.
- **Area statistics**: per band count, excluded count, area, min, max, mean, sum, standard deviation, histogram, and whether it is approximate.

## Success Criteria *(mandatory)*

### Measurable Outcomes
- **SC-001**: A display adjustment changes the map in under 100 ms and starts no tile read.
- **SC-002**: Changing the light of a hillshade changes the map in under 300 ms at 6x CPU throttling, with no main-thread task over 200 ms.
- **SC-003**: Profile values equal the values `point()` reads at the same places (within a rounding of the last digit), tested at 5 places.
- **SC-004**: Area statistics equal an independent computation over the same cells (test over the fixture, exact count and mean within 1e-9 of relative error).
- **SC-005**: A profile of a line across a 4.9 GB COG and statistics of a polygon over it each complete in under 5 seconds on the test machine without reading more than 2% of the file.
- **SC-006**: Every new control is reachable by keyboard and passes the accessibility checks used for round one.

## Assumptions
- Round one (spec 026) is merged; its worker, tiler protocol and style model are the base.
- MapLibre 6.13's raster paint properties (`raster-brightness-min`, `raster-brightness-max`, `raster-contrast`, `raster-saturation`, `raster-hue-rotate`, `raster-resampling`) and its `hillshade` layer with a `raster-dem` source are available.
- Draw tools (Terra Draw) and the pixel reader from rounds before are reused.

## Out of scope (raised for later)
Viewshed, the whitebox tool suite (slope, aspect, curvature, reclassify, band math and the rest), derived rasters, contours, flow and watershed tools, several rasters, zonal statistics over a vector layer.
