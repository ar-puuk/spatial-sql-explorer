<script lang="ts">
  // Spec 027: "Save as" for a result: a button that opens a short menu (CSV, SVG, PNG, ...). A plain menu button: Enter, Space or
  // Down open it, arrows move, Enter chooses, Esc and a click elsewhere close it.
  import Icon from '../Icon.svelte'

  interface Item {
    id: string
    label: string
    hint?: string
  }
  interface Props {
    items: readonly Item[]
    onPick: (id: string) => void | Promise<void>
    label?: string
  }
  let { items, onPick, label = 'Save as' }: Props = $props()

  let open = $state(false)
  let host = $state<HTMLDivElement>()
  let button = $state<HTMLButtonElement>()
  let active = $state(0)

  function show(): void {
    open = true
    active = 0
    queueMicrotask(() => host?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
  }
  function close(refocus = true): void {
    open = false
    if (refocus) button?.focus()
  }
  function choose(id: string): void {
    close()
    void onPick(id)
  }
  function menuKey(e: KeyboardEvent): void {
    const n = items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    else if (e.key === 'Home') active = 0
    else if (e.key === 'End') active = n - 1
    else if (e.key === 'Escape') return close()
    else if (e.key === 'Tab') return close(false)
    else return
    e.preventDefault()
    queueMicrotask(() => host?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus())
  }
  function outside(e: PointerEvent): void {
    if (open && host && !host.contains(e.target as Node)) close(false)
  }
</script>

<svelte:window onpointerdown={outside} />

<div class="save" bind:this={host}>
  <button
    type="button"
    class="trigger"
    bind:this={button}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close() : show())}
    onkeydown={(e) => {
      if (e.key === 'ArrowDown' && !open) {
        e.preventDefault()
        show()
      }
    }}
  >
    {label}<Icon name="chevron-down" size={12} />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label={label} tabindex="-1" onkeydown={menuKey}>
      {#each items as item, i (item.id)}
        <button type="button" role="menuitem" tabindex={i === active ? 0 : -1} title={item.hint} onclick={() => choose(item.id)}>{item.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .save {
    position: relative;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .trigger:hover {
    background: var(--se-button-secondary-hover, var(--se-bg-hover));
  }
  .trigger:focus-visible,
  [role='menuitem']:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 2px);
    z-index: 20;
    min-width: 150px;
    display: grid;
    padding: 4px;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-overlay, var(--se-bg-base));
    box-shadow: var(--se-shadow, 0 4px 14px rgba(0, 0, 0, 0.3));
  }
  [role='menuitem'] {
    padding: 4px 10px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  [role='menuitem']:hover,
  [role='menuitem']:focus {
    background: var(--se-bg-hover);
  }
</style>
