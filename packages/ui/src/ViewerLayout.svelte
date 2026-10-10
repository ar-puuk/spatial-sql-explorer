<script lang="ts">
  import MapView from './MapView.svelte'
  import AttributeTable from './AttributeTable.svelte'
  import ErrorBanner from './ErrorBanner.svelte'
  import LayerWarningBanner from './LayerWarningBanner.svelte'
  import type { ViewerSession } from '@spatial-explorer/core'

  interface Props {
    session: ViewerSession
    onSelectFeature: (id: string | number | null) => void
    onCursorMove: (coords: { lon: number; lat: number } | null) => void
  }
  let { session, onSelectFeature, onCursorMove }: Props = $props()
</script>

<div class="viewer-layout">
  <ErrorBanner message={session.loadState === 'error' ? (session.loadError?.message ?? 'Unknown error') : null} />
  {#if session.layer}
    <LayerWarningBanner invalidGeometryCount={session.layer.invalidGeometryCount} />
  {/if}
  <div class="panes">
    <div class="map-pane">
      <MapView layer={session.layer} selectedFeatureId={session.selectedFeatureId} {onSelectFeature} {onCursorMove} />
    </div>
    <div class="table-pane">
      <AttributeTable layer={session.layer} selectedFeatureId={session.selectedFeatureId} {onSelectFeature} />
    </div>
  </div>
</div>

<style>
  .viewer-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--vscode-editor-background, inherit);
  }
  .panes {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .map-pane {
    flex: 2;
    min-height: 0;
  }
  .table-pane {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--vscode-panel-border, #ccc);
  }
</style>
