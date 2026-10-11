# Contract: UI (`packages/ui`)

## Opening

**`OpenProgress`** replaces today's loading state. It shows:
- the phase label: "Reading file facts…", "Reading the whole file… 12 s",
  "Indexing 4,000,000 features…" or "Loading for queries… 1.4 GB";
- a progress bar: indeterminate unless a fraction is known;
- **Cancel**, always reachable (FR-002).

It appears after 1 s, so quick opens don't flash. Cancel returns to the
previous file or the empty state.

**`ReadWholeDialog`** is a modal (`role=dialog`, labeled), shown for
whole-read formats over 100 MB:

> "GeoJSON files must be read in full. This one is 325 MB and may take about
> 25 seconds. GeoParquet and FlatGeobuf open at any size."

- Buttons: **Open** (the default) and **Cancel**.
- Esc cancels, and focus returns to where the open started.

## Map (`MapView`)

**View loading**:
- **Trigger**: `moveend`, debounced 150 ms. The store calls
  `session.view({ bbox, zoom, cap })`.
- **No flash**: the previous `ViewFeatures` stay drawn until the new ones
  arrive (FR-007).
- **Loading cue**: a thin indeterminate bar on the map's top edge while a
  view loads for more than 300 ms.

**Notices**: the map notice line (spec 001) shows the data-model.md notices
for:
- a thinned view;
- indexing;
- the fallback.

It uses `role=status`, and reads once per change.

**Selection** (FR-008): selecting a row or feature outside the drawn set
calls `featureById`, draws it as a highlighted overlay, and zoom-to fits it.

**PMTiles**: when the layer is `tiles`:
- the `pmtiles` protocol source is added, with the archive's vector layers
  styled with the single-symbol style (spec 001 colors);
- the inspector works on clicked features, showing the layer name;
- facts come from the header;
- SQL, the table, the style panel and export are disabled, each with the
  FR-009a reason.

## Attribute table (`AttributeTable`)

- The row count comes from `result.rows`. The scroller height is sized to
  all rows.
- **Paging**: as the user scrolls, the visible window requests
  `session.page()` for the pages it needs.
  - Placeholder rows (skeleton, `aria-busy`) show while a page loads.
- **Sort**: a header click sets `sort` and clears the page cache. A sorted
  deep page shows a loading row until it arrives.
- **Header**: "4,000,000 rows". The `reRuns` notice shows when set.
- **Keyboard navigation** (spec 001) works across pages: moving into an
  unloaded page waits for it.

## Style panel and legend

- **Classification uses `session.styleStats()`**. While it runs, the panel
  shows "Classifying 4,000,000 rows…" and stays interactive. A newer request
  supersedes an older one.
- **Legend**: counts describe the whole result. A sample note shows when
  `stats.sampled`.

## Query panel

- **The default text** is `SELECT * FROM layer`.
- **The status line** shows the exact row count. "Showing first …" no longer
  appears.
- **`LargeResultDialog` is removed.**

## Export dialog

The rows choice is removed. Everything else is as in spec 005.

## Accessibility (Constitution VII)

- New controls (OpenProgress Cancel, ReadWholeDialog, the "Load for queries"
  button) are keyboard-reachable and labeled.
- Notices use `role=status`. Skeleton rows are `aria-busy`.
- axe runs on:
  - an open in progress;
  - the announcement;
  - a thinned map;
  - a paging table;
  - the PMTiles disabled panels.
