<script lang="ts">
  // Spec 011 (contracts/ui.md "Property rows"): one visual property of the
  // layer. Fixed shows its one value inline; By column shows the column, the
  // scale and its classes (collapsible, with a one-line summary when closed).
  import type { Snippet } from 'svelte'
  import Icon from '../Icon.svelte'

  interface Props {
    /** Stable id for element ids (`row-<id>`). */
    id: string
    /** The property's name: "Color", "Outline width"… */
    name: string
    mode: 'fixed' | 'column'
    onMode: (mode: 'fixed' | 'column') => void
    /** Why By column can't be chosen (no suitable column), or null. */
    columnUnavailable?: string | null
    /** By column, collapsed: e.g. "los · Categories". */
    summary?: string
    fixed: Snippet
    byColumn: Snippet
  }
  let { id, name, mode, onMode, columnUnavailable = null, summary = '', fixed, byColumn }: Props = $props()
  let open = $state(true)

  function keydown(e: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = mode === 'fixed' ? 'column' : 'fixed'
    if (next === 'column' && columnUnavailable) return
    onMode(next)
    const group = (e.currentTarget as HTMLElement).parentElement
    queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
</script>

<div class="channel" data-channel={id}>
  <div class="head">
    <h4 id="row-{id}">{name}</h4>
    <div class="modes" role="radiogroup" aria-label="{name}: Fixed or By column">
      {#each [{ m: 'fixed', label: 'Fixed' }, { m: 'column', label: 'By column' }] as const as o (o.m)}
        {@const on = mode === o.m}
        <button
          type="button"
          role="radio"
          aria-checked={on}
          aria-label="{name}: {o.label}"
          aria-disabled={o.m === 'column' && !!columnUnavailable && !on}
          title={o.m === 'column' && columnUnavailable ? columnUnavailable : undefined}
          tabindex={on ? 0 : -1}
          onclick={() => {
            if (o.m === 'column' && columnUnavailable) return
            if (!on) onMode(o.m)
          }}
          onkeydown={keydown}>{o.label}</button
        >
      {/each}
    </div>
    {#if mode === 'column'}
      <button type="button" class="disclose" aria-expanded={open} aria-label="{open ? 'Collapse' : 'Expand'} {name}" onclick={() => (open = !open)}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </button>
    {/if}
  </div>
  {#if mode === 'fixed'}
    <div class="body">{@render fixed()}</div>
  {:else if open}
    <div class="body">{@render byColumn()}</div>
  {:else if summary}
    <p class="summary">{summary}</p>
  {/if}
</div>

<style>
  .channel {
    display: grid;
    gap: 4px;
    padding: 6px 0;
  }
  .channel + :global(.channel) {
    border-top: 1px dashed color-mix(in srgb, var(--se-border) 70%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  h4 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-weight: 600;
    font-size: inherit;
  }
  .modes {
    display: inline-flex;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .modes button {
    padding: 1px 8px;
    border: none;
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .modes button + button {
    border-left: 1px solid var(--se-input-border);
  }
  .modes button[aria-checked='true'] {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    /* High contrast has no filled button: the active contrast border marks the choice. */
    box-shadow: inset 0 0 0 1px var(--se-selected-indicator);
  }
  .modes button[aria-disabled='true'] {
    cursor: default;
    opacity: 0.55;
  }
  .modes button:focus-visible,
  .disclose:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .disclose {
    display: inline-flex;
    padding: 2px;
    border: none;
    background: none;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .body {
    display: grid;
    gap: 6px;
  }
  .summary {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
</style>
