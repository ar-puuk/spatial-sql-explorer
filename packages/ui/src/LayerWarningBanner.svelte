<script lang="ts">
  // Visually distinct from ErrorBanner — a skipped-geometry count is a
  // successful load with a caveat (FR-014), not a failure. Dismissible, since
  // it stays true for as long as the file is open.
  import Icon from './Icon.svelte'

  interface Props {
    invalidGeometryCount: number
  }
  let { invalidGeometryCount }: Props = $props()
  let dismissed = $state(false)
</script>

{#if invalidGeometryCount > 0 && !dismissed}
  <div class="banner" role="status">
    <Icon name="warning" />
    <span class="message">
      {invalidGeometryCount.toLocaleString()}
      {invalidGeometryCount === 1 ? 'invalid geometry was skipped. It is' : 'invalid geometries were skipped. They are'} not shown on the map or in the table.
    </span>
    <button type="button" aria-label="Dismiss" title="Dismiss" onclick={() => (dismissed = true)}><Icon name="close" size={14} /></button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 12px;
    background: var(--se-warning-bg);
    border-left: 3px solid var(--se-warning);
    border-bottom: 1px solid var(--se-warning-border);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .banner > :global(.icon) {
    color: var(--se-warning);
  }
  .message {
    flex: 1;
  }
  button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
</style>
