<script lang="ts">
  // A choice from a list, in a popup that wears the theme (the browser's native popup does not). bits-ui's Select:
  // typeahead, arrow keys, Esc, collision handling. Portaled to the body, so its styles are global.
  import { Select } from 'bits-ui'
  import Icon from '../Icon.svelte'

  interface Props {
    options: Array<{ value: string; label: string }>
    value: string
    onChange: (value: string) => void
    /** The accessible name. */
    label: string
    /** Fit the trigger to its content instead of filling its cell. */
    compact?: boolean
  }
  let { options, value, onChange, label, compact = false }: Props = $props()
  const current = $derived(options.find((o) => o.value === value)?.label ?? '')
</script>

<Select.Root type="single" {value} onValueChange={(v) => v && onChange(v)} items={options}>
  <Select.Trigger class="se-select{compact ? ' compact' : ''}" aria-label={label}>
    <span class="se-select-value">{current}</span>
    <Icon name="chevron-down" size={14} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="se-select-pop" sideOffset={4} align="start" collisionPadding={8}>
      <Select.Viewport>
        {#each options as o (o.value)}
          <Select.Item class="se-select-item" value={o.value} label={o.label}>
            {#snippet children({ selected })}
              <span>{o.label}</span>
              {#if selected}<Icon name="check" size={14} />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.se-select) {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    font: inherit;
    color: var(--se-text-primary);
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  :global(.se-select.compact) {
    width: auto;
  }
  :global(.se-select:hover) {
    border-color: var(--se-text-muted);
  }
  :global(.se-select:focus-visible) {
    outline: 2px solid var(--se-focus);
    outline-offset: 0;
  }
  :global(.se-select[data-state='open']) {
    border-color: var(--se-focus);
  }
  :global(.se-select .icon) {
    color: var(--se-text-secondary);
  }
  .se-select-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.se-select-pop) {
    z-index: 1000;
    min-width: var(--bits-select-anchor-width);
    max-height: min(320px, var(--bits-select-content-available-height));
    overflow-y: auto;
    padding: 4px;
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    color: var(--se-menu-fg);
    background: var(--se-menu-bg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
  }
  :global(.se-select-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 8px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
    user-select: none;
  }
  :global(.se-select-item[data-highlighted]) {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
    outline: none;
  }
  :global(.se-select-item[data-selected]) {
    font-weight: 500;
  }
</style>
