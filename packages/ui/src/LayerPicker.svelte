<script lang="ts">
  // Spec 010 layout Option A (T050): the layers of a file holding several
  // (GeoPackage, SQLite), as a compact select next to the search box. Spec
  // 008 FR-015/FR-016: each option names the geometry type and feature count.
  interface Props {
    layers: ReadonlyArray<{ name: string; geometryType: string | null; featureCount: number | null; group?: string | null }>
    /** Spec 013: layers read through the experimental geodatabase reader. */
    experimental?: boolean
    active: string | null
    busy: boolean
    onSwitch: (name: string) => void
  }
  let { layers, active, busy, experimental = false, onSwitch }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  /** Feature datasets (a geodatabase's folders) as groups; layers outside one come first, ungrouped. */
  const grouped = $derived.by(() => {
    const out: Array<{ group: string | null; layers: typeof layers }> = []
    for (const l of layers) {
      const g = l.group ?? null
      const hit = out.find((o) => o.group === g)
      if (hit) (hit.layers as Array<(typeof layers)[number]>).push(l)
      else out.push({ group: g, layers: [l] })
    }
    return out.sort((a, b) => (a.group === null ? -1 : b.group === null ? 1 : 0))
  })
  const describe = (l: (typeof layers)[number]): string => `${l.name}, ${l.geometryType ?? 'table'}${l.featureCount !== null ? `, ${nf.format(l.featureCount)}` : ''}`
</script>

<label class="layer-picker" title={experimental ? `This geodatabase has ${layers.length} layers. File Geodatabase support is experimental until the SQL engine reads the format itself.` : `This file has ${layers.length} layers`}>
  <span class="label">Layer</span>
  {#if experimental}<span class="badge">experimental</span>{/if}
  <select
    aria-label="Layer"
    disabled={busy}
    value={active ?? ''}
    onchange={(e) => {
      const name = e.currentTarget.value
      if (name && name !== active) onSwitch(name)
    }}
  >
    {#each grouped as g (g.group ?? '')}
      {#if g.group !== null && grouped.length > 1}
        <optgroup label={g.group}>
          {#each g.layers as l (l.name)}<option value={l.name}>{describe(l)}</option>{/each}
        </optgroup>
      {:else}
        {#each g.layers as l (l.name)}<option value={l.name}>{describe(l)}</option>{/each}
      {/if}
    {/each}
  </select>
</label>

<style>
  .layer-picker {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    width: var(--se-stack-width, auto);
    box-sizing: border-box;
    max-width: 100%;
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
  .badge {
    flex: none;
    padding: 0 5px;
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    font-size: 0.85em;
    line-height: 16px;
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
