# Design Plan: Quick Look UI polish

**Status**: Approved 2026-10-10, with the amendments in §8. §8 overrides
§1–§7 wherever they conflict.
**Relationship to `plan.md`**: this is a *design/visual* plan, scoped entirely within
spec 001's existing technical plan (`plan.md`) and task list (`tasks.md`). It does not
add features, change the data model, or touch Phase 5's CRS work — it only changes how
the already-built Phase 1–4 UI looks and feels, and sets the visual foundation Phase
5–8's remaining components (`StatusBar`, basemap picker, click-to-inspect) should be
built on top of.

## 1. Why this exists

A real bug (missing `<link>` to the webview's CSS — see `research.md` §6) made the VS
Code extension render with **zero** CSS at all, which made both the map and every
component look broken/unstyled. That bug is fixed. But fixing it exposed the real,
separate problem this plan addresses: even with CSS loading correctly, the UI has not
had a deliberate design pass. Components are functionally correct but visually ad hoc
(hardcoded hex colors, default browser fonts, a fixed un-resizable map/table split, no
branding).

Per the user's direction, this UI should be **directly inspired by**:
1. **The old Spatial Explorer web app** (`legacy-v1` tag / `main` branch, still live at
   `https://ar-puuk.github.io/spatial-sql-explorer/`) — a mature, already-shipped design
   system with a real token file (`webapp-theme.md`, also copied into `omx-viewer`).
2. **GeoLibre** (`opengeos/GeoLibre`) — specifically the things it does *better* than
   the old app, scoped down to what applies to spec 001.

I reviewed both directly, not just their docs: I took live screenshots of
`ar-puuk.github.io/spatial-sql-explorer` in light mode, dark mode, the Results tab, and
the SQL Editor tab (via Playwright), and read `webapp-theme.md`, `css/style.css`, and
`index.html` from the `legacy-v1` tag in full. GeoLibre's own docs site doesn't expose
screenshots, but its structural pattern (table expands from the bottom as a collapsible
drawer rather than a permanent split) is clearly documented and is the one concrete
structural idea adopted below.

## 2. Scope boundary — what this plan touches and what it explicitly does not

CLAUDE.md's "explicitly out of scope" list and spec 001's own scope (LOOK only: map +
table + CRS/metadata/status + basemap + click-to-inspect — no QUERY, STYLE, or EXPORT)
both apply here. The legacy app and GeoLibre are full GIS workbenches; most of what
makes them visually rich is UI for features spec 001 does not have yet.

**In scope now** (spec 001's existing/remaining components):
- A shared design-token layer (`packages/ui`) + a per-shell token file (web vs. VS Code)
- Typography (Inter + JetBrains Mono for the web app; VS Code's own font variables for
  the extension — never override a user's VS Code font choice)
- `ViewerLayout`: map/table split becomes resizable and collapsible (not fixed 2:1)
- `AttributeTable`: real data-grid styling (striping, mono data font, header treatment)
- `ErrorBanner` / `LayerWarningBanner`: tinted-background + accent-border treatment
- Web app empty-state/drop-zone: redesigned to match the legacy drop-zone pattern
- Web app gets a minimal branded header bar (the extension does not — see §4.3)
- `StatusBar` (Phase 5, in progress): placement + styling, not its data (unchanged)

**Explicitly deferred — do not build now** (belongs to later phases/specs per
CLAUDE.md and `plan.md`):
- Basemap picker / pills (Phase 6, User Story 4 — not started)
- Map legend (tied to styling, which is spec 003+)
- SQL editor, query history, "Share" links (specs 002+ — query UX)
- Map Style panel, color ramps, categorical/graduated styling (spec 003 — styling)
- Export buttons / CSV / GeoJSON / PNG (spec 005 — export)
- Left rail / table registry / schema explorer / multi-file sessions ("Add to Spatial
  Explorer Session" — a later, separate feature; spec 001 is a single-file viewer)
- Per-column filter row in the table (a querying feature, not in spec 001)
- Checkbox multi-select in the table (spec 001 is single-select, click-to-inspect)

Anything in the "deferred" list that shows up in a screenshot below is reference only —
it informs the visual language (colors, spacing, type scale, card/shadow treatment),
not a feature to add.

## 3. What the live legacy app actually looks like (verified, not assumed)

Light mode (`Light` basemap, Map Style tab open — note: Map Style itself is out of
scope, shown only for the visual language):

- App background: warm cream (`#fffbf2`), panel background slightly deeper cream
  (`#f2ece0`), cards/inputs pure white.
- Left rail: 260px, header with a hex (`⬡`) glyph + uppercase tracked-letter-spacing
  title in amber, subtitle in muted gray-brown, circular theme-toggle button top right.
- Section labels: 9–10px uppercase mono, heavy letter-spacing, muted color — used
  everywhere as a micro-heading (`TABLES`, `SCHEMA`, `LOAD DATA`).
- Basemap switcher: a pill group, floating top-left over the map, frosted-glass
  (`backdrop-filter: blur`) background, active pill filled amber.
- Map legend: floating card, frosted glass, rounded corners, drop shadow — **out of
  scope** (styling feature) but the floating-glass-card treatment is the right visual
  language for anything else we float over the map later (e.g. a future basemap
  picker).
- Status bar: a **thin bar docked to the bottom of the map itself** (not a separate
  full-width row below the whole layout) — semi-transparent dark background with blur,
  11px mono text, muted color, a PNG-export button on the right (out of scope).
- Bottom drawer: tab bar (`SQL Editor` / `Results` / `Map Style` — only `Results`
  applies to spec 001), a drag handle with grip dots to resize, collapses to just the
  tab bar's height when dragged down past a threshold.
- Table (Results tab): uppercase mono column headers, alternating row stripes
  (white/near-white), row hover = amber-tinted background, `null` cells rendered as
  muted literal text, a header row above the table reading `Query Output` /
  `77 rows, 77 mapped in 0.045s · geometry`.

Dark mode: deep navy background (`#0e171e`), elevated surfaces step up in lightness
(`#131e28` → `#192430` → `#1f2d3a`), bright amber accent (`#fbbf24`) instead of the
light mode's deeper amber (`#b45309`) — same token *names*, different values, exactly
per CLAUDE.md's "same token names, different token file" instruction.

## 4. Architecture decision: the token layer

### 4.1 The problem with how `packages/ui` is styled today

Every component today hardcodes VS Code tokens directly with literal-hex fallbacks,
e.g. `AttributeTable.svelte`:
```css
background: var(--vscode-editor-background, inherit);
border-bottom: 1px solid var(--vscode-panel-border, #ccc);
```
This works *only* for VS Code. The web app has no `--vscode-*` variables, so every
component silently falls back to its hardcoded literal (`#ccc`, `#f0f0f0`, system-ui
font) — which is exactly why the web app currently looks like "plain HTML and CSS."
There is no mechanism today for the web app to apply the brand palette at all.

### 4.2 The fix: one abstract token layer, two token files

`packages/ui` components stop referencing `--vscode-*` directly. Instead they reference
a small, fixed set of abstract custom properties (prefixed `--se-` for "spatial
explorer," to avoid any collision with either host's own variables):

```
--se-bg-base          --se-border             --se-text-primary
--se-bg-panel         --se-border-strong      --se-text-secondary
--se-bg-elevated       (focus ring handled    --se-text-muted
--se-bg-hover           via --se-focus-ring)
--se-accent           --se-font-ui
--se-accent-text      --se-font-mono
--se-error / --se-warning / --se-success
--se-radius-sm / --se-radius
--se-shadow-card / --se-shadow-elevated
```

Each shell defines what these resolve to, in exactly one place:

- **`apps/vscode-ext`** (`getHtml()`'s inline `<style>` block, already the right place
  since that's where the CSS-reset fix landed): maps every `--se-*` token straight to
  its `--vscode-*` equivalent, per CLAUDE.md's existing mapping table (e.g.
  `--se-bg-panel: var(--vscode-sideBar-background, var(--vscode-editor-background))`).
  **The brand amber/cream/navy palette is never used here** — VS Code users expect VS
  Code's own theme (light/dark/high-contrast, whatever they've picked), not our brand.
  This is intentional per CLAUDE.md's theming section, not an inconsistency.
- **`apps/web`** (a new small `apps/web/src/theme.css`, imported once from `main.ts`):
  maps every `--se-*` token to the brand values in §3/`webapp-theme.md`, under
  `:root` (light) and `@media (prefers-color-scheme: dark)` (dark) — mirroring the
  legacy app's own light/dark split, minus its extra "Void" variant (not needed).

This is the one piece of real plumbing work in this plan; everything else is applying
tokens that already exist once this lands.

### 4.3 Where chrome lives: shared component vs. per-shell wrapper

`ViewerLayout` (shared) stays exactly what it says — map, table, error/warning banners.
It does **not** gain a header or a status bar. Those are chrome, and the two shells
need different chrome:

- VS Code already has native chrome for this: the editor tab title *is* the header, and
  T036's native status bar items (CRS, feature count, cursor) already exist. Adding an
  in-content header or status bar would duplicate both, which is not what any of
  CLAUDE.md's reference apps (Data Wrangler, Hex Editor, Image Preview) do — they all
  rely on native VS Code chrome and give 100% of the content area to the actual data
  view.
- The web app has neither, so it needs its own: a slim top header bar (branding +
  light/dark toggle, no left rail — the rail's *content* in the legacy app is
  table-registry/schema/history, none of which exist in spec 001's single-file scope)
  and `StatusBar` docked to the bottom of the map pane specifically (§3's pattern),
  not a full-width row below the table.

Concretely: `StatusBar.svelte` (already built in this session, Phase 5/T035) moves out
of `ViewerLayout.svelte` and is instead rendered only by `apps/web/src/App.svelte`,
positioned absolutely over the bottom of the map pane. `apps/vscode-ext`'s
`main.ts` does not render it at all (T036's native status bar already covers the exact
same fields).

## 5. Component-by-component changes

### 5.1 `ViewerLayout.svelte` — resizable, collapsible map/table split

Replace the fixed `flex: 2` / `flex: 1` column split with a draggable split, inspired
by the legacy app's `#drawer-drag-handle` (grip-dot handle, drag to resize, collapses
past a threshold) — but simplified, since spec 001 has only one drawer pane (the
table), not three tabs:

- Default: map ~70%, table ~30% (more map-first than the legacy app's ~56/44, since
  there's no SQL editor competing for that space here).
- A thin drag handle between them (3–4px, grip dots on hover, cursor `row-resize`)
  lets the user resize freely, clamped e.g. 15%–85%.
- Dragging past a small threshold near the bottom collapses the table to just its
  header strip (showing the feature count, e.g. "179 features" — still visibly present,
  satisfying spec.md US1's "and its attributes in a table" acceptance criterion even
  when collapsed) with a click-or-drag-up to re-expand.
- This still defaults to *both visible with real rows*, which is what US1's acceptance
  scenario requires — the drawer change is additive polish (resize + collapse), not a
  change to the default rendered state.

### 5.2 `AttributeTable.svelte` — real data-grid styling

Per `webapp-theme.md`'s already-specified table pattern, confirmed live:
- Header row: uppercase, mono font, letter-spacing, muted/secondary text color, a
  slightly stronger bottom border than body rows.
- Body rows: alternating background (even/odd), not a single flat color.
- Hover: accent-tinted background (amber-tinted on web, VS Code's own hover token in
  the extension).
- Selected: accent-tinted background **and** a left accent-colored border (currently
  only a flat background swap) — matches the legacy app's `border-l-2` selected style
  and is a clearer selection signal.
- Cell data: mono font, `tabular-nums` for numeric-looking values.
- Empty/null attribute values: render as a muted literal (the legacy app uses a plain
  "null"; keep ours as `—` as already implemented — a toss-up either way, not a
  priority to match exactly) rather than a blank cell, so sparse rows are still
  legible.

No filter row, no checkboxes — those are explicitly out of scope (§2).

### 5.3 `ErrorBanner.svelte` / `LayerWarningBanner.svelte`

Both already use VS Code tokens reasonably; on top of that, adopt the legacy app's
`#error-banner` pattern: a tinted background at low opacity (`color-mix` with the
error/warning token, since CLAUDE.md notes Tailwind's `color-mix()` need — plain CSS
`color-mix()` works the same way outside Tailwind) rather than a single flat `warning`-
colored block, plus a left accent border bar. Mono font for the message text itself
(data/technical text), not the UI font.

### 5.4 Web app shell (`apps/web/src/App.svelte`, new `theme.css`)

- New `apps/web/src/theme.css`: the `--se-*` → brand-value mapping (§4.2), Inter +
  JetBrains Mono `@font-face`/Google-Fonts import, thin webkit scrollbar styling (all
  copied as *values*, not files, from `webapp-theme.md` — satisfying CLAUDE.md's
  "copy decisions and design, never code or assets" for the GeoLibre reference, and
  reasonable for our *own* prior app's theme file, which we own).
- Drop-zone/empty-state: redesign to the legacy `#drop-zone` pattern — dashed border
  (`--se-border-strong`), centered icon + "Drag a geospatial file here" + a small
  supported-formats line (reuses the existing format list already in `openFile.ts`'s
  error message, kept in sync), amber-tinted background and solid border on
  drag-over/hover (replacing the current hardcoded `#eef6ff`/`#3388ff`).
- A slim header bar above `ViewerLayout`/the empty-state: hex glyph + "Spatial
  Explorer" title (mono, uppercase, tracked, accent-colored, matching the legacy
  `#app-title`), no subtitle needed (the legacy subtitle described its own tech stack;
  not necessary here). No left rail, no theme-toggle button needed for a first pass
  (light/dark can simply follow `prefers-color-scheme`, matching CLAUDE.md's "Default
  follows VS Code theme kind" principle applied to the web app's equivalent, the OS
  theme) — a manual toggle can be added later if wanted, it's not required for parity.

### 5.5 `apps/vscode-ext` — no new chrome, just finish the token wiring

Beyond the `--se-*` → `--vscode-*` mapping (§4.2) and the already-landed CSS `<link>` +
reset fix, no new VS Code-side components. The extension should continue to look and
feel like a native VS Code view, per CLAUDE.md's explicit instruction and every
referenced extension (Data Wrangler, Hex Editor, SQLite Viewer, Image Preview).

## 6. Out of scope, restated

Nothing in this plan adds a basemap picker, legend, SQL editor, style panel, export
button, left rail, query history, share links, table filter row, or multi-select. Those
screenshots exist only to document the *visual language* (glass-card floats, pill
groups, mono data typography, frosted status bars) that later phases/specs should reuse
when they build those features — not something to build now.

## 7. Verification plan

1. `npm run typecheck --workspace=packages/ui` / `packages/core` stay clean throughout.
2. `tests/web`'s Playwright suite (real `vite build` + `preview`) still passes 2/2,
   including the `.map-pane canvas` visibility assertion.
3. `tests/vscode-ext`'s real `@vscode/test-electron` suite still passes, **including**
   the `mapCanvasRect` regression assertion added after the missing-CSS bug (T014) —
   this is the test that would have caught today's bug, so it must keep passing and
   must not be weakened.
4. Take fresh Playwright screenshots of the rebuilt web app (empty state, loaded state,
   light and dark) and compare side-by-side against the legacy-app screenshots in this
   plan, as a visual sanity check — not a pixel-perfect match, but recognizably "the
   same design language."
5. Manually reload the VS Code Extension Development Host and confirm the map renders
   with a real nonzero size and the new table/banner styling is visible (this is the
   exact thing that was broken; confirm by eye, not just by the automated
   `mapCanvasRect` check).

## 8. Amendments (2026-10-10): user decisions + GeoLibre engine techniques

The user reviewed this plan and widened it in two ways:
- GeoLibre is a model for **technical** quality, not just visuals: initialization,
  lazy loading, memory, map performance, and load/style settings.
- "Any reasonable upgrades over the current functionality" are welcome, within
  spec 001's scope.

GeoLibre's code was read directly (`opengeos/GeoLibre@main`, plus its
`opengeos/maplibre-gl-vector` dependency). Its release notes were used to find
what it had to fix after launch.

### 8.1 Decisions

| Topic | Decision |
|---|---|
| Attribute table | Virtualized rows and a sticky header. The selected row scrolls into view. Double-clicking a row zooms to the feature. Click a header to sort. Sorting is client-side, over the loaded rows only. NULL is styled. Numbers are right-aligned with tabular figures. |
| Map controls | Zoom ±, a fit-to-layer button, and a metric scale bar. Styled with `--se-*` tokens, so they look native in VS Code and on-brand on the web. |
| Map colors | Fixed, theme-independent data color (CLAUDE.md). The selection highlight follows the theme: VS Code focus/accent, read via `getComputedStyle` and re-applied on theme change. |
| Style settings | A small "Layer style" popover: fill color, stroke color, opacity, stroke width, point radius. It is the future styling spec's "single symbol" mode. **Not persisted**, because the sidecar format is still OPEN in CLAUDE.md. |
| Feature cap | **Stays 1000. No setting.** The user's concept is that `LIMIT 1000` is a query the SQL editor (spec 002) will let users edit. The "Showing X of Y" truncation notice stays. |
| Viewport/tile loading (`ST_AsMVT` + `addProtocol`) | **Deferred** to its own later slice, not this pass. |

This moves the following **out** of §2's "deferred" list:
- Map controls are now in.
- The minimal layer-style popover is now in.

Everything else in §2/§6 stays deferred: legend, thematic styling, basemap
picker, SQL, export, left rail, filters, and multi-select.

### 8.2 Engine work adopted from GeoLibre (cited)

1. **Self-healing, session-scoped DuckDB singleton**
   (GeoLibre `duckdb-vector-loader.ts` `getDatabase()`, post-launch fix #1045).
   - Correction: an earlier draft of this item claimed a leak. There was
     none, because `openFile()` terminated its instance after each load.
   - The real cost was that every open re-paid the ~36 MB wasm compile plus
     the spatial extension's CDN fetch.
   - New behavior: one instance per webview or page, with the spatial
     extension loaded once. A failed init is not memoized.
   - After each load, the file's registered buffers are dropped (`dropFile`).
     The ≤1000 materialized features are all the viewer keeps, so the WASM
     heap doesn't hold file bytes it no longer needs.
2. **Pre-warm DuckDB in parallel with file transfer.**
   - In VS Code, DuckDB init starts as soon as the asset URLs arrive, instead
     of after all file chunks have arrived.
   - In the web shell, it starts at idle after first paint.
   - The viewer's only job is opening a file, so lazy init is the wrong
     trade-off here, unlike in GeoLibre's multi-purpose app.
3. **Own the map resize.**
   (GeoLibre `map-resize.ts`; flash bugs #2173/#2201; "ResizeObserver loop"
   noise #1647.)
   - Use `trackResize: false` plus a `ResizeObserver` that calls
     `map.resize()` on the next animation frame.
   - Suppress resizes during a splitter drag and do one resize when the drag
     ends.
4. **Selection via `feature-state` + `promoteId`**, not a `filter` on `__id`.
   - GeoLibre uses a separate overlay source. With our single inline source,
     feature-state is cheaper.
   - Highlight all three geometry kinds. Today only the line highlight
     exists, so a selected **point** shows no highlight at all — a real
     current bug.
5. **GeoLibre's default single-symbol style** as the starting point, adjusted
   to theme-neutral values:
   - Fill opacity ~0.5 with a darker outline, 1.5px.
   - Points at radius 5 with a 1px light stroke.
   - Selection: halo plus a thicker outline.
6. **Text-selection guard** on the map container
   (GeoLibre #2734: a stray text selection hijacked map panning).
7. **Table value formatting** (GeoLibre `AttributeTable.tsx`, #2592):
   - bigint → number when safe, otherwise a string.
   - Objects are JSON-stringified.
   - NULL is rendered as a styled, muted "NULL", which improves on GeoLibre's
     blank cell.

Considered and **not** adopted now:
- Streamed batch parsing with event-loop yields (#2858). Not needed at a
  1000-row cap.
- geojson-vt worker tiling (#2869). Same reason.
- `ST_AsMVT` viewport tiles. Deferred, see 8.1.
- A separate SQL DB instance, `preserveDrawingBuffer`, deck.gl, the plugin
  system, and the multi-renderer engine abstraction.

GeoLibre also replaced DuckDB with sql.js for GPKG after GDAL thread crashes
on the `eh` bundle (#258/#376/#393). **We re-tested this ourselves:** a
50,000-feature GPKG opened in about 2.2s in the real VS Code webview, with
the real count and the cap applied. It does not reproduce in our DuckDB-WASM
version, so there is no sql.js fallback (research.md §7).

### 8.3 Loading state (gap in §5)

`loadState === 'loading'` currently renders an empty map and "No features to
display", which is indistinguishable from an empty file.

- **Both shells:** a thin indeterminate progress bar at the top of the
  viewer. In VS Code it uses `--vscode-progressBar-background`, VS Code's own
  native pattern.
- **Table:** shows "Loading…" instead of the empty-state text.

### 8.4 Where the token files live (refines §4.2)

Rather than an inline `<style>` in `getHtml()`, VS Code's `--se-*` →
`--vscode-*` mapping lives in `apps/vscode-ext/src/webview/theme.css`. It is
imported from the webview's `main.ts`, so Vite bundles it into `main.css`.
The web shell's mapping is `apps/web/src/theme.css`, imported from
`apps/web/src/main.ts`. Each shell has one file, and shared components only
ever read `--se-*`.

High-contrast themes add `--vscode-contrastBorder` to borders and controls
(CLAUDE.md).

### 8.5 Style interchange (user decision, 2026-10-10)

This resolves CLAUDE.md's OPEN "style persistence format" question. The user
asked to keep GeoLibre's QGIS/Mapbox style interchange and chose **QML + Mapbox
+ SLD**.

**Formats.** Single-symbol only for now; categorized and graduated styles
extend the same files later.

| Format | Export | Import | Notes |
|---|---|---|---|
| QGIS QML (`<basename>.qml`) | ✓ | ✓ | **The sidecar.** Written in the QGIS ≥3.26 `<Option>` form with `Pixel` units. Reads the legacy `<prop>` form too, and converts mm/pt at 96 DPI. |
| OGC SLD 1.0 (`.sld`) | ✓ | ✓ | `CssParameter`. Also reads SLD 1.1/SE `SvgParameter`. Mixed layers get one rule per geometry family, using `geometryType()`. |
| Mapbox GL style (`.style.json`) | ✓ | ✓ | A complete v8 style document. Our model is embedded in `metadata`, so round trips are lossless. Expression paints are skipped, with a note. |

**Behavior**
- **Save**
  - VS Code writes `<basename>.qml` next to the data. If one already exists,
    a modal confirm runs first, because it might hold a richer
    QGIS-authored style.
  - The web shell downloads the file instead, since a browser cannot write
    next to a picked file.
  - Either way QGIS loads it automatically, because the `.qml` sidecar is
    QGIS's own convention.
- **Open:** a same-basename `.qml` is applied automatically.
  - VS Code already sends same-basename siblings.
  - On the web, the user drops it alongside the data.
  - A malformed sidecar produces a warning and never blocks viewing the
    data.
- **Export:** QML, SLD or Mapbox JSON through a save dialog (VS Code) or a
  download (web).
- **Import:** a file picker, with auto-detection by extension, then content.
  Format caveats are shown inline in the style panel.

**Where it lives**
- Serializers: `packages/core/src/style/`, our own code, written from GeoLibre's
  format choices rather than copied from it.
- Tests: `tests/core/style.test.ts`, 26 tests covering round trips plus
  QGIS-, GeoServer- and Maputnik-shaped inputs.

### 8.6 Real bugs found by looking at the running app

Each of these was invisible to the existing tests:

1. **The VS Code map never drew any data.**
   - MapLibre v6's worker was never configured in the webview. Its URL is
     derived at runtime, so no bundler emits the file, and a worker can't be
     constructed straight from an `asWebviewUri()` URL anyway.
   - The canvas was sized correctly, so `mapCanvasRect` passed while the map
     stayed blank. This, more than the missing CSS, explains "I cannot see
     the map preview".
   - Fixed by shipping `maplibre-gl-worker.mjs` in `dist-webview` and running
     it from a same-origin `blob:` URL.
   - Guarded by a new `renderedFeatureCount > 0` assertion in T014.
     Mutation-tested: with the worker removed, 2 tests fail.
2. **A source geometry column leaked into attributes.** It showed in the
   table as `{"0":1,"1":3,…}`. GDAL's synthetic `OGC_FID` was also shown.
3. **Map clicks never highlighted the table row.** The map handed back
   `String(id)` while the table compares numeric ids.
4. **Selected points showed no highlight at all.** Only a line highlight
   layer existed.
