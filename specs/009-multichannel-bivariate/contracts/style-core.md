# Contract: Style Core (`packages/core/src/style`)

Host-agnostic and pure. Every function returns new objects and never
mutates its input. Types are in [data-model.md](../data-model.md).

## Resolve

```ts
resolveStyle(style: LayerStyle, input: ResolveInput | null): ResolvedStyle
```

- Without `style.size`, the result equals today's for every existing style
  (regression tests pin this).
- Bivariate: `classes` are the cells in row-major order from low/low
  (`i + nx * j`), then `noValue`; `grid` is set. An axis with fewer distinct
  values has fewer classes (FR-015) and adds a note.
- The size channel resolves into `resolved.size`. A missing or non-numeric
  size column gives `size.status = 'fallback'` with a reason, while the
  color channel still resolves normally.
- Classed size classes carry `size` from `classSizes(n, sizeMin, sizeMax)`.
- Proportional: `domain` is the column's min and max; `samples` are 3–5
  `{value, size}` pairs computed by the same formula as the map.

## Symbols and expressions

```ts
classSymbols(style, resolved): SymbolSpec[]          // color channel, as today
sizeSymbols(style, resolved): SymbolSpec[]           // new: size classes / samples, single colors
symbolExpressions(style, resolved)                   // adds: size (number | expression), from the size channel
proportionalSize(value: number, domain, sizeMin, sizeMax, geometry: 'point' | 'line'): number
paintFor / layoutFor / visibilityFilter              // read both channels
```

- **Map equals legend**: for any feature, MapLibre's evaluator applied to
  the paint and filter must give the color and size of the classes
  `resolveStyle` counted it in. This is tested per channel and per
  bivariate cell (SC-003).
- **Proportional**: lines use `wMin + (wMax − wMin)·t`; points use
  `rMin + (rMax − rMin)·√t`, with `t` clamped to 0–1. Null values get the
  single size. A domain with `min = max` gives `sizeMax`.
- **Visibility**: `visibilityFilter` returns `null` when nothing is hidden.
  Otherwise it hides a feature whose color class or size class is hidden.
- **Shaped-marker icons** are keyed by the color class only. `icon-size`
  carries the size channel.

## Edits (`edit.ts`)

```ts
startStyle(style, 'bivariate', layer, column?)          // picks two numeric columns (column first)
setBivariateAxis(style, 'x' | 'y', { column?, method? })   // the other axis's column swaps the two
swapBivariateAxes(style)
setBivariatePalette(style, id)
setCellVisible(style, key, visible)                     // 'cell:i-j' or '__null'
setSizeChannel(style, column: string | null, geometry: 'point' | 'line')       // null = off (size: undefined, so it clears through a patch merge); defaults and scale by geometry
setSizeMode / setSizeMethod / setSizeClassCount / setSizeRange / setSizeClassBound / setSizeClassLabel / setSizeClassVisible
```

- Size class edits follow graduated's rules: bound edits switch to Manual,
  and overrides are kept by index.
- Switching the color renderer to bivariate keeps `size` stored but
  inactive (FR-007), so switching back restores it.
- `validateStyle` reports the size range, the size bounds, and the
  bivariate axes needing two different numeric columns.

## Sanitize and migrate

```ts
sanitizeStyle(raw): LayerStyle   // migrates graduated vary:'size' (FR-009); drops unknown fields
```

A migrated style must resolve to the same per-feature sizes and the same
labels as the 2026-10-12 build. This is tested against a saved fixture.

## Palettes

```ts
BIVARIATE_PALETTES: ReadonlyArray<BivariatePalette>   // generated, bivariateData.ts
DEFAULT_BIVARIATE_PALETTE: string                     // 'orange-blue'
bivariateColor(palette, i, j, nx, ny): string
```

A unit test re-checks each palette's acceptance thresholds (research §8).
