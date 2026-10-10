<script lang="ts">
  import type { Layer } from '@spatial-explorer/core'

  interface Props {
    layer: Layer | null
    selectedFeatureId: string | number | null
    onSelectFeature: (id: string | number | null) => void
  }
  let { layer, selectedFeatureId, onSelectFeature }: Props = $props()

  let columns = $derived(layer && layer.features.length > 0 ? Object.keys(layer.features[0].attributes) : [])

  function handleKeydown(e: KeyboardEvent, id: string | number): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelectFeature(id)
    }
  }
</script>

<div class="attribute-table" role="region" aria-label="Attribute table">
  {#if !layer || layer.features.length === 0}
    <p class="empty-state">No features to display.</p>
  {:else}
    <table>
      <thead>
        <tr>
          {#each columns as col (col)}
            <th scope="col">{col}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each layer.features as feature (feature.id)}
          <tr
            class:selected={feature.id === selectedFeatureId}
            tabindex="0"
            aria-selected={feature.id === selectedFeatureId}
            onclick={() => onSelectFeature(feature.id)}
            onkeydown={(e) => handleKeydown(e, feature.id)}
          >
            {#each columns as col (col)}
              <td>{feature.attributes[col] ?? ''}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .attribute-table {
    overflow: auto;
    height: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground, inherit);
    background: var(--vscode-editor-background, inherit);
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #ccc);
    white-space: nowrap;
  }
  tr.selected {
    background: var(--vscode-list-activeSelectionBackground, #0060c0);
    color: var(--vscode-list-activeSelectionForeground, #fff);
  }
  tr:hover {
    background: var(--vscode-list-hoverBackground, #f0f0f0);
    cursor: pointer;
  }
  tr:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #0090f1);
    outline-offset: -1px;
  }
  .empty-state {
    padding: 16px;
    color: var(--vscode-descriptionForeground, #888);
  }
</style>
