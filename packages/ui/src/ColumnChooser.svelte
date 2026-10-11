<script lang="ts">
  // Spec 008 FR-008/FR-009 (contracts/ui.md "Table"): which columns the
  // attribute table shows, so wide data fits without sideways scrolling.
  // A dialog anchored under the toolbar's Columns button: a search box, a
  // checkbox per column, Show all / Hide all. At least one column stays
  // visible. Hiding columns changes only the table, never queries, styles
  // or exports.
  import { onMount, tick } from 'svelte'

  interface Props {
    columns: ReadonlyArray<{ name: string; type: string }>
    hidden: ReadonlySet<string>
    onChange: (hidden: string[]) => void
    onClose: () => void
  }
  let { columns, hidden, onChange, onClose }: Props = $props()

  let query = $state('')
  let message = $state<string | null>(null)
  let root = $state<HTMLDivElement>()
  let search = $state<HTMLInputElement>()

  const shown = $derived(columns.filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())))
  const visibleCount = $derived(columns.filter((c) => !hidden.has(c.name)).length)

  function set(name: string, visible: boolean, box: HTMLInputElement): void {
    if (!visible && visibleCount <= 1 && !hidden.has(name)) {
      message = 'At least one column stays visible.'
      box.checked = true
      return
    }
    message = null
    onChange(visible ? [...hidden].filter((n) => n !== name) : [...hidden, name])
  }

  function showAll(): void {
    message = null
    onChange([])
  }

  function hideAll(): void {
    // Keep the first column, so the table always has one.
    message = columns.length > 1 ? `Kept ${columns[0].name}: at least one column stays visible.` : null
    onChange(columns.slice(1).map((c) => c.name))
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab' && root) {
      // Keep focus inside the dialog (it is modal to the table).
      const items = [...root.querySelectorAll<HTMLElement>('input, button')]
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  onMount(() => {
    void tick().then(() => search?.focus())
    const outside = (ev: PointerEvent): void => {
      const target = ev.target as HTMLElement
      if (root && !root.contains(target) && !target.closest('[data-column-chooser-toggle]')) onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  })
</script>

<div class="chooser" role="dialog" aria-label="Choose columns" aria-modal="true" tabindex="-1" bind:this={root} onkeydown={keydown}>
  <input class="search" type="search" placeholder="Find column" aria-label="Find column" bind:this={search} bind:value={query} />
  <div class="actions">
    <button type="button" onclick={showAll}>Show all</button>
    <button type="button" onclick={hideAll}>Hide all</button>
    <span class="count">{visibleCount} of {columns.length} shown</span>
  </div>
  {#if message}<p class="message" role="status">{message}</p>{/if}
  <ul>
    {#each shown as c (c.name)}
      <li>
        <label title={`${c.name} · ${c.type}`}>
          <input type="checkbox" aria-label={c.name} checked={!hidden.has(c.name)} onchange={(e) => set(c.name, e.currentTarget.checked, e.currentTarget)} />
          <span class="name">{c.name}</span>
          <span class="type">{c.type}</span>
        </label>
      </li>
    {:else}
      <li class="none">No column matches “{query}”.</li>
    {/each}
  </ul>
</div>

<style>
  .chooser {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: grid;
    gap: 6px;
    width: 280px;
    max-height: 360px;
    padding: 8px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  .search {
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .actions button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .actions button:hover {
    background: var(--se-button-secondary-hover);
  }
  .count {
    margin-left: auto;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .message {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  ul {
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  label {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  label:hover {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .type {
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.85em;
  }
  .none {
    padding: 4px;
    color: var(--se-text-secondary);
  }
  input:focus-visible,
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  input[type='checkbox'] {
    margin: 0;
    accent-color: var(--se-accent);
  }
</style>
