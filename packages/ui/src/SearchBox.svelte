<script lang="ts">
  // Spec 010 phase 10: one search box on the map's top-left corner, for
  // values in the layer, typed coordinates, and places. Values and
  // coordinates follow the typing; places (spec 008 US8, FR-033) are fetched
  // only on request (Enter or "Search places for …"), after the one-time
  // notice, and only the typed text leaves (placeSearch.ts). A combobox:
  // Up/Down move across the groups, Enter chooses, Escape clears and closes.
  import { onMount, tick } from 'svelte'
  import { parseCoordinates, SEARCH_MIN_LENGTH, type CoordinateCandidate, type SearchHit } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import { PLACE_ATTRIBUTION, PlaceSearchUnavailable, searchPlaces, type Place } from './placeSearch.js'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    /** The open file's name, for the values group ("In world.geojson"). */
    layerName: string
    /** A value was chosen: select its row (and show its details). */
    onChooseFeature: (id: number) => void
  }
  let { store, layerName, onChooseFeature }: Props = $props()

  type Option =
    | { key: string; kind: 'coord'; c: CoordinateCandidate; swapped: boolean }
    | { key: string; kind: 'value'; hit: SearchHit }
    | { key: string; kind: 'placesAction'; q: string }
    | { key: string; kind: 'place'; place: Place }
  type Group = { id: string; label: string; options: Option[] }

  const DEBOUNCE_MS = 200
  const COORD_ZOOM = 12

  let text = $state('')
  let open = $state(false)
  let hits = $state.raw<SearchHit[]>([])
  /** The text the last value search answered (for "nothing matches"). */
  let searchedFor = $state('')
  let places = $state.raw<Place[] | null>(null)
  let placesFor = $state('')
  let activeKey = $state<string | null>(null)
  let searchingPlaces = $state(false)
  let message = $state<{ kind: 'info' | 'error'; text: string; places?: boolean } | null>(null)
  let noticeOpen = $state(false)
  let input = $state<HTMLInputElement>()
  let noticeButton = $state<HTMLButtonElement>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  onMount(() => () => {
    controller?.abort()
    if (timer) clearTimeout(timer)
  })

  const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6)

  const groups = $derived.by((): Group[] => {
    const q = text.trim()
    if (!q) return []
    const out: Group[] = []
    const coords = parseCoordinates(q)
    if (coords.length) out.push({ id: 'coords', label: 'Coordinates', options: coords.map((c, i) => ({ key: `c${i}`, kind: 'coord', c, swapped: i > 0 })) })
    if (hits.length) out.push({ id: 'values', label: `In ${layerName}`, options: hits.map((hit) => ({ key: `v${hit.column}\u0000${hit.value}`, kind: 'value', hit })) })
    if (store.placeSearchEnabled) {
      if (places?.length && placesFor === q) out.push({ id: 'places', label: 'Places', options: places.map((place, i) => ({ key: `p${i}`, kind: 'place', place })) })
      else if (!(places && placesFor === q)) out.push({ id: 'places', label: 'Places', options: [{ key: 'pa', kind: 'placesAction', q }] })
    }
    return out
  })
  const flat = $derived(groups.flatMap((g) => g.options))
  const active = $derived(flat.find((o) => o.key === activeKey) ?? flat[0] ?? null)
  const listShown = $derived(open && flat.length > 0)
  const nothing = $derived(open && !flat.length && text.trim().length >= SEARCH_MIN_LENGTH && searchedFor === text.trim() && !message)
  const optionId = (o: Option): string => `search-opt-${flat.indexOf(o)}`

  function onInput(): void {
    open = true
    message = null
    activeKey = null
    if (timer) clearTimeout(timer)
    const q = text.trim()
    if (q.length < SEARCH_MIN_LENGTH) {
      hits = []
      searchedFor = q
      return
    }
    timer = setTimeout(() => {
      void store.searchValues(q).then((found) => {
        if (text.trim() !== q) return // typed on: a newer search is coming
        hits = found
        searchedFor = q
      })
    }, DEBOUNCE_MS)
  }

  function clear(): void {
    if (timer) clearTimeout(timer)
    controller?.abort()
    text = ''
    hits = []
    searchedFor = ''
    places = null
    message = null
    open = false
    activeKey = null
  }

  async function submitPlaces(): Promise<void> {
    const q = text.trim()
    if (!q || searchingPlaces || !store.placeSearchEnabled) return
    // Disclosed before the first search (constitution v1.1.0).
    if (!(await store.placeSearchNoticeShown())) {
      noticeOpen = true
      void tick().then(() => noticeButton?.focus())
      return
    }
    await runPlaces(q)
  }

  async function runPlaces(q: string): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    searchingPlaces = true
    message = null
    try {
      const found = await searchPlaces(q, controller.signal)
      places = found
      placesFor = q
      open = true
      activeKey = found.length ? 'p0' : null
      if (!found.length) message = { kind: 'info', text: `No places found for “${q}”.`, places: true }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      message = { kind: 'error', text: err instanceof PlaceSearchUnavailable ? err.message : "Can't reach the place search service. Check the connection.", places: true }
    } finally {
      searchingPlaces = false
    }
  }

  function acceptNotice(): void {
    store.markPlaceSearchNoticeShown()
    noticeOpen = false
    void runPlaces(text.trim())
    void tick().then(() => input?.focus())
  }

  function choose(o: Option): void {
    if (o.kind === 'placesAction') {
      void submitPlaces()
      return
    }
    open = false
    if (o.kind === 'coord') store.jumpTo([o.c.lon, o.c.lat], COORD_ZOOM)
    else if (o.kind === 'value') onChooseFeature(o.hit.id)
    else {
      store.fitTo(o.place.bbox)
      message = { kind: 'info', text: `Showing ${o.place.name}.`, places: true }
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (listShown && active) choose(active)
      else void submitPlaces()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (text || message || open) clear()
      else input?.blur()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (!flat.length) return
    if (!listShown) {
      open = true
      return
    }
    const i = active ? flat.indexOf(active) : -1
    const next = e.key === 'ArrowDown' ? (i + 1) % flat.length : (i - 1 + flat.length) % flat.length
    activeKey = flat[next].key
    void tick().then(() => document.getElementById(optionId(flat[next]))?.scrollIntoView({ block: 'nearest' }))
  }
</script>

<div class="search-box">
  <div role="search">
    <form
      onsubmit={(e) => {
        e.preventDefault()
      }}
    >
      <Icon name="search" size={14} />
      <input
        bind:this={input}
        bind:value={text}
        type="text"
        role="combobox"
        aria-label="Search"
        aria-autocomplete="list"
        aria-expanded={listShown}
        aria-controls="search-results"
        aria-activedescendant={listShown && active ? optionId(active) : undefined}
        placeholder={store.placeSearchEnabled ? 'Search layer, coordinates or places' : 'Search layer or coordinates'}
        autocomplete="off"
        spellcheck="false"
        oninput={onInput}
        onkeydown={onKey}
        onfocus={() => {
          if (text.trim()) open = true
        }}
        onblur={() => (open = false)}
      />
      {#if searchingPlaces}<span class="busy" aria-hidden="true">…</span>{/if}
      {#if text}
        <button type="button" class="clear" aria-label="Clear search" title="Clear (Esc)" onpointerdown={(e) => e.preventDefault()} onclick={clear}><Icon name="close" size={12} /></button>
      {/if}
    </form>
  </div>

  {#if listShown || message || noticeOpen || nothing}
    <div class="drop">
      <div id="search-results" role="listbox" aria-label="Search results" hidden={!listShown}>
        {#each groups as g (g.id)}
          <ul role="group" aria-label={g.label}>
            <li role="presentation" class="group-label">{g.label}</li>
            {#each g.options as o (o.key)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <li
                id={optionId(o)}
                role="option"
                aria-selected={o === active}
                class:active={o === active}
                onpointerdown={(e) => e.preventDefault()}
                onpointermove={() => (activeKey = o.key)}
                onclick={() => choose(o)}
              >
                {#if o.kind === 'coord'}
                  <Icon name="globe" size={12} />
                  <span class="main">Go to {fmt(o.c.lon)}, {fmt(o.c.lat)}</span>
                  <span class="dim">{o.swapped ? 'read as lat, lon' : 'lon, lat'}</span>
                {:else if o.kind === 'value'}
                  <Icon name="list" size={12} />
                  <span class="main" title={o.hit.value}>{o.hit.value}</span>
                  <span class="dim">{o.hit.column}{#if o.hit.count > 1}&nbsp;· {o.hit.count.toLocaleString('en-US')}{/if}</span>
                {:else if o.kind === 'placesAction'}
                  <Icon name="search" size={12} />
                  <span class="main">Search places for “{o.q}”</span>
                {:else}
                  <Icon name="search" size={12} />
                  <span class="main" title={o.place.name}>{o.place.name}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
      </div>
      {#if nothing}
        <p class="message info" role="status">Nothing in {layerName} matches “{text.trim()}”.</p>
      {/if}
      {#if message}
        <p class="message {message.kind}" role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
      {/if}
      {#if noticeOpen}
        <div class="notice" role="dialog" aria-modal="true" aria-label="Place search" aria-describedby="place-notice-text">
          <p id="place-notice-text">
            Place search sends only the text you type to OpenStreetMap's Nominatim service (nominatim.openstreetmap.org). Nothing about your file or its data is sent.{#if store.placeSearchConfigurable}
              You can turn place search off in the settings (Spatial Explorer › Place Search).{/if}
          </p>
          <div class="actions">
            <button
              type="button"
              class="secondary"
              onclick={() => {
                noticeOpen = false
                void tick().then(() => input?.focus())
              }}>Cancel</button
            >
            <button type="button" class="primary" bind:this={noticeButton} onclick={acceptNotice}>Search</button>
          </div>
        </div>
      {/if}
      {#if (listShown && groups.some((g) => g.id === 'places' && g.options[0]?.kind === 'place')) || message?.places || noticeOpen}
        <p class="attribution">{PLACE_ATTRIBUTION}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search-box {
    pointer-events: auto;
    position: relative;
    width: 300px;
    max-width: 100%;
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    color: var(--se-text-primary);
  }
  form {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 8px;
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-control-bg);
    box-shadow: var(--se-shadow-card);
    color: var(--se-text-secondary);
  }
  form:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  .busy {
    color: var(--se-text-secondary);
  }
  .clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .clear:hover {
    background: var(--se-bg-hover);
  }
  .drop {
    display: grid;
    gap: 6px;
    margin-top: 4px;
    padding: 4px;
    max-height: min(60vh, 420px);
    overflow: auto;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    box-shadow: var(--se-shadow-elevated);
  }
  [role='listbox'] {
    display: grid;
    gap: 4px;
  }
  [role='listbox'][hidden] {
    display: none;
  }
  ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .group-label {
    padding: 2px 6px;
    color: var(--se-text-secondary);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [role='option'] {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding: 2px 6px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  [role='option'] :global(.icon) {
    flex: none;
    color: var(--se-text-secondary);
  }
  .main {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim {
    flex: none;
    margin-left: auto;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--se-text-muted, var(--se-text-secondary));
    font-size: 0.9em;
  }
  [role='option'].active {
    background: var(--se-menu-hover-bg, var(--se-bg-hover));
    color: var(--se-menu-hover-fg, var(--se-text-primary));
  }
  [role='option'].active .dim,
  [role='option'].active :global(.icon) {
    color: inherit;
  }
  .message {
    margin: 0;
    padding: 2px 6px;
    color: var(--se-text-secondary);
  }
  .message.error {
    color: var(--se-error-fg, var(--se-error));
  }
  .attribution {
    margin: 0;
    padding: 0 6px 2px;
    color: var(--se-text-muted, var(--se-text-secondary));
    font-size: 11px;
  }
  .notice {
    display: grid;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--se-info);
    border-radius: var(--se-radius-sm);
    background: color-mix(in srgb, var(--se-info) 8%, var(--se-bg-elevated));
  }
  .notice p {
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
