<script lang="ts">
  // Spec 023: the snippet library. A popover under the query panel's header with a search box and the ready-made queries that fit
  // the open layer, grouped by what they do; the one under the cursor shows its SQL below. Enter or a click puts it in the
  // editor (the editor's fields are then Tab stops); Esc closes and returns focus to the button. Arrow keys move through the list
  // while the search box has focus (the combobox pattern), so typing and choosing never need the mouse.
  import { onMount, tick } from 'svelte'
  import { SNIPPET_CATEGORIES, plainSql, snippetTemplate, type SnippetContext, type SnippetDef } from '@spatial-explorer/core'

  interface Props {
    snippets: SnippetDef[]
    context: SnippetContext
    onPick: (def: SnippetDef, template: string) => void
    onClose: () => void
  }
  let { snippets, context, onPick, onClose }: Props = $props()

  let query = $state('')
  let active = $state(0)
  let root = $state<HTMLDivElement>()
  let input = $state<HTMLInputElement>()
  let list = $state<HTMLDivElement>()

  const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean))
  const shown = $derived(snippets.filter((s) => words.every((w) => `${s.title} ${s.category} ${s.description}`.toLowerCase().includes(w))))
  const groups = $derived(SNIPPET_CATEGORIES.map((category) => ({ category, items: shown.filter((s) => s.category === category) })).filter((g) => g.items.length > 0))
  /** The rows in the order they are listed (the groups' order), for the arrow keys. */
  const flat = $derived(groups.flatMap((g) => g.items))
  const current = $derived(flat[Math.min(active, Math.max(0, flat.length - 1))])
  const preview = $derived(current ? plainSql(snippetTemplate(current, context)) : '')

  $effect(() => {
    void query
    active = 0
  })
  $effect(() => {
    void active
    if (current) void tick().then(() => list?.querySelector(`#snippet-${current.id}`)?.scrollIntoView({ block: 'nearest' }))
  })

  function pick(def: SnippetDef | undefined): void {
    if (def) onPick(def, snippetTemplate(def, context))
  }
  function onKeydown(ev: KeyboardEvent): void {
    const n = flat.length
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      onClose()
    } else if (n && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault()
      active = (active + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n
    } else if (n && ev.key === 'Enter') {
      ev.preventDefault()
      pick(current)
    } else if (ev.key === 'Tab') {
      onClose()
    }
  }

  onMount(() => {
    input?.focus()
    const outside = (ev: PointerEvent) => {
      if (root && !root.contains(ev.target as Node)) onClose()
    }
    // Registered after the click that opened the popover has finished.
    const t = setTimeout(() => document.addEventListener('pointerdown', outside, true))
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', outside, true)
    }
  })
</script>

<div class="library" role="dialog" aria-label="Snippet library" bind:this={root}>
  <input
    bind:this={input}
    bind:value={query}
    type="search"
    role="combobox"
    aria-label="Search snippets"
    aria-expanded="true"
    aria-controls="snippet-list"
    aria-activedescendant={current ? `snippet-${current.id}` : undefined}
    placeholder="Search ready-made queries"
    autocomplete="off"
    spellcheck="false"
    onkeydown={onKeydown}
  />
  <div class="list" id="snippet-list" role="listbox" aria-label="Snippets" bind:this={list}>
    {#each groups as g (g.category)}
      <div role="group" aria-label={g.category}>
        <div class="category" aria-hidden="true">{g.category}</div>
        {#each g.items as s (s.id)}
          <!-- Keys are handled on the search box (the combobox pattern). -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
          <div id="snippet-{s.id}" role="option" aria-selected={s.id === current?.id} class="item" class:active={s.id === current?.id} onpointermove={() => (active = flat.indexOf(s))} onclick={() => pick(s)}>
            <span class="title">{s.title}</span>
            <span class="description">{s.description}</span>
          </div>
        {/each}
      </div>
    {/each}
    {#if flat.length === 0}
      <p class="empty" role="status">{snippets.length === 0 ? 'No snippets fit this layer.' : 'No snippet matches that.'}</p>
    {/if}
  </div>
  {#if current}
    <pre class="preview" aria-label="The query of {current.title}">{preview}</pre>
    <p class="hint">Fills the editor. Tab moves between the values to change; Ctrl+Z brings your old query back.</p>
  {/if}
</div>

<style>
  .library {
    position: absolute;
    top: 30px;
    right: 6px;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: min(460px, calc(100% - 12px));
    max-height: min(420px, calc(100% - 36px));
    min-height: 0;
    padding: 6px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  input {
    flex: none;
    height: 24px;
    box-sizing: border-box;
    padding: 0 8px;
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .list {
    flex: 1 1 auto;
    min-height: 60px;
    overflow: auto;
  }
  .category {
    padding: 6px 8px 2px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 3px 8px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  .item.active {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .description {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.92em;
    opacity: 0.85;
  }
  .empty {
    margin: 0;
    padding: 8px;
    color: var(--se-text-secondary);
  }
  .preview {
    flex: none;
    max-height: 96px;
    margin: 0;
    padding: 6px 8px;
    overflow: auto;
    background: var(--se-bg-base);
    color: var(--se-text-primary);
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
    white-space: pre;
  }
  .hint {
    flex: none;
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
</style>
