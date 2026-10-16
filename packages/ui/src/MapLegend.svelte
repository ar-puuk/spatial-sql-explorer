<script lang="ts">
  // On-map legend (spec 003 FR-010, contracts/ui-style-panel.md): the active
  // style's classes with swatch, label and count. Each swatch toggles that
  // class on the map (FR-009). Collapsible; the state is remembered by the
  // store. Bottom-left, above the scale bar (research §8, amended): the style
  // panel opens on the right and must not cover it, and the feature
  // inspector (top-left) is transient. Spec 011: one group per property that
  // varies, merged when properties read the same classes (core `legendGroups`).
  import { CHANNEL_NAMES, markerExtent, type ChannelId, type GeometryType, type LegendEntry, type LegendGroup, type ResolvedSizeChannel, type ResolvedStyle, type SymbolSpec } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import SymbolSwatch from './style/SymbolSwatch.svelte'
  import BivariateLegend from './style/BivariateLegend.svelte'

  interface Props {
    resolved: ResolvedStyle
    /** Column name shown when the style falls back (FR-012). */
    title: string
    /** The layer's name: a bivariate legend names its axes itself, so this is its heading. */
    layerName?: string
    geometryType: GeometryType
    collapsed: boolean
    onToggleCollapsed: () => void
    /** Bivariate cells and the single symbol's row. */
    onToggleClass: (key: string, visible: boolean) => void
    /** The single symbol (core `classSymbols`), shown when nothing varies. */
    symbols: SymbolSpec[]
    /** Spec 011: every group with classes, merged where properties share them (core `legendGroups`). */
    groups?: LegendGroup[]
    /** Hides or shows an entry: its class in every merged property. */
    onToggleEntry?: (toggles: LegendEntry['toggles'], visible: boolean) => void
    /** Spec 009 US2: proportional sizes (reference sizes, then No value), drawn to scale. */
    proportional?: { channel: ResolvedSizeChannel; symbols: SymbolSpec[] } | null
    /** Clusters: a row per step, its bubble to scale (core `clusterLegendRows`). */
    clusterRows?: Array<{ label: string; color: string; symbol: SymbolSpec }>
  }
  let { resolved, title, layerName = '', geometryType, collapsed, onToggleCollapsed, onToggleClass, symbols, groups = [], onToggleEntry = () => {}, proportional = null, clusterRows = [] }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const shape = $derived(geometryType === 'LineString' ? 'line' : geometryType === 'Point' ? 'point' : 'area')
  const heading = $derived(resolved.status === 'fallback' ? `${title} · not available` : resolved.grid ? layerName || 'Layer' : resolved.caption || 'Layer')
  // Markers keep their relative sizes; big ones shrink together to fit a row.
  const SWATCH = 22
  const reachOf = (list: SymbolSpec[]) => Math.max(1, ...list.map((s) => s.radius * markerExtent(s.shape) + Math.min(s.strokeWidth, 3) / 2))
  const sizes = (g: LegendGroup) => g.channels.includes('size') || g.channels.includes('width')
  /** Some group draws sizes: groups that don't draw their swatches at one readable size (spec 009). */
  const sizing = $derived(groups.some(sizes) || !!proportional)
  /** How a group's swatches are drawn: markers for shapes, rotation and point sizes, lines for widths and patterns. */
  function kindOf(g: LegendGroup): 'point' | 'line' | 'area' {
    if (g.channels.some((c) => c === 'shape' || c === 'rotation')) return 'point'
    if (g.channels.some((c) => c === 'width' || c === 'dash')) return 'line'
    if (g.channels.includes('size')) return geometryType === 'Point' ? 'point' : 'line'
    return shape
  }
  function shown(g: LegendGroup): SymbolSpec[] {
    const list = g.entries.map((e) => e.symbol)
    return sizing && !sizes(g) ? list.map((s) => ({ ...s, lineWidth: Math.max(s.lineWidth, 3), radius: Math.max(s.radius, 5) })) : list
  }
  /** "class", "size class", "shape class": what the toggle names, after the group's first property. */
  const noun = (c: ChannelId) => (c === 'color' ? 'class' : `${CHANNEL_NAMES[c].toLowerCase()} class`)
  const single = $derived(!resolved.grid && !resolved.heat && !resolved.clusters && !groups.length && !proportional && resolved.classes.length === 1 && resolved.classes[0].kind === 'single')
  const singleSwatch = $derived(shape === 'point' ? Math.min(SWATCH, Math.max(16, Math.ceil(2 * reachOf(symbols) * Math.min(1, (SWATCH / 2 - 1) / reachOf(symbols)) + 2))) : 18)
  const propReach = $derived(reachOf(proportional?.symbols ?? []))
  const propKind = $derived<'point' | 'line'>(geometryType === 'Point' ? 'point' : 'line')
</script>

<section class="legend" class:open={!collapsed} aria-label="Legend" style:--swatch-size="{SWATCH}px">
  <button type="button" class="head" aria-expanded={!collapsed} onclick={onToggleCollapsed} title={heading}>
    <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={12} />
    <span class="caption">{heading}</span>
  </button>
  {#if !collapsed}
    {#if resolved.status === 'fallback'}
      <p class="reason">{resolved.reason} Showing the single symbol.</p>
    {/if}
    {#if resolved.grid && resolved.status === 'ok'}
      <!-- Spec 009 US4: the bivariate square. -->
      <div role="group" aria-label={heading} class="group">
        <BivariateLegend {resolved} onToggle={onToggleClass} />
      </div>
    {:else if resolved.heat && resolved.status === 'ok'}
      <!-- A heatmap: the ramp from sparse to dense, and how many points make it. -->
      {@const points = resolved.classes[0]?.count ?? 0}
      <div role="group" aria-label={heading} class="group heat">
        <div class="heat-ramp" role="img" aria-label="Colors from sparse to dense" style:background="linear-gradient(to right, transparent, {resolved.heat.colors.join(', ')})"></div>
        <div class="heat-ends">
          <span>Sparse</span>
          <span class="count">{nf.format(points)} {points === 1 ? 'point' : 'points'}</span>
          <span>Dense</span>
        </div>
      </div>
    {:else if resolved.clusters && resolved.status === 'ok' && clusterRows.length}
      <!-- Clusters: the bubbles, smallest groups first, then the points not in a group. -->
      {@const points = resolved.classes[0]}
      <div role="group" aria-label={heading} class="group">
        <ul>
          {#each clusterRows as row (row.label)}
            <li>
              <span class="swatch"><SymbolSwatch symbol={row.symbol} kind="point" size={SWATCH} /></span>
              <span class="label" title={row.label}>{row.label}</span>
            </li>
          {/each}
          {#if points}
            <li>
              <span class="swatch" style:--swatch={points.color}><SymbolSwatch symbol={symbols[0]} kind="point" scale={Math.min(1, (SWATCH / 2 - 1) / reachOf(symbols))} size={singleSwatch} /></span>
              <span class="label" title={points.label}>{points.label}</span>
            </li>
          {/if}
        </ul>
      </div>
    {:else if single}
      <!-- Nothing varies: the single symbol's row. -->
      <div role="group" aria-label={heading} class="group">
        <ul>
          <li>
            <span class="swatch" style:--swatch={resolved.classes[0].color}><SymbolSwatch symbol={symbols[0]} kind={shape} scale={Math.min(1, (SWATCH / 2 - 1) / reachOf(symbols))} size={singleSwatch} /></span>
            <span class="label" title={resolved.classes[0].label}>{resolved.classes[0].label}</span>
            <span class="count">{nf.format(resolved.classes[0].count)}</span>
          </li>
        </ul>
      </div>
    {/if}
    <!-- Spec 009/011: one group per property, merged where they read the same classes (contracts/ui.md "Legend"). -->
    {#each groups as g, gi (g.key)}
      {@const kind = kindOf(g)}
      {@const list = shown(g)}
      {@const sc = Math.min(1, (SWATCH / 2 - 1) / reachOf(list))}
      <!-- The color's classes are the layer's own (the heading names them); a continuous or as-is color has its own title. -->
      {@const ownTitle = !(gi === 0 && g.channels[0] === 'color') || !!g.gradient || !!g.note}
      {@const label = ownTitle ? g.title : heading}
      {#if ownTitle}
        <h2 class="group-title" title={g.title}>{g.title}</h2>
      {/if}
      <div role="group" aria-label={label} class="group" data-channels={g.channels.join(' ')}>
        {#if g.gradient}
          <!-- Spec 011 US4: a continuous color, as its ramp from the smallest value to the largest. -->
          <div class="heat-ramp" role="img" aria-label="{g.title}: colors from {g.gradient.min} to {g.gradient.max}" style:background="linear-gradient(to right, {g.gradient.stops.join(', ')})"></div>
          <div class="heat-ends"><span>{g.gradient.min}</span><span>{g.gradient.max}</span></div>
        {/if}
        {#if g.note}<p class="group-note">{g.note}</p>{/if}
        <ul>
          {#each g.entries as e, i (e.key)}
            {#if !e.toggles.length}
              <!-- Spec 011 US4: a continuous property's sample: drawn, not a class to hide. -->
              <li>
                <span class="swatch"><SymbolSwatch symbol={list[i]} {kind} scale={sc} size={kind === 'point' ? SWATCH : 18} /></span>
                <span class="label" title={e.label}>{e.label}</span>
                <span class="count"></span>
              </li>
            {:else}
            <li class:hidden={!e.visible}>
              <button
                type="button"
                class="swatch"
                style:--swatch={g.channels[0] === 'color' ? e.symbol.fillColor : undefined}
                aria-pressed={!e.visible}
                aria-label={`${e.visible ? 'Hide' : 'Show'} ${noun(g.channels[0])} ${e.label}`}
                title={e.visible ? 'Hide this class on the map' : 'Show this class on the map'}
                onclick={() => onToggleEntry(e.toggles, !e.visible)}
              >
                <SymbolSwatch symbol={list[i]} {kind} scale={sc} size={kind === 'point' ? SWATCH : 18} hollow={!e.visible} />
              </button>
              <span class="label" title={e.label}>{e.label}</span>
              <span class="count">{nf.format(e.count)}</span>
            </li>
            {/if}
          {/each}
        </ul>
      </div>
    {/each}
    {#if proportional}
      {@const sc = Math.min(1, (SWATCH / 2 - 1) / propReach)}
      <h2 class="group-title" title={proportional.channel.caption}>{proportional.channel.caption}</h2>
      <div role="group" aria-label={proportional.channel.caption} class="group">
        <ul>
          <!-- Spec 009 US2: proportional reference sizes, smallest first; not classes, so not toggles. -->
          {#each proportional.channel.samples ?? [] as sample, i (sample.value)}
            <li>
              <span class="swatch"><SymbolSwatch symbol={proportional.symbols[i]} kind={propKind} scale={sc} size={propKind === 'point' ? SWATCH : SWATCH} /></span>
              <span class="label">{sample.label}</span>
              <span class="count"></span>
            </li>
          {/each}
          {#each proportional.channel.classes as c, i (c.key)}
            <li class:hidden={!c.visible}>
              <button
                type="button"
                class="swatch"
                aria-pressed={!c.visible}
                aria-label={`${c.visible ? 'Hide' : 'Show'} size class ${c.label}`}
                title={c.visible ? 'Hide this class on the map' : 'Show this class on the map'}
                onclick={() => onToggleClass(c.key, !c.visible)}
              >
                <SymbolSwatch symbol={proportional.symbols[(proportional.channel.samples?.length ?? 0) + i]} kind={propKind} scale={sc} size={SWATCH} hollow={!c.visible} />
              </button>
              <span class="label" title={c.label}>{c.label}</span>
              <span class="count">{nf.format(c.count)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

<style>
  /* Spec 014: a stack item in whichever corner the user put it; the corner bounds its height. */
  .legend {
    display: flex;
    flex-direction: column;
    min-width: 160px;
    max-width: min(300px, 100%);
    max-height: 100%;
    /* It gives way when the column is short: the list scrolls, nothing else spills out of the box. */
    min-height: 0;
    overflow: hidden;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  /* Open, it keeps room for its title and a few rows, so it is never a sliver; the tools above it make way (MapView fitPalette). */
  .legend.open {
    min-height: min(72px, 100%);
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 5px 8px;
    border: 0;
    background: transparent;
    color: var(--se-section-title-fg);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .caption {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reason {
    margin: 0 8px 4px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  /* Spec 009: one group per channel; the group, not the list, takes the space. */
  .group {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  ul {
    margin: 0;
    padding: 0 6px 6px;
    overflow-y: auto;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: var(--swatch-size, 18px) 1fr auto;
    align-items: center;
    gap: 8px;
    min-height: 22px;
    padding: 0 2px;
  }
  li.hidden .label,
  li.hidden .count {
    opacity: 0.5;
  }
  .swatch {
    display: grid;
    place-items: center;
    justify-self: center;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: transparent;
  }
  button.swatch {
    cursor: pointer;
  }
  .heat {
    gap: 3px;
    padding: 2px 8px 8px;
  }
  .heat-ramp {
    height: 12px;
    border: 1px solid var(--se-control-border);
    border-radius: 2px;
  }
  .heat-ends {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  /* Spec 011 US4: a continuous color's bar, and an as-is property's line, inside a property's group. */
  .group:not(.heat) > .heat-ramp,
  .group:not(.heat) > .heat-ends {
    margin: 2px 8px 0;
  }
  .group-note {
    margin: 0 8px 4px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .group-title {
    margin: 4px 8px 2px;
    overflow: hidden;
    font: inherit;
    font-weight: 600;
    color: var(--se-section-title-fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  .head:focus-visible,
  button.swatch:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
