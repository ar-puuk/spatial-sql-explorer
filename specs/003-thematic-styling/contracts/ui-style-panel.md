# Contract: style panel, ramp picker and legend (FR-001, FR-007, FR-009, FR-010, FR-016 to FR-019)

## Layer style panel (CHANGED: spec 001's `LayerStylePanel.svelte` popover)

It is still the dialog opened by the map's **Layer style** button (paint
icon), anchored under the map controls. It grows from about 260 px to
**320 px wide**, is capped at the map height, and its body scrolls. The
header and footer stay visible.

```
┌ LAYER STYLE ─────────────────────── ● unsaved  ✕ ┐
│ [ Single | Categorized | Graduated ]              │  radio group
│ Column    [ value ▾ ]                             │  eligible columns only
│ Method    [ Quantile ▾ ]   Classes [ 5 ▾ ]        │  graduated only
│ Colors    [▇▇▇▇▇▇▇ viridis ▾]  [⇄ Reverse]        │  ramp picker
│ ─ Classes ───────────────────────────── [+ Add] ─ │
│ 👁 ■ 1,730 – 10,497          312      ✎  🗑       │  one row per class
│ 👁 ■ 10,497 – 16,286         310      ✎  🗑       │
│ 👁 ■ No value                 10                  │
│ ▸ Symbol  (outline, opacity, width, point size)   │  spec 001 controls, collapsible
│ ⚠ notice (missing column / export loss / repeats) │
├───────────────────────────────────────────────────┤
│ [Save]  [Export ▾]  [Import]               [↺]    │  as spec 001
└───────────────────────────────────────────────────┘
```

| Control | Behavior |
|---|---|
| Renderer | A radio group (arrow keys move and apply). Switching keeps the symbol settings. Categorized and Graduated are disabled, with a tooltip reason, when no eligible column exists. |
| Column | Lists the eligible columns with their type (`value · DOUBLE`). Changing it recomputes the classes (manual classes are reset, after an inline confirm if they were edited). |
| Method / Classes | Graduated only. The methods are Equal interval, Quantile, Natural breaks (Jenks) and Manual. Manual is selectable only once edits exist, and shows as selected after an edit. Classes: 2–10. |
| Ramp picker | A button showing the current ramp strip. It opens a listbox of strips grouped Sequential / Diverging (Graduated) or Qualitative (Categorized). Arrows move, Enter applies, Esc closes. Each option's accessible name is the ramp name plus its kind. **Reverse** is a toggle button (`aria-pressed`). |
| Class row | Visibility toggle (an eye button, `aria-pressed`), color swatch (opens the native color input), label (click ✎ or press F2 to edit inline; Enter commits, Esc cancels), count, and delete. For graduated, the lower and upper bounds are editable number fields. For categorized, the value is an editable text field. Bound and value edits switch the method to Manual, with a one-line hint the first time. |
| Add class | Categorized: appends an empty-value row, focused. Graduated: splits the last class at its midpoint. Both switch to Manual. |
| Notice | Lists the items of the latest `StyleNotice`, or the fallback reason (FR-012). It can be dismissed. |
| Unsaved | The dot and "unsaved" appear while the style differs from the saved sidecar (FR-017, as spec 001). |

**Live updates (FR-016)**: every change applies immediately.
- A recompute that takes longer than 150 ms shows a thin progress bar in
  the panel.
- The previous style stays on the map until the new one is drawn.

**Keyboard**:
- Tab visits each control once.
- In the class list, arrows move between rows and Tab moves between a
  row's cells.
- Esc closes the panel and returns focus to the Layer style button.

## Legend (NEW: `MapLegend.svelte`)

```
┌ ▾ value · Quantile, 5 classes ┐   bottom-left of the map, above the scale bar
│ ■ 1,730 – 10,497        312   │   swatch is a toggle button: hides/shows the class
│ ■ 10,497 – 16,286       310   │
│ ▫ 16,286 – 25,115       311   │   hidden: hollow swatch, dimmed row
│ ■ No value               10   │
└───────────────────────────────┘
```

- **Shown** for thematic renderers, and for a non-default single symbol (one
  row). The header button collapses it (`aria-expanded`), and the state is
  remembered via `legend.collapsed`.
- **Rows**: swatch with the class color, drawn as the geometry: a filled
  square for polygons, a line for lines, a circle for points. Then the
  label and the count, with tabular numbers. "Other" says how many values
  it groups (`Other (37 values)`).
- **Fallback** (FR-012): the header shows the reason and the legend shows
  the single symbol.
- It never covers the map controls, and it is scrollable above 14 rows. It
  is a `region` named "Legend". Its toggles have names like "Hide class
  10,497 – 16,286".
- **Chrome** uses the overlay tokens (VS Code `editorWidget`, high-contrast
  borders). Swatches are data colors with a 1 px contrast border.

## Map (CHANGED: `MapView.svelte`)

- Paint comes from `paintFor()`, and the layer filters combine the geometry
  filter with `visibilityFilter()`.
- **Selection**: the feature-state highlight plus the halo ring
  (research §6).
- Thematic changes set paint and filter only; GeoJSON is re-uploaded only
  when the data changes, as today.
