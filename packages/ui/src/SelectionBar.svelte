<script lang="ts">
  // Spec 008 FR-013 (contracts/ui.md "SelectionBar"): what to do with the
  // ticked rows. Shown in the table toolbar while the selection isn't empty.
  import Icon from './Icon.svelte'

  interface Props {
    count: number
    showSelectedOnly: boolean
    onZoom: () => void
    onShowSelectedOnly: (on: boolean) => void
    onClear: () => void
  }
  let { count, showSelectedOnly, onZoom, onShowSelectedOnly, onClear }: Props = $props()
  const nf = new Intl.NumberFormat('en-US')
</script>

<div class="selection-bar" role="group" aria-label="Selection">
  <span class="count" role="status">{nf.format(count)} selected</span>
  <button type="button" onclick={onZoom} title="Zoom the map to the selected features"><Icon name="fit" size={14} /><span>Zoom to selection</span></button>
  <button type="button" aria-pressed={showSelectedOnly} onclick={() => onShowSelectedOnly(!showSelectedOnly)} title="Show only the selected rows in the table and on the map">
    <Icon name="filter" size={14} /><span>Show selected only</span>
  </button>
  <button type="button" class="icon" aria-label="Clear selection" title="Clear selection" onclick={onClear}><Icon name="close" size={14} /></button>
</div>

<style>
  .selection-bar {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .count {
    color: var(--se-text-secondary);
    margin-right: 2px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  button[aria-pressed='true'] {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
    border-color: var(--se-selected-indicator);
  }
  button.icon {
    width: 22px;
    padding: 0;
    justify-content: center;
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
</style>
