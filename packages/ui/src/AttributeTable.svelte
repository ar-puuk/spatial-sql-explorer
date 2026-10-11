<script lang="ts">
  // Attribute grid. Row virtualization, sticky header, client-side sort,
  // scroll-selected-into-view and zoom-to-feature follow GeoLibre's
  // AttributeTable (design-plan.md §8.1); the implementation is our own and
  // simpler, since every row here is the same height.
  //
  // Sorting reorders only the loaded rows (at most DEFAULT_FEATURE_CAP); it is
  // a view affordance, not a query — ordering the whole source is the SQL
  // editor's job (spec 002).
  import { onMount } from 'svelte'
  import type { Feature, Layer } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    layer: Layer | null
    loading: boolean
    selectedFeatureId: string | number | null
    onSelectFeature: (id: string | number | null) => void
    onZoomToFeature: (id: string | number) => void
  }
  let { layer, loading, selectedFeatureId, onSelectFeature, onZoomToFeature }: Props = $props()

  type Value = Feature['attributes'][string] | undefined
  const OVERSCAN = 8
  const MIN_COL = 56
  const MAX_AUTO_COL = 320

  let scroller: HTMLDivElement
  let rowHeight = $state(24)
  let viewportHeight = $state(0)
  let scrollTop = $state(0)
  let sort = $state<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  let widths = $state<Record<string, number>>({})

  // Spec 002: rows whose geometry is missing or invalid are listed, not drawn.
  let hasGeometry = $derived(!!layer && layer.featureCount + layer.invalidGeometryCount > 0)
  let columns = $derived(layer && layer.features.length > 0 ? Object.keys(layer.features[0].attributes) : [])

  // Reset per-layer view state when a different file is opened.
  $effect(() => {
    void layer
    sort = null
    widths = {}
    if (scroller) scroller.scrollTop = 0
  })

  function compare(a: Value, b: Value): number {
    const an = a === null || a === undefined
    const bn = b === null || b === undefined
    if (an || bn) return an && bn ? 0 : an ? 1 : -1 // nulls last, whatever the direction
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }

  let rows = $derived.by(() => {
    const features = layer?.features ?? []
    if (!sort) return features
    const { key, dir } = sort
    const sign = dir === 'asc' ? 1 : -1
    return [...features].sort((x, y) => {
      const xv = x.attributes[key]
      const yv = y.attributes[key]
      if (xv === null || xv === undefined || yv === null || yv === undefined) return compare(xv, yv)
      return sign * compare(xv, yv)
    })
  })

  let first = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN))
  let last = $derived(Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN))
  let visible = $derived(rows.slice(first, last))

  /** Auto width from the header and a sample of values; resizable afterwards. */
  function autoWidth(col: string): number {
    let chars = col.length + 3
    const sample = layer?.features.slice(0, 200) ?? []
    for (const f of sample) chars = Math.max(chars, display(f.attributes[col]).length)
    return Math.min(MAX_AUTO_COL, Math.max(MIN_COL + 24, chars * 7.2 + 20))
  }
  let colWidths = $derived(columns.map((c) => widths[c] ?? autoWidth(c)))
  let idWidth = $derived(Math.max(44, String(layer?.features.length ?? 0).length * 8 + 20))
  let tableWidth = $derived(idWidth + colWidths.reduce((a, b) => a + b, 0))

  function display(v: Value): string {
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  function toggleSort(col: string): void {
    if (!sort || sort.key !== col) sort = { key: col, dir: 'asc' }
    else if (sort.dir === 'asc') sort = { key: col, dir: 'desc' }
    else sort = null
  }

  function ariaSort(col: string): 'ascending' | 'descending' | 'none' {
    return sort?.key === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  }

  // --- column resize -------------------------------------------------------
  function startResize(e: PointerEvent, col: string, index: number): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[index]
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      widths = { ...widths, [col]: Math.max(MIN_COL, startW + ev.clientX - startX) }
    }
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  // --- selection + keyboard ------------------------------------------------
  let selectedIndex = $derived(selectedFeatureId === null ? -1 : rows.findIndex((f) => f.id === selectedFeatureId))

  /** Scrolls a row into view only if it isn't already fully visible ("auto" alignment). */
  function ensureVisible(index: number): void {
    if (!scroller || index < 0) return
    // Row i starts below the sticky header, which occupies the top row slot.
    const top = (index + 1) * rowHeight
    const bottom = top + rowHeight
    if (top < scroller.scrollTop + rowHeight) scroller.scrollTop = top - rowHeight
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
  }

  // Selection made on the map: bring its row into view.
  $effect(() => {
    const index = selectedIndex
    if (index >= 0) ensureVisible(index)
  })

  function moveSelection(delta: number): void {
    if (rows.length === 0) return
    const base = selectedIndex < 0 ? (delta > 0 ? -1 : rows.length) : selectedIndex
    const next = Math.min(rows.length - 1, Math.max(0, base + delta))
    onSelectFeature(rows[next].id)
  }

  function handleKeydown(e: KeyboardEvent): void {
    const page = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1)
    switch (e.key) {
      case 'ArrowDown':
        moveSelection(1)
        break
      case 'ArrowUp':
        moveSelection(-1)
        break
      case 'PageDown':
        moveSelection(page)
        break
      case 'PageUp':
        moveSelection(-page)
        break
      case 'Home':
        if (rows.length > 0) onSelectFeature(rows[0].id)
        break
      case 'End':
        if (rows.length > 0) onSelectFeature(rows[rows.length - 1].id)
        break
      case 'Enter':
        if (selectedFeatureId !== null) onZoomToFeature(selectedFeatureId)
        break
      case 'Escape':
        onSelectFeature(null)
        break
      default:
        return
    }
    e.preventDefault()
  }

  onMount(() => {
    const raw = parseFloat(getComputedStyle(scroller).getPropertyValue('--se-row-height'))
    if (Number.isFinite(raw) && raw > 0) rowHeight = raw
  })
</script>

<!-- The scroll container is presentational; the <table> is the ARIA grid
     (it owns the rows) and the keyboard focus target. -->
<div
  class="attribute-table"
  bind:this={scroller}
  bind:clientHeight={viewportHeight}
  onscroll={() => (scrollTop = scroller.scrollTop)}
  style:--row-h="{rowHeight}px"
>
  {#if loading}
    <p class="placeholder">Loading…</p>
  {:else if !layer || layer.features.length === 0}
    <p class="placeholder">No features to display.</p>
  {:else}
    <table
      style:min-width="{tableWidth}px"
      role="grid"
      aria-label="Attribute table"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + 1}
      aria-activedescendant={selectedIndex >= 0 ? `row-${String(rows[selectedIndex].id)}` : undefined}
      tabindex="0"
      onkeydown={handleKeydown}
    >
      <colgroup>
        <col style:width="{idWidth}px" />
        {#each colWidths as w, i (columns[i])}
          <col style:width="{w}px" />
        {/each}
        <!-- Absorbs leftover width so sized columns keep their widths when
             the grid is wider than its columns (fixed layout would otherwise
             spread the slack across every column). -->
        <col />
      </colgroup>
      <thead>
        <tr aria-rowindex={1}>
          <th class="id" scope="col" role="columnheader">#</th>
          {#each columns as col, i (col)}
            <th scope="col" role="columnheader" aria-sort={ariaSort(col)} title={col}>
              <button type="button" class="sort" onclick={() => toggleSort(col)}>
                <span class="label">{col}</span>
                {#if sort?.key === col}
                  <Icon name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />
                {/if}
              </button>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="resizer" onpointerdown={(e) => startResize(e, col, i)}></span>
            </th>
          {/each}
          <th class="filler" aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        {#if first > 0}
          <tr class="spacer" aria-hidden="true" style:height="{first * rowHeight}px"><td colspan={columns.length + 2}></td></tr>
        {/if}
        {#each visible as feature, i (feature.id)}
          {@const index = first + i}
          <tr
            id="row-{String(feature.id)}"
            aria-rowindex={index + 2}
            aria-selected={feature.id === selectedFeatureId}
            class:odd={index % 2 === 1}
            class:selected={feature.id === selectedFeatureId}
            onclick={() => onSelectFeature(feature.id)}
            ondblclick={() => onZoomToFeature(feature.id)}
          >
            <td class="id" role="gridcell">
              {#if hasGeometry && feature.geometry === null}<span class="no-geom" title="No valid geometry: listed here, not drawn on the map" aria-label="no geometry">∅</span>{/if}{typeof feature.id === 'number' ? feature.id + 1 : feature.id}
            </td>
            {#each columns as col (col)}
              {@const v = feature.attributes[col]}
              <td role="gridcell" class:num={typeof v === 'number'} class:null={v === null || v === undefined} title={display(v)}>{display(v)}</td>
            {/each}
            <td class="filler" aria-hidden="true"></td>
          </tr>
        {/each}
        {#if last < rows.length}
          <tr class="spacer" aria-hidden="true" style:height="{(rows.length - last) * rowHeight}px"><td colspan={columns.length + 2}></td></tr>
        {/if}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .attribute-table {
    position: relative;
    overflow: auto;
    height: 100%;
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    color: var(--se-text-primary);
    background: var(--se-table-bg);
    outline: none;
  }
  table:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  table {
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    height: var(--row-h);
    padding: 0;
    background: var(--se-table-header-bg);
    color: var(--se-table-header-fg);
    border-bottom: var(--se-table-header-border);
    font: var(--se-table-header-font);
    text-transform: var(--se-table-header-transform);
    letter-spacing: var(--se-table-header-tracking);
    text-align: left;
    white-space: nowrap;
  }
  thead th.id {
    padding: 0 8px;
    text-align: right;
    font-family: var(--se-font-mono);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: var(--row-h);
    padding: 0 10px 0 8px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sort:hover {
    color: var(--se-text-primary);
  }
  .sort:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .resizer {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    border-right: 1px solid var(--se-border);
  }
  .resizer:hover {
    border-right: 2px solid var(--se-sash-hover);
  }

  tbody tr {
    height: var(--row-h);
    cursor: default;
  }
  tbody tr.odd {
    background: var(--se-table-stripe);
  }
  tbody tr:hover {
    background: var(--se-bg-hover);
  }
  td {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-bottom: 1px solid var(--se-table-row-border);
    font-family: var(--se-font-data);
    font-variant-numeric: tabular-nums;
  }
  td.id {
    text-align: right;
    color: var(--se-text-muted);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  .no-geom {
    margin-right: 4px;
    color: var(--se-warning-fg);
    font-family: var(--se-font-ui);
  }
  td.num {
    text-align: right;
    color: var(--se-table-number-fg);
  }
  td.null {
    color: var(--se-text-muted);
    font-family: var(--se-font-mono);
    font-size: 0.85em;
    letter-spacing: 0.04em;
  }

  /* Selection follows VS Code's list semantics: the strong color only when
     the grid has focus, the "inactive" color otherwise (e.g. a map click). */
  tbody tr.selected {
    background: var(--se-selected-inactive-bg);
    color: var(--se-selected-inactive-fg);
    box-shadow: inset 2px 0 0 var(--se-selected-indicator);
  }
  .attribute-table:focus-within tbody tr.selected {
    background: var(--se-selected-bg);
    color: var(--se-selected-fg);
    outline: 1px solid var(--se-selected-outline);
    outline-offset: -1px;
  }
  tbody tr.selected td.id,
  tbody tr.selected td.num,
  tbody tr.selected td.null {
    color: inherit;
  }
  tr.spacer,
  tr.spacer td {
    padding: 0;
    border: 0;
    background: transparent;
  }
  .placeholder {
    margin: 0;
    padding: 16px;
    color: var(--se-text-secondary);
  }
</style>
