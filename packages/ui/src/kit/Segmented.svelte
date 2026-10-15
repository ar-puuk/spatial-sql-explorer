<script lang="ts">
  // A short list of exclusive choices, all visible (2 to 4 of them). bits-ui's Toggle Group in single mode:
  // role=radio items with arrow-key movement. Never empty: a click on the chosen item keeps it.
  import { ToggleGroup } from 'bits-ui'

  interface Props {
    options: Array<{ value: string; label: string; title?: string }>
    value: string
    onChange: (value: string) => void
    label: string
  }
  let { options, value, onChange, label }: Props = $props()
</script>

<ToggleGroup.Root class="se-seg" type="single" {value} onValueChange={(v) => v && onChange(v)} aria-label={label}>
  {#each options as o (o.value)}
    <ToggleGroup.Item class="se-seg-item" value={o.value} title={o.title}>{o.label}</ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

<style>
  :global(.se-seg) {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 2px;
    padding: 2px;
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-hover);
    box-shadow: inset 0 0 0 1px var(--vscode-contrastBorder, transparent);
  }
  :global(.se-seg-item) {
    all: unset;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    height: 22px;
    padding: 0 10px;
    border-radius: calc(var(--se-radius-sm) - 1px);
    font: inherit;
    color: var(--se-text-secondary);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 120ms var(--se-ease), color 120ms var(--se-ease);
  }
  :global(.se-seg-item:hover) {
    color: var(--se-text-primary);
  }
  :global(.se-seg-item[data-state='on']) {
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    font-weight: 500;
    box-shadow: 0 0 0 1px var(--se-border);
  }
  :global(.se-seg-item:focus-visible) {
    outline: 2px solid var(--se-focus);
    outline-offset: 1px;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.se-seg-item) {
      transition: none;
    }
  }
</style>
