# Spec 020: Time slider

**Status:** built (2026-10-17), branch `020-time-slider`. **Request (user):** a time slider, from the pipeline list (PIPELINE.md §3).

## Purpose
Events, trips and observations carry a date. A window over that date, moved by hand or played, shows what happened when.

## Behavior
- A map button **Time slider** (tools group, a registry control like the others) opens a bar at the foot of the map. Off, with the reason as its
  hint, for a layer with no DATE or TIMESTAMP column.
- The bar: Play or Pause, the date column (a list when there are several), the window's two ends, a two-handle range over the column's
  whole span, a note with the number of undated rows, Close.
- The window is **the column's own filter** (`between`, query/filters.ts): the map, the table ("3 of 4 rows"), the counts, styles and export all read
  the same rows. The whole span is no filter, so undated rows stay until the window narrows. Close lifts it. Other columns' filters stay.
- Play moves the window, at its width, a fifth of it every 0.7 s, to the end, then starts over; a full-span window starts as a tenth of the span.
  Touching a handle pauses.
- Date columns snap to whole days. Handles never cross (the one you drag pushes the other). Arrow keys move a handle.
- A new result (a query, Reset) closes the slider; its filters are cleared with it.

## Out of scope
Numeric years or text dates (a column that isn't DATE or TIMESTAMP), several slider columns at once, a cumulative ("up to") mode,
fading by age, a rendering of the window's trail.

## How
`view/timeSlider.ts` (pure: columns, extent SQL, filter text, positions, `nextWindow`), `QuerySession.timeExtent`, store `timeSlider` state
and actions (viewerStore.svelte.ts), `TimeSlider.svelte` (two range inputs on one track), the `timeSlider` map control.
