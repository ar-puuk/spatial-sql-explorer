# Contract: UI (packages/ui)

Chrome uses the existing `--se-*` tokens; data colors are fixed (Constitution
III). Every control has an accessible name, role and state (Constitution VII).

## Style panel (`LayerStylePanel.svelte`, split)

```
┌ Style ──────────────────────────────────────────┐
│ [Draw as ▾  Markers                           ] │  StyleTypePicker: group "Draw as" + group "Recipes"
│   One symbol per point, varied by the rows below│
│                                                 │
│ Color          [Fixed|By column]  ■ #3b82f6 75% │  ChannelRow (collapsed when Fixed)
│ Outline color  [Fixed|By column]  ■ #4b5563 1px │
│ Size           [Fixed|By column]  ── 5 px       │
│ Shape          [Fixed|By column]  ▲ Triangle    │
│ Opacity        [Fixed|By column]  ── 100%       │
│ Rotation       [Fixed|By column]  ── 0°         │
│ ▾ Width        [Fixed|By column]                │  expanded when By column:
│     Column [volume ▾]  Scale [Classes ▾]        │    ScaleEditor
│     Method [Quantile ▾]  Classes [5]            │
│     Range 1 px – 6 px                           │
│     ClassList (outputs: widths)                 │
│     ☐ Hide from legend                          │
│ ─────────────────────────────────────────────── │
│ Layer opacity ── 100%       3D/Heatmap settings │
│ Import / Export style …                         │
└─────────────────────────────────────────────────┘
```

**Draw as and recipes (`style/StyleTypePicker.svelte`, extended).** The listbox
has two labelled groups, `role="group"` with `aria-label` "Draw as" and
"Recipes". Recipes are actions: choosing one applies it, and the button keeps
showing the current Draw as. An unavailable recipe is `aria-disabled` and
described by its reason, as unavailable types are today.

**Property rows (`style/ChannelRow.svelte`, NEW).** One per channel from
`channelsFor`:
- **Name**: an `h4`, or the label of the row's group.
- **Fixed / By column switch**: a two-button `radiogroup`, "Color: Fixed" and
  "Color: By column".
- **Fixed editor**, by channel type: color swatch and opacity, number slider,
  shape select, pattern select, or rotation slider.
- **By column**:
  - a column select (and "SQL expression…", as graduated has today);
  - a scale select listing `scalesFor(channel)` only;
  - the `ScaleEditor`.
- A row varying by data shows a summary when collapsed, e.g. "volume ·
  Quantile, 5 classes". Rows are `<details>`-like disclosure buttons with
  `aria-expanded`.

**Scale editor (`style/ScaleEditor.svelte`, NEW).** Dispatches to the existing
editors, parameterized by output type:
- `ClassList` gains an output column (color swatch, number, shape or pattern);
- `RampPicker` for colors, and a min–max pair for numbers;
- the rules editor for conditions;
- `BivariatePicker` for color only.

**Notes.** A third varying channel, more than 7 shapes, quantized marker colors,
and per-channel fallbacks each show as a one-line note in their row.

**Removed.** The style type section and the separate Size, Appearance and 3D
sections. Their settings are now rows. The heatmap keeps its own section while
Draw as is Heatmap.

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
