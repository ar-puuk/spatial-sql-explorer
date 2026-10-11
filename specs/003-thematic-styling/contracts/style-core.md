# Contract: core styling API (packages/core/src/style)

Host-agnostic and pure, except for the timing log. All of it is unit-tested
in `tests/core`.

```ts
// classify.ts — research §2, §3
export function toNumber(v: unknown): number | null          // same rules as the map expressions
export function toCategory(v: unknown): string | null        // String(v); null/'' -> null
export function equalIntervalBreaks(sortedValues: number[], k: number): number[]   // k-1 inner breaks
export function quantileBreaks(sortedValues: number[], k: number): number[]         // QGIS interpolation
export function jenksBreaks(sortedValues: number[], k: number): number[]            // exact optimum; >200k: estimated
export function classOf(value: number, ranges: Array<{ lower: number; upper: number }>): number  // upper-inclusive, -1 if outside

// resolve.ts — data-model ResolvedStyle
export function resolveStyle(
  style: LayerStyle,
  layer: Pick<Layer, 'features' | 'columns' | 'geometryType'>
): ResolvedStyle
export function eligibleColumns(columns: Layer['columns'], kind: 'categorized' | 'graduated'): string[]

// edit.ts — FR-009 transitions (return a new LayerStyle; never mutate)
export function setClassColor(style: LayerStyle, key: string, color: string): LayerStyle
export function setClassLabel(style: LayerStyle, key: string, label: string): LayerStyle
export function setClassVisible(style: LayerStyle, key: string, visible: boolean): LayerStyle
export function setClassBound(style: LayerStyle, index: number, side: 'lower' | 'upper', value: number): LayerStyle  // -> manual
export function setCategoryValue(style: LayerStyle, key: string, value: string): LayerStyle                        // -> manual
export function addClass(style: LayerStyle, resolved: ResolvedStyle): LayerStyle                                  // -> manual
export function deleteClass(style: LayerStyle, key: string): LayerStyle                                            // -> manual

// ramps.ts — research §6
export const RAMPS: readonly Ramp[]
export function rampColors(ref: RampRef, n: number): string[]
export function rampsFor(kind: 'categorized' | 'graduated'): readonly Ramp[]

// expressions.ts — research §4
export function paintFor(style: LayerStyle, resolved: ResolvedStyle, selectionColor: string): MapPaint
export function visibilityFilter(style: LayerStyle, resolved: ResolvedStyle): unknown | null   // null = all visible

// index.ts — CHANGED: thematic renderers in every format
export function exportStyle(style, format, geometry, dataFileName, resolved?): StyleExport & { notice: StyleNotice }
export function previewExportNotice(style, format, resolved): StyleNotice      // shown before writing
export function importStyle(fileName, text): StyleImportResult                 // notes = notice items
```

## Guarantees

1. **Map equals legend.** For every feature `f`, the class that
   `paintFor()`'s expression selects (evaluated by MapLibre's style-spec)
   is the class whose `count` `resolveStyle()` incremented. This is
   asserted per feature in the unit tests.
2. **Upper-inclusive ranges**: `lower < v ≤ upper`, and the first range
   also includes `lower`. Values outside every range (possible only for
   manual classes) count as "Other" and draw in its color.
3. **Determinism**: the same features and style always give the same
   classes in the same order, so both shells agree (FR-020).
4. **Purity**: no I/O. `resolveStyle` takes under 50 ms for 50,000 features
   (unit-timed with generous CI slack; measured in the performance spec).
5. **Back-compatibility**: a spec 001 style (no `renderer`) behaves as
   `{ kind: 'single' }`, and spec 001 sidecars import exactly as before.
