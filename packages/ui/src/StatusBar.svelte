<script lang="ts">
  // T035 (specs/001-quick-look/tasks.md, User Story 3): CRS, feature count,
  // geometry type, CRS-assumed disclosure (FR-015), truncation notice
  // (FR-019), and live cursor coordinates (FR from US3's acceptance scenario
  // 3). This is the web shell's only metadata display — VS Code additionally
  // (and primarily) shows the same fields via its native status bar, wired
  // separately through HostAdapter.setStatus (apps/vscode-ext/src/extension.ts).
  import type { ViewerSession } from '@spatial-explorer/core'

  interface Props {
    session: ViewerSession
  }
  let { session }: Props = $props()
</script>

{#if session.layer}
  {@const layer = session.layer}
  <div class="status-bar" role="status">
    <span class="item" title={layer.crsAssumed ? 'No CRS information found in the file — WGS84 was assumed' : undefined}>
      {layer.sourceCrs.label}{layer.crsAssumed ? ' (assumed)' : ''}
    </span>
    <span class="item">{layer.featureCount.toLocaleString()} features</span>
    <span class="item">{layer.geometryType}</span>
    {#if layer.truncated}
      <span class="item truncated">
        Showing {Math.min(layer.features.length, layer.featureCount).toLocaleString()} of {layer.featureCount.toLocaleString()} features
      </span>
    {/if}
    <span class="spacer"></span>
    {#if session.cursorCoordinates}
      <span class="item cursor">{session.cursorCoordinates.lat.toFixed(5)}, {session.cursorCoordinates.lon.toFixed(5)}</span>
    {/if}
  </div>
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 2px 12px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, #252526));
    border-top: 1px solid var(--vscode-panel-border, #2b2b2b);
    color: var(--vscode-descriptionForeground, #ccc);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 0.85em;
    white-space: nowrap;
    overflow-x: auto;
  }
  .item {
    flex-shrink: 0;
  }
  .truncated {
    color: var(--vscode-foreground, #fff);
  }
  .spacer {
    flex: 1;
    min-width: 8px;
  }
  .cursor {
    font-variant-numeric: tabular-nums;
    color: var(--vscode-foreground, #fff);
  }
</style>
