# Spec 015 (proposal): visual redo

**Status:** revision 3, on branch `015-visual-redesign` (spec 014 merged to main first). Slice 2 (Lucide icons) is built;
the rest is a proposal. No behavior, data or feature changes.
**Direction (user, 2026-10-15):** build on other people's work and do not reinvent the wheel: use maintained libraries for
icons and for interactive components. The placement grid is not agreed (see section 6): it stays a plain dropdown until
the user says otherwise.
**Request (user, 2026-10-15):** a real icon library instead of hand-drawn icons; revisit style, placement, polish and
input types without losing the fit inside VS Code; the web page need not stay blue and pale yellow, which reads as
AI-generated; aim for the polish of a paid app.
**Companion:** `mockup.html` (open in a browser; the typed query on the landing page plays once). Landing and viewer
in light and dark, the palette and the data ramp. A static sketch, not the implementation.

## 1. Subject, audience, job

- **Subject:** Spatial Explorer, a quick look at geographic files: open, query in SQL, style, export.
- **Audience:** GIS and transportation analysts, planners and developers who live in VS Code or a browser tab and
  want an answer in seconds without opening QGIS.
- **Primary job:** get from a file to a trustworthy picture and a query result quickly, and never feel lost.
- **Where distinct choices come from:** cartography. Chart ink, nautical-chart magenta, hypsometric tints, the
  ruler, graticule and legend. Not generic SaaS.

## 2. What is wrong now (screenshots of the current build)

1. Icons are ours: 56 hand-drawn paths in `Icon.svelte`, uneven in weight and grid.
2. The web shell wears a costume: cream and amber, uppercase monospace labels (`MAP CONTROLS`, `OPENS`), numbered cards
   (`01 Look`), contour art and an amber hexagon map. The status bar is dark in light mode.
3. Monospace uppercase does the decorating; monospace should only carry data.
4. Native selects, checkboxes and ranges, restyled by color only. The Map controls panel is 15 selects with 2-3 line
   hints.
5. Map chrome is scattered; the rail's fourth button sits alone; no labels or tooltips; a full-width yellow banner for
   one bad row.
6. The default data fill is a saturated blue that fights every basemap.

## 3. Design plan, and the review against the generic defaults

The first draft of this proposal (spruce accent, cool neutral surfaces, small monospace labels, the same radius and
shadow everywhere) landed on several of the traits the skill lists as what generated UI converges on. Review:

| Draft choice | Why it was a default | Change |
| --- | --- | --- |
| Near-black dark mode with one bright accent | trait 2 | Dark mode is a deep *navy* "night chart" with a rose-magenta accent, the same identity as light, not an inversion. In VS Code, colors come from the user's theme anyway. |
| Muted spruce/teal accent | safe "dev tool green" | **Chart magenta**, the color nautical charts use for navigation marks and notes. Specific to the subject, unlike the usual indigo or green. |
| One radius, one soft shadow | SaaS-card kit | A radius hierarchy (3 px controls, 6 px floating groups, 10 px hero and dialogs) and two elevation levels: a hairline ring for floating map controls, a deep shadow only for the one floating bar and the hero. Docked panels use rules, not shadows. |
| Small monospace labels, dot-joined meta strings (`180 rows · 179 mapped`) | trait 5 | Labels are sentence-case in the UI face. Monospace carries only data: SQL, coordinates, numbers. Meta becomes separate status-bar fields with dividers. |
| Hero as drop zone plus feature cards | generic landing | One memorable thing: a live demo. See section 5. Cards and numbering removed (the content is not a sequence). |
| Inter or system font everywhere | default family | IBM Plex Sans and Plex Mono on the web (engineered, instrument feel, drawn as a pair). In VS Code, the editor's fonts. |

**Tokens (web shell, one file: `apps/web/src/theme.css`)**

| Role | Light | Dark |
| --- | --- | --- |
| paper / night | `#fcfcfd` | `#0f1726` |
| panel | `#f3f5f8` | `#141e30` |
| rule | `#dde2ea` | `#263349` |
| chart ink (text) / secondary | `#1c2f55` / `#5a6882` | `#e4eaf5` / `#93a0b8` |
| chart magenta (accent) | `#b3135f` | `#f06aa8` |
| data ramp "tide" (default fill) | `#d9e9ef` to `#1b5470`, 6 steps | same, dimmed 15% |

The accent is used for exactly three things: the primary action, the active tool or tab, and focus. Selected rows get
an amber tint with a magenta edge. The map's selection color stays as it is.

**Type scale (web):** 12 / 13 / 15 / 46 px; 400, 500, 600 only; line length under 70 characters; the headline has tight
tracking and `text-wrap: balance`. No accenting a single word, no all-caps labels, no eyebrows.

**Principles**
1. Chrome is quiet and exact; the map and the data are the color.
2. Structure is information: rules, group headings and dividers appear only where they separate real things.
3. Motion answers an action (switch, tool activation, panel open), except for one orchestrated moment on the landing
   page. Everything honors `prefers-reduced-motion`.
4. Every control has a name, a tooltip with its shortcut, a keyboard path and a visible focus ring.
5. Words: sentence case, plain verbs, the same name for an action through the whole flow ("Open file" opens a file and
   its progress says "Opening"), errors say what happened and what to do.

## 4. Icon library

Requirement: permissive licence; inline SVG (no font, no CSP change); tree-shakeable; Svelte 5; GIS tools included.

| Option | Licence | Verdict |
| --- | --- | --- |
| **Lucide** (`@lucide/svelte` 1.57, Svelte 5) | ISC | **Recommended.** 24 px grid, adjustable stroke (1.6 at 16 px sits beside VS Code's own icons), about 1,600 icons |
| Codicons | CC-BY-4.0 | Identical to VS Code, but no polygon, lasso, ruler, terrain; rejected as the only set |
| Tabler | MIT | Fallback for a gap |
| Phosphor | MIT | Softer than VS Code; no |

Every name we need exists in Lucide (checked): `paintbrush`, `tag`, `map`, `sliders-horizontal`, `globe`,
`mountain-snow`, `scan`, `ruler-dimension-line`, `pentagon`, `square-dashed-mouse-pointer`, `spline`, `circle`,
`undo-2`, `redo-2`, `folder-open`, `search`, `link`, `triangle-alert`, `chevrons-up-down` and the rest of the list.
The mockup uses them.

How: keep `<Icon name>` (157 call sites unchanged); `Icon.svelte` maps our names to Lucide components imported one by
one, so unused icons are not bundled; stroke, size and `currentColor` set in one place; delete the custom paths.
Kept: the product mark (globe in SQL brackets; on the web it sits on a chart-magenta tile) and data symbols in the
style panel. ISC notice in THIRD-PARTY-NOTICES. Size cost to be measured in slice 2.

## 5. Landing page

- **One memorable thing: a live demo, not a screenshot.** A framed window types
  `SELECT name, pop / area AS density FROM layer ORDER BY density DESC`, then the map under it fills in on the tide
  ramp, once, about 4 seconds. It shows the whole promise (a file, a query, a map) without a word. With reduced
  motion it shows the finished state. It is the single orchestrated animation on the page.
- **Left:** the headline ("Open a map file. Query it like a database."), two sentences of plain explanation, "Open a
  file" (the only filled button) and "Try sample data", and a small line: drop a file anywhere, and the formats.
  Dropping anywhere on the page shows a full-page drop target.
- **Removed:** numbered cards, the format chip rows, contour art, amber hexagons, the GitHub-style eyebrow.
- **Status line:** SQL engine state, and that files stay in the browser.

## 6. Components (the input types)

A small kit in `packages/ui/src/kit/`, themed by `--se-*` and `--vscode-*`, each with a keyboard and axe test.

| Today | Becomes | Why |
| --- | --- | --- |
| checkbox for on/off | **Switch** (`role=switch`) | applies immediately; checkbox stays for multi-select (rows, columns) |
| `<select>` for 2-4 choices (units, draw purpose) | **Segmented control** (`radiogroup`) | all choices visible |
| `<select>` for long lists (CRS, predicate) | **Select** (listbox, typeahead, themed popup) | the native popup ignores the theme |
| position `<select>` per control | **Select** from the same library, listing only the positions that suit that control (as now) | no new invention. A placement grid (a 3 x 2 picture of the corners) was proposed and is shelved |
| `<input type=range>` | **Slider** plus a number field | drag or type |
| unlabeled icon buttons | **Icon button with tooltip** (name and shortcut) | rail and map buttons have none |
| yellow banner | **Notice** over the map: icon, one sentence, action ("Show row"), dismiss | does not push the app down |
| ad hoc menus | **Menu / Popover** with focus return and Esc | one behavior |

Use **bits-ui** (MIT, Svelte 5, headless, accessible by construction) for every one of these that it provides: Switch,
Toggle Group (the segmented control), Slider, Select, Popover, Dropdown Menu and Tooltip. We write only the styling, with
our tokens. Check each against the axe specs when it is adopted. Anything it lacks, we take from another maintained
Svelte library before writing our own.

## 7. Viewer layout

- **Title bar (40 px):** mark, name, the open file as a tab, "Copy link", "Open file" (filled).
- **Right rail:** 40 px, icons only, tooltips, a 2 px accent bar on the active tab, all four tabs together at the top.
- **Map chrome:** controls sit in *groups* (one rounded box, 1 px dividers, 30 px cells), 6 px apart: Zoom, View (fit,
  globe, terrain), Tools (draw, measure, select, image). The active tool takes the accent tint. Search, coordinates and
  scale use the same hairline-ring language. The coordinates readout becomes three fields (E, N, elevation) with
  dividers.
- **Draw, measure, select:** one contextual bar at the bottom center while a purpose is active: shape tools, undo,
  redo, clear and units, with the purpose named at its left. It leaves when the purpose ends.
- **Map controls panel:** groups "Measuring" and "Placement"; each row is a switch, a name and the placement grid;
  hints move to tooltips; "Reset to defaults" is a text action. All 15 rows fit without scrolling.
- **Table and SQL:** sentence-case headers, no zebra, hairline rows, muted row numbers, numeric columns right-aligned in
  mono, selected rows an amber tint with a 2 px magenta edge, an underlined active tab, counts in plain words
  ("180 rows, 179 on the map").
- **Status bar:** theme-matched on the web; fields separated by dividers, not dots.
- **Empty and error states** say what to do: "1 row has no usable geometry. It is in the table, not on the map.
  Show row." Never "Oops".

## 8. VS Code fit

Colors stay `--vscode-*` (accent: `--vscode-button-background`, focus: `--vscode-focusBorder`, high contrast:
`--vscode-contrastBorder`); the web palette and Plex fonts do not ship in the extension. Shapes follow the editor:
13 px, 28 px controls, a smaller `--se-radius` set by the extension. Verify in Dark Modern, Light Modern, Dark High
Contrast and one third-party theme.

## 9. How it ships (slices, behavior unchanged)

1. Tokens and type: new `theme.css`, drop uppercase mono labels, one spacing and type scale. Plex Sans and Mono
   self-hosted as subsetted woff2 (OFL), loaded by the web shell only.
2. Icons: Lucide behind `Icon.svelte`; delete custom paths; notice file; bundle size check.
3. Kit and inputs, starting with Map controls, then Terrain and Shapes, then the style panels.
4. Map chrome: groups, the contextual draw bar, notices, rail and tooltips.
5. Table, SQL tab and status bar.
6. Landing page and title bar, including the live demo.
7. Baselines: Playwright `toHaveScreenshot` for landing, viewer and panels in light, dark and high contrast; a
   test-electron pass in VS Code.

Specs that read native `<select>` or `checkbox` roles (Map controls, Terrain) are rewritten with their controls.

## 10. Decisions for you

1. **Identity:** chart ink with chart magenta (proposed). Alternatives: deep-water blue-green, or graphite with
   vermilion. One token file, so it is cheap to change after you see it running.
2. **Fonts:** IBM Plex Sans and Mono for the web shell (proposed, about 50 kB self-hosted), or system fonts.
3. **bits-ui** for all headless components (now the plan, per your direction).
4. ~~Placement grid~~ shelved: dropdown stays.
5. **Landing page picture:** the right half of the page shows the product. Either a short animation that plays once (a
   query is typed and the map under it colors in), or one still image of the viewer. The animation is more convincing and
   costs a few lines of CSS; the still is plainer and never distracts. Your call.
6. **Scope:** all seven slices as spec 015, or slices 1 and 2 first, which alone remove most of the generated look.

## 11. Not in scope

New features, moving functionality between panels, the VS Code color model, the logo, map data symbology,
`PIPELINE.md`. A command palette and keyboard-shortcut cheat sheet would add to the paid-app feel but are features;
noted for later.
