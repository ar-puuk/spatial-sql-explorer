<script lang="ts">
  // On-map legend (spec 003 FR-010, contracts/ui-style-panel.md): the active
  // style's classes with swatch, label and count. Each swatch toggles that
  // class on the map (FR-009). Collapsible; the state is remembered by the
  // store. Bottom-left, above the scale bar (research §8, amended): the style
  // panel opens on the right and must not cover it, and the feature
  // inspector (top-left) is transient.
  import { markerExtent, type GeometryType, type ResolvedSizeChannel, type ResolvedStyle, type SymbolSpec } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import SymbolSwatch from './style/SymbolSwatch.svelte'

  interface Props {
    resolved: ResolvedStyle
    /** Column name shown when the style falls back (FR-012). */
    title: string
    geometryType: GeometryType
    collapsed: boolean
    onToggleCollapsed: () => void
    onToggleClass: (key: string, visible: boolean) => void
    /** Each class's symbol (core `classSymbols`), so swatches look like the map: color, opacity, shape, size, pattern. */
    symbols: SymbolSpec[]
    /** Spec 009: the size channel's group: its classes and their symbols (core `sizeSymbols`), drawn to scale. */
    size?: { channel: ResolvedSizeChannel; symbols: SymbolSpec[] } | null
  }
  let { resolved, title, geometryType, collapsed, onToggleCollapsed, onToggleClass, symbols, size = null }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const shape = $derived(geometryType === 'LineString' ? 'line' : geometryType === 'Point' ? 'point' : 'area')
  const heading = $derived(resolved.status === 'fallback' ? `${title} · not available` : resolved.caption || 'Layer')
  // Markers keep their relative sizes; big ones shrink together to fit a row.
  const SWATCH = 22
  // Each group has its own scale: color swatches stay one readable size, size swatches keep their proportions.
  const reachOf = (list: SymbolSpec[]) => Math.max(1, ...list.map((s) => s.radius * markerExtent(s.shape) + Math.min(s.strokeWidth, 3) / 2))
  const reach = $derived(reachOf(symbols))
  const sizeReach = $derived(reachOf(size?.symbols ?? []))
  const sizeScale = $derived(Math.min(1, (SWATCH / 2 - 1) / sizeReach))
  const scale = $derived(Math.min(1, (SWATCH / 2 - 1) / reach))
  const swatchSize = $derived(shape === 'point' ? Math.min(SWATCH, Math.max(16, Math.ceil(2 * reach * scale + 2))) : 18)
  // Size rows: markers to scale on point layers, line widths on line and mixed layers.
  const sizeKind = $derived<'point' | 'line'>(geometryType === 'Point' ? 'point' : 'line')
  const sizeSwatch = $derived(sizeKind === 'point' ? Math.min(SWATCH, Math.max(16, Math.ceil(2 * sizeReach * sizeScale + 2))) : SWATCH)
</script>

<section class="legend" aria-label="Legend" style:--swatch-size="{swatchSize}px">
  <button type="button" class="head" aria-expanded={!collapsed} onclick={onToggleCollapsed} title={heading}>
    <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={12} />
    <span class="caption">{heading}</span>
  </button>
  {#if !collapsed}
    {#if resolved.status === 'fallback'}
      <p class="reason">{resolved.reason} Showing the single symbol.</p>
    {/if}
    <!-- Spec 009: one group per channel (contracts/ui.md "Legend"). -->
    <div role="group" aria-label={heading} class="group">
    <ul>
      {#each resolved.classes as c, i (c.key)}
        <li class:hidden={!c.visible}>
          {#if c.kind === 'single'}
            <span class="swatch" style:--swatch={c.color}><SymbolSwatch symbol={symbols[i]} kind={shape} {scale} size={swatchSize} /></span>
          {:else}
            <button
              type="button"
              class="swatch"
              style:--swatch={c.color}
              aria-pressed={!c.visible}
              aria-label={`${c.visible ? 'Hide' : 'Show'} class ${c.label}`}
              title={c.visible ? 'Hide this class on the map' : 'Show this class on the map'}
              onclick={() => onToggleClass(c.key, !c.visible)}
            >
              <SymbolSwatch symbol={symbols[i]} kind={shape} {scale} size={swatchSize} hollow={!c.visible} />
            </button>
          {/if}
          <span class="label" title={c.label}>{c.label}</span>
          <span class="count">{nf.format(c.count)}</span>
        </li>
      {/each}
    </ul>
    </div>
    {#if size}
      <h4 class="group-title" title={size.channel.caption}>{size.channel.caption}</h4>
      <div role="group" aria-label={size.channel.caption} class="group">
      <ul>
        <!-- Spec 009 US2: proportional reference sizes, smallest first; not classes, so not toggles. -->
        {#each size.channel.samples ?? [] as sample, i (sample.value)}
          <li>
            <span class="swatch"><SymbolSwatch symbol={size.symbols[i]} kind={sizeKind} scale={sizeScale} size={sizeSwatch} /></span>
            <span class="label">{sample.label}</span>
            <span class="count"></span>
          </li>
        {/each}
        {#each size.channel.classes as c, i (c.key)}
          <li class:hidden={!c.visible}>
            <button
              type="button"
              class="swatch"
              style:--swatch={c.color}
              aria-pressed={!c.visible}
              aria-label={`${c.visible ? 'Hide' : 'Show'} size class ${c.label}`}
              title={c.visible ? 'Hide this class on the map' : 'Show this class on the map'}
              onclick={() => onToggleClass(c.key, !c.visible)}
            >
              <SymbolSwatch symbol={size.symbols[(size.channel.samples?.length ?? 0) + i]} kind={sizeKind} scale={sizeScale} size={sizeSwatch} hollow={!c.visible} />
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
  .legend {
    position: absolute;
    left: 10px;
    bottom: calc(var(--se-map-bottom-inset, 0px) + 34px);
    z-index: 5;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    max-width: min(300px, calc(100% - 20px));
    max-height: calc(100% - 90px - var(--se-map-bottom-inset, 0px));
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .head {
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
