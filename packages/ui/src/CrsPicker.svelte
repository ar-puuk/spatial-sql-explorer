<script lang="ts">
  // Spec 008 (user request): the export CRS picker. A dropdown of every CRS
  // the engine knows (core's EPSG catalog), with the usual ones pinned on top
  // and the ones whose area of use holds the data suggested, then grouped as
  // QGIS and ArcGIS group them (Geographic; UTM, State Plane, World; by
  // projection method). The search box finds a CRS by code, name or area.
  //
  // ARIA: the search box is a combobox whose popup is a tree (sections with
  // aria-expanded, CRS rows inside); focus stays in the box and the arrows
  // move aria-activedescendant (WAI-ARIA combobox pattern).
  import { onDestroy, tick } from 'svelte'
  import { loadCrsCatalog, PINNED_CRS, searchCrs, suggestCrs, type Bbox, type CrsCatalog, type CrsEntry } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  /** 'result': the result's own CRS; a number: that EPSG code. */
  type Choice = 'result' | number

  interface Props {
    id: string
    value: Choice
    /** The result's CRS, e.g. "EPSG:26912 (NAD83 / UTM zone 12N)". */
    resultLabel: string
    resultSrid: number | null
    /** The data's WGS84 extent, for suggestions. */
    extent: Bbox | null
    disabled?: boolean
    /** Text shown instead of the choice when disabled (a format that requires WGS84). */
    disabledLabel?: string
    describedBy?: string
    invalid?: boolean
    /** The chosen code's name, when known without the list (the engine's check). */
    valueName?: string | null
    onChoose: (choice: Choice) => void
  }
  let { id, value, resultLabel, resultSrid, extent, disabled = false, disabledLabel, describedBy, invalid = false, valueName = null, onChoose }: Props = $props()

  let catalog = $state.raw<CrsCatalog | null>(null)
  let loadError = $state<string | null>(null)
  let open = $state(false)
  /** The search box's text, and the query the list follows (a beat behind while typing). */
  let query = $state('')
  let q = $state('')
  let active = $state(0)
  let expanded = $state<Record<string, boolean>>({})
  let trigger = $state<HTMLButtonElement>()
  let search = $state<HTMLInputElement>()
  let panel = $state<HTMLDivElement>()
  let tree = $state<HTMLDivElement>()
  let place = $state<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null)
  const treeId = $derived(`${id}-tree`)

  const triggerText = $derived.by(() => {
    if (disabled && disabledLabel) return disabledLabel
    if (value === 'result') return `${resultLabel} · as the result`
    const name = valueName ?? catalog?.byCode.get(value)?.name ?? null
    return name ? `EPSG:${value} · ${name}` : `EPSG:${value}`
  })

  // --- The list: one flat array of rows, of which only the visible ones are in the DOM ---------
  type Item = { choice: Choice; label: string; code: number | null; area?: string }
  type Row =
    | { kind: 'section'; name: string; count: number; fixed: boolean; open: boolean }
    | { kind: 'item'; item: Item; pos: number; size: number }
  const itemOf = (e: CrsEntry): Item => ({ choice: e.code, label: e.name, code: e.code, area: e.area })

  /** The CRSs whose area holds the data: computed once per list and extent. */
  const suggested = $derived(catalog ? suggestCrs(catalog.entries, extent, 6) : [])

  const rows = $derived.by((): Row[] => {
    if (!catalog) return []
    const out: Row[] = []
    const add = (name: string, items: Item[], fixed: boolean, isOpen: boolean) => {
      out.push({ kind: 'section', name, count: items.length, fixed, open: isOpen })
      if (isOpen) items.forEach((item, pos) => out.push({ kind: 'item', item, pos: pos + 1, size: items.length }))
    }
    if (!q) {
      const pinned: Item[] = [
        { choice: 'result', label: `${resultLabel} · as the result`, code: resultSrid ?? null },
        ...PINNED_CRS.filter((c) => c !== resultSrid).flatMap((c) => {
          const e = catalog!.byCode.get(c)
          return e ? [itemOf(e)] : []
        }),
      ]
      add('Pinned', pinned, true, true)
      const shown = new Set<number>([...PINNED_CRS, ...(resultSrid ? [resultSrid] : [])])
      const sugg = suggested.filter((e) => !shown.has(e.code)).map(itemOf)
      if (sugg.length) add('Suggested for this data', sugg, true, true)
      for (const g of catalog.groups) {
        const entries = catalog.byGroup.get(g) ?? []
        // Items are built only for an open group (UTM alone holds 1,156).
        if (expanded[g]) add(g, entries.map(itemOf), false, true)
        else out.push({ kind: 'section', name: g, count: entries.length, fixed: false, open: false })
      }
      return out
    }
    const hits = searchCrs(catalog.entries, q, 400)
    // A typed code the list doesn't hold can still be used (the engine checks it).
    const typed = /^\s*(?:epsg\s*:?)?\s*(\d{3,6})\s*$/i.exec(q)
    if (typed && !catalog.byCode.has(Number(typed[1]))) add('Other code', [{ choice: Number(typed[1]), label: `Use EPSG:${typed[1]}`, code: null }], true, true)
    // A local, built per search: not state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byGroup = new Map<string, Item[]>()
    for (const e of hits) {
      const list = byGroup.get(e.group)
      if (list) list.push(itemOf(e))
      else byGroup.set(e.group, [itemOf(e)])
    }
    for (const g of catalog.groups) {
      const items = byGroup.get(g)
      if (items) add(g, items, true, true)
    }
    return out
  })
  const rowId = (i: number): string => `${id}-r${i}`
  const activeRow = $derived(rows[active] ?? null)
  const isChosen = (it: Item): boolean => it.choice === value
  /** The section a row belongs to (its index). */
  function sectionOf(i: number): number {
    for (let j = i; j >= 0; j--) if (rows[j].kind === 'section') return j
    return 0
  }

  // Virtual scrolling: fixed-height rows, plus a margin above and below the view.
  const ROW = 22
  const OVERSCAN = 12
  let scrollTop = $state(0)
  let viewHeight = $state(320)
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN))
  const last = $derived(Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW) + OVERSCAN))
  const visible = $derived(rows.slice(first, last).map((r, k) => ({ r, i: first + k })))

  // Typing: the list follows a beat behind, so each key doesn't rebuild it.
  let typing: ReturnType<typeof setTimeout> | null = null
  function onInput(): void {
    if (typing) clearTimeout(typing)
    const next = query.trim()
    if (!next) {
      q = ''
      return
    }
    typing = setTimeout(() => {
      typing = null
      q = query.trim()
    }, 90)
  }
  // A new search starts at the first result, at the top.
  $effect(() => {
    void q
    const i = rows.findIndex((r) => r.kind === 'item')
    active = i < 0 ? 0 : i
    if (tree) tree.scrollTop = 0
    scrollTop = 0
  })

  async function show(): Promise<void> {
    if (disabled || open) return
    open = true
    query = ''
    q = ''
    placePanel()
    if (!catalog && !loadError) {
      try {
        catalog = await loadCrsCatalog()
      } catch (err) {
        loadError = `The CRS list could not be loaded: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    await tick()
    // Start on the current choice.
    const i = rows.findIndex((r) => r.kind === 'item' && isChosen(r.item))
    active = i >= 0 ? i : 0
    search?.focus()
    scrollActive()
  }

  function hide(refocus = true): void {
    if (!open) return
    open = false
    query = ''
    q = ''
    if (typing) clearTimeout(typing)
    if (refocus) trigger?.focus()
  }

  function choose(it: Item): void {
    onChoose(it.choice)
    hide()
  }

  function toggle(i: number): void {
    const r = rows[i]
    if (!r || r.kind !== 'section' || r.fixed || q) return
    expanded = { ...expanded, [r.name]: !r.open }
  }

  function placePanel(): void {
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const useAbove = below < 240 && above > below
    place = { left: r.left, top: useAbove ? r.top - 2 : r.bottom + 2, width: r.width, maxHeight: Math.min(380, Math.max(160, useAbove ? above : below)), above: useAbove }
  }

  /** Keeps the active row in view (it must be rendered: aria-activedescendant points at it). */
  function scrollActive(): void {
    if (!tree) return
    const top = active * ROW
    const h = tree.clientHeight || viewHeight
    if (top < tree.scrollTop) tree.scrollTop = top
    else if (top + ROW > tree.scrollTop + h) tree.scrollTop = top + ROW - h
    scrollTop = tree.scrollTop
  }

  function onSearchKey(e: KeyboardEvent): void {
    const r = activeRow
    const move = (to: number) => {
      e.preventDefault()
      active = Math.max(0, Math.min(rows.length - 1, to))
      scrollActive()
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1)
      case 'ArrowUp':
        return move(active - 1)
      case 'PageDown':
        return move(active + 10)
      case 'PageUp':
        return move(active - 10)
      case 'Home':
        if (!query) return move(0)
        return
      case 'End':
        if (!query) return move(rows.length - 1)
        return
      case 'ArrowRight':
        if (r?.kind === 'section' && !r.open) {
          e.preventDefault()
          toggle(active)
        }
        return
      case 'ArrowLeft':
        if (r?.kind === 'section' && r.open && !r.fixed && !q) {
          e.preventDefault()
          toggle(active)
        } else if (r?.kind === 'item' && !q) {
          move(sectionOf(active))
        }
        return
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        if (typing) {
          // Enter right after typing: search now, then take the first result.
          clearTimeout(typing)
          typing = null
          q = query.trim()
          void tick().then(() => {
            const hit = rows.find((x) => x.kind === 'item')
            if (hit?.kind === 'item') choose(hit.item)
          })
          return
        }
        if (r?.kind === 'item') choose(r.item)
        else if (r) toggle(active)
        return
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        hide()
        return
      case 'Tab':
        hide(false)
        return
    }
  }

  function onTriggerKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      void show()
    }
  }

  // A click outside closes the panel; so do scrolling and resizing outside it (it is placed on screen).
  function onDocPointer(e: PointerEvent): void {
    if (!open) return
    const t = e.target as Node
    if (panel?.contains(t) || trigger?.contains(t)) return
    hide(false)
  }
  function onDocScroll(e: Event): void {
    if (open && !(e.target instanceof Node && panel?.contains(e.target))) placePanel()
  }
  $effect(() => {
    if (!open) return
    document.addEventListener('pointerdown', onDocPointer, true)
    window.addEventListener('resize', placePanel)
    document.addEventListener('scroll', onDocScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true)
      window.removeEventListener('resize', placePanel)
      document.removeEventListener('scroll', onDocScroll, true)
    }
  })
  onDestroy(() => {
    open = false
    if (typing) clearTimeout(typing)
  })
  const nf = new Intl.NumberFormat('en-US')
</script>

<button
  {id}
  bind:this={trigger}
  type="button"
  class="trigger"
  class:invalid
  aria-haspopup="tree"
  aria-expanded={open}
  aria-describedby={describedBy}
  {disabled}
  onclick={() => (open ? hide() : void show())}
  onkeydown={onTriggerKey}
>
  <span class="text">{triggerText}</span>
  <Icon name="chevron-down" size={14} />
</button>

{#if open && place}
  <div
    class="panel"
    class:above={place.above}
    bind:this={panel}
    style:left="{place.left}px"
    style:top="{place.top}px"
    style:width="{place.width}px"
    style:max-height="{place.maxHeight}px"
  >
    <div class="search">
      <Icon name="search" size={14} />
      <input
        bind:this={search}
        bind:value={query}
        type="text"
        role="combobox"
        aria-label="Search coordinate reference systems"
        aria-expanded="true"
        aria-controls={treeId}
        aria-autocomplete="list"
        aria-activedescendant={activeRow ? rowId(active) : undefined}
        placeholder="Search by EPSG code, name or area"
        autocomplete="off"
        spellcheck="false"
        oninput={onInput}
        onkeydown={onSearchKey}
      />
    </div>
    {#if loadError}
      <p class="empty" role="alert">{loadError}</p>
    {:else if !catalog}
      <p class="empty" role="status">Loading the CRS list…</p>
    {:else if rows.length === 0}
      <p class="empty" role="status">No CRS matches “{q}”.</p>
    {:else}
      <div
        class="tree"
        id={treeId}
        role="tree"
        aria-label="Coordinate reference systems"
        bind:this={tree}
        bind:clientHeight={viewHeight}
        onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
      >
        <div class="spacer" style:height="{rows.length * ROW}px">
          {#each visible as { r, i } (i)}
            {#if r.kind === 'section'}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                role="treeitem"
                tabindex="-1"
                id={rowId(i)}
                aria-level={1}
                aria-expanded={r.open}
                aria-selected="false"
                class="row section"
                class:active={active === i}
                class:fixed={r.fixed}
                style:top="{i * ROW}px"
                onpointerdown={(e) => e.preventDefault()}
                onclick={() => {
                  active = i
                  toggle(i)
                }}
              >
                {#if !r.fixed}<span class="twisty" class:open={r.open}><Icon name="chevron-down" size={12} /></span>{/if}
                <span class="section-name">{r.name}</span>
                <span class="count">{nf.format(r.count)}</span>
              </div>
            {:else}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                role="treeitem"
                tabindex="-1"
                id={rowId(i)}
                aria-level={2}
                aria-posinset={r.pos}
                aria-setsize={r.size}
                aria-selected={isChosen(r.item)}
                class="row item"
                class:active={active === i}
                class:chosen={isChosen(r.item)}
                style:top="{i * ROW}px"
                title={r.item.area ? `${r.item.label}\n${r.item.area}` : r.item.label}
                onpointerdown={(e) => e.preventDefault()}
                onpointermove={() => (active = i)}
                onclick={() => choose(r.item)}
              >
                <span class="check">{#if isChosen(r.item)}<Icon name="check" size={12} />{/if}</span>
                <span class="name">{r.item.label}{#if r.item.area && q}<span class="area">{r.item.area}</span>{/if}</span>
                {#if r.item.code !== null}<span class="code">{r.item.code}</span>{/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 0 4px 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .trigger.invalid {
    border-color: var(--se-error-border, var(--se-error));
  }
  .trigger:disabled {
    opacity: 0.7;
    cursor: default;
  }
  .trigger:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .trigger .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 280px;
    overflow: hidden;
    border: 1px solid var(--se-menu-border, var(--se-control-border));
    border-radius: var(--se-radius-sm);
    background: var(--se-menu-bg, var(--se-bg-elevated));
    color: var(--se-menu-fg, var(--se-text-primary));
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .panel.above {
    transform: translateY(-100%);
  }
  .search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin: 4px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
  }
  .search:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  .tree {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin-bottom: 4px;
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    box-sizing: border-box;
  }
  .empty {
    margin: 0;
    padding: 8px 10px;
    color: var(--se-text-secondary);
  }
  .section {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px 0 4px;
    background: var(--se-menu-bg, var(--se-bg-elevated));
    color: var(--se-section-title-fg, var(--se-text-secondary));
    font-weight: 600;
    cursor: pointer;
    user-select: none;
  }
  .section.fixed {
    padding-left: 8px;
    cursor: default;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .twisty {
    display: inline-grid;
    place-items: center;
    width: 14px;
    transform: rotate(-90deg);
    transition: transform 0.1s;
  }
  .twisty.open {
    transform: none;
  }
  .section-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count,
  .code {
    flex: none;
    color: var(--se-text-secondary);
    font-variant-numeric: tabular-nums;
    font-weight: normal;
  }
  .item {
    font-weight: normal;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px 0 4px;
    cursor: pointer;
  }
  .check {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 16px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .area {
    margin-left: 8px;
    color: var(--se-text-secondary);
  }
  .section.active,
  .item.active {
    background: var(--se-menu-hover-bg, var(--se-bg-hover));
    color: var(--se-menu-hover-fg, var(--se-text-primary));
    outline: 1px solid var(--se-selected-outline, transparent);
    outline-offset: -1px;
  }
  .item.active .code,
  .item.active .area {
    color: inherit;
  }
  @media (prefers-reduced-motion: reduce) {
    .twisty {
      transition: none;
    }
  }
</style>
