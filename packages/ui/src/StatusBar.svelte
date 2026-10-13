<script lang="ts">
  // T035 (specs/001-quick-look/tasks.md, User Story 3): CRS, feature count,
  // geometry type, CRS-assumed disclosure (FR-015), truncation notice
  // (FR-019), and live cursor coordinates. Web-shell chrome only
  // (design-plan.md §4.3), docked over the bottom of the map like the legacy
  // app's map status bar. VS Code shows the same fields in its native status
  // bar via HostAdapter.setStatus (apps/vscode-ext/src/extension.ts).
  import type { DatasetFacts, DrawMode, ViewerSession } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  /** Spec 010: how the map draws the result, and the switches between the modes. */
  export interface DrawStatus {
    mode: DrawMode | null
    /** GeoJSON mode: features in memory. */
    features: number | null
    loading: boolean
    progress: number | null
    /** "Load all" was chosen: offer tiles back. */
    loadedAll: boolean
    onLoadAll: () => void
    onDrawAsTiles: () => void
  }

  interface Props {
    session: ViewerSession
    /** Spec 007 FR-001: whole-file facts while the file is still opening. */
    facts?: DatasetFacts | null
    draw?: DrawStatus | null
    /** Spec 010: a full-width row under the panels, not over the map. */
    docked?: boolean
  }
  let { session, facts = null, draw = null, docked = false }: Props = $props()
  const LOAD_ALL_TIP = 'Over 100,000 features: drawn from tiles the engine builds as you move. Load all draws every feature at once (slower to open, then no work while panning).'
  const nf = new Intl.NumberFormat()
</script>

{#if session.layer}
  {@const layer = session.layer}
  <div class="status-bar" class:docked role="status">
    <span class="item crs" class:assumed={layer.crsAssumed} title={layer.crsAssumed ? 'No CRS information found in the file — WGS84 was assumed' : 'Source CRS (reprojected to WGS84 for display)'}>
      {layer.sourceCrs.label}{layer.crsAssumed ? ' · assumed' : ''}
    </span>
    <span class="sep" aria-hidden="true"></span>
    {#if layer.facts?.tiles}
      <!-- Spec 007 US5: an archive's facts come from its header and metadata. -->
      {@const t = layer.facts.tiles}
      <span class="item">PMTiles</span>
      <span class="sep" aria-hidden="true"></span>
      <span class="item">Zoom {t.minZoom}–{t.maxZoom}</span>
      {#if layer.extent}
        <span class="sep" aria-hidden="true"></span>
        <span class="item" title="Archive bounds (west, south, east, north)">{layer.extent.map((v) => v.toFixed(2)).join(', ')}</span>
      {/if}
      <span class="sep" aria-hidden="true"></span>
      <span class="item">{t.layers.length} {t.layers.length === 1 ? 'layer' : 'layers'}</span>
    {:else if layer.facts?.invalid === null}
      <!-- Spec 007: invalid geometry isn't known without a full scan, so count rows (FR-016). -->
      <span class="item">{nf.format(layer.source.rows)} {layer.source.rows === 1 ? 'row' : 'rows'}</span>
    {:else}
      <span class="item">{nf.format(layer.source.features)} {layer.source.features === 1 ? 'feature' : 'features'}</span>
    {/if}
    {#if !layer.facts?.tiles}
      <span class="sep" aria-hidden="true"></span>
      <span class="item">{layer.geometryType}</span>
    {/if}
    {#if layer.truncated}
      <span class="sep" aria-hidden="true"></span>
      <span class="item truncated">
        Showing {nf.format(layer.rowCount)} of {nf.format(layer.totalRows)}
      </span>
    {/if}
    {#if draw?.mode && !layer.facts?.tiles}
      <!-- Spec 010: GeoJSON drawn once, or engine tiles, and the switch between them. -->
      <span class="sep" aria-hidden="true"></span>
      <span class="item draw">
        <Icon name="layers" size={12} />
        {#if draw.loading}
          Loading features…{draw.progress !== null ? ` ${nf.format(draw.progress)}` : ''}
        {:else if draw.mode === 'tiles'}
          <span title={LOAD_ALL_TIP}>Tiles</span>
          <button type="button" class="link" title={LOAD_ALL_TIP} onclick={draw.onLoadAll}>Load all</button>
        {:else}
          All drawn{draw.features !== null ? ` · ${nf.format(draw.features)} ${draw.features === 1 ? 'feature' : 'features'}` : ''}
          {#if draw.loadedAll}
            <button type="button" class="link" title="Draw from tiles again: quicker to show, the engine builds what is in view" onclick={draw.onDrawAsTiles}>Draw as tiles</button>
          {/if}
        {/if}
      </span>
    {/if}
    <span class="spacer"></span>
    <span class="item cursor" title="Cursor coordinates (lat, lon)">
      {#if session.cursorCoordinates}
        {session.cursorCoordinates.lat.toFixed(5)}, {session.cursorCoordinates.lon.toFixed(5)}
      {/if}
    </span>
  </div>
{:else if facts}
  {@const n = facts.rows - (facts.invalid ?? 0)}
  <div class="status-bar" class:docked role="status">
    <span class="item crs" class:assumed={facts.crsAssumed}>{facts.crs.label}{facts.crsAssumed ? ' · assumed' : ''}</span>
    <span class="sep" aria-hidden="true"></span>
    <span class="item">{nf.format(n)} {facts.invalid === null ? (n === 1 ? 'row' : 'rows') : n === 1 ? 'feature' : 'features'}</span>
    <span class="sep" aria-hidden="true"></span>
    <span class="item">{facts.geometryType}</span>
  </div>
{/if}

<style>
  .status-bar.docked {
    position: static;
    flex: none;
    backdrop-filter: none;
  }
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
  .draw {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .link {
    padding: 0 4px;
    border: 0;
    border-radius: var(--se-radius);
    background: transparent;
    color: var(--se-statusbar-accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .link:hover {
    background: var(--se-control-hover);
  }
  .link:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
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
