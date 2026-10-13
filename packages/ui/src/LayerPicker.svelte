<script lang="ts">
  // Spec 010 layout Option A (T050): the layers of a file holding several
  // (GeoPackage, SQLite), as a compact select next to the search box. Spec
  // 008 FR-015/FR-016: each option names the geometry type and feature count.
  interface Props {
    layers: ReadonlyArray<{ name: string; geometryType: string | null; featureCount: number | null }>
    active: string | null
    busy: boolean
    onSwitch: (name: string) => void
  }
  let { layers, active, busy, onSwitch }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const describe = (l: (typeof layers)[number]): string => `${l.name}, ${l.geometryType ?? 'table'}${l.featureCount !== null ? `, ${nf.format(l.featureCount)}` : ''}`
</script>

<label class="layer-picker" title="This file has {layers.length} layers">
  <span class="label">Layer</span>
  <select
    aria-label="Layer"
    disabled={busy}
    value={active ?? ''}
    onchange={(e) => {
      const name = e.currentTarget.value
      if (name && name !== active) onSwitch(name)
    }}
  >
    {#each layers as l (l.name)}
      <option value={l.name}>{describe(l)}</option>
    {/each}
  </select>
</label>

<style>
  .layer-picker {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    max-width: 260px;
    padding: 0 4px 0 8px;
    background: var(--se-control-bg);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    box-shadow: var(--se-shadow-card);
    color: var(--se-text-secondary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    pointer-events: auto;
  }
  .layer-picker:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .label {
    flex: none;
  }
  select {
    min-width: 0;
    flex: 1;
    height: 24px;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    text-overflow: ellipsis;
  }
  select option {
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
  }
</style>
