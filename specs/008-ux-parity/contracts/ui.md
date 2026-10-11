# Contract: UI (spec 008)

Roles, names and keyboard behavior the tests rely on. Accessible names are
binding (tests query by role and name).

## Style panel (`LayerStylePanel.svelte`, `style/*`)

- Dialog `Layer style`. Each section is a `section` labeled by its `h3`; the
  order is fixed, and only the sections that apply are shown:
  - `Style`: radiogroup `Style type` with Single, Categorized and Graduated;
  - `Color by` (thematic): select `Column` (kept from spec 003);
  - `Classification` (graduated): `Method`, `Classes`, and the histogram (`img`
    named "Value distribution", with an `aria-describedby` text listing the
    breaks);
  - `Colors` (thematic): ramp picker (`Colors: <ramp>` button), `Reverse
    colors` toggle (kept from spec 003), class list;
  - `Appearance`: fill opacity, outline color/width/opacity, point size
    (sliders with `aria-valuetext`);
  - `3D` (polygons): `Extrude polygons` switch, `Height from` combobox
    (columns plus "Constant height"), `Height scale` number input, and a
    status line "N polygons drawn flat (no height)".
- No Apply button. Every change applies immediately.
- **Ramp picker**: a listbox `Color ramps`. Focusing an option previews it
  on the map; Enter or click commits; Escape or Tab restores and closes.
- **Save** (`SaveStyleButton.svelte`):
  - a button named `Save style (QML)`, or `Download style (QML)` on the web;
  - an adjacent button `More style formats` with `aria-haspopup="menu"`
    and `aria-expanded`;
  - a `menu` with `menuitem`s `QGIS style (.qml)`, `OGC SLD (.sld)` and
    `Mapbox GL style (.json)`.
  - Keyboard: Enter, Space or ArrowDown opens the menu and focuses the
    first item; Up/Down move through items; Home/End jump; Enter
    activates; Escape closes and returns focus to the arrow button.
  - The menu is named `Style formats`.
- `Import style…` and `Reset style` stay, as icon buttons with names.
- The legend's swatches carry the fill opacity (FR-005).

## Table (`AttributeTable.svelte` and friends)

- **Toolbar**:
  - `Columns` button: "Columns (N hidden)" when any are hidden. It opens a
    dialog `Choose columns` with a searchbox `Find column`, a checkbox per
    column, and `Show all` and `Hide all` buttons.
  - `Clear filters` (visible when filters exist).
  - The count shows "N of M rows" when filtered.
- **Filter row** under the header: one input per visible column, named
  `Filter <column>`.
  - Number and date columns have an operator select (`=`, `≥`, `≤`,
    `between`); `between` shows a second input.
  - Invalid input sets `aria-invalid="true"` with a reason in
    `aria-describedby`.
- **Checkbox column**:
  - header checkbox `Select all matching rows` (tri-state, `aria-checked`
    `mixed`);
  - row checkbox `Select row <n>`;
  - Space on a focused row toggles it.
- **SelectionBar** (when the selection is not empty): "N selected",
  `Zoom to selection`, `Show selected only` (toggle, `aria-pressed`) and
  `Clear selection`.
- Empty filter result: the text "No rows match the filters" with a `Clear
  filters` button.
- Unavailable for PMTiles (unchanged FR-009a notice).

## Layers (`LayerList.svelte`)

- Shown only when `facts.layers` is present, as a listbox `Layers in this
  file`.
- Options read "<name>, <geometry type or 'table'>, <count>".
- The selected option is the active layer. Enter or click switches.
- A status line: "This file has N layers."

## Export dialog

Settings stacked in VS Code's settings-editor style (label, native
`<select>`, one line of description). Focus starts on the first select.

- `Rows` select (All rows, Filtered rows (N), Selected rows (N)), shown
  only when a narrower scope applies.
- `Format` select with two `<optgroup>`s: `With geometry` (the spatial
  formats, and CSV) and `Attributes only` (CSV, Parquet, Excel workbook,
  JSON). The group an option is in sets whether the geometry is written
  (user request, 2026-10-11; replaces the `Include geometry` switch). A
  result with no geometry shows `Attributes only` alone. Under it: what the
  format is good for, and the output file name.
- `Coordinate reference system` select, with geometry only: the result's
  CRS, `EPSG:4326 · WGS 84`, `EPSG:3857 · Web Mercator`, `Other EPSG code…`.
  Disabled, showing WGS 84 and the reason, for WGS84-only formats. `Other`
  shows an `EPSG code` box (accepts `26912` or `EPSG:26912`) and a status
  line: the CRS name from the engine's PROJ database, or why the code is
  not usable (`aria-invalid`). While it's unusable, the dialog's Export
  button is disabled (the toolbar's Export data… button is not).
- `Geometry as` select (WKT text, X / Y columns) for CSV with geometry.
- The "What changes" list shows `forcedChanges`, including Shapefile field
  renames.

## Map

- **Controls toolbar** (`Map controls`) adds:
  - `Globe view` (toggle, `aria-pressed`);
  - `Reset view` (enabled when pitch or bearing is not 0);
  - `Export map image…`;
  - `Search places` (`searchbox` inside a `search` landmark; hidden when
    disabled).
- **Place search**:
  - Enter or the button searches. Results form a `listbox` "Places".
    Escape closes it.
  - The first use shows a dialog `Place search` with the privacy notice,
    and `Search` and `Cancel` buttons.
- **Legend range filter** (graduated): a group `Value range` with two
  `slider`s, `Minimum value` and `Maximum value` (`aria-valuetext` in data
  units), plus a `Reset range` button.
- **Map image dialog**: `Export map image`, with radios `1×` / `2×`,
  checkbox `Include legend` and button `Export`.
- **Keyboard**: the existing map focus handlers, plus Shift+←/→ to rotate
  and Shift+↑/↓ to tilt (MapLibre's built-ins, documented in the map
  help).
- The attribution button and icon use the `--se-text-secondary` token
  (FR-035).

## Panels

- Resize handles (`separator` with `aria-valuenow`) reset to their default
  on double-click or Enter.

## Web shell chrome

- `Theme` menu button with a `menuitemradio` each for `System`, `Light` and
  `Dark`.
- `Copy link` button (web only).
- `Try sample data` button in the empty state.

## Test hooks (`?e2e=1`, web; `spatialExplorer._*` commands, VS Code)

Added:
- `filterState()` returns `{ filters, matching, total }`;
- `selectionState()` returns `{ kind, count }`;
- `layers()` returns `FileLayer[]` and the active layer;
- `mapState()` returns `{ projection, pitch, bearing, extrusion: boolean }`;
- `captureMap(scale)` returns `{ width, height, bytes }`;
- `shareLink()` returns a string.
