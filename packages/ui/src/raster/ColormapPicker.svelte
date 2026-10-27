<script lang="ts">
  // Spec 026 US3 (FR-008): a colormap picked from previews. A button showing the current one opens a list where every
  // colormap is a name and its gradient (sampled from the tiler itself, so the preview is what the map draws): the short
  // list first, "More colormaps" for all. Listbox pattern: arrow keys move, Enter or a click picks, Esc closes.
  import { COLORMAP_GROUPS, RASTER_COLORMAPS } from '@spatial-explorer/core'
  import { tick } from 'svelte'
  import Icon from '../Icon.svelte'

  interface Props {
    value: string
    reversed: boolean
    onChange: (name: string) => void
    /** The colors of a colormap from low to high (null: not available yet). */
    colorsFor: (name: string, reversed: boolean) => string[] | null
    /** The accessible name. */
    label: string
  }
  let { value, reversed, onChange, colorsFor, label }: Props = $props()

  let open = $state(false)
  let showAll = $state(false)
  let root = $state<HTMLDivElement>()
  let list = $state<HTMLDivElement>()
  let trigger = $state<HTMLButtonElement>()

  const featured = new Set(COLORMAP_GROUPS.flatMap((g) => g.names))
  const others = RASTER_COLORMAPS.filter((n) => !featured.has(n))
  const gradient = (name: string): string => {
    const colors = colorsFor(name, reversed)
    return colors ? `linear-gradient(to right, ${colors.join(', ')})` : 'var(--se-input-bg)'
  }

  const options = (): HTMLElement[] => [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]

  async function toggle(): Promise<void> {
    open = !open
    if (open) {
      await tick()
      ;(list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? options()[0])?.focus()
    }
  }
  function close(refocus = true): void {
    open = false
    showAll = false
    if (refocus) trigger?.focus()
  }
  function pick(name: string): void {
    onChange(name)
    close()
  }
  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    const items = options()
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }
  function outside(e: MouseEvent): void {
    if (open && root && !root.contains(e.target as Node)) close(false)
  }
</script>

<svelte:window onmousedown={outside} />

<div class="picker" bind:this={root}>
  <button type="button" class="trigger" bind:this={trigger} aria-haspopup="listbox" aria-expanded={open} aria-label="{label}: {value}" onclick={() => void toggle()}>
    <span class="strip" style:background={gradient(value)} aria-hidden="true"></span>
    <span class="name">{value}</span>
    <Icon name="chevron-down" size={14} />
  </button>
  {#if open}
    <div class="pop" onkeydown={keydown} role="presentation">
      <div role="listbox" aria-label="{label} choices" tabindex="-1" bind:this={list}>
        {#each COLORMAP_GROUPS as g (g.id)}
          <div role="group" aria-label={g.label}>
            <div class="group" aria-hidden="true">{g.label}</div>
            {#each g.names as n (n)}
              {@render option(n)}
            {/each}
          </div>
        {/each}
        {#if showAll}
          <div role="group" aria-label="More colormaps">
            <div class="group" aria-hidden="true">More</div>
            {#each others as n (n)}
              {@render option(n)}
            {/each}
          </div>
        {/if}
      </div>
      {#if !showAll}
        <button type="button" class="more" onclick={() => (showAll = true)}>More colormaps…</button>
      {/if}
    </div>
  {/if}
</div>

{#snippet option(n: string)}
  <button type="button" role="option" class="opt" class:current={n === value} aria-selected={n === value} onclick={() => pick(n)}>
    <span class="strip" style:background={gradient(n)} aria-hidden="true"></span>
    <span class="name">{n}</span>
  </button>
{/snippet}

<style>
  .picker {
    position: relative;
    min-width: 0;
  }
  .trigger,
  .opt {
    display: grid;
    grid-template-columns: 96px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .trigger:focus-visible,
  .opt:focus-visible,
  .more:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .strip {
    height: 12px;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px var(--se-border);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop {
    position: absolute;
    z-index: 30;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    max-height: 280px;
    overflow-y: auto;
    display: grid;
    gap: 1px;
    padding: 4px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
  }
  .opt {
    grid-template-columns: 96px 1fr;
    border-color: transparent;
    background: transparent;
    color: inherit;
  }
  .opt:hover,
  .opt:focus-visible {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .opt.current {
    box-shadow: inset 2px 0 0 var(--se-selected-indicator, var(--se-accent));
  }
  .group {
    padding: 6px 8px 2px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .more {
    margin-top: 4px;
    height: 26px;
    border: 0;
    background: transparent;
    color: var(--se-link);
    font: inherit;
    text-align: left;
    padding: 0 8px;
    cursor: pointer;
  }
</style>
