<script lang="ts">
  // T035 (specs/001-quick-look/tasks.md, User Story 3): CRS, feature count,
  // geometry type, CRS-assumed disclosure (FR-015), truncation notice
  // (FR-019), and live cursor coordinates. Web-shell chrome only
  // (design-plan.md §4.3), docked over the bottom of the map like the legacy
  // app's map status bar. VS Code shows the same fields in its native status
  // bar via HostAdapter.setStatus (apps/vscode-ext/src/extension.ts).
  import type { ViewerSession } from '@spatial-explorer/core'

  interface Props {
    session: ViewerSession
  }
  let { session }: Props = $props()
  const nf = new Intl.NumberFormat()
</script>

{#if session.layer}
  {@const layer = session.layer}
  <div class="status-bar" role="status">
    <span class="item crs" class:assumed={layer.crsAssumed} title={layer.crsAssumed ? 'No CRS information found in the file — WGS84 was assumed' : 'Source CRS (reprojected to WGS84 for display)'}>
      {layer.sourceCrs.label}{layer.crsAssumed ? ' · assumed' : ''}
    </span>
    <span class="sep" aria-hidden="true"></span>
    <span class="item">{nf.format(layer.source.features)} {layer.source.features === 1 ? 'feature' : 'features'}</span>
    <span class="sep" aria-hidden="true"></span>
    <span class="item">{layer.geometryType}</span>
    {#if layer.truncated}
      <span class="sep" aria-hidden="true"></span>
      <span class="item truncated">
        Showing {nf.format(layer.rowCount)} of {nf.format(layer.source.rows)}
      </span>
    {/if}
    <span class="spacer"></span>
    <span class="item cursor" title="Cursor coordinates (lat, lon)">
      {#if session.cursorCoordinates}
        {session.cursorCoordinates.lat.toFixed(5)}, {session.cursorCoordinates.lon.toFixed(5)}
      {/if}
    </span>
  </div>
{/if}

<style>
  .status-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 24px;
    padding: 0 10px;
    background: var(--se-statusbar-bg);
    color: var(--se-statusbar-fg);
    border-top: 1px solid var(--se-statusbar-border);
    backdrop-filter: var(--se-overlay-blur);
    font-family: var(--se-font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  .item {
    flex-shrink: 0;
  }
  .crs {
    color: var(--se-statusbar-accent);
  }
  .crs.assumed {
    color: var(--se-warning-fg);
  }
  .truncated {
    color: var(--se-warning-fg);
  }
  .sep {
    width: 1px;
    height: 12px;
    background: var(--se-statusbar-border);
  }
  .spacer {
    flex: 1;
    min-width: 8px;
  }
  .cursor {
    min-width: 19ch;
    text-align: right;
  }
</style>
