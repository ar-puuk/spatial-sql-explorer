<script lang="ts">
  // Spec 016: the atlas (map series) settings (GeoLibre's AtlasEditor): one page per feature of the layer, or a run of
  // pages along its lines, each page the same layout framed on its own part of the map.
  import Segmented from '../kit/Segmented.svelte'
  import Select from '../kit/Select.svelte'
  import Switch from '../kit/Switch.svelte'
  import { MAX_LINE_ATLAS_PAGES } from './atlas.js'
  import type { PrintComposer } from './composer.svelte.js'

  interface Props {
    c: PrintComposer
  }
  let { c }: Props = $props()
  const l = $derived(c.layout)
  const a = $derived(c.atlas)
  const fieldOptions = (none: string): Array<{ value: string; label: string }> => [{ value: '', label: none }, ...a.fields.map((f) => ({ value: f, label: f }))]
</script>

<section aria-label="Atlas">
  <h3>Atlas</h3>
  <div class="toggle">
    <span id="atlas-switch">Generate a multi-page map series</span>
    <Switch labelledby="atlas-switch" checked={l.atlasEnabled} disabled={!a.supported} onChange={(v) => c.set({ atlasEnabled: v })} />
  </div>
  {#if !a.supported}
    <p class="hint">An atlas needs the flat map: switch the globe off.</p>
  {:else if l.atlasEnabled}
    <div class="block">
      <div class="row">
        <span>Coverage</span>
        <Segmented
          label="Atlas coverage"
          value={l.atlasCoverage}
          onChange={(v) => {
            c.set({ atlasCoverage: v as 'features' | 'line' })
            a.index = 0
          }}
          options={[
            { value: 'features', label: 'One page per feature' },
            { value: 'line', label: 'Pages along a line' },
          ]}
        />
      </div>
      {#if l.atlasCoverage === 'line'}
        <label class="row">
          <span>Segment length (km)</span>
          <input type="text" inputmode="decimal" aria-label="Segment length in kilometers" value={l.atlasSegmentKm} oninput={(e) => c.set({ atlasSegmentKm: e.currentTarget.value.replace(/[^0-9.]/g, '') })} />
        </label>
        {#if !a.segmentValid}<p class="error" role="alert">A segment is at least 0.1 km.</p>{/if}
        {#if !a.loading && a.lineFeatureCount === 0}<p class="error" role="alert">The layer has no line features to walk.</p>{/if}
        {#if a.count >= MAX_LINE_ATLAS_PAGES}<p class="hint">Stopped at {MAX_LINE_ATLAS_PAGES.toLocaleString('en-US')} pages: a longer segment makes fewer.</p>{/if}
      {/if}
      <div class="row">
        <span>Page name field</span>
        <div class="grow"><Select label="Page name field" value={l.atlasNameField} onChange={(v) => c.set({ atlasNameField: v })} options={fieldOptions('Feature number')} /></div>
      </div>
      <div class="row">
        <span>Page extent</span>
        <Segmented
          label="Atlas page extent"
          value={l.atlasExtentMode}
          onChange={(v) => c.set({ atlasExtentMode: v as 'margin' | 'scale' })}
          options={[
            { value: 'margin', label: 'Margin' },
            ...(c.isMmPage ? [{ value: 'scale', label: 'Fixed scale' }] : []),
          ]}
        />
      </div>
      {#if l.atlasExtentMode === 'margin' || !c.isMmPage}
        <label class="row">
          <span>Margin (%)</span>
          <input type="number" min="0" max="100" aria-label="Margin around the feature, percent" value={l.atlasMarginPct} oninput={(e) => c.set({ atlasMarginPct: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} />
        </label>
      {:else}
        <label class="row">
          <span>Scale (1:N)</span>
          <input type="text" inputmode="numeric" aria-label="Atlas scale" value={l.atlasScale} oninput={(e) => c.set({ atlasScale: e.currentTarget.value.replace(/[^0-9]/g, '') })} />
        </label>
        {#if !a.scaleValid}<p class="error" role="alert">Enter a scale.</p>{/if}
        {#if a.scaleNotice}<p class="error" role="alert">{a.scaleNotice}</p>{/if}
      {/if}
      {#if l.atlasCoverage === 'features'}
        <div class="toggle">
          <span id="atlas-mask">Mask area outside the current feature</span>
          <Switch labelledby="atlas-mask" checked={l.atlasMaskEnabled} onChange={(v) => c.set({ atlasMaskEnabled: v })} />
        </div>
        <p class="hint">For polygon layers: everything outside the page's feature is dimmed.</p>
        <div class="row">
          <span>Sort by</span>
          <div class="grow"><Select label="Atlas sort field" value={l.atlasSortField} onChange={(v) => c.set({ atlasSortField: v })} options={fieldOptions('Source order')} /></div>
        </div>
        <div class="row">
          <span>Order</span>
          <Segmented label="Atlas sort order" value={l.atlasSortDescending ? 'desc' : 'asc'} onChange={(v) => c.set({ atlasSortDescending: v === 'desc' })} options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]} />
        </div>
      {/if}
      <label class="row">
        <span>Filter</span>
        <input type="text" aria-label="Atlas filter" placeholder={'POP2000 > 100000 and ST = "CA"'} value={l.atlasFilter} oninput={(e) => c.set({ atlasFilter: e.currentTarget.value })} />
      </label>
      {#if a.predicate === null}<p class="error" role="alert">Use =, !=, &gt;, &gt;=, &lt;, &lt;= or contains, joined with and.</p>{/if}
      <label class="row">
        <span>Page file name</span>
        <input type="text" aria-label="Page file name" value={l.atlasFilenamePattern} oninput={(e) => c.set({ atlasFilenamePattern: e.currentTarget.value })} />
      </label>
      <p class="count" role="status">
        {#if a.loading}Reading the layer…{:else if a.count > 0}{a.count.toLocaleString('en-US')} {a.count === 1 ? 'page' : 'pages'}{:else}No pages: nothing in the layer matches.{/if}
        {#if a.truncated}<span class="hint"> The layer has more than {a.features.length.toLocaleString('en-US')} features; only these are read.</span>{/if}
      </p>
      <p class="hint">In the title, subtitle, footer and file name: {'{atlas.name}'}, {'{atlas.pagenumber}'}, {'{atlas.total}'} and {'{atlas.attr:FIELD}'}.</p>
      {#if l.atlasCoverage === 'line'}<p class="hint">Along a line, {'{atlas.attr:km_start}'}, km_end, segment and segments are also there.</p>{/if}
    </div>
  {/if}
</section>

<style>
  section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
  }
  h3 {
    margin: 0 0 2px;
    font: var(--se-section-title-font);
    color: var(--se-text-primary);
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
  }
  .block {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    min-width: 0;
  }
  .row > span:first-child {
    flex: none;
    width: 112px;
    color: var(--se-text-secondary);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  input[type='text'],
  input[type='number'] {
    flex: 1;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    padding: 2px 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
  }
  input[type='number'] {
    flex: none;
    width: 72px;
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .count {
    margin: 0;
    font-weight: 500;
  }
  .error {
    margin: 0;
    color: var(--se-error-fg, var(--se-error));
  }
</style>
