<script lang="ts">
  import ColumnOptions from './ColumnOptions.svelte'
  // Spec 009 US4 (contracts/ui.md "Style panel"): the bivariate axes (a
  // numeric column and a method each), swapping them, and the palette, shown
  // as 3x3 previews. Palette colors are fixed data colors.
  import { BIVARIATE_PALETTES, METHOD_NAMES, type BivariateAxis, type BivariateMethod, type BivariateRenderer } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'

  interface Props {
    renderer: BivariateRenderer
    /** Numeric columns of the displayed result. */
    columns: Array<{ name: string; type: string }>
    onAxis: (axis: 'x' | 'y', patch: Partial<BivariateAxis>) => void
    onSwap: () => void
    onPalette: (id: string) => void
  }
  let { renderer, columns, onAxis, onSwap, onPalette }: Props = $props()

  const METHODS: BivariateMethod[] = ['quantile', 'equal', 'jenks']
  const AXES = [
    { key: 'x', label: 'Axis 1', hint: 'Horizontal in the legend, low to high' },
    { key: 'y', label: 'Axis 2', hint: 'Vertical in the legend, low to high' },
  ] as const

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
<button type="button" class="swap" onclick={onSwap} title="Swap axis 1 and axis 2"><Icon name="swap" size={14} />Swap axes</button>

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
      <svg width="27" height="27" viewBox="0 0 27 27" aria-hidden="true">
        {#each [2, 1, 0] as j, r (j)}
          {#each [0, 1, 2] as i (i)}
            <rect x={i * 9} y={r * 9} width="9" height="9" fill={p.cells[i + 3 * j]} />
          {/each}
        {/each}
      </svg>
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
  .palettes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .palettes button {
    display: grid;
    place-items: center;
    width: 35px;
    height: 35px;
    padding: 0;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: transparent;
    cursor: pointer;
  }
  .palettes button[aria-checked='true'] {
    border: 2px solid var(--se-selected-indicator, var(--se-focus));
  }
  select:focus-visible,
  .swap:focus-visible,
  .palettes button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
