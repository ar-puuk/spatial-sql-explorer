<script lang="ts">
  // Attribute grid. Row virtualization, sticky header, sort,
  // scroll-selected-into-view and zoom-to-feature follow GeoLibre's
  // AttributeTable (design-plan.md §8.1); the implementation is our own and
  // simpler, since every row here is the same height.
  //
  // Spec 007 (FR-011): the table pages the whole result from the engine,
  // PAGE_SIZE rows at a time, as they scroll into view; sorting is SQL over
  // the whole result. Rows still loading show as placeholders (aria-busy).
  //
  // Spec 008 (FR-008–FR-012): hidden columns aren't rendered; each header
  // cell carries its column's filter under the sort button (one header row,
  // so row counts stay as they were); a checkbox column ticks rows, with a
  // tri-state "all matching" box in the header.
  import { onMount, untrack } from 'svelte'
  import { PAGE_SIZE, type ColumnFilter as Filter, type Feature, type Layer, type Selection, type TablePage } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import ColumnFilter from './ColumnFilter.svelte'

  interface Props {
    layer: Layer | null
    loading: boolean
    /** Rows in the whole result. */
    total: number
    /** Bumps when the result or sort changes: loaded pages are discarded. */
    revision: number
    sort: { column: string; dir: 'asc' | 'desc' } | null
    loadPage: (offset: number) => Promise<TablePage | null>
    onSort: (sort: { column: string; dir: 'asc' | 'desc' } | null) => void
    selectedFeatureId: string | number | null
    onSelectFeature: (id: string | number | null) => void
    onZoomToFeature: (id: string | number) => void
    /** Spec 008: columns not shown (FR-008). */
    hiddenColumns?: ReadonlySet<string>
    /** Spec 008: the filters, by column (FR-010); null hides the filter row. */
    filters?: readonly Filter[] | null
    onFilter?: (column: string, filter: Filter | null) => void
    /** Spec 008: the ticked rows (FR-012). */
    selection?: Selection
    onToggleSelect?: (id: number, selected: boolean) => void
    onSelectAll?: (selected: boolean) => void
  }
  let {
    layer,
    loading,
    total,
    revision,
    sort,
    loadPage,
    onSort,
    selectedFeatureId,
    onSelectFeature,
    onZoomToFeature,
    hiddenColumns = new Set<string>(),
    filters = null,
    onFilter = () => {},
    selection = { kind: 'ids', ids: new Set<number>() },
    onToggleSelect = () => {},
    onSelectAll = () => {},
  }: Props = $props()

  type Value = Feature['attributes'][string] | undefined
  type Row = TablePage['rows'][number]
  const OVERSCAN = 8
  const MIN_COL = 56
  const MAX_AUTO_COL = 320

  let scroller: HTMLDivElement | undefined = $state()
  let rowHeight = $state(24)
  let viewportHeight = $state(0)
  let scrollTop = $state(0)
  let widths = $state<Record<string, number>>({})

  // Loaded pages of the current revision, by page index.
  let pages = $state.raw<Map<number, TablePage>>(new Map())
  // Pages being fetched: bookkeeping only, never rendered.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let pending = new Set<number>()
  let loadedRevision = -1
  /** The keyboard cursor (a row index), which may sit on a row still loading. */
  let activeIndex = $state(-1)

  // Spec 002: rows whose geometry is missing or invalid are listed, not drawn.
  let hasGeometry = $derived(!!layer && layer.featureCount + layer.invalidGeometryCount > 0)
  let firstPage = $derived(pages.get(0))
  let allColumns = $derived(firstPage && firstPage.rows.length > 0 ? Object.keys(firstPage.rows[0].attributes) : (layer?.columns.map((c) => c.name) ?? []))
  let columns = $derived(allColumns.filter((c) => !hiddenColumns.has(c)))
  const typeOf = (col: string): string => layer?.columns.find((c) => c.name === col)?.type ?? 'VARCHAR'
  const filterOf = (col: string): Filter | null => filters?.find((f) => f.column === col) ?? null
  const showFilters = $derived(filters !== null)
  const isSelected = (id: number | string): boolean => selection.kind === 'all-matching' || (typeof id === 'number' && selection.ids.has(id))
  const headerState = $derived<'true' | 'false' | 'mixed'>(
    selection.kind === 'all-matching' ? 'true' : selection.ids.size === 0 ? 'false' : selection.ids.size >= total && total > 0 ? 'true' : 'mixed'
  )
  const CHECK_W = 28

  // A new result or sort: drop loaded pages, back to the top.
  $effect(() => {
    const r = revision
    if (r === loadedRevision) return
    loadedRevision = r
    pages = new Map()
    pending = new Set()
    activeIndex = -1
    syncedIndex = -1
    if (scroller) scroller.scrollTop = 0
    scrollTop = 0
  })

  // A new file: column widths start over.
  $effect(() => {
    void layer?.id
    widths = {}
  })

  async function ensurePage(index: number): Promise<void> {
    if (index < 0 || index * PAGE_SIZE >= total || pages.has(index) || pending.has(index)) return
    const rev = revision
    pending.add(index)
    try {
      const page = await loadPage(index * PAGE_SIZE)
      if (rev !== revision || !page) return
      // `pages` is $state.raw and replaced whole, so a plain Map is right here.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const next = new Map(pages)
      next.set(index, page)
      pages = next
    } finally {
      if (rev === revision) pending.delete(index)
    }
  }

  function rowAt(index: number): Row | null {
    return pages.get(Math.floor(index / PAGE_SIZE))?.rows[index % PAGE_SIZE] ?? null
  }

  let first = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN))
  let last = $derived(Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN))
  // (The header is sticky and at most two rows tall: OVERSCAN covers the difference.)

  // Load the pages the visible window needs.
  $effect(() => {
    void revision
    if (loading || total === 0) return
    const from = Math.floor(first / PAGE_SIZE)
    const to = Math.floor(Math.max(first, last - 1) / PAGE_SIZE)
    for (let p = from; p <= to; p++) void ensurePage(p)
  })

  let visible = $derived(Array.from({ length: Math.max(0, last - first) }, (_, i) => ({ index: first + i, row: (void pages, rowAt(first + i)) })))

  /** Auto width from the header and the first page's values; resizable afterwards. */
  function autoWidth(col: string): number {
    let chars = col.length + 3
    for (const r of firstPage?.rows ?? []) chars = Math.max(chars, display(r.attributes[col]).length)
    return Math.min(MAX_AUTO_COL, Math.max(MIN_COL + 24, chars * 7.2 + 20))
  }
  let colWidths = $derived(columns.map((c) => widths[c] ?? autoWidth(c)))
  let idWidth = $derived(Math.max(44, String(total).length * 8 + 20))
  let tableWidth = $derived(CHECK_W + idWidth + colWidths.reduce((a, b) => a + b, 0))
  /** The sticky header: one row, or two lines tall with the filter inputs. */
  let headerHeight = $derived(showFilters ? rowHeight * 2 : rowHeight)

  function display(v: Value): string {
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  function toggleSort(col: string): void {
    if (!sort || sort.column !== col) onSort({ column: col, dir: 'asc' })
    else if (sort.dir === 'asc') onSort({ column: col, dir: 'desc' })
    else onSort(null)
  }

  function ariaSort(col: string): 'ascending' | 'descending' | 'none' {
    return sort?.column === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
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
  /** The selected row's index, when its page is loaded. */
  let selectedIndex = $derived.by(() => {
    if (selectedFeatureId === null) return -1
    for (const [p, page] of pages) {
      const i = page.rows.findIndex((r) => r.id === selectedFeatureId)
      if (i >= 0) return p * PAGE_SIZE + i
    }
    return -1
  })

  /** Scrolls a row into view only if it isn't already fully visible ("auto" alignment). */
  function ensureVisible(index: number): void {
    if (!scroller || index < 0) return
    // Row i starts below the sticky header.
    const top = headerHeight + index * rowHeight
    const bottom = top + rowHeight
    if (top < scroller.scrollTop + headerHeight) scroller.scrollTop = top - headerHeight
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
  }

  // Selection made on the map: bring its row into view (when it's loaded).
  // Follows selection changes only: a keyboard move across pages (End) sets
  // the cursor before its row loads, and must not be pulled back to the old
  // selection meanwhile.
  let syncedIndex = -1
  $effect(() => {
    const index = selectedIndex
    if (index < 0 || index === syncedIndex) return
    syncedIndex = index
    if (index !== untrack(() => activeIndex)) {
      activeIndex = index
      ensureVisible(index)
    }
  })

  /** Moves the cursor; selects the row there, waiting for its page if needed. */
  async function moveTo(index: number): Promise<void> {
    if (total === 0) return
    const next = Math.min(total - 1, Math.max(0, index))
    activeIndex = next
    ensureVisible(next)
    let row = rowAt(next)
    if (!row) {
      await ensurePage(Math.floor(next / PAGE_SIZE))
      if (activeIndex !== next) return
      row = rowAt(next)
    }
    if (row) onSelectFeature(row.id)
  }

  function handleKeydown(e: KeyboardEvent): void {
    const page = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1)
    const base = activeIndex >= 0 ? activeIndex : selectedIndex
    switch (e.key) {
      case 'ArrowDown':
        void moveTo(base < 0 ? 0 : base + 1)
        break
      case 'ArrowUp':
        void moveTo(base < 0 ? total - 1 : base - 1)
        break
      case 'PageDown':
        void moveTo(base < 0 ? 0 : base + page)
        break
      case 'PageUp':
        void moveTo(base < 0 ? 0 : base - page)
        break
      case 'Home':
        void moveTo(0)
        break
      case 'End':
        void moveTo(total - 1)
        break
      case 'Enter':
        if (selectedFeatureId !== null) onZoomToFeature(selectedFeatureId)
        break
      case ' ': {
        // Spec 008 FR-012: Space ticks the row under the cursor.
        const row = activeIndex >= 0 ? rowAt(activeIndex) : null
        if (row && typeof row.id === 'number') onToggleSelect(row.id, !isSelected(row.id))
        break
      }
      case 'Escape':
        onSelectFeature(null)
        break
      default:
        return
    }
    e.preventDefault()
  }

  onMount(() => {
    if (!scroller) return
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
  onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
  style:--row-h="{rowHeight}px"
>
  {#if loading}
    <p class="placeholder">Loading…</p>
  {:else if !layer || (total === 0 && !(filters ?? []).some((f) => f.valid))}
    <p class="placeholder">No features to display.</p>
  {:else}
    {@const activeRow = activeIndex >= 0 ? rowAt(activeIndex) : null}
    <table
      style:min-width="{tableWidth}px"
      role="grid"
      aria-label="Attribute table"
      aria-rowcount={total + 1}
      aria-colcount={columns.length + 2}
      aria-activedescendant={activeRow ? `row-${String(activeRow.id)}` : undefined}
      tabindex="0"
      onkeydown={handleKeydown}
    >
      <colgroup>
        <col style:width="{CHECK_W}px" />
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
        <tr aria-rowindex={1} style:height="{headerHeight}px">
          <th class="check" scope="col" role="columnheader">
            <input
              type="checkbox"
              aria-label="Select all matching rows"
              checked={headerState === 'true'}
              indeterminate={headerState === 'mixed'}
              aria-checked={headerState}
              onchange={(e) => onSelectAll(e.currentTarget.checked)}
            />
          </th>
          <th class="id" scope="col" role="columnheader">#</th>
          {#each columns as col, i (col)}
            <th scope="col" role="columnheader" aria-sort={ariaSort(col)} title={col}>
              <button type="button" class="sort" onclick={() => toggleSort(col)}>
                <span class="label">{col}</span>
                {#if sort?.column === col}
                  <Icon name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />
                {/if}
              </button>
              {#if showFilters}
                <div class="filter-cell">
                  <ColumnFilter column={col} type={typeOf(col)} filter={filterOf(col)} onChange={(f) => onFilter(col, f)} />
                </div>
              {/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="resizer" onpointerdown={(e) => startResize(e, col, i)}></span>
            </th>
          {/each}
          <th class="filler" aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        {#if first > 0}
          <tr class="spacer" aria-hidden="true" style:height="{first * rowHeight}px"><td colspan={columns.length + 3}></td></tr>
        {/if}
        {#each visible as { index, row } (row ? `r${String(row.id)}` : `i${index}`)}
          {#if row}
            <tr
              id="row-{String(row.id)}"
              aria-rowindex={index + 2}
              aria-selected={row.id === selectedFeatureId}
              class:odd={index % 2 === 1}
              class:selected={row.id === selectedFeatureId}
              class:ticked={isSelected(row.id)}
              onclick={() => {
                activeIndex = index
                onSelectFeature(row.id)
              }}
              ondblclick={() => onZoomToFeature(row.id)}
            >
              <td class="check" role="gridcell">
                <input
                  type="checkbox"
                  aria-label="Select row {index + 1}"
                  checked={isSelected(row.id)}
                  onclick={(e) => e.stopPropagation()}
                  onchange={(e) => typeof row.id === 'number' && onToggleSelect(row.id, e.currentTarget.checked)}
                />
              </td>
              <td class="id" role="gridcell">
                {#if hasGeometry && row.invalidGeometry}<span class="no-geom" title="No valid geometry: listed here, not drawn on the map" aria-label="no geometry">∅</span>{/if}{index + 1}
              </td>
              {#each columns as col (col)}
                {@const v = row.attributes[col]}
                <td role="gridcell" class:num={typeof v === 'number'} class:null={v === null || v === undefined} title={display(v)}>{display(v)}</td>
              {/each}
              <td class="filler" aria-hidden="true"></td>
            </tr>
          {:else}
            <tr class="skeleton" aria-rowindex={index + 2} aria-busy="true" class:odd={index % 2 === 1}>
              <td class="check" role="gridcell"></td>
              <td class="id" role="gridcell">{index + 1}</td>
              <td role="gridcell" colspan={columns.length}><span class="bar"></span></td>
              <td class="filler" aria-hidden="true"></td>
            </tr>
          {/if}
        {/each}
        {#if last < total}
          <tr class="spacer" aria-hidden="true" style:height="{(total - last) * rowHeight}px"><td colspan={columns.length + 3}></td></tr>
        {/if}
      </tbody>
    </table>
    {#if total === 0}
      <p class="placeholder" role="status">No rows match the filters.</p>
    {/if}
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
  thead tr {
    vertical-align: top;
  }
  th.check,
  td.check {
    width: 28px;
    padding: 0;
    text-align: center;
  }
  th.check {
    padding-top: calc((var(--row-h) - 14px) / 2);
  }
  th.check input,
  td.check input {
    margin: 0;
    accent-color: var(--se-accent);
    cursor: pointer;
  }
  .filter-cell {
    padding: 0 6px 4px 6px;
  }
  tbody tr.ticked {
    box-shadow: inset 2px 0 0 var(--se-accent);
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
  /* Spec 007: a row whose page is still loading. */
  tr.skeleton .bar {
    display: block;
    width: 60%;
    height: 8px;
    border-radius: 4px;
    background: var(--se-table-row-border);
    opacity: 0.6;
  }
  .placeholder {
    margin: 0;
    padding: 16px;
    color: var(--se-text-secondary);
  }
</style>
