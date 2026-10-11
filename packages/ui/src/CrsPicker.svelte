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
    onChoose: (choice: Choice) => void
  }
  let { id, value, resultLabel, resultSrid, extent, disabled = false, disabledLabel, describedBy, invalid = false, onChoose }: Props = $props()

  let catalog = $state.raw<CrsCatalog | null>(null)
  let loadError = $state<string | null>(null)
  let open = $state(false)
  let query = $state('')
  let active = $state(0)
  let expanded = $state<Record<string, boolean>>({ Pinned: true, 'Suggested for this data': true })
  let trigger = $state<HTMLButtonElement>()
  let search = $state<HTMLInputElement>()
  let panel = $state<HTMLDivElement>()
  let place = $state<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null)
  const treeId = $derived(`${id}-tree`)

  const byCode = $derived(new Map(catalog?.entries.map((e) => [e.code, e]) ?? []))
  // A chosen code shows its name without opening the list.
  $effect(() => {
    if (typeof value === 'number' && !catalog && !loadError) {
      void loadCrsCatalog()
        .then((c) => (catalog = c))
        .catch(() => {})
    }
  })
  const nameOf = (code: number): string | null => byCode.get(code)?.name ?? null

  const triggerText = $derived.by(() => {
    if (disabled && disabledLabel) return disabledLabel
    if (value === 'result') return `${resultLabel} · as the result`
    const name = nameOf(value)
    return name ? `EPSG:${value} · ${name}` : `EPSG:${value}`
  })

  type Item = { key: string; choice: Choice; label: string; code: number | null; area?: string }
  type Section = { name: string; items: Item[]; count: number; fixed?: boolean }
  const itemOf = (e: CrsEntry): Item => ({ key: `c${e.code}`, choice: e.code, label: e.name, code: e.code, area: e.area })

  const sections = $derived.by((): Section[] => {
    if (!catalog) return []
    const q = query.trim()
    const pinned: Item[] = [
      { key: 'result', choice: 'result', label: `${resultLabel} · as the result`, code: resultSrid ?? null },
      ...PINNED_CRS.filter((c) => c !== resultSrid)
        .map((c) => byCode.get(c))
        .filter((e): e is CrsEntry => !!e)
        .map(itemOf),
    ]
    if (!q) {
      const shown = new Set<number>([...PINNED_CRS, ...(resultSrid ? [resultSrid] : [])])
      const suggested = suggestCrs(catalog.entries, extent, 6)
        .filter((e) => !shown.has(e.code))
        .map(itemOf)
      const entries = catalog.entries
      const groups = catalog.groups.map((g) => {
        const items = entries.filter((e) => e.group === g).map(itemOf)
        return { name: g, items, count: items.length }
      })
      return [{ name: 'Pinned', items: pinned, count: pinned.length, fixed: true }, ...(suggested.length ? [{ name: 'Suggested for this data', items: suggested, count: suggested.length, fixed: true }] : []), ...groups]
    }
    const hits = searchCrs(catalog.entries, q, 400)
    const out: Section[] = []
    // A typed code the catalog doesn't hold can still be used (the engine checks it).
    const typed = /^\s*(?:epsg\s*:?)?\s*(\d{3,6})\s*$/i.exec(q)
    if (typed && !byCode.has(Number(typed[1]))) {
      const code = Number(typed[1])
      out.push({ name: 'Other code', items: [{ key: `c${code}`, choice: code, label: `Use EPSG:${code}`, code: null }], count: 1, fixed: true })
    }
    for (const g of catalog.groups) {
      const items = hits.filter((e) => e.group === g).map(itemOf)
      if (items.length) out.push({ name: g, items, count: items.length })
    }
    return out
  })

  /** While searching every section is open; otherwise as the user left them. */
  const isOpen = (s: Section): boolean => !!query.trim() || !!s.fixed || !!expanded[s.name]

  type Row = { kind: 'section'; section: Section; rowId: string } | { kind: 'item'; item: Item; section: Section; rowId: string }
  const rows = $derived.by((): Row[] => {
    const out: Row[] = []
    sections.forEach((s, si) => {
      out.push({ kind: 'section', section: s, rowId: `${id}-s${si}` })
      if (isOpen(s)) s.items.forEach((item, ii) => out.push({ kind: 'item', item, section: s, rowId: `${id}-s${si}-${ii}` }))
    })
    return out
  })
  const activeRow = $derived(rows[active] ?? null)
  const isChosen = (it: Item): boolean => it.choice === value

  async function show(): Promise<void> {
    if (disabled || open) return
    open = true
    query = ''
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
    if (refocus) trigger?.focus()
  }

  function choose(it: Item): void {
    onChoose(it.choice)
    hide()
  }

  function toggle(s: Section): void {
    if (s.fixed || query.trim()) return
    expanded = { ...expanded, [s.name]: !expanded[s.name] }
  }

  function placePanel(): void {
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const useAbove = below < 240 && above > below
    place = { left: r.left, top: useAbove ? r.top - 2 : r.bottom + 2, width: r.width, maxHeight: Math.min(380, Math.max(160, useAbove ? above : below)), above: useAbove }
  }

  function scrollActive(): void {
    void tick().then(() => {
      const r = rows[active]
      if (r) document.getElementById(r.rowId)?.scrollIntoView({ block: 'nearest' })
    })
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
        if (r?.kind === 'section' && !isOpen(r.section)) {
          e.preventDefault()
          toggle(r.section)
        }
        return
      case 'ArrowLeft':
        if (r?.kind === 'section' && isOpen(r.section) && !r.section.fixed && !query) {
          e.preventDefault()
          toggle(r.section)
        } else if (r?.kind === 'item' && !query) {
          e.preventDefault()
          move(rows.findIndex((x) => x.kind === 'section' && x.section === r.section))
        }
        return
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        if (r?.kind === 'item') choose(r.item)
        else if (r) toggle(r.section)
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
  // A new search starts at the first result.
  $effect(() => {
    void query
    active = rows.findIndex((r) => r.kind === 'item')
    if (active < 0) active = 0
  })
  onDestroy(() => {
    open = false
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
        aria-activedescendant={activeRow?.rowId}
        placeholder="Search by EPSG code, name or area"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onSearchKey}
      />
    </div>
    {#if loadError}
      <p class="empty" role="alert">{loadError}</p>
    {:else if !catalog}
      <p class="empty" role="status">Loading the CRS list…</p>
    {:else if sections.length === 0}
      <p class="empty" role="status">No CRS matches “{query.trim()}”.</p>
    {:else}
      <div class="tree" id={treeId} role="tree" aria-label="Coordinate reference systems">
        {#each sections as s, si (s.name)}
          {@const sid = `${id}-s${si}`}
          <div role="treeitem" tabindex="-1" id={sid} aria-expanded={isOpen(s)} aria-level={1} aria-selected="false" class="section-item">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="section"
              class:active={activeRow?.rowId === sid}
              class:fixed={s.fixed}
              onpointerdown={(e) => e.preventDefault()}
              onclick={() => {
                active = rows.findIndex((r) => r.rowId === sid)
                toggle(s)
              }}
            >
              {#if !s.fixed && !query.trim()}<span class="twisty" class:open={isOpen(s)}><Icon name="chevron-down" size={12} /></span>{/if}
              <span class="section-name">{s.name}</span>
              <span class="count">{nf.format(s.count)}</span>
            </div>
            {#if isOpen(s)}
              <div role="group">
                {#each s.items as it, ii (it.key)}
                  {@const rid = `${sid}-${ii}`}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    role="treeitem"
                    tabindex="-1"
                    id={rid}
                    aria-level={2}
                    aria-selected={isChosen(it)}
                    class="item"
                    class:active={activeRow?.rowId === rid}
                    class:chosen={isChosen(it)}
                    title={it.area ? `${it.label}\n${it.area}` : it.label}
                    onpointerdown={(e) => e.preventDefault()}
                    onpointermove={() => (active = rows.findIndex((r) => r.rowId === rid))}
                    onclick={() => choose(it)}
                  >
                    <span class="check">{#if isChosen(it)}<Icon name="check" size={12} />{/if}</span>
                    <span class="name">{it.label}{#if it.area && query.trim()}<span class="area">{it.area}</span>{/if}</span>
                    {#if it.code !== null}<span class="code">{it.code}</span>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
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
    padding-bottom: 4px;
  }
  .empty {
    margin: 0;
    padding: 8px 10px;
    color: var(--se-text-secondary);
  }
  .section {
    position: sticky;
    top: 0;
    z-index: 1;
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
