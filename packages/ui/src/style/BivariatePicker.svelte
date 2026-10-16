<script lang="ts">
  import ColumnOptions from './ColumnOptions.svelte'
  // Spec 009 US4 (contracts/ui.md "Style panel"): the bivariate axes (a
  // numeric column and a method each), swapping them, and the palette, shown
  // as 3x3 previews (other grid sizes read the same colors). Palette colors are fixed data colors.
  import { BIVARIATE_CLASS_COUNTS, BIVARIATE_PALETTES, METHOD_NAMES, type BivariateAxis, type BivariateMethod, type BivariateRenderer } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'

  interface Props {
    renderer: BivariateRenderer
    /** Numeric columns of the displayed result. */
    columns: Array<{ name: string; type: string }>
    onAxis: (axis: 'x' | 'y', patch: Partial<BivariateAxis>) => void
    onSwap: () => void
    /** The legend as a diamond (true) or a square. */
    onTilted: (tilted: boolean) => void
    onPalette: (id: string) => void
  }
  let { renderer, columns, onAxis, onSwap, onTilted, onPalette }: Props = $props()

  const METHODS: BivariateMethod[] = ['quantile', 'equal', 'jenks']
  const AXES = [
    { key: 'x', label: 'Axis 1', hint: 'Horizontal in the legend, low to high' },
    { key: 'y', label: 'Axis 2', hint: 'Vertical in the legend, low to high' },
  ] as const

  const chosen = $derived(BIVARIATE_PALETTES.find((p) => p.id === renderer.palette) ?? BIVARIATE_PALETTES[0])

  function paletteKeydown(e: KeyboardEvent): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = BIVARIATE_PALETTES.findIndex((p) => p.id === renderer.palette)
    const next = BIVARIATE_PALETTES[(Math.max(0, i) + dir + BIVARIATE_PALETTES.length) % BIVARIATE_PALETTES.length]
    onPalette(next.id)
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-palette="${next.id}"]`)?.focus())
  }
</script>

{#each AXES as a (a.key)}
  {@const axis = renderer[a.key]}
  <div class="axis">
    <span class="label" title={a.hint}>{a.label}</span>
    <select class="column-select" aria-label={a.label} title={a.hint} value={axis.column} onchange={(e) => onAxis(a.key, { column: e.currentTarget.value })}>
      {#if !columns.some((c) => c.name === axis.column)}
        <option value={axis.column}>{axis.column || 'Choose…'}</option>
      {/if}
      <ColumnOptions columns={columns} />
    </select>
    <select class="method" aria-label="{a.label} method" value={axis.method} onchange={(e) => onAxis(a.key, { method: e.currentTarget.value as BivariateMethod })}>
      {#each METHODS as m (m)}
        <option value={m}>{m === 'jenks' ? 'Natural breaks' : METHOD_NAMES[m]}</option>
      {/each}
    </select>
  </div>
{/each}
<div class="axis counts">
  <span class="label" title="How many classes each axis has: the grid is axis 1 by axis 2. Unequal counts (2 by 3, 3 by 4) suit measures of different character.">Classes</span>
  <span class="count-pair">
    {#each AXES as a (a.key)}
      <select aria-label="{a.label} classes" value={String(renderer[a.key].classes ?? 3)} onchange={(e) => onAxis(a.key, { classes: Number(e.currentTarget.value) })}>
        {#each BIVARIATE_CLASS_COUNTS as n (n)}
          <option value={String(n)}>{a.label}: {n}</option>
        {/each}
      </select>
    {/each}
  </span>
</div>
<div class="axis counts">
  <span class="label" title="The legend's shape, on the map and on a printed page. The diamond puts the two axes along its lower edges.">Legend</span>
  <span class="count-pair">
    <select aria-label="Legend shape" value={renderer.tilted ? 'tilted' : 'square'} onchange={(e) => onTilted(e.currentTarget.value === 'tilted')}>
      <option value="square">Square</option>
      <option value="tilted">Tilted (diamond)</option>
    </select>
  </span>
</div>
<button type="button" class="swap" onclick={onSwap} title="Swap axis 1 and axis 2"><Icon name="swap" size={14} />Swap axes</button>

{#if chosen}
  <p class="palette-name">{chosen.name}{#if chosen.note}<span class="note">{chosen.note}</span>{/if}</p>
{/if}
<div class="palettes" role="radiogroup" aria-label="Bivariate palette">
  {#each BIVARIATE_PALETTES as p (p.id)}
    <button
      type="button"
      role="radio"
      data-palette={p.id}
      aria-checked={renderer.palette === p.id}
      tabindex={renderer.palette === p.id ? 0 : -1}
      aria-label={p.name}
      title={p.note ? `${p.name}. ${p.note}` : p.name}
      onclick={() => onPalette(p.id)}
      onkeydown={paletteKeydown}
    >
      <!-- The same grid as the legend: touching cells, a hairline between them (spec 015). -->
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        {#each [2, 1, 0] as j, r (j)}
          {#each [0, 1, 2] as i (i)}
            <rect x={i * 12} y={r * 12} width="12" height="12" fill={p.cells[i + 3 * j]} stroke="rgba(255,255,255,0.55)" stroke-width="1" />
          {/each}
        {/each}
      </svg>
      {#if renderer.palette === p.id}<span class="tick"><Icon name="check" size={11} /></span>{/if}
    </button>
  {/each}
</div>

<style>
  .axis {
    display: grid;
    grid-template-columns: 72px 1fr 92px;
    align-items: center;
    gap: 6px;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .counts {
    grid-template-columns: 72px 1fr;
  }
  .count-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
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
  .swap {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 4px;
    height: 24px;
    margin-left: 78px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .swap:hover {
    background: var(--se-button-secondary-hover);
  }
  .palette-name {
    margin: 2px 0 0;
    font-weight: 600;
  }
  .note {
    margin-left: 8px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
    font-weight: 400;
  }
  .palettes {
    display: grid;
    grid-template-columns: repeat(auto-fill, 44px);
    gap: 6px;
  }
  .palettes button {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--se-radius);
    background: transparent;
    cursor: pointer;
  }
  .palettes button:hover {
    background: var(--se-control-hover);
  }
  .palettes svg {
    display: block;
    border: 1px solid color-mix(in srgb, var(--se-text-primary) 20%, transparent);
  }
  .palettes button[aria-checked='true'] {
    border-color: var(--se-accent);
    box-shadow: 0 0 0 1px var(--se-accent);
  }
  .tick {
    position: absolute;
    right: -4px;
    top: -4px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--se-accent);
    color: var(--se-button-fg);
  }
  select:focus-visible,
  .swap:focus-visible,
  .palettes button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
