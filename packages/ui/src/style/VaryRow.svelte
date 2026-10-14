<script lang="ts">
  // Spec 011 (contracts/ui.md "Vary by attribute"): one property that varies
  // by a column, under the style type: its name, a one-line summary when
  // collapsed, and Remove (back to the Appearance setting).
  import type { Snippet } from 'svelte'
  import Icon from '../Icon.svelte'

  interface Props {
    /** Stable id for element ids. */
    id: string
    /** e.g. "Outline color". */
    name: string
    /** Collapsed: e.g. "severity · 4 categories". */
    summary?: string
    onRemove: () => void
    children: Snippet
  }
  let { id, name, summary = '', onRemove, children }: Props = $props()
  let open = $state(true)
</script>

<div class="vary" data-channel={id} role="group" aria-labelledby="vary-{id}">
  <div class="head">
    <h4 id="vary-{id}">
      <button type="button" class="disclose" aria-expanded={open} aria-controls="vary-body-{id}" onclick={() => (open = !open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-up'} size={12} />{name} by
      </button>
    </h4>
    {#if !open && summary}<span class="summary" title={summary}>{summary}</span>{/if}
    <button type="button" class="remove" aria-label="Stop varying {name.toLowerCase()}" title="Back to the Appearance setting" onclick={onRemove}>
      <Icon name="close" size={12} />
    </button>
  </div>
  {#if open}
    <div class="body" id="vary-body-{id}">{@render children()}</div>
  {/if}
</div>

<style>
  .vary {
    display: grid;
    gap: 4px;
    padding: 6px 0;
  }
  .vary + :global(.vary) {
    border-top: 1px dashed color-mix(in srgb, var(--se-border) 70%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .disclose {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  h4 {
    margin: 0;
    font-weight: 600;
    font-size: inherit;
  }
  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--se-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove {
    display: inline-flex;
    margin-left: auto;
    padding: 2px;
    border: none;
    background: none;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .remove:hover {
    color: var(--se-text-primary);
  }
  .disclose:focus-visible,
  .remove:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .body {
    display: grid;
    gap: 6px;
  }
</style>
