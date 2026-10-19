<script lang="ts" module>
  import ColorField from './kit/ColorField.svelte'
  import type { Encoding as SetAsideEncoding } from '@spatial-explorer/core'
  /** Spec 011 FR-007: properties removed from Vary by attribute, per layer and property, for the session. */
  // Not reactive on purpose: only read when a property is added again.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const setAside = new Map<string, SetAsideEncoding>()
</script>

{#snippet sizeScaleChoice(current: ScaleKind)}
  <!-- Spec 009's two sizes, and (spec 011 US4) conditions and as is. -->
  <div class="renderers four" role="radiogroup" aria-label="Size scale">
    {#each SIZE_SCALES as m, i (m.kind)}
      <button
        type="button"
        role="radio"
        aria-checked={current === m.kind}
        tabindex={current === m.kind ? 0 : -1}
        title={m.hint}
        onclick={() => chooseSizeScale(m.kind)}
        onkeydown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
          if (!step) return
          e.preventDefault()
          const next = SIZE_SCALES[(i + step + SIZE_SCALES.length) % SIZE_SCALES.length].kind
          chooseSizeScale(next)
          const group = (e.currentTarget as HTMLElement).parentElement
          queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
        }}>{m.label}</button
      >
    {/each}
  </div>
{/snippet}

<script lang="ts">
  // Layer style popover (design-plan.md §8.1/§8.5; spec 003
  // contracts/ui-style-panel.md; spec 008 US1, contracts/ui.md "Style panel").
  // One flow, top to bottom: style type, then the column to color by, then
  // classes (with the value distribution), colors, and appearance. Edits
  // apply live, with no Apply step. Save is one split button: QML (the
  // QGIS-convention sidecar, saved next to the data or downloaded), or any
  // format from its menu. Import reads any of the three formats.
  import {
    eligibleColumns,
    measureColumns,
    extrusionUnavailableReason,
    DEFAULT_EXTRUSION_SCALE,
    type Extrusion,
    METHOD_NAMES,
    MIN_CLASS_COUNT,
    MAX_CLASS_COUNT,
    type GraduatedMethod,
    rendererOf,
    startStyle,
    addRule,
    updateRule,
    removeRule,
    moveRule,
    setRulesElse,
    suggestedRules,
    type RuleSuggestions,
    addClass,
    deleteClass,
    setCategorizedAuto,
    setCategoryValue,
    setClassBound,
    setClassColor,
    setClassCount,
    setClassLabel,
    setClassVisible,
    setMethod,
    setRamp,
    setHeatmap,
    setClusters,
    CLUSTER_RADIUS,
    CLUSTER_MAX_ZOOM,
    CLUSTER_BUBBLE,
    CLUSTER_STEP_COUNT,
    type ClusterStep,
    setHeatmapRadiusUnit,
    setHeatmapAutoIntensity,
    HEATMAP_METERS,
    HEATMAP_INTENSITY,
    HEATMAP_RADIUS,
    HEATMAP_STOPS,
    setBivariateAxis,
    setBivariateTilted,
    setBivariatePalette,
    setCellVisible,
    swapBivariateAxes,
    setSizeChannel,
    setSizeClassBound,
    setSizeClassCount,
    setSizeClassLabel,
    setSizeClassVisible,
    setSizeMethod,

    setSizeRange,
    sizeSymbols as sizeSymbolsOf,
    baseSymbol,
    LINE_DASHES,
    LINE_DASH_NAMES,
    MARKER_SHAPES,
    MARKER_SHAPE_NAMES,
    type LineDash,
    type ArrowSettings,
    ARROW_SIZE,
    ARROW_SPACING,
    DEFAULT_ARROWS,
    type MarkerShape,
    validateStyle,
    previewExportNotice,
    type GeometryType,
    type LayerStyle,

    type Renderer,
    type Scale,
    type ResolveInput,
    type ResolvedStyle,
    type StyleFormat,
    type ValueHistogram as Histogram,
    extrusionOf,
    sizeOf,
    CHANNEL_NAMES,
    channelsFor,
    drawOf,
    isNumericType,
    setChannelClass,
    setChannelClasses,
    setChannelColumn,

    setChannelRamp,


    setChannelDomain,
    defaultRamp,
    addCondition,
    updateCondition,
    removeCondition,
    moveCondition,
    setConditionElse,
    setChannelCurve,
    scalesFor,
    setChannelRange,
    setEncoding,
    setLegendHidden,
    setScaleKind,
    startEncoding,
    type ChannelId,
    type Encoding,
    type ScaleKind,
  } from '@spatial-explorer/core'
  import Icon, { type IconName } from './Icon.svelte'
  import Tip from './kit/Tip.svelte'
  import NumberField from './kit/NumberField.svelte'
  import RangeSlider from './kit/RangeSlider.svelte'
  import Switch from './kit/Switch.svelte'
  import { sanitizeZoom, ZOOM_LIMITS, ZOOM_SIZE_FACTOR, type ZoomSettings } from '@spatial-explorer/core'
  import RampPicker from './RampPicker.svelte'
  import ClassList from './ClassList.svelte'
  import ValueHistogram from './style/ValueHistogram.svelte'
  import SaveStyleButton from './style/SaveStyleButton.svelte'
  import SymbolSwatch from './style/SymbolSwatch.svelte'
  import BivariatePicker from './style/BivariatePicker.svelte'
  import BivariateLegend from './style/BivariateLegend.svelte'
  import RulesEditor from './style/RulesEditor.svelte'
  import StyleTypePicker from './style/StyleTypePicker.svelte'
  import VaryRow from './style/VaryRow.svelte'
  import AddVaryMenu from './style/AddVaryMenu.svelte'
  import ScaleEditor from './style/ScaleEditor.svelte'
  import ColumnOptions from './style/ColumnOptions.svelte'
  import type { StyleNotice } from './viewerStore.svelte.js'

  interface Props {
    style: LayerStyle
    resolved: ResolvedStyle
    /** The displayed result (unproxied): columns for the pickers, rows for defaults. */
    layer: ResolveInput | null
    geometryType: GeometryType
    sidecarName: string
    styleSource: string | null
    styleDirty: boolean
    canSaveSidecar: boolean
    notice: StyleNotice | null
    onChange: (patch: Partial<LayerStyle>) => void
    /** FR-004: a style shown while browsing ramps, or null to restore the committed one. */
    onPreview?: (next: LayerStyle | null) => void
    /** FR-003: the graduated column's value distribution (null while loading). */
    histogram?: Histogram | null
    onSave: () => void
    onExport: (format: StyleFormat) => void
    onImport: () => void
    onReset: () => void
    onDismissNotice: () => void
    onClose: () => void
    /** Spec 007: rows being classified by the engine (shown after 300 ms), or null. */
    classifyingRows?: number | null
    /** Spec 008 US6: polygons drawn flat by the extrusion (missing, zero or negative height), or null. */
    extrusionFlat?: number | null
    /** Spec 008 US6: a height scale that makes a column visible at the layer's extent. */
    onSuggestScale?: (column: string) => Promise<number>
    /** Spec 010: inside the side panel (no title or close button of its own). */
    embedded?: boolean
    /** Spec 010: example rules from the data, for a first rules style. */
    onSuggestRules?: () => Promise<RuleSuggestions>
    onSuggestHeatRadius?: () => Promise<{ meters: number; latitude: number } | null>
    /** The map's view: a heatmap radius switched between pixels and meters keeps its size on screen. */
    camera?: { center: [number, number]; zoom: number } | null
    /** The map's zoom as it moves (the camera has it only when a move ends): what the zoom marker shows. */
    zoom?: number | null
  }
  let {
    style,
    resolved,
    layer,
    geometryType,
    sidecarName,
    styleSource,
    styleDirty,
    canSaveSidecar,
    notice,
    onChange,
    onPreview = () => {},
    histogram = null,
    onSave,
    onExport,
    onImport,
    onReset,
    onDismissNotice,
    onClose,
    classifyingRows = null,
    extrusionFlat = null,
    onSuggestScale,
    embedded = false,
    onSuggestRules,
    onSuggestHeatRadius,
    camera = null,
    zoom = null,
  }: Props = $props()
  const nowZoom = $derived(zoom ?? camera?.zoom ?? null)

  // --- Spec 008 US6: 3D extrusion ---------------------------------------
  const CONSTANT = '__constant'
  const extrusionReason = $derived(extrusionUnavailableReason(geometryType))
  const ext = $derived(extrusionOf(style))
  const heightColumns = $derived(eligibleColumns(layer?.columns, 'graduated'))
  /** A column whose name says height: its values are taken as meters (no automatic scale). */
  const HEIGHT_NAME = /height|elev|floor|storey|stories|levels|hgt/i
  /** A first guess at the height column: a name that says height, else the first numeric column. */
  function defaultHeightSource(): Extrusion['source'] {
    const cols = heightColumns
    const named = cols.find((c) => HEIGHT_NAME.test(c.name))
    const col = named ?? cols[0]
    return col ? { kind: 'column', column: col.name } : { kind: 'constant', meters: 10 }
  }
  function setExtrusion(patch: Partial<Extrusion>): void {
    const base: Extrusion = ext ?? { enabled: false, source: defaultHeightSource(), scale: DEFAULT_EXTRUSION_SCALE }
    onChange({ extrusion: { ...base, ...patch } })
  }
  function chooseHeight(value: string): void {
    setExtrusion({ source: value === CONSTANT ? { kind: 'constant', meters: ext?.source.kind === 'constant' ? ext.source.meters : 10 } : { kind: 'column', column: value } })
    if (value !== CONSTANT && !HEIGHT_NAME.test(value)) void autoScale(value)
  }
  function toggleExtrusion(): void {
    const first = !ext
    setExtrusion({ enabled: !ext?.enabled })
    // Raw values are rarely meters: the first time, pick a scale that shows them.
    const src = extrusionOf(style)?.source
    if (first && src?.kind === 'column' && !HEIGHT_NAME.test(src.column)) void autoScale(src.column)
  }
  let scaling = $state(false)
  /** Sets the scale suggested for `column`, unless the height column changed meanwhile. */
  async function autoScale(column: string): Promise<void> {
    if (!onSuggestScale) return
    scaling = true
    try {
      const scale = await onSuggestScale(column)
      const now = extrusionOf(style)
      if (now?.source.kind === 'column' && now.source.column === column) setExtrusion({ scale })
    } finally {
      scaling = false
    }
  }

  /** Spec 011 US4: the color's types: the pre-011 renderers, plus Continuous and As is (no renderer of their own). */
  type ColorType = Renderer['kind'] | 'continuous' | 'identity'
  // In the order a user reaches for them: one color; by one column (a value, a range, a ramp); by two; by a condition; by colors the data holds; then the two that are only for points.
  const RENDERERS: Array<{ kind: ColorType; label: string; hint: string }> = [
    { kind: 'single', label: 'Single color', hint: 'One color for every feature' },
    { kind: 'categorized', label: 'Categorized', hint: 'A color for each value of a column' },
    { kind: 'graduated', label: 'Graduated', hint: 'Colors by ranges of a number or an expression' },
    { kind: 'continuous', label: 'Continuous', hint: 'Colors along a ramp, in proportion to a number' },
    { kind: 'bivariate', label: 'Bivariate', hint: 'Two numeric columns at once, on a grid of 2 to 4 classes each' },
    { kind: 'rules', label: 'Rules', hint: 'SQL conditions: the first one a feature meets colors it' },
    { kind: 'identity', label: 'As is', hint: 'Colors read from a column (#rrggbb)' },
    { kind: 'heatmap', label: 'Heatmap', hint: 'Where points cluster, as a smooth density surface' },
    { kind: 'clusters', label: 'Clusters', hint: 'Nearby points grouped into bubbles, sized and colored by how many' },
  ]
  const typeOptions = $derived(RENDERERS.map((r) => ({ ...r, icon: `style-${r.kind}` as IconName, unavailable: unavailable(r.kind) })))
  const renderer = $derived(rendererOf(style))
  const colorEnc = $derived(style.renderer === undefined ? style.channels?.color : undefined)
  const colorType = $derived<ColorType>(renderer.kind === 'single' && (colorEnc?.scale.kind === 'continuous' || colorEnc?.scale.kind === 'identity') ? colorEnc.scale.kind : renderer.kind)
  // Clusters keep the single symbol for points not in a group.
  const thematic = $derived(colorType !== 'single' && colorType !== 'clusters')
  /** Text columns, for colors read as is (name-like ones first: hex, color, colour). */
  const colorColumns = $derived(eligibleColumns(layer?.columns, 'categorized').filter((c) => !isNumericType(c.type)).sort((a, b) => Number(/hex|colou?r/i.test(b.name)) - Number(/hex|colou?r/i.test(a.name))))
  const columnsFor = (kind: 'categorized' | 'graduated') => eligibleColumns(layer?.columns, kind)
  /** Why a renderer can't be chosen, or null. */
  function unavailable(kind: ColorType): string | null {
    if (kind === 'single') return null
    if (kind === 'continuous') return columnsFor('graduated').length ? null : 'Continuous colors need a numeric column.'
    if (kind === 'identity') return colorColumns.length ? null : 'Colors as is need a text column of colors (#rrggbb).'
    if (kind === 'bivariate') return columnsFor('graduated').length >= 2 ? null : 'Bivariate maps need two numeric columns.'
    if (kind === 'rules') return layer?.columns.length ? null : 'This result has no attribute columns.'
    if (kind === 'heatmap') return geometryType === 'Point' || geometryType === 'Mixed' ? null : 'Heatmaps need points; this layer has none.'
    if (kind === 'clusters') return geometryType === 'Point' || geometryType === 'Mixed' ? null : 'Clusters need points; this layer has none.'
    if (columnsFor(kind).length) return null
    return kind === 'graduated' ? 'Graduated styling needs a numeric column.' : 'This result has no attribute columns.'
  }

  /** A new column for the continuous or as-is color, keeping its kind of scale and ramp. */
  function setChannelColumnKeepScale(column: string): LayerStyle {
    return colorEnc ? setEncoding(style, 'color', { ...colorEnc, source: { kind: 'column', column } }) : style
  }

  function chooseRenderer(kind: ColorType): void {
    if (kind === colorType || unavailable(kind)) return
    // Spec 011 US4: continuous and as is are a color encoding over the single symbol.
    if (kind === 'continuous' || kind === 'identity') {
      // Identifier-like columns last, as Size starts (spec 009 SC-001).
      const column = (kind === 'continuous' ? (measureColumns(layer?.columns)[0] ?? columnsFor('graduated')[0]) : colorColumns[0])?.name ?? ''
      const scale: Scale = kind === 'continuous' ? { kind: 'continuous', ramp: defaultRamp('graduated', 5), noValue: {} } : { kind: 'identity', noValue: {} }
      return onChange(setEncoding(startStyle(style, 'single', layer), 'color', { source: { kind: 'column', column }, scale }))
    }
    onChange(startStyle(style, kind, layer))
    if (kind === 'rules') void suggestRules()
  }

  // --- Clusters -----------------------------------------------------------------

  /** The steps with one changed (a count, a color or a bubble size). */
  function withStep(steps: ClusterStep[], i: number, patch: Partial<ClusterStep>): ClusterStep[] {
    return steps.map((st, j) => (j === i ? { ...st, ...patch } : st))
  }
  /** A step after the last: five times its count, its color, a bubble 10 px larger. */
  function addedStep(steps: ClusterStep[]): ClusterStep[] {
    const last = steps[steps.length - 1]
    return [...steps, { from: Math.max(last.from * 5, last.from + 1), color: last.color, radius: Math.min(last.radius + 10, CLUSTER_BUBBLE.max) }]
  }
  const COUNT_FORMATS = [
    { value: 'abbreviated', label: 'Abbreviated (1.2k)' },
    { value: 'grouped', label: 'Grouped (1,234)' },
    { value: 'raw', label: 'Plain (1234)' },
  ] as const

  // --- Heatmap ------------------------------------------------------------------
  // Intensity on a log scale: 0.01 to 5, where dense data needs the low end.
  const LOG_SPAN = Math.log(HEATMAP_INTENSITY.max / HEATMAP_INTENSITY.min)
  const intensityToSlider = (v: number) => Math.log(v / HEATMAP_INTENSITY.min) / LOG_SPAN
  const sliderToIntensity = (t: number) => Number((HEATMAP_INTENSITY.min * Math.exp(t * LOG_SPAN)).toPrecision(2))
  const intensityText = (v: number) => `${Number(v.toPrecision(2))}×`

  // --- Spec 010: rules and graduated by expression ----------------------------
  /** A first rules style gets two example rules from the data (unless rules were added meanwhile). */
  async function suggestRules(): Promise<void> {
    const s = await onSuggestRules?.().catch(() => ({}))
    const now = rendererOf(style)
    if (!s || now.kind !== 'rules' || now.rules.length) return
    const rules = suggestedRules(s)
    if (rules.length) onChange({ renderer: { ...now, rules } })
  }

  const EXPRESSION = '__expression'
  /** "Expression…" chosen in the Value select, before an expression is written. */
  let expressionMode = $state(false)
  const usingExpression = $derived(renderer.kind === 'graduated' && (!!renderer.expression || expressionMode))
  function chooseValue(value: string): void {
    if (value === EXPRESSION) {
      expressionMode = true
      return
    }
    expressionMode = false
    chooseColumn(value)
  }
  function commitExpression(text: string): void {
    if (renderer.kind !== 'graduated') return
    const expression = text.trim()
    if (!expression) return
    if (expression === renderer.expression) return
    // A new expression starts new classes (as a new column does); the label follows the text.
    apply({ ...style, renderer: { ...renderer, expression, column: '', method: renderer.method === 'manual' ? 'quantile' : renderer.method, classes: [] } })
  }

  const METHODS: GraduatedMethod[] = ['equal', 'quantile', 'jenks']
  const CLASS_COUNTS = Array.from({ length: MAX_CLASS_COUNT - MIN_CLASS_COUNT + 1 }, (_, i) => MIN_CLASS_COUNT + i)

  function chooseMethod(method: GraduatedMethod): void {
    if (renderer.kind !== 'graduated' || method === renderer.method || method === 'manual') return
    apply(setMethod(style, method))
  }

  function chooseClassCount(classCount: number): void {
    apply(setClassCount(style, classCount))
  }

  /** The last rejected edit (FR-009 validation), shown under the class list. */
  let editError = $state<string | null>(null)

  /** Applies an edited style unless it breaks a rule (e.g. overlapping manual ranges). */
  function apply(next: LayerStyle): void {
    const errors = validateStyle(next)
    if (errors.length) {
      editError = errors[0]
      return
    }
    editError = null
    onChange(next)
  }

  function chooseColumn(column: string): void {
    if (renderer.kind === 'single' || renderer.kind === 'rules' || renderer.kind === 'heatmap') return
    onChange({ renderer: startStyle(style, renderer.kind, layer, column).renderer })
  }

  let hasFill = $derived(geometryType !== 'LineString')
  let hasPoints = $derived(geometryType === 'Point' || geometryType === 'Mixed')
  let hasLines = $derived(geometryType !== 'Point')
  let strokeLabel = $derived(geometryType === 'LineString' ? 'Line' : 'Outline')

  // --- Spec 009: the size channel (marker size on points, line width on lines; none on polygons).
  const sizeGeometry = $derived<'point' | 'line'>(geometryType === 'LineString' ? 'line' : 'point')
  const size = $derived(sizeOf(style))
  const sizeOn = $derived(!!size && renderer.kind !== 'bivariate')
  const numericColumns = $derived(eligibleColumns(layer?.columns, 'graduated'))
  const sizeSymbols = $derived(sizeOn && resolved.size?.status === 'ok' ? { symbols: sizeSymbolsOf(style, resolved), kind: sizeGeometry } : null)
  function toggleSize(): void {
    if (sizeOn) return apply(setSizeChannel(style, null, sizeGeometry))
    // Identifier-like columns go last (spec 009 SC-001: a useful default in one click).
    const column = measureColumns(layer?.columns)[0]?.name
    if (column) apply(setSizeChannel(style, column, sizeGeometry))
  }
  function chooseSize(side: 'min' | 'max', value: number): void {
    if (!size || !Number.isFinite(value)) return
    apply(setSizeRange(style, side === 'min' ? value : size.sizeMin, side === 'max' ? value : size.sizeMax))
  }

  // --- Spec 011: Vary by attribute (contracts/ui.md): more properties, each by its own column.
  /** Properties shown under Vary by attribute, in panel order ("size" stands for marker size or line width). */
  const varying = $derived.by((): ChannelId[] => {
    const generic = (['strokeColor', 'strokeWidth', 'shape', 'dash', 'opacity', 'rotation'] as ChannelId[]).filter((id) => !!style.channels?.[id])
    return sizeOn || sizeOther ? ['size', ...generic] : generic
  })
  /**
   * Spec 011 US4: size and width (one shared encoding) by conditions or as is.
   * Spec 009's size editor has classes and proportional; these use the scale
   * editor, and every edit goes to both channels.
   */
  const sizeOther = $derived(!sizeOn && !!(style.channels?.size ?? style.channels?.width))
  const SIZE_IDS: ChannelId[] = ['size', 'width']
  const sizeId = $derived<ChannelId>(sizeGeometry === 'line' ? 'width' : 'size')
  const bothSizes = (f: (s: LayerStyle, id: ChannelId) => LayerStyle): void => apply(SIZE_IDS.reduce((s, id) => f(s, id), style))
  /** Conditions and as is set the drawn property only (marker size or line width); spec 009's scales keep both. */
  function chooseSizeScale(kind: ScaleKind): void {
    if (kind === 'conditions' || kind === 'identity') {
      const other = SIZE_IDS.find((x) => x !== sizeId) as ChannelId
      const base = style.channels?.[sizeId] || !style.channels?.[other] ? style : setEncoding(style, sizeId, style.channels[other] ?? null)
      return apply(setEncoding(setScaleKind(base, sizeId, kind, layer), other, null))
    }
    bothSizes((s, x) => setScaleKind(s, x, kind, layer))
  }
  const oneSize = (f: (s: LayerStyle, id: ChannelId) => LayerStyle): void => apply(f(style, sizeId))
  const SIZE_SCALES = [
    { kind: 'classes', label: 'Classed', hint: 'Sizes in steps, by classes of the column' },
    { kind: 'continuous', label: 'Proportional', hint: 'Sizes that follow the values smoothly' },
    { kind: 'conditions', label: 'Conditions', hint: 'Sizes set by SQL conditions, the first that holds wins' },
    { kind: 'identity', label: 'As is', hint: 'Sizes read from the column, in pixels' },
  ] as const
  /** What "Add…" offers: the layer's properties that aren't varying yet (Color is the style type; Height is 3D). */
  const addable = $derived.by(() => {
    const ids = channelsFor(geometryType, drawOf(style)).filter((id) => id !== 'color' && id !== 'height' && id !== 'width')
    if (geometryType === 'LineString') ids.unshift('size')
    return ids
      .filter((id) => !varying.includes(id))
      .map((id) => ({
        id,
        label: id === 'size' ? (sizeGeometry === 'line' ? 'Width' : 'Size') : CHANNEL_NAMES[id],
        unavailable:
          id === 'size'
            ? renderer.kind === 'bivariate'
              ? 'Bivariate maps have no size.'
              : numericColumns.length
                ? null
                : 'Sizing needs a numeric column.'
            : channelColumns.length
              ? null
              : 'This result has no attribute columns.',
      }))
  })
  /** Columns a property can vary by: any attribute column. */
  const channelColumns = $derived(eligibleColumns(layer?.columns, 'categorized'))
  /** The scales offered for a property's column: categories, and classes for numbers (shapes and patterns: categories only). */
  function scalesForColumn(id: ChannelId, enc: Encoding): ScaleKind[] {
    const column = enc.source.kind === 'column' ? enc.source.column : ''
    const numeric = isNumericType(layer?.columns.find((c) => c.name === column)?.type ?? '')
    // FR-010, for the column at hand: classes and continuous need numbers; as is reads colors from text, the rest from numbers.
    const color = id === 'strokeColor'
    return scalesFor(id).filter((k) => {
      if (k === 'classes' || k === 'continuous') return numeric
      if (k === 'identity') return color ? !numeric : numeric
      // Spec 011 US4: conditions read any columns (SQL).
      return k === 'categories' || k === 'conditions'
    })
  }
  /** A property added again starts on the column it last had in this session, else on a suitable first one (FR-007). */
  function addVary(id: ChannelId): void {
    if (id === 'size') return toggleSize()
    const kept = setAside.get(`${sidecarName}|${id}`)
    if (kept) return apply(setEncoding(style, id, kept))
    const prefersText = id === 'strokeColor' || id === 'shape' || id === 'dash'
    const pick = (prefersText ? channelColumns.find((c) => !isNumericType(c.type)) : measureColumns(layer?.columns)[0]) ?? channelColumns[0]
    if (pick) apply(setEncoding(style, id, startEncoding(id, pick.name, layer)))
  }
  function removeVary(id: ChannelId): void {
    const enc = style.channels?.[id]
    if (enc) setAside.set(`${sidecarName}|${id}`, enc)
    apply(setEncoding(style, id, null))
  }

  // --- Marker shape and line pattern.
  const shape = $derived<MarkerShape>(style.markerShape ?? 'circle')
  const dash = $derived<LineDash>(style.lineDash ?? 'solid')
  // Spec 025: the zoom range the layer shows in, and sizes that follow the zoom.
  const zoomFrom = $derived(style.zoom?.min ?? ZOOM_LIMITS.min)
  const zoomTo = $derived(style.zoom?.max ?? ZOOM_LIMITS.max)
  const DEFAULT_ZOOM_SIZES = { fromZoom: 10, toZoom: 14, factor: ZOOM_SIZE_FACTOR.default }
  function setZoom(patch: Partial<ZoomSettings>): void {
    onChange({ zoom: sanitizeZoom({ ...style.zoom, ...patch }) })
  }
  function setZoomSizes(patch: Partial<NonNullable<ZoomSettings['sizes']>>): void {
    const next = { ...(style.zoom?.sizes ?? DEFAULT_ZOOM_SIZES), ...patch }
    // The two zooms stay one apart at least, whichever one was moved.
    if (next.toZoom <= next.fromZoom) {
      if ('fromZoom' in patch) next.toZoom = Math.min(ZOOM_LIMITS.max, next.fromZoom + 1)
      else next.fromZoom = Math.max(ZOOM_LIMITS.min, next.toZoom - 1)
    }
    setZoom({ sizes: next })
  }
  // Spec 019: direction arrows on lines (a layer of lines, or a mix with lines in it).
  const arrowMode = $derived<'none' | 'along' | 'center'>(style.arrows ? style.arrows.placement : 'none')
  function setArrows(mode: string): void {
    if (mode === 'none') onChange({ arrows: undefined })
    else onChange({ arrows: { ...DEFAULT_ARROWS, ...style.arrows, placement: mode === 'center' ? 'center' : 'along' } })
  }
  function patchArrows(patch: Partial<ArrowSettings>): void {
    if (style.arrows) onChange({ arrows: { ...style.arrows, ...patch } })
  }
  const preview = $derived(baseSymbol(style))
  function shapeKeydown(e: KeyboardEvent): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = MARKER_SHAPES[(MARKER_SHAPES.indexOf(shape) + dir + MARKER_SHAPES.length) % MARKER_SHAPES.length]
    onChange({ markerShape: next })
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-shape="${next}"]`)?.focus())
  }

  const pct = (n: number): string => `${Math.round(n * 100)}%`
  const numberFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })
  const fmt = (v: number): string => numberFormat.format(v)
  /** The class breaks (each range's upper bound but the last), with its class color. */
  const histogramBreaks = $derived(
    resolved.classes
      .filter((c) => c.kind === 'range')
      .slice(0, -1)
      .map((c) => ({ value: c.upper ?? 0, color: c.color }))
  )

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      onClose()
      e.stopPropagation()
    }
  }
</script>

<div class="panel" class:embedded aria-label="Layer style" role={embedded ? 'region' : 'dialog'} tabindex="-1" onkeydown={handleKeydown}>
  {#if embedded}
    <div class="source-row">
      <span class="source" title={styleSource ?? undefined}>
        {styleSource ?? 'Default'}{styleDirty ? ' · modified' : ''}
      </span>
    </div>
  {:else}
    <header>
      <h2>Layer style</h2>
      <span class="source" title={styleSource ?? undefined}>
        {styleSource ?? 'Default'}{styleDirty ? ' · modified' : ''}
      </span>
      <button type="button" class="icon-button" aria-label="Close" title="Close" onclick={onClose}><Icon name="close" /></button>
    </header>
  {/if}

  <div class="body">
    <!-- Spec 008 FR-001: one flow, top to bottom; only the sections that apply to the chosen type. -->
    <!-- The whole layer's opacity, on top of the fill and outline opacities (QGIS's layer opacity). -->
    <div class="row">
      <span class="label" id="layer-opacity-label">Opacity</span>
      <input
        type="range"
        class="wide"
        aria-label="Layer opacity"
        aria-valuetext={pct(style.layerOpacity ?? 1)}
        min="0"
        max="1"
        step="0.05"
        value={style.layerOpacity ?? 1}
        oninput={(e) => onChange({ layerOpacity: Number(e.currentTarget.value) })}
      />
      <span class="value">{pct(style.layerOpacity ?? 1)}</span>
    </div>

    <!-- Spec 025: the zoom range the layer shows in, beside the opacity. -->
    <div class="row">
      <span class="label" id="zoom-range-label" title="The zoom levels the layer shows at. Zoom 0 shows the world, 14 a city, 18 a street.">Zoom</span>
      <span class="wide">
        <RangeSlider
          from={zoomFrom}
          to={zoomTo}
          min={ZOOM_LIMITS.min}
          max={ZOOM_LIMITS.max}
          fromLabel="Show from zoom"
          toLabel="Hide from zoom"
          marker={nowZoom}
          markerLabel={nowZoom !== null ? `The map is at zoom ${nowZoom.toFixed(1)}${nowZoom >= zoomFrom && nowZoom < zoomTo ? '' : ': the layer is hidden here'}` : ''}
          onChange={(from, to) => setZoom({ min: from, max: to })}
        />
      </span>
      <span class="value zoom-range-value" aria-hidden="true">{zoomFrom} – {zoomTo}</span>
    </div>

    <section aria-labelledby="style-sec-type">
      <h3 id="style-sec-type">Color</h3>
      <StyleTypePicker options={typeOptions} value={colorType} onChange={chooseRenderer} label="Color" listLabel="Color styles" />
      {#if classifyingRows !== null}
        <p class="classifying" role="status">Classifying {classifyingRows.toLocaleString('en-US')} rows…</p>
      {/if}
    </section>

    {#if (colorType === 'continuous' || colorType === 'identity') && colorEnc}
      <!-- Spec 011 US4: colors along a ramp, or read from the column. -->
      <section aria-labelledby="style-sec-by">
        <h3 id="style-sec-by">Color by</h3>
        <ScaleEditor
          channel="color"
          enc={colorEnc}
          resolved={resolved.channels?.color}
          columns={colorType === 'continuous' ? columnsFor('graduated') : colorColumns}
          scales={[]}
          onColumn={(c) => apply(setChannelColumnKeepScale(c))}
          onScale={() => {}}
          onClasses={() => {}}
          onRange={() => {}}
          onRamp={(ramp) => apply(setChannelRamp(style, 'color', ramp))}
          onDomain={(d) => apply(setChannelDomain(style, 'color', d))}
          onClass={(key, patch) => apply(setChannelClass(style, 'color', key, patch))}
          onLegendHidden={(h) => apply(setLegendHidden(style, 'color', h))}
        />
      </section>
    {/if}

    {#if renderer.kind === 'categorized' || renderer.kind === 'graduated'}
      <section aria-labelledby="style-sec-by">
        <h3 id="style-sec-by">Color by</h3>
        <div class="row field">
          <label class="label" for="style-column">Column</label>
          <select id="style-column" class="column-select" value={usingExpression ? EXPRESSION : renderer.column} onchange={(e) => chooseValue(e.currentTarget.value)}>
            {#if !usingExpression && !columnsFor(renderer.kind).some((c) => c.name === renderer.column)}
              <option value={renderer.column}>{renderer.column || 'Choose…'}</option>
            {/if}
            <ColumnOptions columns={columnsFor(renderer.kind)} />
            {#if renderer.kind === 'graduated'}
              <option value={EXPRESSION}>Expression…</option>
            {/if}
          </select>
        </div>
        {#if renderer.kind === 'graduated' && usingExpression}
          <div class="expression">
            <input
              type="text"
              class="mono"
              aria-label="Expression"
              aria-describedby="style-expression-hint"
              placeholder="gdp_md * 1e6 / pop_est"
              spellcheck="false"
              autocomplete="off"
              value={renderer.expression ?? ''}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onchange={(e) => commitExpression(e.currentTarget.value)}
            />
            <p class="hint" id="style-expression-hint">A SQL expression over this layer's columns, e.g. gdp_md * 1e6 / pop_est</p>
          </div>
        {/if}
      </section>

      {#if renderer.kind === 'graduated'}
        <section aria-labelledby="style-sec-classes">
          <h3 id="style-sec-classes">Classification</h3>
          <div class="pair">
            <div class="row field">
              <label class="label" for="style-method">Method</label>
              <select id="style-method" value={renderer.method} onchange={(e) => chooseMethod(e.currentTarget.value as GraduatedMethod)}>
                {#each METHODS as m (m)}
                  <option value={m}>{m === 'jenks' ? 'Natural breaks (Jenks)' : METHOD_NAMES[m]}</option>
                {/each}
                {#if renderer.method === 'manual'}
                  <option value="manual">Manual</option>
                {/if}
              </select>
            </div>
            <div class="row field">
              <label class="label" for="style-classes">Classes</label>
              <select id="style-classes" class="narrow" value={renderer.classCount} onchange={(e) => chooseClassCount(Number(e.currentTarget.value))}>
                {#each CLASS_COUNTS as n (n)}
                  <option value={n}>{n}</option>
                {/each}
              </select>
            </div>
          </div>
          {#if resolved.status !== 'fallback'}
            <ValueHistogram {histogram} breaks={histogramBreaks} format={fmt} />
          {/if}
        </section>
      {/if}

      <section aria-labelledby="style-sec-colors">
        <h3 id="style-sec-colors">Colors</h3>
        {#if resolved.status === 'fallback'}
          <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.reason} Showing the single symbol.</p>
        {:else}
          <RampPicker
            value={renderer.ramp}
            renderer={renderer.kind}
            classCount={resolved.classes.filter((c) => c.kind === 'value' || c.kind === 'range').length}
            onChange={(ramp) => apply(setRamp(style, ramp))}
            onPreview={(ramp) => onPreview(ramp ? setRamp(style, ramp) : null)}
          />
          <ClassList
            {resolved}
            kind={renderer.kind}
            manual={renderer.kind === 'graduated' ? renderer.method === 'manual' : renderer.manual}
            onColor={(key, color) => apply(setClassColor(style, key, color))}
            onLabel={(key, label) => apply(setClassLabel(style, key, label))}
            onVisible={(key, visible) => apply(setClassVisible(style, key, visible))}
            onValue={(key, value) => apply(setCategoryValue(style, resolved, key, value))}
            onBound={(index, side, value) => apply(setClassBound(style, resolved, index, side, value))}
            onAdd={() => apply(addClass(style, resolved))}
            onDelete={(key) => apply(deleteClass(style, resolved, key))}
          />
          {#if editError}
            <p class="inline-note warning" role="alert"><Icon name="warning" size={14} />{editError}</p>
          {/if}
          {#if renderer.kind === 'categorized' && renderer.manual}
            <p class="inline-note">
              <Icon name="info" size={14} /><span>Fixed classes (Manual). <button type="button" class="link" onclick={() => apply(setCategorizedAuto(style))}>Back to automatic</button></span>
            </p>
          {:else if renderer.kind === 'graduated' && renderer.method === 'manual'}
            <p class="inline-note"><Icon name="info" size={14} />Fixed classes (Manual): choose a method to recompute them.</p>
          {/if}
          {#each resolved.notes as note (note)}
            <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
          {/each}
        {/if}
      </section>
    {/if}

    <!-- Spec 010: rules (the first matching condition colors a feature). -->
    {#if renderer.kind === 'rules'}
      <section aria-labelledby="style-sec-rules">
        <h3 id="style-sec-rules">Rules</h3>
        <p class="hint">SQL conditions on this layer's columns. The first rule a feature matches colors it.</p>
        <RulesEditor
          {renderer}
          {resolved}
          onUpdate={(id, patch) => apply(updateRule(style, id, patch))}
          onAdd={() => apply(addRule(style))}
          onRemove={(id) => apply(removeRule(style, id))}
          onMove={(id, by) => apply(moveRule(style, id, by))}
          onElse={(patch) => apply(setRulesElse(style, patch))}
        />
        {#if editError}
          <p class="inline-note warning" role="alert"><Icon name="warning" size={14} />{editError}</p>
        {/if}
      </section>
    {/if}

    <!-- A heatmap: the points' density, optionally weighted by a numeric column. -->
    {#if renderer.kind === 'heatmap'}
      <section aria-labelledby="style-sec-heat">
        <h3 id="style-sec-heat">Heatmap</h3>
        <div class="row field">
          <label class="label" for="style-heat-weight">Weight</label>
          <select id="style-heat-weight" class="column-select" value={renderer.weight} onchange={(e) => apply(setHeatmap(style, { weight: e.currentTarget.value }))}>
            <option value="">None: count each point</option>
            {#if renderer.weight && !numericColumns.some((c) => c.name === renderer.weight)}
              <option value={renderer.weight}>{renderer.weight}</option>
            {/if}
            <ColumnOptions columns={numericColumns} />
          </select>
        </div>
        <div class="row field">
          <span class="label" id="heat-unit-label">Radius in</span>
          <div class="renderers two" role="radiogroup" aria-labelledby="heat-unit-label">
            {#each [{ unit: 'px', label: 'Pixels' }, { unit: 'm', label: 'Meters' }] as const as u (u.unit)}
              {@const on = (renderer.radiusUnit ?? 'px') === u.unit}
              <button
                type="button"
                role="radio"
                aria-checked={on}
                tabindex={on ? 0 : -1}
                onclick={() => apply(setHeatmapRadiusUnit(style, u.unit, camera ? { latitude: camera.center[1], zoom: camera.zoom } : null))}
                onkeydown={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault()
                    const next = (renderer.radiusUnit ?? 'px') === 'px' ? 'm' : 'px'
                    apply(setHeatmapRadiusUnit(style, next, camera ? { latitude: camera.center[1], zoom: camera.zoom } : null))
                    const group = (e.currentTarget as HTMLElement).parentElement
                    queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
                  }
                }}>{u.label}</button
              >
            {/each}
          </div>
        </div>
        {#if renderer.radiusUnit === 'm'}
          <div class="row field">
            <label class="label" for="heat-meters">Radius</label>
            <input
              id="heat-meters"
              class="number"
              type="number"
              aria-label="Radius in meters"
              min={HEATMAP_METERS.min}
              max={HEATMAP_METERS.max}
              step="any"
              value={renderer.radiusMeters ?? HEATMAP_METERS.default}
              onchange={(e) => {
                const v = Number(e.currentTarget.value)
                if (Number.isFinite(v) && v > 0) apply(setHeatmap(style, { radiusMeters: v }))
              }}
            />
          </div>
          <p class="hint">Fixed on the map: a place keeps its color at every zoom. Zoomed far out, points may shrink to nothing.</p>
        {:else}
          <div class="row">
            <span class="label" id="heat-radius-label">Radius</span>
            <input
              type="range"
              class="wide"
              aria-labelledby="heat-radius-label"
              aria-valuetext="{renderer.radius} pixels"
              min={HEATMAP_RADIUS.min}
              max={60}
              step="1"
              value={renderer.radius}
              oninput={(e) => apply(setHeatmap(style, { radius: Number(e.currentTarget.value) }))}
            />
            <span class="value">{renderer.radius} px</span>
          </div>
          <p class="hint">Fixed on screen: zooming out piles points together, so the map gets hotter.</p>
        {/if}
        <div class="row">
          <span class="label" id="heat-intensity-label">Intensity</span>
          <input
            type="range"
            class="wide"
            disabled={renderer.autoIntensity === true}
            aria-labelledby="heat-intensity-label"
            aria-valuetext={intensityText(renderer.intensity)}
            min="0"
            max="1"
            step="0.005"
            value={intensityToSlider(renderer.intensity)}
            oninput={(e) => apply(setHeatmap(style, { intensity: sliderToIntensity(Number(e.currentTarget.value)) }))}
          />
          <span class="value">{intensityText(renderer.autoIntensity && resolved.heat?.intensity !== undefined ? resolved.heat.intensity : renderer.intensity)}</span>
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={renderer.autoIntensity === true}
            onchange={async (e) => {
              const on = e.currentTarget.checked
              const view = camera ? { latitude: camera.center[1], zoom: camera.zoom } : null
              apply(setHeatmapAutoIntensity(style, on, view))
              // Automatic also sizes the kernel from the point spacing; the radius stays editable.
              const fit = on ? await onSuggestHeatRadius?.() : null
              if (fit && renderer.kind === 'heatmap' && renderer.autoIntensity) apply(setHeatmap(style, { radiusMeters: fit.meters, latitude: fit.latitude }))
            }}
          />
          <span>Automatic</span>
          <Tip text="Sets the radius from how close the points lie (meters), and the intensity so the densest 2% take the last color. Worked out from all the points, so it holds at every zoom. Change the radius afterward if you like." side="top">
            {#snippet trigger(props)}
              <button type="button" class="info" {...props} aria-label="About automatic intensity"><Icon name="info" size={13} /></button>
            {/snippet}
          </Tip>
        </label>
        <RampPicker
          value={renderer.ramp}
          renderer="graduated"
          classCount={HEATMAP_STOPS}
          onChange={(ramp) => apply(setRamp(style, ramp))}
          onPreview={(ramp) => onPreview(ramp ? setRamp(style, ramp) : null)}
        />
        <p class="hint">Sparse areas take the left of the ramp, dense ones the right; where there are no points, the map shows through.</p>
        {#if geometryType === 'Mixed'}
          <p class="inline-note" role="status"><Icon name="info" size={14} />Only points make the heatmap; lines and polygons keep the single symbol.</p>
        {/if}
        {#each resolved.notes as note (note)}
          <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
        {/each}
      </section>
    {/if}

    <!-- Clusters: groups of points as bubbles (after mapgl's cluster_options). -->
    {#if renderer.kind === 'clusters'}
      <section aria-labelledby="style-sec-clusters">
        <h3 id="style-sec-clusters">Clusters</h3>
        <div class="row">
          <span class="label" id="cluster-radius-label">Radius</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="cluster-radius-label"
            aria-valuetext="{renderer.radius} pixels"
            min={CLUSTER_RADIUS.min}
            max={120}
            step="5"
            value={renderer.radius}
            oninput={(e) => apply(setClusters(style, { radius: Number(e.currentTarget.value) }))}
          />
          <span class="value">{renderer.radius} px</span>
        </div>
        <p class="hint">Points this close on screen group into one bubble.</p>
        <div class="row">
          <span class="label" id="cluster-zoom-label">Up to zoom</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="cluster-zoom-label"
            aria-valuetext="zoom {renderer.maxZoom}"
            min={CLUSTER_MAX_ZOOM.min}
            max={CLUSTER_MAX_ZOOM.max}
            step="1"
            value={renderer.maxZoom}
            oninput={(e) => apply(setClusters(style, { maxZoom: Number(e.currentTarget.value) }))}
          />
          <span class="value">{renderer.maxZoom}</span>
        </div>
        <p class="hint">Zoomed in further, every point shows on its own.</p>

        <span class="label" id="cluster-steps-label">Bubbles</span>
        <ul class="cluster-steps" aria-labelledby="cluster-steps-label">
          {#each renderer.steps as st, i (i)}
            {@const label = resolved.clusters?.steps[i]?.label ?? `${st.from}+ points`}
            <li>
              <ColorField label="Color for {label}" value={st.color} apply="live" size="md" onChange={(v) => apply(setClusters(style, { steps: withStep(renderer.steps, i, { color: v }) }))} />
              {#if i === 0}
                <span class="from">From 2</span>
              {:else}
                <label class="from">
                  From
                  <input
                    class="number"
                    type="number"
                    aria-label="Step {i + 1} starts at"
                    min={renderer.steps[i - 1].from + 1}
                    step="1"
                    value={st.from}
                    onchange={(e) => {
                      const v = Math.round(Number(e.currentTarget.value))
                      if (Number.isFinite(v)) apply(setClusters(style, { steps: withStep(renderer.steps, i, { from: v }) }))
                    }}
                  />
                </label>
              {/if}
              <label class="size">
                <input
                  class="number"
                  type="number"
                  aria-label="Bubble radius for {label}"
                  min={CLUSTER_BUBBLE.min}
                  max={CLUSTER_BUBBLE.max}
                  step="1"
                  value={st.radius}
                  onchange={(e) => {
                    const v = Number(e.currentTarget.value)
                    if (Number.isFinite(v)) apply(setClusters(style, { steps: withStep(renderer.steps, i, { radius: v }) }))
                  }}
                />
                px
              </label>
              {#if renderer.steps.length > CLUSTER_STEP_COUNT.min}
                <button
                  type="button"
                  class="icon-button"
                  aria-label="Remove the step for {label}"
                  title="Remove this step"
                  onclick={() => apply(setClusters(style, { steps: renderer.steps.filter((_, j) => j !== i) }))}><Icon name="close" size={14} /></button
                >
              {/if}
            </li>
          {/each}
        </ul>
        {#if renderer.steps.length < CLUSTER_STEP_COUNT.max}
          <button type="button" class="link add-step" onclick={() => apply(setClusters(style, { steps: addedStep(renderer.steps) }))}><Icon name="plus" size={12} />Add a step</button>
        {/if}

        <div class="row field">
          <label class="label" for="cluster-count-format">Counts</label>
          <select id="cluster-count-format" class="column-select" value={renderer.countFormat} onchange={(e) => apply(setClusters(style, { countFormat: e.currentTarget.value as typeof renderer.countFormat }))}>
            {#each COUNT_FORMATS as f (f.value)}
              <option value={f.value}>{f.label}</option>
            {/each}
          </select>
        </div>
        <div class="row">
          <span class="label" id="cluster-text-label">Count color</span>
          <ColorField labelledby="cluster-text-label" value={renderer.textColor} apply="live" size="md" onChange={(v) => apply(setClusters(style, { textColor: v }))} />
        </div>
        <div class="row">
          <span class="label" id="cluster-opacity-label">Opacity</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="cluster-opacity-label"
            aria-valuetext={pct(renderer.opacity)}
            min="0"
            max="1"
            step="0.05"
            value={renderer.opacity}
            oninput={(e) => apply(setClusters(style, { opacity: Number(e.currentTarget.value) }))}
          />
          <span class="value">{pct(renderer.opacity)}</span>
        </div>
        <div class="row">
          <span class="label" id="cluster-outline-label">Outline</span>
          <ColorField labelledby="cluster-outline-label" value={renderer.strokeColor} apply="live" size="md" onChange={(v) => apply(setClusters(style, { strokeColor: v }))} />
          <input
            type="range"
            aria-label="Outline width"
            aria-valuetext="{renderer.strokeWidth} pixels"
            min="0"
            max="5"
            step="0.5"
            value={renderer.strokeWidth}
            oninput={(e) => apply(setClusters(style, { strokeWidth: Number(e.currentTarget.value) }))}
          />
          <span class="value">{renderer.strokeWidth} px</span>
        </div>
        <p class="hint">A click on a bubble zooms in until it breaks apart. Points not in a group take the symbol below.</p>
        {#if geometryType === 'Mixed'}
          <p class="inline-note" role="status"><Icon name="info" size={14} />Only points are grouped; lines and polygons keep the single symbol.</p>
        {/if}
      </section>
    {/if}

    <!-- Spec 009 US1/US2: an independent size channel (contracts/ui.md "Size"). -->
    <!-- Spec 009 US4: bivariate (contracts/ui.md "Style panel"). -->
    {#if renderer.kind === 'bivariate'}
      <section aria-labelledby="style-sec-axes">
        <h3 id="style-sec-axes">Columns</h3>
        <BivariatePicker
          {renderer}
          columns={columnsFor('graduated')}
          onAxis={(axis, patch) => apply(setBivariateAxis(style, axis, patch))}
          onSwap={() => apply(swapBivariateAxes(style))}
          onTilted={(tilted) => apply(setBivariateTilted(style, tilted))}
          onPalette={(id) => apply(setBivariatePalette(style, id))}
        />
        {#if editError}
          <p class="inline-note warning" role="alert"><Icon name="warning" size={14} />{editError}</p>
        {/if}
      </section>
      <section aria-labelledby="style-sec-cells">
        <h3 id="style-sec-cells">Cells</h3>
        {#if resolved.status === 'fallback'}
          <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.reason} Showing the single symbol.</p>
        {:else}
          <BivariateLegend {resolved} cell={32} onToggle={(key, visible) => apply(setCellVisible(style, key, visible))} />
          {#each resolved.notes as note (note)}
            <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
          {/each}
        {/if}
      </section>
    {/if}

    <!-- A point heatmap draws no symbols; mixed layers keep them for lines and polygons. -->
    {#if renderer.kind !== 'heatmap' || geometryType !== 'Point'}
    <section aria-labelledby="style-sec-look">
      <h3 id="style-sec-look">Appearance</h3>
      {#if hasFill}
        <div class="row">
          <span class="label" id="fill-label">Fill</span>
          {#if thematic}
            <span class="by-class" title="Class colors come from the classes above">·</span>
          {:else}
            <ColorField labelledby="fill-label" value={style.fillColor} apply="live" size="md" onChange={(v) => onChange({ fillColor: v })} />
          {/if}
          <input
            type="range"
            aria-label="Fill opacity"
            aria-valuetext={pct(style.fillOpacity)}
            min="0"
            max="1"
            step="0.05"
            value={style.fillOpacity}
            oninput={(e) => onChange({ fillOpacity: Number(e.currentTarget.value) })}
          />
          <span class="value">{pct(style.fillOpacity)}</span>
        </div>
      {/if}

      <div class="row">
        <span class="label" id="stroke-label">{strokeLabel}</span>
        <ColorField labelledby="stroke-label" value={style.strokeColor} apply="live" size="md" onChange={(v) => onChange({ strokeColor: v })} />
        <input
          type="range"
          aria-label="{strokeLabel} opacity"
          aria-valuetext={pct(style.strokeOpacity)}
          min="0"
          max="1"
          step="0.05"
          value={style.strokeOpacity}
          oninput={(e) => onChange({ strokeOpacity: Number(e.currentTarget.value) })}
        />
        <span class="value">{pct(style.strokeOpacity)}</span>
      </div>

      <div class="row">
        <span class="label" id="width-label">Width</span>
        <input
          type="range"
          class="wide"
          aria-labelledby="width-label"
          aria-valuetext="{style.strokeWidth} pixels"
          min="0"
          max="10"
          step="0.5"
          value={style.strokeWidth}
          oninput={(e) => onChange({ strokeWidth: Number(e.currentTarget.value) })}
        />
        <span class="value">{style.strokeWidth} px</span>
      </div>

      {#if hasLines}
        <div class="row">
          <label class="label" for="style-dash">Pattern</label>
          <span class="preview" aria-hidden="true"><SymbolSwatch symbol={{ ...preview, lineWidth: Math.min(Math.max(preview.lineWidth, 1.5), 3) }} kind="line" size={26} /></span>
          <select id="style-dash" class="span" value={dash} onchange={(e) => onChange({ lineDash: e.currentTarget.value as LineDash })}>
            {#each LINE_DASHES as d (d)}
              <option value={d}>{LINE_DASH_NAMES[d]}</option>
            {/each}
          </select>
        </div>
        <div class="row">
          <label class="label" for="style-arrows">Arrows</label>
          <select id="style-arrows" class="span" value={arrowMode} onchange={(e) => setArrows(e.currentTarget.value)}>
            <option value="none">None</option>
            <option value="along">Along the line</option>
            <option value="center">Middle of the line</option>
          </select>
        </div>
        {#if style.arrows}
          {#if style.arrows.placement === 'along'}
            <div class="row">
              <span class="label" id="arrow-spacing-label">Spacing</span>
              <input
                type="range"
                class="wide"
                aria-labelledby="arrow-spacing-label"
                aria-valuetext="{style.arrows.spacing} pixels"
                min={ARROW_SPACING.min}
                max="300"
                step="10"
                value={style.arrows.spacing}
                oninput={(e) => patchArrows({ spacing: Number(e.currentTarget.value) })}
              />
              <span class="value">{style.arrows.spacing} px</span>
            </div>
          {/if}
          <div class="row">
            <span class="label" id="arrow-size-label">Arrow size</span>
            <input
              type="range"
              class="wide"
              aria-labelledby="arrow-size-label"
              aria-valuetext="{style.arrows.size} times"
              min={ARROW_SIZE.min}
              max={ARROW_SIZE.max}
              step="0.1"
              value={style.arrows.size}
              oninput={(e) => patchArrows({ size: Number(e.currentTarget.value) })}
            />
            <span class="value">{style.arrows.size}×</span>
          </div>
        {/if}
      {/if}

      {#if hasPoints}
        <div class="row">
          <span class="label" id="shape-label">Shape</span>
          <div class="shapes" role="radiogroup" aria-labelledby="shape-label">
            {#each MARKER_SHAPES as m (m)}
              <button
                type="button"
                role="radio"
                data-shape={m}
                aria-checked={shape === m}
                aria-label={MARKER_SHAPE_NAMES[m]}
                title={MARKER_SHAPE_NAMES[m]}
                tabindex={shape === m ? 0 : -1}
                onclick={() => onChange({ markerShape: m })}
                onkeydown={shapeKeydown}
              >
                <SymbolSwatch symbol={{ ...preview, shape: m, radius: 6, strokeWidth: Math.min(preview.strokeWidth, 1.5), fillOpacity: Math.max(preview.fillOpacity, 0.6) }} kind="point" size={18} />
              </button>
            {/each}
          </div>
        </div>
        <div class="row">
          <span class="label" id="radius-label">Point size</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="radius-label"
            aria-valuetext="{style.pointRadius} pixels"
            min="1"
            max="20"
            step="0.5"
            value={style.pointRadius}
            oninput={(e) => onChange({ pointRadius: Number(e.currentTarget.value) })}
          />
          <span class="value">{style.pointRadius} px</span>
        </div>
      {/if}

      <!-- Spec 025: sizes that follow the zoom. -->
      <div class="zoom-row">
        <span class="label" id="zoom-sizes-label">Sizes follow zoom</span>
        <Switch checked={!!style.zoom?.sizes} labelledby="zoom-sizes-label" onChange={(on) => setZoom({ sizes: on ? DEFAULT_ZOOM_SIZES : undefined })} />
      </div>
      {#if style.zoom?.sizes}
        <div class="zoom-row">
          <span class="label" id="zoom-from-label">Smallest at zoom</span>
          <NumberField label="Smallest at zoom" value={style.zoom.sizes.fromZoom} min={ZOOM_LIMITS.min} max={ZOOM_LIMITS.max - 1} onChange={(v) => setZoomSizes({ fromZoom: v })} />
        </div>
        <div class="zoom-row">
          <span class="label" id="zoom-to-label">Full size at zoom</span>
          <NumberField label="Full size at zoom" value={style.zoom.sizes.toZoom} min={1} max={ZOOM_LIMITS.max} onChange={(v) => setZoomSizes({ toZoom: v })} />
        </div>
        <div class="row">
          <span class="label" id="zoom-factor-label">Markers</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="zoom-factor-label"
            aria-valuetext={pct(style.zoom.sizes.factor)}
            min={ZOOM_SIZE_FACTOR.min}
            max="0.95"
            step="0.05"
            value={style.zoom.sizes.factor}
            oninput={(e) => setZoomSizes({ factor: Number(e.currentTarget.value) })}
          />
          <span class="value">{pct(style.zoom.sizes.factor)}</span>
        </div>
        <div class="row">
          <span class="label" id="zoom-line-factor-label">Lines</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="zoom-line-factor-label"
            aria-valuetext={pct(style.zoom.sizes.lineFactor ?? style.zoom.sizes.factor)}
            min={ZOOM_SIZE_FACTOR.min}
            max="1"
            step="0.05"
            value={style.zoom.sizes.lineFactor ?? style.zoom.sizes.factor}
            oninput={(e) => setZoomSizes({ lineFactor: Number(e.currentTarget.value) })}
          />
          <span class="value">{pct(style.zoom.sizes.lineFactor ?? style.zoom.sizes.factor)}</span>
        </div>
        <p class="hint">At the first zoom and below, markers (size and outline) and lines are this fraction of their size; they grow to full size at the second zoom.</p>
      {/if}
    </section>
    {/if}

    <!-- Spec 011 (contracts/ui.md "Vary by attribute"): more properties, each by its own column. -->
    {#if renderer.kind !== 'heatmap' || geometryType !== 'Point'}
      <section aria-labelledby="style-sec-vary">
        <h3 id="style-sec-vary">Vary by attribute</h3>
        {#if !varying.length}
          <p class="hint">Show more columns at once: size, outline, shape, opacity and more, each by its own column.</p>
        {/if}
        {#each varying as id (id)}
          {#if id === 'size'}
            <VaryRow
              id="size"
              name={sizeGeometry === 'line' ? 'Width' : 'Size'}
              summary={resolved.size?.caption ?? resolved.channels?.[sizeId]?.caption ?? ''}
              onRemove={() => (sizeOn ? toggleSize() : SIZE_IDS.forEach((x) => removeVary(x)))}
            >
              {#if sizeOn && size}
              <div class="row field">
                <span class="label" aria-hidden="true">Column</span>
                <select id="style-size-column" class="column-select" aria-label="Size column" value={size.column} onchange={(e) => apply(setSizeChannel(style, e.currentTarget.value, sizeGeometry))}>
                  {#if !numericColumns.some((c) => c.name === size.column)}
                    <option value={size.column}>{size.column || 'Choose…'}</option>
                  {/if}
                  <ColumnOptions columns={numericColumns} />
                </select>
              </div>
              <div class="row field">
                <span class="label" id="size-scale-label">Scale</span>
                {@render sizeScaleChoice(size.mode === 'classed' ? 'classes' : 'continuous')}
              </div>
              {#if size.mode === 'classed'}
              <div class="pair">
                <div class="row field">
                  <span class="label" aria-hidden="true">Method</span>
                  <select id="style-size-method" aria-label="Size method" value={size.method} onchange={(e) => apply(setSizeMethod(style, e.currentTarget.value as Exclude<GraduatedMethod, 'manual'>))}>
                    {#each METHODS as m (m)}
                      <option value={m}>{m === 'jenks' ? 'Natural breaks (Jenks)' : METHOD_NAMES[m]}</option>
                    {/each}
                    {#if size.method === 'manual'}
                      <option value="manual">Manual</option>
                    {/if}
                  </select>
                </div>
                <div class="row field">
                  <span class="label" aria-hidden="true">Classes</span>
                  <select id="style-size-count" class="narrow" aria-label="Size class count" value={size.classCount} onchange={(e) => apply(setSizeClassCount(style, Number(e.currentTarget.value)))}>
                    {#each CLASS_COUNTS as n (n)}
                      <option value={n}>{n}</option>
                    {/each}
                  </select>
                </div>
              </div>
              {:else}
                <p class="hint">Sizes scale smoothly from the smallest to the largest value of {size.column}{sizeGeometry === 'point' ? ', by marker area' : ''}.</p>
              {/if}
              <div class="row field">
                <span class="label" aria-hidden="true">{sizeGeometry === 'line' ? 'Widths' : 'Sizes'}</span>
                <span class="size-range">
                  <input id="style-size-min" class="number" type="number" aria-label="Smallest size" min="0.5" max="100" step="0.5" value={size.sizeMin} onchange={(e) => chooseSize('min', Number(e.currentTarget.value))} />
                  <span aria-hidden="true">to</span>
                  <input class="number" type="number" aria-label="Largest size" min="0.5" max="100" step="0.5" value={size.sizeMax} onchange={(e) => chooseSize('max', Number(e.currentTarget.value))} />
                  <span>px</span>
                </span>
              </div>
              {#if resolved.size?.status === 'fallback'}
                <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.size.reason}</p>
              {:else if resolved.size && sizeSymbols && size.mode === 'classed'}
                <ClassList
                  {resolved}
                  kind="graduated"
                  classes={resolved.size.classes}
                  caption={resolved.size.caption}
                  listLabel="Size classes"
                  canAdd={false}
                  {sizeSymbols}
                  manual={size.method === 'manual'}
                  onColor={() => {}}
                  onLabel={(key, label) => apply(setSizeClassLabel(style, key, label))}
                  onVisible={(key, visible) => apply(setSizeClassVisible(style, key, visible))}
                  onValue={() => {}}
                  onBound={(index, side, value) => apply(setSizeClassBound(style, resolved, index, side, value))}
                  onAdd={() => {}}
                  onDelete={() => {}}
                />
                {#each resolved.size.notes as note (note)}
                  <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
                {/each}
              {/if}
              {:else if sizeOther}
                {@const enc = style.channels?.[sizeId]}
                {#if enc}
                  <div class="row field">
                    <span class="label" aria-hidden="true">Scale</span>
                    {@render sizeScaleChoice(enc.scale.kind)}
                  </div>
                  <ScaleEditor
                    channel={sizeId}
                    {enc}
                    resolved={resolved.channels?.[sizeId]}
                    columns={channelColumns}
                    scales={[]}
                    onColumn={(c) => oneSize((s, x) => setChannelColumn(s, x, c, layer))}
                    onScale={chooseSizeScale}
                    onClasses={() => {}}
                    onRange={() => {}}
                    onRamp={() => {}}
                    onCondition={{
                      add: () => oneSize((s, x) => addCondition(s, x)),
                      update: (rid, patch) => oneSize((s, x) => updateCondition(s, x, rid, patch)),
                      remove: (rid) => oneSize((s, x) => removeCondition(s, x, rid)),
                      move: (rid, by) => oneSize((s, x) => moveCondition(s, x, rid, by)),
                      otherwise: (patch) => oneSize((s, x) => setConditionElse(s, x, patch)),
                    }}
                    onClass={(key, patch) => oneSize((s, x) => setChannelClass(s, x, key, patch))}
                    onLegendHidden={(h) => oneSize((s, x) => setLegendHidden(s, x, h))}
                  />
                {/if}
              {/if}
            </VaryRow>
          {:else}
            {@const enc = style.channels?.[id]}
            <VaryRow {id} name={CHANNEL_NAMES[id]} summary={resolved.channels?.[id]?.caption ?? ''} onRemove={() => removeVary(id)}>
              {#if enc}
                <ScaleEditor
                  channel={id}
                  {enc}
                  resolved={resolved.channels?.[id]}
                  columns={channelColumns}
                  scales={scalesForColumn(id, enc)}
                  onColumn={(c) => apply(setChannelColumn(style, id, c, layer))}
                  onScale={(k) => apply(setScaleKind(style, id, k, layer))}
                  onClasses={(p) => apply(setChannelClasses(style, id, p))}
                  onRange={(lo, hi) => apply(setChannelRange(style, id, lo, hi))}
                  onRamp={(ramp) => apply(setChannelRamp(style, id, ramp))}
                  onDomain={(d) => apply(setChannelDomain(style, id, d))}
                  onCurve={(c) => apply(setChannelCurve(style, id, c))}
                  onCondition={{
                    add: () => apply(addCondition(style, id)),
                    update: (rid, patch) => apply(updateCondition(style, id, rid, patch)),
                    remove: (rid) => apply(removeCondition(style, id, rid)),
                    move: (rid, by) => apply(moveCondition(style, id, rid, by)),
                    otherwise: (patch) => apply(setConditionElse(style, id, patch)),
                  }}
                  onClass={(key, patch) => apply(setChannelClass(style, id, key, patch))}
                  onLegendHidden={(h) => apply(setLegendHidden(style, id, h))}
                />
              {/if}
            </VaryRow>
          {/if}
        {/each}
        <AddVaryMenu items={addable} onAdd={addVary} />
        {#if varying.length + (thematic ? 1 : 0) >= 3}
          <p class="inline-note" role="status"><Icon name="info" size={14} />Maps with many variables are harder to read: consider two.</p>
        {/if}
      </section>
    {/if}

    <!-- Spec 008 US6 (FR-025): polygons raised by a column or a constant height. -->
    <section aria-labelledby="style-sec-3d">
      <h3 id="style-sec-3d">3D</h3>
      {#if extrusionReason}
        <p class="inline-note" role="status"><Icon name="info" size={14} />{extrusionReason}</p>
      {:else}
        <div class="row field">
          <span class="label" id="extrude-label">Extrude</span>
          <button
            type="button"
            role="switch"
            class="switch"
            aria-label="Extrude polygons"
            aria-checked={ext?.enabled === true}
            onclick={toggleExtrusion}
          >
            <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            <span class="state">{ext?.enabled ? 'On' : 'Off'}</span>
          </button>
        </div>
        {#if ext?.enabled}
          <div class="row field">
            <label class="label" for="extrude-height">Height</label>
            <select id="extrude-height" class="column-select" aria-label="Height from" value={ext.source.kind === 'column' ? ext.source.column : CONSTANT} onchange={(e) => chooseHeight(e.currentTarget.value)}>
              {#if ext.source.kind === 'column' && !heightColumns.some((c) => ext.source.kind === 'column' && c.name === ext.source.column)}
                <option value={ext.source.column}>{ext.source.column}</option>
              {/if}
              <ColumnOptions columns={heightColumns} />
              <option value={CONSTANT}>Constant height</option>
            </select>
          </div>
          {#if ext.source.kind === 'constant'}
            <div class="row field">
              <label class="label" for="extrude-meters">Meters</label>
              <input
                id="extrude-meters"
                class="number"
                type="number"
                aria-label="Constant height"
                min="0"
                step="any"
                value={ext.source.meters}
                onchange={(e) => {
                  const v = Number(e.currentTarget.value)
                  if (Number.isFinite(v) && v >= 0) setExtrusion({ source: { kind: 'constant', meters: v } })
                }}
              />
            </div>
          {/if}
          <div class="row field with-action">
            <label class="label" for="extrude-scale">Scale</label>
            <input
              id="extrude-scale"
              class="number"
              type="number"
              aria-label="Height scale"
              aria-describedby="extrude-scale-hint"
              min="0"
              step="any"
              value={ext.scale}
              onchange={(e) => {
                const v = Number(e.currentTarget.value)
                if (Number.isFinite(v) && v > 0) setExtrusion({ scale: v })
              }}
            />
            {#if ext.source.kind === 'column' && onSuggestScale}
              {@const column = ext.source.column}
              <button type="button" class="auto-scale" disabled={scaling} title="Pick a scale that shows the heights at this layer's extent" onclick={() => void autoScale(column)}>Auto</button>
            {/if}
          </div>
          <p class="hint" id="extrude-scale-hint">Height in meters = {ext.source.kind === 'column' ? `${ext.source.column} × ${ext.scale}` : `${ext.source.meters} × ${ext.scale}`}. Right-drag or Shift+arrows to tilt and rotate.</p>
          {#if extrusionFlat}
            <p class="inline-note" role="status"><Icon name="info" size={14} />{extrusionFlat.toLocaleString('en-US')} {extrusionFlat === 1 ? 'polygon' : 'polygons'} drawn flat (no height, zero or negative).</p>
          {/if}
        {/if}
      {/if}
    </section>
  </div>

  {#if notice}
    <div class="notice {notice.kind}" role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={notice.kind === 'info' ? 'info' : notice.kind} size={14} />
      <span>{notice.text}</span>
      <button type="button" class="icon-button" aria-label="Dismiss" onclick={onDismissNotice}><Icon name="close" size={14} /></button>
    </div>
  {/if}

  <footer>
    <SaveStyleButton {canSaveSidecar} {sidecarName} losses={(f) => previewExportNotice(style, f, resolved).items} {onSave} onSaveAs={onExport} />
    <!-- Spec 008 (user request): loading a style is as visible as saving one (QGIS: Load Style…). -->
    <button type="button" class="secondary" aria-label="Load style…" title="Load a style: QGIS .qml, OGC .sld or Mapbox GL style .json" onclick={onImport}><Icon name="import" size={14} />Load…</button>
    <span class="spacer"></span>
    <button type="button" class="icon-button" aria-label="Reset style" title="Reset to the default style" onclick={onReset}><Icon name="reset-style" /></button>
  </footer>
</div>

<style>
  section {
    display: grid;
    gap: 6px;
  }
  section + section {
    padding-top: 10px;
    border-top: 1px solid var(--se-border);
  }
  h3 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .pair {
    display: grid;
    gap: 6px;
  }
  .classifying {
    margin: 0;
    color: var(--se-text-secondary);
  }
  .panel {
    display: flex;
    flex-direction: column;
    max-height: 100%;
    width: 344px;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  /* Spec 010: inside the side panel, which has the title and the close button. */
  .panel.embedded {
    /* The side panel can be as narrow as 240 px: the renderer choice wraps (below). */
    container-type: inline-size;
    flex: 1;
    width: auto;
    min-height: 0;
    max-height: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .source-row {
    display: flex;
    flex: none;
    padding: 0 12px 4px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--se-border);
  }
  h2 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
    white-space: nowrap;
  }
  .source {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .body {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }
  .renderers {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .renderers button {
    height: 24px;
    padding: 0 4px;
    border: 0;
    border-left: 1px solid var(--se-input-border);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .renderers button:first-child {
    border-left: 0;
  }
  .expression {
    display: grid;
    gap: 3px;
  }
  .expression input {
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  .expression input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.88em;
    line-height: 1.35;
  }
  .renderers button[aria-checked='true'] {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    /* High contrast has no filled button: the active contrast border marks the choice. */
    box-shadow: inset 0 0 0 1px var(--se-selected-indicator);
  }
  .renderers button:focus-visible,
  select:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .row.field {
    grid-template-columns: 72px 1fr;
  }
  /* Clusters: one row per step (color, starting count, bubble radius). */
  .cluster-steps {
    list-style: none;
    margin: 4px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cluster-steps li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cluster-steps .from {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--se-text-secondary);
  }
  .cluster-steps .size {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--se-text-secondary);
  }
  .cluster-steps .number {
    width: 64px;
  }
  .add-step {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-link, var(--se-accent));
    font: inherit;
    font-size: 0.92em;
    cursor: pointer;
  }
  .add-step:hover {
    text-decoration: underline;
  }
  .add-step:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }

  /* Heatmap: automatic intensity, under its slider. */
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--se-text-primary);
    cursor: pointer;
  }
  .check .info {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--se-text-secondary);
    cursor: help;
  }
  .check .info:hover,
  .check .info:focus-visible {
    color: var(--se-text-primary);
  }
  .check input {
    margin: 0;
    accent-color: var(--se-button-bg);
  }
  input.number {
    justify-self: start;
    width: 96px;
    height: 24px;
    box-sizing: border-box;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  .row.field.with-action {
    grid-template-columns: 72px auto 1fr;
  }
  .auto-scale {
    justify-self: start;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .auto-scale:hover:not(:disabled) {
    background: var(--se-button-secondary-hover);
    color: var(--se-text-primary);
  }
  .auto-scale:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .auto-scale:focus-visible,
  input.number:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  @media (prefers-reduced-motion: reduce) {
    }
  /*
   * Column pickers: each option's type as a short, muted symbol before the
   * name (style/ColumnOptions.svelte). Chromium's customizable select draws
   * it (VS Code's webview, Chrome, Edge); other browsers show it as plain text.
   */
  @supports (appearance: base-select) {
    :global(select.column-select),
    :global(select.column-select::picker(select)) {
      appearance: base-select;
    }
    :global(select.column-select) {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    :global(select.column-select::picker-icon) {
      margin-left: auto;
      color: var(--se-text-secondary);
    }
    :global(select.column-select::picker(select)) {
      padding: 4px;
      border: 1px solid var(--se-menu-border);
      border-radius: var(--se-radius);
      background: var(--se-menu-bg);
      color: var(--se-menu-fg);
      box-shadow: var(--se-shadow-elevated);
    }
    :global(select.column-select option) {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 6px;
      border-radius: var(--se-radius-sm);
    }
    :global(select.column-select option:hover),
    :global(select.column-select option:focus-visible) {
      background: var(--se-menu-hover-bg);
      color: var(--se-menu-hover-fg);
      outline: none;
    }
    :global(select.column-select option::checkmark) {
      display: none;
    }
    /*
     * In the open list only: the closed picker copies the option's content, not
     * this. 123, 1.2 and Abc as text; dates, times, true/false, geometry and
     * nested values as icons (Power Query and QGIS show field types this way).
     */
    :global(select.column-select option[data-type]::before) {
      content: attr(data-type);
      flex: none;
      width: 2.6em;
      color: var(--se-text-secondary);
      font-family: var(--se-font-mono);
      font-size: 0.85em;
    }
    :global(select.column-select option[data-icon]::before) {
      content: '';
      flex: none;
      /* The text symbols' width: 2.6em at their 0.85em font size. */
      width: 2.21em;
      height: 12px;
      background-color: var(--se-text-secondary);
      mask: var(--type-icon) no-repeat left center / 12px 12px;
    }
    :global(select.column-select option[data-icon='date']) {
      --type-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='3' width='12' height='11' rx='1.5'/><path d='M2 6.5h12M5 1.5v3M11 1.5v3'/></svg>");
    }
    :global(select.column-select option[data-icon='time']) {
      --type-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><circle cx='8' cy='8' r='6'/><path d='M8 4.5V8l2.5 1.5'/></svg>");
    }
    :global(select.column-select option[data-icon='bool']) {
      --type-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><path d='M3 8.5l3 3 7-7'/></svg>");
    }
    :global(select.column-select option[data-icon='geo']) {
      --type-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><circle cx='8' cy='8' r='6'/><path d='M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12'/></svg>");
    }
    :global(select.column-select option[data-icon='nested']) {
      --type-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><path d='M6 2.5c-1.5 0-2 .7-2 2v1.5c0 1-.6 1.5-1.5 1.5.9 0 1.5.5 1.5 1.5v1.5c0 1.3.5 2 2 2M10 2.5c1.5 0 2 .7 2 2v1.5c0 1 .6 1.5 1.5 1.5-.9 0-1.5.5-1.5 1.5v1.5c0 1.3-.5 2-2 2'/></svg>");
    }
  }
  select.narrow {
    justify-self: start;
    width: 64px;
  }
  select {
    min-width: 0;
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  .link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-link, var(--se-accent));
    font: inherit;
    cursor: pointer;
  }
  .inline-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
    line-height: 1.4;
  }
  .inline-note.warning :global(.icon) {
    color: var(--se-warning);
  }
  .by-class {
    text-align: center;
    color: var(--se-text-muted);
  }
  .row {
    display: grid;
    grid-template-columns: 72px 28px 1fr 44px;
    align-items: center;
    gap: 8px;
  }
  .row .wide {
    grid-column: 2 / 4;
  }
  /* Spec 025: a name, then the control(s), at the panel's right edge. */
  .zoom-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .zoom-row .label {
    flex: 1;
    min-width: 0;
  }
  .zoom-range-value {
    text-align: right;
    white-space: nowrap;
  }
  .row .span {
    grid-column: 3 / 5;
  }
  .preview {
    display: grid;
    place-items: center;
  }
  .renderers.four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: row;
  }
  .renderers.four button:nth-child(3) {
    border-left: 0;
  }
  .renderers.four button:nth-child(n + 3) {
    border-top: 1px solid var(--se-input-border);
  }
  .renderers.two {
    grid-template-columns: repeat(2, 1fr);
  }
  .size-range {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--se-text-secondary);
  }
  .size-range input.number {
    width: 64px;
  }
  /* Marker shapes: a row of toggles, each drawn in the layer's own colors. */
  .shapes {
    grid-column: 2 / 5;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .shapes button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--se-radius-sm);
    background: transparent;
    cursor: pointer;
  }
  .shapes button:hover {
    background: var(--se-control-hover);
  }
  .shapes button[aria-checked='true'] {
    border-color: var(--se-selected-indicator, var(--se-focus));
    background: var(--se-control-hover);
  }
  .shapes button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .value {
    text-align: right;
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--se-accent);
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 12px 12px;
    padding: 6px 4px 6px 8px;
    border-left: 2px solid var(--notice-accent);
    background: color-mix(in srgb, var(--notice-accent) 12%, transparent);
    border-radius: var(--se-radius-sm);
    font-size: 0.92em;
    line-height: 1.4;
  }
  .notice > :global(.icon) {
    margin-top: 2px;
    color: var(--notice-accent);
  }
  .notice span {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .notice.info {
    --notice-accent: var(--se-info);
  }
  .notice.warning {
    --notice-accent: var(--se-warning);
  }
  .notice.error {
    --notice-accent: var(--se-error);
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 8px 12px;
    border-top: 1px solid var(--se-border);
  }
  .spacer {
    flex: 1;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .secondary:hover {
    background: var(--se-button-secondary-hover);
  }
  footer :global(button:focus-visible) {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  /* A VS Code-style toggle: a clear off state in every theme, the accent when on. */
  .switch {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    padding: 0 4px 0 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    font-weight: normal;
    cursor: pointer;
  }
  .switch:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .switch .track {
    position: relative;
    flex: none;
    box-sizing: border-box;
    width: 30px;
    height: 16px;
    border-radius: 8px;
    border: 1px solid var(--se-input-border);
    background: color-mix(in srgb, var(--se-text-secondary) 22%, var(--se-input-bg));
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }
  .switch .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--se-text-primary);
    opacity: 0.75;
    transition:
      transform 0.15s,
      opacity 0.15s;
  }
  .switch:not(:disabled):hover .track {
    border-color: var(--se-text-secondary);
  }
  .switch[aria-checked='true'] .track {
    background: var(--se-button-bg);
    border-color: var(--se-button-bg);
  }
  .switch[aria-checked='true'] .thumb {
    transform: translateX(14px);
    background: var(--se-button-fg);
    opacity: 1;
  }
  .switch .state {
    color: var(--se-text-secondary);
  }
  .switch:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch .track,
    .switch .thumb {
      transition: none;
    }
  }
</style>
