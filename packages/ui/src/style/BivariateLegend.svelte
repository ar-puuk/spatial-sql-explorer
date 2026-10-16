<script lang="ts">
  // Spec 009 US4 (contracts/ui.md "Legend"): the bivariate square. A keyboard
  // grid of cells (rows from high to low, so axis 2 reads bottom to top), each
  // a toggle that hides its features; arrow keys move one cell at a time
  // (roving tabindex); "No value" below. Palette colors are fixed data colors;
  // the chrome follows the theme.
  import type { ResolvedStyle } from '@spatial-explorer/core'
  import { axisEnds } from './axisEnds.js'

  interface Props {
    resolved: ResolvedStyle
    onToggle: (key: string, visible: boolean) => void
    /** Cell size, px. */
    cell?: number
  }
  let { resolved, onToggle, cell = 32 }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const grid = $derived(resolved.grid)
  /** The style's choice: a diamond, the grid turned a quarter-turn and a half, its axes along the two lower edges. */
  const tilted = $derived(!!resolved.grid?.tilted)
  const nx = $derived(grid?.x.ranges.length ?? 0)
  const ny = $derived(grid?.y.ranges.length ?? 0)
  const cells = $derived(resolved.classes.filter((c) => c.kind === 'cell'))
  const noValue = $derived(resolved.classes.find((c) => c.kind === 'noValue'))
  /** Rows top to bottom: the highest axis 2 class first. */
  const rows = $derived(Array.from({ length: ny }, (_, r) => ny - 1 - r))
  const cellAt = (i: number, j: number) => cells.find((c) => c.col === i && c.row === j)
  const xEnds = $derived(grid ? axisEnds(grid.x.ranges) : undefined)
  const yEnds = $derived(grid ? axisEnds(grid.y.ranges) : undefined)
  /** A diamond's cells are smaller: it is as wide as both sides of the grid together. */
  const size = $derived(tilted ? Math.max(18, Math.round(cell * 0.72)) : cell)
  const W = $derived(nx * size + 2)
  const H = $derived(ny * size + 2)
  /** The diamond's side-to-side extent, and its center in the box that holds it (room for the labels along the lower edges). */
  const ROOM = 24
  const side = $derived((W + H) / Math.SQRT2)
  const K = Math.SQRT1_2
  /** An axis label along a lower edge: `offset` px out from the edge, turned to run along it. */
  function along(axis: 'x' | 'y', offset: number): string {
    const cx = ROOM + side / 2
    const cy = side / 2
    const x = axis === 'x' ? cx + (K * H) / 2 + offset * K : cx - (K * W) / 2 - offset * K
    const y = axis === 'x' ? cy + (K * H) / 2 + offset * K : cy + (K * W) / 2 + offset * K
    return `left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${axis === 'x' ? -45 : 45}deg)`
  }
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

{#snippet gridOfCells()}
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
                style:border-color={c.visible ? undefined : c.color}
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
{/snippet}

{#if grid}
  <div class="bivariate" class:tilted bind:this={root} style:--cell="{size}px" style:--cols={nx} style:--rows={ny}>
    {#if tilted}
      <!-- The diamond: the grid turned, with each axis named along a lower edge (its ends close to the edge, its name beyond). -->
      <div class="diamond" style:width="{side + ROOM * 2}px" style:height="{side + 30}px">
        <div class="turned" style:left="{ROOM + side / 2 - W / 2}px" style:top="{side / 2 - H / 2}px">{@render gridOfCells()}</div>
        {#if xEnds}<span class="edge small" style={along('x', 11)}>{xEnds[0]} → {xEnds[1]}</span>{/if}
        <span class="edge" style={along('x', 24)} title={grid.x.column}>{grid.x.column} →</span>
        {#if yEnds}<span class="edge small" style={along('y', 11)}>{yEnds[0]} → {yEnds[1]}</span>{/if}
        <span class="edge" style={along('y', 24)} title={grid.y.column}>← {grid.y.column}</span>
      </div>
    {:else}
      <span class="y-axis" title={grid.y.column}>{grid.y.column} <span aria-hidden="true">→</span></span>
      {#if yEnds}<span class="y-ends" aria-hidden="true"><span>{yEnds[0]}</span><span>{yEnds[1]}</span></span>{/if}
      {@render gridOfCells()}
      {#if xEnds}<span class="x-ends" aria-hidden="true"><span>{xEnds[0]}</span><span>{xEnds[1]}</span></span>{/if}
      <span class="x-axis" title={grid.x.column}>{grid.x.column} <span aria-hidden="true">→</span></span>
    {/if}
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
  /* After mapgl's bivariate legend (R package, add_bivariate_legend): square cells that touch, a hairline between them,
     one thin outline round the grid; the second axis' title runs up the left side, the first one's runs along the
     bottom. Both at 11 px in the secondary color. */
  .bivariate {
    --line: color-mix(in srgb, var(--se-bg-elevated) 55%, transparent);
    display: grid;
    grid-template-columns: auto auto auto;
    grid-template-areas:
      'y ye square'
      '. . xe'
      '. . x'
      'nv nv nv';
    justify-content: start;
    align-items: center;
    justify-items: center;
    gap: 6px;
    padding: 4px 8px 8px;
    font-size: 0.92em;
  }
  .y-axis {
    grid-area: y;
    max-height: calc(var(--cell) * var(--rows) + 2px);
    overflow: hidden;
    color: var(--se-text-secondary);
    font-size: 11px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
  .x-axis {
    grid-area: x;
    max-width: calc(var(--cell) * var(--cols) + 2px);
    overflow: hidden;
    color: var(--se-text-secondary);
    font-size: 11px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The ends of each axis, small, along the grid: the lowest value first (at the left, and at the bottom). */
  .x-ends {
    grid-area: xe;
    display: flex;
    justify-content: space-between;
    width: calc(var(--cell) * var(--cols) + 2px);
    margin-top: -3px;
    color: var(--se-text-secondary);
    font-size: 10px;
  }
  .y-ends {
    grid-area: ye;
    display: flex;
    justify-content: space-between;
    height: calc(var(--cell) * var(--rows) + 2px);
    color: var(--se-text-secondary);
    font-size: 10px;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
  .diamond {
    grid-column: 1 / -1;
    grid-row: 1 / 4;
    position: relative;
    justify-self: start;
  }
  .turned {
    position: absolute;
    transform: rotate(-45deg);
  }
  .edge {
    position: absolute;
    white-space: nowrap;
    color: var(--se-text-primary);
    font-size: 11px;
  }
  .edge.small {
    color: var(--se-text-secondary);
    font-size: 10px;
  }
  .square {
    grid-area: square;
    display: grid;
    gap: 0;
    border: 1px solid color-mix(in srgb, var(--se-text-primary) 20%, transparent);
  }
  .row {
    display: flex;
  }
  [role='gridcell'] {
    display: block;
    line-height: 0;
  }
  .cell {
    display: block;
    box-sizing: border-box;
    width: var(--cell);
    height: var(--cell);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 0;
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
    justify-self: stretch;
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
