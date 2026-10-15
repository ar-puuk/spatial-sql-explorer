<script lang="ts">
  // A skipped-geometry count is a successful load with a caveat (FR-014), not a failure, so it is a notice over
  // the map, not a bar that pushes the app down (spec 015). Those rows stay in the table and are only left off
  // the map. Dismissible, since it stays true for as long as the result is shown.
  import Icon from './Icon.svelte'

  interface Props {
    invalidGeometryCount: number
  }
  let { invalidGeometryCount }: Props = $props()
  let dismissed = $state(false)
</script>

{#if invalidGeometryCount > 0 && !dismissed}
  <div class="notice" role="status">
    <Icon name="warning" />
    <span class="message">
      {invalidGeometryCount.toLocaleString()}
      {invalidGeometryCount === 1 ? 'row has' : 'rows have'} no usable geometry. {invalidGeometryCount === 1 ? 'It is' : 'They are'} in the table, not on the map.
    </span>
    <button type="button" aria-label="Dismiss" onclick={() => (dismissed = true)}><Icon name="close" size={14} /></button>
  </div>
{/if}

<style>
  .notice {
    position: absolute;
    top: 10px;
    left: 50%;
    z-index: 9;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(560px, calc(100% - 24px));
    padding: 5px 6px 5px 10px;
    background: var(--se-warning-bg);
    border: 1px solid var(--se-warning-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-card);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .notice > :global(.icon) {
    color: var(--se-warning);
  }
  .message {
    flex: 1;
    min-width: 0;
  }
  button {
    display: grid;
    place-items: center;
    flex: none;
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
    outline: 2px solid var(--se-focus);
  }
</style>
