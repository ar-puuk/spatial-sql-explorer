<script lang="ts">
  // Spec 010 T043: "More basemaps…", a searchable modal over the generated
  // gallery (basemapGallery.ts, from maplibre-gl-basemap-control). A click
  // applies a basemap and keeps the modal open to compare; Enter or a
  // double-click applies and closes. Rows are virtualized (fixed 64 px) and
  // previews load only for rows in view. Modal mechanics follow ExportDialog.
  import { onDestroy, onMount, tick } from 'svelte'
  import { GALLERY, galleryCategories, galleryProviders, KEY_SIGNUP, searchGallery, type GalleryBasemap } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    onClose: () => void
  }
  let { store, onClose }: Props = $props()

  const ROW = 64
  const OVERSCAN = 4
  const categories = galleryCategories()
  const providers = galleryProviders()

  let dialog = $state<HTMLDivElement>()
  let list = $state<HTMLDivElement>()
  let keyInput = $state<HTMLInputElement>()
  let query = $state('')
  let search = $state('')
  let category = $state<string | null>(null)
  let provider = $state('')
  let keylessOnly = $state(false)
  let showKeys = $state(false)
  let keyValue = $state('')
  let keyError = $state<string | null>(null)
  let scrollTop = $state(0)
  let viewport = $state(0)
  let cursor = $state(0)

  let debounce: ReturnType<typeof setTimeout> | null = null
  function onSearchInput(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      search = query
      cursor = 0
      if (list) list.scrollTop = 0
    }, 120)
  }
  onDestroy(() => {
    if (debounce) clearTimeout(debounce)
  })

  const results = $derived(searchGallery(search, { category, provider: provider || null, keylessOnly }))
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN))
  const last = $derived(Math.min(results.length, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN))
  const visible = $derived(results.slice(first, last))
  const activeId = $derived(store.basemap.id)
  const keyRequest = $derived(store.keyRequest)
  const storedKeys = $derived(providers.filter((p) => store.basemapKeys[p.id]))

  function badge(g: GalleryBasemap): string | null {
    if (g.key === 'required') return store.basemapKeys[g.provider] ? null : 'Needs key'
    if (g.key === 'optional') return 'Key optional'
    return null
  }

  async function apply(g: GalleryBasemap, close: boolean): Promise<void> {
    const outcome = await store.chooseGalleryBasemap(g.id)
    if (outcome === 'needsKey') {
      keyValue = ''
      keyError = null
      void tick().then(() => keyInput?.focus())
      return
    }
    if (close) onClose()
  }

  async function saveKey(): Promise<void> {
    if (!keyRequest || !keyValue.trim()) return
    try {
      await store.setBasemapKey(keyRequest.provider, keyValue)
      keyValue = ''
      keyError = null
      void tick().then(() => list?.focus())
    } catch (err) {
      keyError = err instanceof Error ? err.message : String(err)
    }
  }

  function cancelKey(): void {
    store.cancelKeyRequest()
    keyValue = ''
    void tick().then(() => list?.focus())
  }

  function moveCursor(to: number): void {
    if (!results.length || !list) return
    cursor = Math.max(0, Math.min(results.length - 1, to))
    const top = cursor * ROW
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW - list.clientHeight
  }

  function onListKeydown(e: KeyboardEvent): void {
    const page = Math.max(1, Math.floor((list?.clientHeight ?? ROW) / ROW) - 1)
    const moves: Record<string, number> = { ArrowDown: cursor + 1, ArrowUp: cursor - 1, PageDown: cursor + page, PageUp: cursor - page, Home: 0, End: results.length - 1 }
    if (e.key in moves) {
      e.preventDefault()
      moveCursor(moves[e.key])
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault()
      void apply(results[cursor], true)
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (keyRequest) cancelKey()
      else onClose()
      return
    }
    // Keep focus inside the modal.
    if (e.key === 'Tab' && dialog) {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [role="listbox"]'))
      if (!focusable.length) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
  }

  // --- Previews, loaded when a row comes into view -----------------------------
  type Preview = { kind: 'image'; src: string } | { kind: 'colors'; land: string; water: string | null } | { kind: 'none' }
  const previews = $state<Record<string, Preview>>({})
  // Plain caches, never rendered from.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const styleCache = new Map<string, Promise<Preview>>()

  function tileUrl(template: string, scheme: GalleryBasemap['scheme']): string {
    const [z, x, y] = [2, 2, 1]
    return template
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(scheme === 'tms' ? 2 ** z - 1 - y : y))
      .replace('{r}', '')
  }

  function stylePreview(url: string): Promise<Preview> {
    let p = styleCache.get(url)
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((style: { layers?: Array<{ id: string; type: string; paint?: Record<string, unknown> }> } | null) => {
          const layers = style?.layers ?? []
          const land = layers.find((l) => l.type === 'background')?.paint?.['background-color']
          const water = layers.find((l) => l.type === 'fill' && l.id.includes('water'))?.paint?.['fill-color']
          if (typeof land !== 'string') return { kind: 'none' } as Preview
          return { kind: 'colors', land, water: typeof water === 'string' ? water : null } as Preview
        })
        .catch(() => ({ kind: 'none' }) as Preview)
      styleCache.set(url, p)
    }
    return p
  }

  async function loadPreview(g: GalleryBasemap): Promise<void> {
    if (previews[g.id]) return
    previews[g.id] = { kind: 'none' }
    const urls = await store.galleryPreviewUrls(g.id)
    if (!urls) return
    if (g.kind === 'raster' && urls.tiles?.[0]) previews[g.id] = { kind: 'image', src: tileUrl(urls.tiles[0], g.scheme) }
    else if (g.kind === 'vector' && urls.url && g.key === 'none') previews[g.id] = await stylePreview(urls.url)
  }

  let observer: IntersectionObserver | null = null
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const observed = new Map<Element, GalleryBasemap>()
  function inView(node: HTMLElement, g: GalleryBasemap): { update(g: GalleryBasemap): void; destroy(): void } {
    observed.set(node, g)
    observer?.observe(node)
    return {
      update(next) {
        observed.set(node, next)
      },
      destroy() {
        observer?.unobserve(node)
        observed.delete(node)
      },
    }
  }

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const g = observed.get(e.target)
          if (e.isIntersecting && g) void loadPreview(g)
        }
      },
      { root: list }
    )
    for (const node of observed.keys()) observer.observe(node)
    const current = results.findIndex((g) => g.id === activeId)
    if (current > 0) moveCursor(current)
    void tick().then(() => dialog?.querySelector<HTMLElement>('.search input')?.focus())
  })
  onDestroy(() => observer?.disconnect())
</script>

<div class="backdrop" role="presentation" onkeydown={onKeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="basemap-gallery-title" bind:this={dialog}>
    <header>
      <h2 id="basemap-gallery-title">Basemaps</h2>
      <span class="count">{GALLERY.length} basemaps</span>
      <button type="button" class="icon-button" aria-label="Close" title="Close" onclick={onClose}><Icon name="close" /></button>
    </header>

    {#if keyRequest}
      <form
        class="key-form"
        onsubmit={(e) => {
          e.preventDefault()
          void saveKey()
        }}
      >
        <p>
          {keyRequest.providerName} needs an API key. Keys stay {store.keyStorage === 'vscode' ? 'on this computer (VS Code secret storage)' : 'in this browser'}.
          {#if KEY_SIGNUP[keyRequest.provider]}<a href={KEY_SIGNUP[keyRequest.provider]} target="_blank" rel="noreferrer">Get a key</a>{/if}
        </p>
        <div class="key-row">
          <input bind:this={keyInput} type="password" autocomplete="off" spellcheck="false" aria-label="{keyRequest.providerName} API key" bind:value={keyValue} />
          <button type="submit" class="primary" disabled={!keyValue.trim()}>Save and use</button>
          <button type="button" onclick={cancelKey}>Cancel</button>
        </div>
        {#if keyError}<p class="error" role="alert">{keyError}</p>{/if}
      </form>
    {/if}

    <div class="toolbar">
      <label class="search">
        <Icon name="search" size={14} />
        <input type="search" placeholder="Search basemaps" aria-label="Search basemaps" bind:value={query} oninput={onSearchInput} />
      </label>
      <select aria-label="Provider" bind:value={provider} onchange={() => moveCursor(0)}>
        <option value="">All providers</option>
        {#each providers as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <label class="check"><input type="checkbox" bind:checked={keylessOnly} /> No API key needed</label>
    </div>
    <div class="chips" role="group" aria-label="Category">
      <button type="button" class="chip" aria-pressed={category === null} onclick={() => (category = null)}>All</button>
      {#each categories as c (c)}
        <button type="button" class="chip" aria-pressed={category === c} onclick={() => (category = category === c ? null : c)}>{c}</button>
      {/each}
    </div>

    <div
      class="results"
      role="listbox"
      tabindex="0"
      aria-label="Basemaps"
      aria-activedescendant={results[cursor] ? `bg-${results[cursor].id}` : undefined}
      bind:this={list}
      bind:clientHeight={viewport}
      onscroll={() => (scrollTop = list?.scrollTop ?? 0)}
      onkeydown={onListKeydown}
    >
      {#if !results.length}
        <p class="empty">No basemap matches.</p>
      {/if}
      <div class="spacer" style:height="{results.length * ROW}px">
        {#each visible as g, i (g.id)}
          {@const index = first + i}
          {@const preview = previews[g.id]}
          {@const tag = badge(g)}
          <div
            id="bg-{g.id}"
            class="row"
            class:cursor={index === cursor}
            class:active={g.id === activeId}
            role="option"
            aria-selected={g.id === activeId}
            style:top="{index * ROW}px"
            use:inView={g}
            tabindex="-1"
            onclick={() => {
              cursor = index
              void apply(g, false)
            }}
            ondblclick={() => void apply(g, true)}
            onkeydown={() => {}}
          >
            <span class="preview" aria-hidden="true">
              {#if preview?.kind === 'image'}
                <img src={preview.src} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (previews[g.id] = { kind: 'none' })} />
              {:else if preview?.kind === 'colors'}
                <span class="land" style:background={preview.land}></span>
                {#if preview.water}<span class="water" style:background={preview.water}></span>{/if}
              {:else}
                <span class="provider-swatch">{g.providerName}</span>
              {/if}
            </span>
            <span class="text">
              <span class="name">{g.name}</span>
              <span class="meta">{g.providerName} · {g.category}</span>
              <span class="description">{g.description}</span>
            </span>
            {#if tag}<span class="badge">{tag}</span>{/if}
            <span class="mark">{#if g.id === activeId}<Icon name="check" size={14} />{/if}</span>
          </div>
        {/each}
      </div>
    </div>

    <footer>
      <button type="button" aria-expanded={showKeys} onclick={() => (showKeys = !showKeys)}>API keys…</button>
      <span class="credit">Catalog: maplibre-gl-basemap-control (MIT)</span>
    </footer>
    {#if showKeys}
      <div class="keys" role="region" aria-label="Stored API keys">
        {#if !storedKeys.length}
          <p>No API keys stored.</p>
        {:else}
          {#each storedKeys as p (p.id)}
            <div class="key-item">
              <span>{p.name}</span>
              <button type="button" onclick={() => void store.setBasemapKey(p.id, null)} aria-label="Remove the {p.name} API key">Remove</button>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 16px;
    background: color-mix(in srgb, black 40%, transparent);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(880px, 92vw);
    height: min(640px, 86vh);
    max-height: 100%;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--se-border);
  }
  h2 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .count {
    flex: 1;
    color: var(--se-text-secondary);
  }
  .key-form {
    margin: 8px 12px 0;
    padding: 8px 10px;
    border-left: 2px solid var(--se-focus);
    background: var(--se-bg-panel);
    border-radius: var(--se-radius-sm);
  }
  .key-form p {
    margin: 0 0 6px;
    line-height: 1.4;
  }
  .key-form a {
    color: var(--se-link);
  }
  .key-row {
    display: flex;
    gap: 6px;
  }
  .key-row input {
    flex: 1;
    min-width: 0;
  }
  .error {
    color: var(--se-error);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 4px;
  }
  .search {
    flex: 1 1 220px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    color: var(--se-text-secondary);
  }
  .search:focus-within {
    outline: 1px solid var(--se-focus);
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 4px 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  input[type='password'],
  select {
    padding: 4px 6px;
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .chips {
    display: flex;
    gap: 4px;
    padding: 4px 12px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--se-border);
  }
  .chip {
    flex: none;
    padding: 2px 10px;
    border: 1px solid var(--se-control-border);
    border-radius: 999px;
    background: transparent;
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--se-button-bg);
    border-color: var(--se-button-border);
    color: var(--se-button-fg);
  }
  .results {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    outline: none;
  }
  .results:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .spacer {
    position: relative;
  }
  .empty {
    margin: 0;
    padding: 16px;
    color: var(--se-text-secondary);
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: 64px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .row:hover {
    background: var(--se-bg-hover);
  }
  .row.active {
    background: var(--se-selected-inactive-bg);
    color: var(--se-selected-inactive-fg);
  }
  .results:focus .row.cursor {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .preview {
    position: relative;
    flex: none;
    width: 96px;
    height: 56px;
    overflow: hidden;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-map-bg);
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .land {
    position: absolute;
    inset: 0;
  }
  .water {
    position: absolute;
    right: -12px;
    bottom: -16px;
    width: 52px;
    height: 44px;
    border-radius: 50%;
  }
  .provider-swatch {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 0 4px;
    color: var(--se-text-muted);
    font-size: 10.5px;
    text-align: center;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 1px;
  }
  .name {
    font-weight: 600;
  }
  .meta,
  .description {
    color: var(--se-text-secondary);
    font-size: 0.92em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .badge {
    flex: none;
    padding: 1px 6px;
    border: 1px solid var(--se-control-border);
    border-radius: 999px;
    color: var(--se-text-secondary);
    font-size: 0.85em;
  }
  .mark {
    flex: none;
    width: 14px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--se-border);
  }
  .credit {
    margin-left: auto;
    color: var(--se-text-muted);
    font-size: 10.5px;
  }
  .keys {
    padding: 4px 12px 8px;
    border-top: 1px solid var(--se-border);
  }
  .keys p {
    margin: 4px 0;
    color: var(--se-text-secondary);
  }
  .key-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
  }
  footer button,
  .key-row button,
  .key-item button {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  footer button:hover,
  .key-row button:hover,
  .key-item button:hover {
    background: var(--se-button-secondary-hover);
  }
  .key-row button.primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .key-row button.primary:hover {
    background: var(--se-button-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  select:focus-visible,
  input:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
</style>
