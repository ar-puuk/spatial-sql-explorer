# Contract: UI (`packages/ui`)

All controls are keyboard-operable and labeled (Constitution VII). Edits
apply live (FR-020). Chrome uses theme tokens; data colors are fixed.

## Style panel (`LayerStylePanel.svelte`)

- **Style type**: a radio group with Single · Categorized · Graduated ·
  **Bivariate**. Bivariate is unavailable (with the reason as its title)
  when the result has fewer than two numeric columns.
- **Bivariate** sections:
  - **Columns**: Axis 1 and Axis 2 selects (numeric columns only), a Swap
    button, and a Method select per axis (Quantile, Equal interval,
    Natural breaks).
  - **Palette**: a radio group of palette previews (3×3 thumbnails, names,
    and a note when one is less color-blind safe).
  - **Cells**: the interactive square (below), plus "No value" with its
    count and visibility.
- **Size** section (points, lines and mixed layers; absent for polygons,
  where the panel says "Polygons have no size"):
  - a switch, **Size by column**;
  - when on:
    - Column (numeric);
    - a radio group, Classed | Proportional;
    - Classed: Method, Classes (2–10), and a size class list (eye toggle,
      size swatch, label, count, bound editing like `ClassList`);
    - Smallest and Largest size inputs (px).
  - Implemented accessible names:
    - "Size by column" (switch);
    - "Size column", "Size scale" (radio group: Classed / Proportional),
      "Size method", "Size class count";
    - "Smallest size", "Largest size", and "Size classes" (the list);
    - the visible words Column, Method and Classes are not `<label>`s,
      so they don't clash with the color controls.
  - The panel is 344 px wide, so four style types fit.
  - With Bivariate chosen, the section reads "Bivariate maps have no size
    channel." On a polygon layer the polygon note is shown instead (it
    applies whatever the style type).
- The Graduated **Vary: Color | Size** radio from 2026-10-12 is removed.

## Legend (`MapLegend.svelte`)

- One `<section>` group per active channel, each with its caption as a
  heading.
- **Color group**: unchanged rows.
- **Size group**: rows of size swatches, drawn in the single symbol's
  colors and to scale (shrunk together to fit, as now). Classed rows toggle
  visibility; Proportional rows are reference sizes and not toggles.
  "No value" is a toggle in both modes.
- **Bivariate group** (`BivariateLegend.svelte`, new):
  - `role="grid"` with `ny` rows by `nx` cells. Rows are high-to-low on
    screen, so axis 2 reads bottom-to-top.
  - Each cell is a button with `aria-pressed` (hidden). Its accessible name
    is "`<x column>` `<x range>`, `<y column>` `<y range>`: `<count>`
    features". The title tooltip says the same.
  - Roving tabindex; the arrow keys move one cell at a time; Enter or Space
    toggles.
  - Axis labels: the column names with "→" (horizontal) and "↑" (vertical).
    The vertical axis's label sits above the square, horizontal, so long
    names fit.
  - The grid is named "Bivariate cells". In the panel: the selects
    "Axis 1" and "Axis 2" with "Axis 1 method" and "Axis 2 method", the
    button "Swap axes", and the radio group "Bivariate palette".
  - "No value" is a row under the square.

## Map (`MapView.svelte`)

- Paint, layout and filters come from core (`paintFor`, `layoutFor`,
  `visibilityFilter`) as today. No new layers are needed.
- Shaped-marker icons are drawn at the largest size in use (research §3),
  and `icon-size` scales them per feature.

## Map image (`mapImage.ts`)

- `LegendSpec` gains `groups`: `{ title, kind: 'classes' | 'sizes' |
  'bivariate', rows | grid }`.
- The bivariate group is drawn as a square with axis labels; hidden cells
  are hollow.
