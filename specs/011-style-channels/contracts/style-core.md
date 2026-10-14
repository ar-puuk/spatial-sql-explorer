# Contract: style core (packages/core/src/style)

What `packages/ui` and the shells may call. Everything is pure and needs no
platform access (Constitution II). Signatures are indicative; names are binding.

## Model (`model.ts`, `channels.ts` NEW)

```ts
CHANNEL_ORDER: readonly ChannelId[]
channelsFor(geometry: StyleGeometry, draw: Required<DrawAs>): ChannelId[]   // what the panel lists (data-model table)
scalesFor(channel: ChannelId): Scale['kind'][]                               // FR-010
fixedValue(style: LayerStyle, channel: ChannelId, part: 'marker' | 'line' | 'fill'): Output
drawOf(style: LayerStyle): Required<DrawAs>
sanitizeStyle(raw: unknown): LayerStyle                                      // + migration (research §9)
styleDataColumns(style: LayerStyle): string[]                                // every channel's data column + label column
channelDataColumn(channel: ChannelId, enc: Encoding): string                 // column | __se_val_<ch> | __se_cls_<ch>
LABEL_COLUMN = '__se_lbl'
```

Removed after slice 2:
- `rendererOf`, `rendererColumns`, `rendererTitle`, `Renderer`, `SizeChannel`;
- the `renderer`, `size` and `extrusion` fields.

## Edits (`edit.ts`)

Every edit returns a new `LayerStyle` and never mutates. Each one replaces a
current renderer-specific edit:

```ts
setFixed(style, channel, value: Output): LayerStyle
setEncoding(style, channel, enc: Encoding | null): LayerStyle                // null: Fixed
startEncoding(channel, source: Source, layer: ResolveInput | null): Encoding // default scale (data-model)
setScaleKind(style, channel, kind, layer): LayerStyle                        // keeps outputs where they fit
setScaleMethod / setClassCount / setClassBound / setCategoryValue / addClass / deleteClass  (channel-scoped)
setClassOutput(style, channel, classKey, output): LayerStyle                 // replaces setClassColor
setClassLabel / setClassVisible (channel, key)
setRamp(style, channel, ramp) / setRange(style, channel, min, max) / setCurve(style, channel, curve)
addRule / updateRule / removeRule / moveRule / setRulesElse (channel)        // conditions, as spec 010 per channel
setBivariateAxis / swapBivariateAxes / setBivariatePalette / setCellVisible  // color channel
setLegendHidden(style, channel, hidden)
setDraw(style, patch: Partial<DrawAs>, view): LayerStyle
setHeatmap / setHeatmapRadiusUnit / setHeatmapAutoIntensity                  // unchanged behavior, now on style.heatmap
setLabels(style, patch: Partial<LabelSettings>): LayerStyle
```

## Recipes (`recipes.ts` NEW)

```ts
RECIPES: Array<{ id: RecipeId; label: string; hint: string }>
recipeUnavailable(id, geometry, columns): string | null    // one-line reason (research §11)
applyRecipe(style, id, layer: ResolveInput, view): LayerStyle
```

## Resolve (`resolve.ts`)

```ts
resolveStyle(style, layer: ResolveInput | null): ResolvedStyle
```

- Each channel is resolved independently.
- Classes, categories, bivariate and conditions reuse today's code paths
  (`classifyRanges`, categories, `rules`, `bivariate`), parameterized by channel
  and output type.
- `ResolveInput` gains:
  - `ruleCountsByChannel` and `ruleErrorsByChannel`;
  - `expressionErrors` by channel;
  - `labelError`.
  The single-channel forms stay as aliases for `color` for one slice.

## Map paint (`expressions.ts`)

```ts
paintFor(style, resolved, selectionColor, layerLatitude?): MapPaint      // same layer ids as today, plus 'label'
layoutFor(style, resolved): Partial<Record<MapLayerId, Record<string, unknown>>>
layerFilters(style, resolved): Partial<Record<MapLayerId, unknown>>      // NEW: circle vs marker split by shape (research §2), hidden classes
channelExpression(style, resolved, channel, part): unknown               // one channel → a MapLibre expression or constant
markerIconExpression(style, resolved): unknown                           // concat of shape/fill/stroke/width outputs (research §2)
visibilityFilter(style, resolved): unknown | null                        // a feature hidden by ANY channel's hidden class is hidden
labelLayer(style, resolved): { layout, paint } | null                    // text-field from column or __se_lbl; text-font ['sans-serif']
```

`MapLayerId` gains `'label'`. The rule that the map matches the legend stays:
the expressions are built from the same `ResolvedChannel.classes` the legend
lists, and are tested through MapLibre's evaluator.

## Legend (`legend.ts` NEW)

```ts
legendGroups(style, resolved, geometry): LegendGroupModel[]   // merge rule: research §10
```

## Engine SQL (`query/session.ts`, `view/stats.ts`)

- **Per-channel computed columns**: `__se_val_<channel>` (expression source),
  `__se_cls_<channel>` (conditions) and `__se_lbl` (expression label). They are
  added to the view's SELECT and to the engine tiles' properties.
- **Statistics** per distinct column, as now (`dataByColumn`), and **rule
  counts** per channel.
- **Errors** in a channel's expression or condition, or the label expression,
  come back per channel and per rule. The channel keeps its last working
  resolution (edge case).
