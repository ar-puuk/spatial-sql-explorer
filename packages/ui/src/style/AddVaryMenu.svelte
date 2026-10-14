<script lang="ts" generics="K extends string">
  // Spec 011: "+ Add" under Vary by attribute: a menu of the properties that
  // can still vary by a column (menu button pattern: arrows move, Enter
  // chooses, Esc closes back to the button). Unusable ones say why.
  import { onMount } from 'svelte'
  import Icon from '../Icon.svelte'

  interface Item {
    id: K
    label: string
    /** Why it can't be added for this layer, or null. */
    unavailable: string | null
  }
  interface Props {
    items: Item[]
    onAdd: (id: K) => void
  }
  let { items, onAdd }: Props = $props()
  let open = $state(false)
  let root = $state<HTMLDivElement>()
  let button = $state<HTMLButtonElement>()
  let menu = $state<HTMLDivElement>()
  const uid = `add-vary-${Math.random().toString(36).slice(2, 8)}`

  function show(): void {
    open = true
    queueMicrotask(() => menu?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus())
  }
  function hide(refocus = true): void {
    open = false
    if (refocus) button?.focus()
  }
  function choose(it: Item): void {
    if (it.unavailable) return
    hide()
    onAdd(it.id)
  }
  function keydown(e: KeyboardEvent): void {
    const all = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      hide()
    } else if (e.key === 'Tab') hide(false)
  }
  onMount(() => {
    const outside = (ev: PointerEvent) => {
      if (open && root && !root.contains(ev.target as Node)) hide(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  })
</script>

<div class="add" bind:this={root}>
  <button
    type="button"
    class="secondary"
    bind:this={button}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={uid}
    disabled={!items.length}
    onclick={() => (open ? hide() : show())}
  >
    <Icon name="plus" size={14} />Add…
  </button>
  {#if open}
    <div class="menu" role="menu" id={uid} aria-label="Vary by attribute" tabindex="-1" bind:this={menu} onkeydown={keydown}>
      {#each items as it (it.id)}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          aria-disabled={it.unavailable !== null}
          title={it.unavailable ?? undefined}
          onclick={() => choose(it)}
        >
          <span class="name">{it.label}</span>
          {#if it.unavailable}<span class="why">{it.unavailable}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .add {
    position: relative;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
    cursor: pointer;
  }
  .secondary:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .secondary:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  /* In the flow of the panel (not floating): the panel's body scrolls, and a floating menu was cut off at its bottom. */
  .menu {
    margin-top: 4px;
    display: grid;
    min-width: 200px;
    padding: 4px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
  }
  [role='menuitem'] {
    display: grid;
    padding: 4px 8px;
    border: none;
    border-radius: var(--se-radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  [role='menuitem']:hover:not([aria-disabled='true']),
  [role='menuitem']:focus-visible {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
    outline: none;
  }
  [role='menuitem'][aria-disabled='true'] {
    cursor: default;
  }
  [role='menuitem'][aria-disabled='true'] .name {
    opacity: 0.55;
  }
  .why {
    color: var(--se-text-secondary);
    font-size: 0.92em;
    font-style: italic;
  }
</style>
