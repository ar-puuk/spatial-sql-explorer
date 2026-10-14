# Contract: UI (packages/ui)

Chrome uses the existing `--se-*` tokens; data colors are fixed (Constitution
III). Every control has an accessible name, role and state (Constitution VII).

## Style panel (`LayerStylePanel.svelte`)

Revised 2026-10-13 (spec Clarifications): the style type, the color editors,
the Appearance section and the 3D section stay as they were before this spec.
The old Size section becomes a row of the new section below.

```
┌ Style ──────────────────────────────────────────┐
│ Opacity ───────────────── 100%                  │
│ STYLE  [Categorized ▾  A color for each value…] │  StyleTypePicker (unchanged)
│ COLOR BY / CLASSIFICATION / COLORS              │  (unchanged)
│ APPEARANCE  Line ■ 80%  Width ─ 0.75  Pattern ▾ │  (unchanged: the fixed settings)
│ VARY BY ATTRIBUTE                               │
│ ▾ Width by                                  ✕   │  VaryRow: the spec 009 size editor
│     Column [volume ▾] Scale (Classed|Prop.)…    │
│ ▾ Shape by                                  ✕   │  VaryRow + ScaleEditor
│     Column [crash_type ▾] Scale [Categories ▾]  │
│     class list: output, label, count            │
│ [+ Add…]                                        │  AddVaryMenu
│ 3D …                                            │  (unchanged)
└─────────────────────────────────────────────────┘
```

**Vary by attribute (`style/VaryRow.svelte`, `style/AddVaryMenu.svelte`, NEW).**
- Section heading "Vary by attribute"; with nothing varying, a one-line hint.
- Each varying property is a group named "<Property> by" (`role="group"`),
  with a disclosure button (`aria-expanded`) in its heading, a one-line
  summary when collapsed, and a Remove button named "Stop varying <property>".
- "Add…" is a menu button (`aria-haspopup="menu"`). Its menu, named "Vary by
  attribute", lists the properties that can still vary (spec FR-002) as
  `menuitem`s; one that can't be added is `aria-disabled` with its reason.
  Arrows, Home and End move; Enter adds; Esc closes back to the button.
- Size (points) or Width (lines) uses spec 009's size editor (column, Classed
  or Proportional, method, classes, sizes). The others use the scale editor.

**Scale editor (`style/ScaleEditor.svelte`, NEW).** Column ("<Property>
column"), scale ("<Property> scale"), method and class count for classes, a
ramp (colors) or a min–max range (numbers), the class list ("<Property>
classes": per class, its output "<class> <property>", label and count, and a
hide toggle), and "Hide from legend".

**Notes.** Three or more variables (the style type's color counted), more than
6 shapes, and per-property fallbacks each show as a one-line note.

## Labels panel (`LabelsPanel.svelte`, NEW; side tab `labels`)

- **The rail button.** `ActivityRail` gains "Labels", a new `tag` icon
  (an `Icon.svelte` path), between Style and Details. The title is "Labels",
  or "Labels: on (name)" when on.
- **Controls:**
  - **Show labels** checkbox.
  - **Text**: a column select plus "SQL expression…". The expression has a
    textarea with the same completion as rules, and its error shows below with
    `aria-describedby`.
  - **Size** slider, 6–48 px.
  - **Color** swatch.
  - **Halo**: a checkbox, then a swatch and a width slider.
  - **Placement**: a radiogroup (Above, Below, Left, Right, Center) plus an
    offset slider, shown only when points are present. Lines and polygons say
    "Along lines" and "Inside polygons".
- **Disabled state.** The rail button is disabled, with a reason, when no
  layer is shown (as Style).

## Legend (`MapLegend.svelte`)

- **One group per `LegendGroupModel`**, with the title as a heading. Each
  entry is a toggle button (`aria-pressed`) that hides its class, as today.
- **Gradient groups** are `role="img"` with an accessible name, "volume:
  colors from 12 to 4,310".
- **Sample groups** list three items.
- **A merged group's swatch** draws every merged output: color, size and shape
  together.

## Map image (`mapImage.ts`, `ViewerLayout.svelte`)

`LegendSpec.groups` carries every `LegendGroupModel`, drawn with the same
`SymbolSpec`. Labels are part of the map frame.
