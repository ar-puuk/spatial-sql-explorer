# Spec 012: Basemap previews and the Basemap panel

**Status:** built (2026-10-15), branch `012-basemap-previews`.
**Request (user, 2026-10-14):** "The fake [previews] look ugly. Also maybe a
redesigned basemap panel from the right sidecar?"

## Decisions (user, 2026-10-14)

- Real previews, bundled where we may ship them (bundled thumbnails accepted).
- In-panel search: yes.
- Recent picks: not now (unsure; easy to add later).
- Preview place and zoom: copy GeoLibre or another popular app. Chosen:
  GeoLibre's preview center (8°E, 47°N: Zurich and its lake) at city scale
  (MapLibre zoom 10), as ArcGIS's basemap gallery frames its thumbnails. At
  GeoLibre's zoom 2 every light style looks alike; zoom 11 was mostly lake.
- The gallery opens centered over the map's column, not the whole window
  (falls back to the window under 640 px).

## What it does

1. **Previews** (`packages/core/src/basemapThumbnails.ts`,
   `packages/ui/src/basemapPreviews.svelte.ts`, `BasemapThumb.svelte`):
   - keyless vector styles: thumbnails rendered by
     `scripts/basemap-thumbnails.mjs` (MapLibre in Chrome, 120×72 CSS px at
     2x, WebP), bundled in `basemapThumbnails.json` (~113 KB for 23) and
     loaded on first use as their own chunk;
   - raster rows: one live tile of the same place, two zooms past the
     vector view (256 px tiles at half size on a 2x screen), capped at the
     provider's maxzoom; never bundled (their imagery isn't ours to ship);
   - keyed rows without a stored key: a "Needs key" tile; with a key, raster
     rows resolve their tile URL through the store;
   - Blank: its color, or the map background.
   The old two-color swatches (`preview: {land, water}`) and the gallery's
   style-JSON color guess are gone.
2. **Panel** (`BasemapPicker.svelte`): the current basemap (thumbnail, name,
   provider and kind; Blank's color tools), "Follow the theme", a search over
   every basemap with up to 12 results in the panel (usable ones first; Enter
   takes the first; a keyed one opens the gallery's key form), the featured
   basemaps as a 3-column radio grid (arrows move in two dimensions), and
   "More basemaps…" (the gallery, with the panel's search).
3. **Gallery** (`BasemapGallery.svelte`): the same previews; centered over
   the map's column.

## Out of scope / later

- Recent picks.
- API keys moved from the gallery into the panel.
- Rendering keyed vector styles at runtime (GeoLibre's hidden "style camera"):
  a second WebGL context per webview, network on every session.
- Per-provider preview places for regional raster providers (they may show a
  neutral tile when Zurich is outside their coverage).

## Checks

- Core: `tests/core/basemap-thumbnails.test.ts` (every keyless vector style
  has a thumbnail, the script's view matches the app's, tile math).
- Web: `tests/web/specs/basemap-panel-012.spec.ts` (previews, follow theme,
  grid keyboard, search, gallery position, axe, 6x CPU: longest task 52–55 ms
  opening the panel and typing a search).
