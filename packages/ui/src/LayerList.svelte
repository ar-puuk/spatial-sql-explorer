<script lang="ts">
  // Spec 008 FR-015/FR-016 (contracts/ui.md "Layers"): the layers of a file
  // holding several (GeoPackage), with geometry type and feature count. The
  // selected option is the layer shown; Enter or a click switches. Shown
  // only for multi-layer files. Collapsible to its header.
  import Icon from './Icon.svelte'

  interface Props {
    layers: ReadonlyArray<{ name: string; geometryType: string | null; featureCount: number | null }>
    active: string | null
    busy: boolean
    onSwitch: (name: string) => void
  }
  let { layers, active, busy, onSwitch }: Props = $props()

  let collapsed = $state(false)
  let cursor = $state(0)
  const nf = new Intl.NumberFormat('en-US')
  const describe = (l: (typeof layers)[number]): string =>
    `${l.geometryType ?? 'table'}${l.featureCount !== null ? `, ${nf.format(l.featureCount)}` : ''}`

  $effect(() => {
    const i = layers.findIndex((l) => l.name === active)
    if (i >= 0) cursor = i
  })

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : layers.length - 1)) % layers.length
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      cursor = e.key === 'Home' ? 0 : layers.length - 1
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!busy) onSwitch(layers[cursor].name)
    }
  }
</script>

<section class="layer-list" aria-label="File layers">
  <button type="button" class="head" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
    <Icon name="layers" size={14} />
    <span class="status" role="status">This file has {layers.length} layers.</span>
    <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} />
  </button>
  {#if !collapsed}
    <ul

      role="listbox"
      aria-label="Layers in this file"
      tabindex="0"
      aria-busy={busy}
      aria-activedescendant={`file-layer-${cursor}`}
      onkeydown={keydown}
    >
      {#each layers as l, i (l.name)}
        <!-- Keys are handled on the listbox (aria-activedescendant pattern). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`file-layer-${i}`}
          role="option"
          aria-selected={l.name === active}
          aria-label={`${l.name}, ${describe(l)}`}
          class:cursor={i === cursor}
          onclick={() => {
            cursor = i
            if (!busy) onSwitch(l.name)
          }}
        >
          <span class="name" title={l.name}>{l.name}</span>
          <span class="meta">{describe(l)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .layer-list {
    width: 240px;
    max-width: calc(100% - 16px);
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--se-text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .status {
    flex: 1;
  }
  ul {
    max-height: 200px;
    margin: 0;
    padding: 2px 4px 4px;
    overflow-y: auto;
    list-style: none;
    outline: none;
    border-top: 1px solid var(--se-border);
  }
  ul:focus-visible,
  .head:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  li.cursor,
  li:hover {
    background: var(--se-list-hover-bg, var(--se-control-hover));
  }
  li[aria-selected='true'] {
    background: var(--se-selected-inactive-bg);
    color: var(--se-selected-inactive-fg);
    box-shadow: inset 2px 0 0 var(--se-selected-indicator);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--se-text-secondary);
    font-size: 0.92em;
    white-space: nowrap;
  }
</style>
