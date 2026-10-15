<script lang="ts">
  // Spec 009 US4 (contracts/ui.md "Legend"): the bivariate square. A keyboard
  // grid of cells (rows from high to low, so axis 2 reads bottom to top), each
  // a toggle that hides its features; arrow keys move one cell at a time
  // (roving tabindex); "No value" below. Palette colors are fixed data colors;
  // the chrome follows the theme.
  import type { ResolvedStyle } from '@spatial-explorer/core'

  interface Props {
    resolved: ResolvedStyle
    onToggle: (key: string, visible: boolean) => void
    /** Cell size, px. */
    cell?: number
  }
  let { resolved, onToggle, cell = 22 }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const grid = $derived(resolved.grid)
  const nx = $derived(grid?.x.ranges.length ?? 0)
  const ny = $derived(grid?.y.ranges.length ?? 0)
  const cells = $derived(resolved.classes.filter((c) => c.kind === 'cell'))
  const noValue = $derived(resolved.classes.find((c) => c.kind === 'noValue'))
  /** Rows top to bottom: the highest axis 2 class first. */
  const rows = $derived(Array.from({ length: ny }, (_, r) => ny - 1 - r))
  const cellAt = (i: number, j: number) => cells.find((c) => c.col === i && c.row === j)
  const features = (n: number) => `${nf.format(n)} ${n === 1 ? 'feature' : 'features'}`
  const name = (c: (typeof cells)[number]) =>
    `${grid?.x.column} ${grid?.x.ranges[c.col ?? 0]?.label}, ${grid?.y.column} ${grid?.y.ranges[c.row ?? 0]?.label}: ${features(c.count)}`

  /** The one cell in the tab order (roving tabindex). */
  let focusKey = $state<string | null>(null)
  const tabKey = $derived(focusKey && cells.some((c) => c.key === focusKey) ? focusKey : (cells[0]?.key ?? null))
  let root = $state<HTMLDivElement>()

  function keydown(e: KeyboardEvent, i: number, j: number): void {
    const move: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    const d = move[e.key]
    if (!d) return
    e.preventDefault()
    const ni = Math.min(nx - 1, Math.max(0, i + d[0]))
    const nj = Math.min(ny - 1, Math.max(0, j + d[1]))
    const next = cellAt(ni, nj)
    if (!next) return
    focusKey = next.key
    root?.querySelector<HTMLElement>(`[data-cell="${next.key}"]`)?.focus()
  }
</script>

{#if grid}
  <div class="bivariate" bind:this={root} style:--cell="{cell}px">
    <span class="y-axis" title={grid.y.column}><span aria-hidden="true">↑</span> {grid.y.column}</span>
    <div class="square" role="grid" aria-label="Bivariate cells">
      {#each rows as j (j)}
        <div class="row" role="row">
          {#each Array.from({ length: nx }, (_, i) => i) as i (i)}
            {@const c = cellAt(i, j)}
            {#if c}
              <div role="gridcell">
                <button
                  type="button"
                  class="cell"
                  class:hidden={!c.visible}
                  data-cell={c.key}
                  style:background-color={c.visible ? c.color : 'transparent'}
                  style:border-color={c.color}
                  tabindex={c.key === tabKey ? 0 : -1}
                  aria-pressed={!c.visible}
                  aria-label={name(c)}
                  title={name(c)}
                  onfocus={() => (focusKey = c.key)}
                  onclick={() => onToggle(c.key, !c.visible)}
                  onkeydown={(e) => keydown(e, i, j)}
                ></button>
              </div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
    <span class="x-axis" title={grid.x.column}>{grid.x.column} <span aria-hidden="true">→</span></span>
    {#if noValue}
      <button
        type="button"
        class="no-value"
        class:hidden={!noValue.visible}
        aria-pressed={!noValue.visible}
        aria-label={`${noValue.label}: ${features(noValue.count)}`}
        title={noValue.visible ? 'Hide features with no value' : 'Show features with no value'}
        onclick={() => onToggle(noValue.key, !noValue.visible)}
      >
        <span class="swatch" style:background-color={noValue.visible ? noValue.color : 'transparent'} style:border-color={noValue.color} aria-hidden="true"></span>
        <span class="label">{noValue.label}</span>
        <span class="count">{nf.format(noValue.count)}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .bivariate {
    --gap: 2px;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'y y'
      'square .'
      'x x'
      'nv nv';
    align-items: center;
    gap: 2px 6px;
    padding: 2px 8px 6px;
    font-size: 0.92em;
  }
  /* Axis 2 reads upward: its label sits above the square, horizontal, so long names fit. */
  .y-axis {
    grid-area: y;
    overflow: hidden;
    color: var(--se-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x-axis {
    grid-area: x;
    overflow: hidden;
    color: var(--se-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The cells are square tiles with one gap, the same between rows and between columns (as in ArcGIS Pro's bivariate
     legend and mapgl's). The cell wrappers are blocks with no line box, or the row gap would grow by the text's descender. */
  .square {
    grid-area: square;
    display: grid;
    gap: var(--gap);
  }
  .row {
    display: flex;
    gap: var(--gap);
  }
  [role='gridcell'] {
    display: block;
    line-height: 0;
  }
  .cell {
    display: block;
    width: var(--cell);
    height: var(--cell);
    padding: 0;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: pointer;
  }
  /* Hidden: hollow, the color kept as its outline. */
  .cell.hidden {
    border-width: 2px;
  }
  .cell:focus-visible,
  .no-value:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 1px;
  }
  .no-value {
    grid-area: nv;
    display: grid;
    grid-template-columns: 14px 1fr auto;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .no-value .swatch {
    width: 12px;
    height: 12px;
    border: 1px solid transparent;
    border-radius: 2px;
  }
  .no-value.hidden .swatch {
    border-width: 2px;
  }
  .no-value.hidden .label,
  .no-value.hidden .count {
    opacity: 0.5;
  }
  .count {
    font-family: var(--se-font-mono);
    color: var(--se-text-secondary);
  }
</style>
