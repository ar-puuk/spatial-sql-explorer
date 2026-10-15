<script lang="ts">
  // Spec 012: the Basemap side panel. The current basemap as a large preview
  // (with "Follow the theme"), a search over every basemap with results in
  // the panel, the featured basemaps as a grid of real previews, and "More
  // basemaps…" for the gallery. Previews: basemapPreviews.svelte.ts.
  //
  // Until the user picks one, the theme's default (Positron or Dark) is the
  // checked entry and follows theme changes (FR-009/FR-017); "Follow the
  // theme" turns that back on. Blank's color matches the theme by default;
  // the user can set their own, which is remembered (HostAdapter.saveState).
  import { BASEMAP_CATALOG, GALLERY, findGalleryBasemap, getBlankBasemap, getDefaultBasemap, searchGallery, type BasemapChoice, type GalleryBasemap } from '@spatial-explorer/core'
  import { tick } from 'svelte'
  import BasemapThumb from './BasemapThumb.svelte'
  import Icon from './Icon.svelte'
  import { featuredPreview, galleryPreview, tilePreview, type BasemapPreview } from './basemapPreviews.svelte.js'

  interface Props {
    /** The entry actually shown (the theme default while following the theme). */
    activeId: string
    followingTheme: boolean
    appearance: 'light' | 'dark'
    blankColor: string | null
    notice: string | null
    /** Providers with a stored API key. */
    keys: Readonly<Record<string, boolean>>
    onChoose: (choice: BasemapChoice) => void
    /** A gallery basemap: 'needsKey' when it asks for a key first (the gallery's key form takes it). */
    onChooseGallery: (id: string) => Promise<'applied' | 'needsKey'>
    /** A keyed gallery row's URLs with its key, for its preview. */
    previewUrls: (id: string) => Promise<{ url?: string; tiles?: string[] } | null>
    /** Opens the gallery, searching for `query`. */
    onMore: (query?: string) => void
    onBlankColor: (color: string | null) => void
    onClose: () => void
  }
  let { activeId, followingTheme, appearance, blankColor, notice, keys, onChoose, onChooseGallery, previewUrls, onMore, onBlankColor, onClose }: Props = $props()

  const themeDefaultId = $derived(getDefaultBasemap(appearance).id)
  const lightName = getDefaultBasemap('light').name
  const darkName = getDefaultBasemap('dark').name
  let blankInput = $state<HTMLInputElement>()
  let grid = $state<HTMLDivElement>()
  let resultsList = $state<HTMLUListElement>()

  /** The gallery row for a featured id (its provider and kind). */
  const galleryOf = (id: string): GalleryBasemap | undefined => GALLERY.find((g) => g.featuredId === id)
  const activeGallery = $derived(activeId.startsWith('g-') ? findGalleryBasemap(activeId) : undefined)

  // --- The current basemap ------------------------------------------------------
  const current = $derived.by(() => {
    if (activeGallery) return { name: activeGallery.name, detail: `${activeGallery.providerName} · ${kindName(activeGallery.kind)}` }
    const entry = BASEMAP_CATALOG.find((e) => e.id === activeId)
    if (!entry || entry.type === 'blank') return { name: 'Blank', detail: blankColor ? `Background ${blankColor.toUpperCase()}` : 'Background matches the theme' }
    const g = galleryOf(entry.id)
    return { name: entry.name, detail: g ? `${g.providerName} · ${kindName(g.kind)}` : kindName(entry.type) }
  })
  const kindName = (kind: string): string => (kind === 'raster' ? 'Raster' : 'Vector')

  /** Keyed raster rows' previews, resolved with their key (by id). */
  const resolved = $state<Record<string, BasemapPreview>>({})
  // Plain bookkeeping, never rendered from.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const requested = new Set<string>()
  function previewOf(g: GalleryBasemap): BasemapPreview {
    return galleryPreview(g, !!keys[g.provider]) ?? resolved[g.id] ?? { kind: 'none' }
  }
  // The rows shown that need their key's URLs: the current one and the results.
  $effect(() => {
    for (const g of [activeGallery, ...matches.slice(0, RESULTS)]) {
      if (!g || g.kind !== 'raster' || requested.has(g.id) || galleryPreview(g, !!keys[g.provider])) continue
      requested.add(g.id)
      void previewUrls(g.id).then((urls) => (resolved[g.id] = tilePreview(g, urls?.tiles)))
    }
  })
  const currentPreview = $derived(activeGallery ? previewOf(activeGallery) : featuredPreview(activeId, blankColor))

  function setFollow(on: boolean): void {
    onChoose(on ? 'auto' : activeId)
  }

  // --- Search ------------------------------------------------------------------
  const RESULTS = 12
  let query = $state('')
  let search = $state('')
  let debounce: ReturnType<typeof setTimeout> | null = null
  function onSearchInput(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => (search = query.trim()), 100)
  }
  const blankRow = getBlankBasemap()
  /** Matches, the ones usable now first (no key needed, or one stored): Enter takes the first. */
  const matches = $derived.by(() => {
    const found = search ? searchGallery(search) : []
    const ready = (g: GalleryBasemap): boolean => g.key !== 'required' || !!keys[g.provider]
    return [...found.filter(ready), ...found.filter((g) => !ready(g))]
  })
  const blankMatches = $derived(!!search && search.split(/\s+/).every((w) => 'blank none empty'.includes(w.toLowerCase())))
  const total = $derived(matches.length + (blankMatches ? 1 : 0))

  const isActive = (g: GalleryBasemap): boolean => g.id === activeId || (!!g.featuredId && g.featuredId === activeId)

  async function chooseResult(g: GalleryBasemap): Promise<void> {
    if ((await onChooseGallery(g.id)) === 'needsKey') onMore(search)
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && query) {
      // Clears the search first; a second Escape closes the panel.
      e.stopPropagation()
      query = ''
      search = ''
    } else if (e.key === 'ArrowDown' && search) {
      e.preventDefault()
      resultsList?.querySelector<HTMLElement>('button')?.focus()
    } else if (e.key === 'Enter' && search) {
      e.preventDefault()
      resultsList?.querySelector<HTMLElement>('button')?.click()
    }
  }

  function onResultsKeydown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(resultsList?.querySelectorAll<HTMLElement>('button') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowUp' && i <= 0) (document.querySelector('.basemap-search input') as HTMLElement | null)?.focus()
    else items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  // --- The featured grid (a radio group; arrows move in two dimensions) --------
  const COLUMNS = 3
  function onGridKeydown(e: KeyboardEvent): void {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }
    if (!(e.key in moves) && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const n = BASEMAP_CATALOG.length
    const i = BASEMAP_CATALOG.findIndex((o) => o.id === activeId)
    let next: number
    if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    // From a gallery basemap (not in the grid), arrows start at the grid's ends.
    else if (i < 0) next = moves[e.key] > 0 ? 0 : n - 1
    else next = Math.max(0, Math.min(n - 1, i + moves[e.key]))
    const entry = BASEMAP_CATALOG[next]
    onChoose(entry.id)
    void tick().then(() => grid?.querySelector<HTMLElement>(`[data-basemap="${entry.id}"]`)?.focus())
  }

  function onPanelKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      onClose()
      e.stopPropagation()
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="panel" role="region" aria-label="Basemap" onkeydown={onPanelKeydown}>
  <div class="scroll">
    <div class="current">
      <div class="current-preview"><BasemapThumb preview={currentPreview} label={current.name} /></div>
      <div class="current-text">
        <span class="current-name">{current.name}</span>
        <span class="current-detail" title={current.detail}>{current.detail}</span>
      {#if activeId === 'blank'}
        <div class="blank-tools">
          <button type="button" class="tool" title="Choose blank background color" aria-label="Choose blank background color" onclick={() => blankInput?.click()}>
            <Icon name="paint" size={14} />Color…
          </button>
          {#if blankColor}
            <button type="button" class="tool" title="Match theme color" aria-label="Match theme color" onclick={() => onBlankColor(null)}>
              <Icon name="reset" size={14} />Theme color
            </button>
          {/if}
        </div>
      {/if}
      </div>
      <label class="follow" title="{lightName} on a light theme, {darkName} on a dark one">
        <input type="checkbox" checked={followingTheme} onchange={(e) => setFollow(e.currentTarget.checked)} />
        Follow the theme ({lightName} or {darkName})
      </label>
    </div>

    <!-- The blank color's input lives outside the current card so it survives Blank being chosen by it. -->
    <input
      bind:this={blankInput}
      class="color-input"
      type="color"
      tabindex="-1"
      aria-hidden="true"
      value={blankColor ?? '#808080'}
      oninput={(e) => {
        onBlankColor(e.currentTarget.value)
        if (activeId !== 'blank') onChoose('blank')
      }}
    />

    <label class="basemap-search">
      <Icon name="search" size={14} />
      <input type="search" placeholder="Search {GALLERY.length + 1} basemaps" aria-label="Find a basemap" bind:value={query} oninput={onSearchInput} onkeydown={onSearchKeydown} />
    </label>

    {#if search}
      <div class="results" role="group" aria-label="Search results">
        {#if !total}
          <p class="empty">No basemap matches “{search}”.</p>
        {:else}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <ul bind:this={resultsList} onkeydown={onResultsKeydown}>
            {#if blankMatches}
              <li>
                <button type="button" class="result" class:active={activeId === 'blank'} aria-pressed={activeId === 'blank'} onclick={() => onChoose('blank')}>
                  <span class="result-thumb"><BasemapThumb preview={featuredPreview('blank', blankColor)} compact /></span>
                  <span class="result-text"><span class="result-name">{blankRow.name}</span><span class="result-detail">No basemap</span></span>
                  {#if activeId === 'blank'}<Icon name="check" size={14} />{/if}
                </button>
              </li>
            {/if}
            {#each matches.slice(0, RESULTS) as g (g.id)}
              {@const active = isActive(g)}
              <li>
                <button type="button" class="result" class:active aria-pressed={active} onclick={() => void chooseResult(g)}>
                  <span class="result-thumb"><BasemapThumb preview={previewOf(g)} compact /></span>
                  <span class="result-text">
                    <span class="result-name">{g.name}</span>
                    <span class="result-detail">{g.providerName} · {kindName(g.kind)}{g.key === 'required' && !keys[g.provider] ? ' · Needs key' : ''}</span>
                  </span>
                  {#if active}<Icon name="check" size={14} />{/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if total > RESULTS}
            <button type="button" class="link" onclick={() => onMore(search)}>All {total} results in the gallery…</button>
          {/if}
        {/if}
      </div>
    {:else}
      <h3 id="basemap-featured">Featured</h3>
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="grid" role="radiogroup" aria-labelledby="basemap-featured" bind:this={grid} onkeydown={onGridKeydown}>
        {#each BASEMAP_CATALOG as entry (entry.id)}
          {@const checked = entry.id === activeId}
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            tabindex={checked || (!BASEMAP_CATALOG.some((e) => e.id === activeId) && entry === BASEMAP_CATALOG[0]) ? 0 : -1}
            data-basemap={entry.id}
            class="card"
            class:checked
            title={entry.name}
            onclick={() => onChoose(entry.id)}
          >
            <span class="card-thumb">
              <BasemapThumb preview={featuredPreview(entry.id, blankColor)} label={entry.name} />
              {#if checked}<span class="badge"><Icon name="check" size={12} /></span>{/if}
            </span>
            <span class="card-name">{entry.name}</span>
            {#if entry.type === 'blank'}
              <span class="card-detail">{blankColor ? blankColor.toUpperCase() : 'Theme color'}</span>
            {:else if entry.id === themeDefaultId && followingTheme}
              <span class="card-detail">Theme default</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    <button type="button" class="more-button" onclick={() => onMore(search)}>More basemaps…</button>
    {#if notice}
      <p class="notice" role="status"><Icon name="warning" size={14} />{notice}</p>
    {/if}
  </div>
  <p class="credit">Previews: © OpenStreetMap contributors and each provider</p>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  .scroll {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 12px 12px;
  }
  /* The current basemap at the thumbnails' own size (120x72), its name beside it. */
  .current {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    gap: 8px 10px;
    align-items: start;
  }
  .current-preview {
    width: 120px;
    height: 72px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius);
    overflow: hidden;
  }
  .current-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding-top: 2px;
  }
  .current .follow {
    grid-column: 1 / -1;
  }
  .current-name {
    font-weight: 600;
  }
  .current-detail,
  .result-detail,
  .card-detail {
    color: var(--se-text-secondary);
    font-size: 0.9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .follow {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .follow input {
    margin: 0;
    accent-color: var(--se-accent);
  }
  .blank-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .tool:hover {
    background: var(--se-button-secondary-hover);
  }
  .color-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }
  .basemap-search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
  }
  .basemap-search:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .basemap-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  h3 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 6px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card-thumb {
    position: relative;
    display: block;
    aspect-ratio: 5 / 3;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .card:hover .card-thumb {
    border-color: var(--se-text-secondary);
  }
  /* The checked card: a ring and a check badge, not color alone (high contrast too). */
  .card.checked .card-thumb {
    border-color: var(--se-focus);
    box-shadow: 0 0 0 1px var(--se-focus);
  }
  .card:focus-visible {
    outline: none;
  }
  .card:focus-visible .card-thumb {
    outline: 2px solid var(--se-focus);
    outline-offset: 1px;
  }
  .badge {
    position: absolute;
    top: 3px;
    right: 3px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--se-focus);
    color: var(--se-button-fg, #fff);
  }
  .card-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card.checked .card-name {
    font-weight: 600;
  }
  .results ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .result:hover {
    background: var(--se-bg-hover);
  }
  .result.active {
    background: var(--se-selected-inactive-bg);
    color: var(--se-selected-inactive-fg);
  }
  .result:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .result-thumb {
    flex: none;
    width: 50px;
    height: 30px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .result-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .result-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    margin: 0;
    color: var(--se-text-secondary);
  }
  .link {
    margin-top: 4px;
    padding: 2px 4px;
    border: 0;
    background: transparent;
    color: var(--se-link, var(--se-focus));
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .more-button {
    width: 100%;
    height: 26px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .more-button:hover {
    background: var(--se-button-secondary-hover);
  }
  .more-button:focus-visible,
  .tool:focus-visible,
  .link:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .notice {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 6px 8px;
    border-left: 2px solid var(--se-warning);
    background: color-mix(in srgb, var(--se-warning) 12%, transparent);
    border-radius: var(--se-radius-sm);
    font-size: 0.92em;
    line-height: 1.4;
  }
  .notice > :global(.icon) {
    margin-top: 2px;
    color: var(--se-warning);
  }
  .credit {
    margin: 0;
    padding: 6px 12px 8px;
    border-top: 1px solid var(--se-border);
    color: var(--se-text-muted);
    font-size: 10.5px;
  }
  @media (forced-colors: active) {
    .card.checked .card-thumb {
      outline: 2px solid Highlight;
    }
  }
</style>
