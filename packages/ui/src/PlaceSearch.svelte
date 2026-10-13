<script lang="ts">
  // Spec 008 US8 (FR-033, contracts/ui.md "Place search"): find a place and
  // fit the map to it. Opt-out, disclosed before the first search (a notice
  // dialog, shown once), and only the typed text leaves (placeSearch.ts). A
  // request goes out only on Enter or the button; results form the
  // `Places` listbox (arrows, Enter, Escape).
  import { onMount, tick } from 'svelte'
  import Icon from './Icon.svelte'
  import { PLACE_ATTRIBUTION, PlaceSearchUnavailable, searchPlaces, type Place } from './placeSearch.js'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    onClose: () => void
    /**
     * Spec 010: always on the map (SearchBox) rather than a popover: no focus
     * on mount, Escape clears instead of closing, results drop down below.
     */
    floating?: boolean
  }
  let { store, onClose, floating = false }: Props = $props()

  let text = $state('')
  let results = $state.raw<Place[] | null>(null)
  let active = $state(-1)
  let searching = $state(false)
  let message = $state<{ kind: 'info' | 'error'; text: string } | null>(null)
  let noticeOpen = $state(false)
  let input = $state<HTMLInputElement>()
  let noticeButton = $state<HTMLButtonElement>()
  let controller: AbortController | null = null

  onMount(() => {
    if (!floating) void tick().then(() => input?.focus())
    return () => controller?.abort()
  })

  async function submit(): Promise<void> {
    const q = text.trim()
    if (!q || searching) return
    // Disclosed before the first search (constitution v1.1.0).
    if (!(await store.placeSearchNoticeShown())) {
      noticeOpen = true
      void tick().then(() => noticeButton?.focus())
      return
    }
    await run(q)
  }

  async function run(q: string): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    searching = true
    message = null
    results = null
    active = -1
    try {
      const found = await searchPlaces(q, controller.signal)
      results = found
      active = found.length ? 0 : -1
      if (!found.length) message = { kind: 'info', text: `No places found for “${q}”.` }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      message = { kind: 'error', text: err instanceof PlaceSearchUnavailable ? err.message : "Can't reach the place search service. Check the connection." }
    } finally {
      searching = false
    }
  }

  function acceptNotice(): void {
    store.markPlaceSearchNoticeShown()
    noticeOpen = false
    void run(text.trim())
    void tick().then(() => input?.focus())
  }

  function pick(p: Place): void {
    store.fitTo(p.bbox)
    results = null
    message = { kind: 'info', text: `Showing ${p.name}.` }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (results && active >= 0 && results[active]) pick(results[active])
      else void submit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (results) results = null
      else if (floating) {
        if (message) message = null
        else input?.blur()
      } else onClose()
      return
    }
    if (!results?.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      active = (active + 1) % results.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = (active - 1 + results.length) % results.length
    }
  }
</script>

<div class="panel" class:floating role={floating ? undefined : 'dialog'} aria-label={floating ? undefined : 'Search places'}>
  <div role="search" class="search">
    <form
      onsubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Icon name="search" size={14} />
      <input
        bind:this={input}
        bind:value={text}
        type="search"
        aria-label="Search places"
        placeholder={floating ? 'Search places' : 'City, address or landmark'}
        autocomplete="off"
        spellcheck="false"
        aria-controls={results?.length ? 'place-results' : undefined}
        aria-activedescendant={results && active >= 0 ? `place-${active}` : undefined}
        oninput={() => {
          // Typing sends nothing (FR-033): results go stale until the next search.
          if (results) results = null
        }}
        onkeydown={onKey}
      />
      <button type="submit" class="go" disabled={!text.trim() || searching}>{searching ? 'Searching…' : 'Search'}</button>
    </form>
  </div>

  {#if !floating || results?.length || message || noticeOpen}
  <div class="drop">
  {#if results && results.length}
    <ul id="place-results" role="listbox" aria-label="Places">
      {#each results as p, i (i)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`place-${i}`}
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          title={p.name}
          onpointerdown={(e) => e.preventDefault()}
          onpointermove={() => (active = i)}
          onclick={() => pick(p)}
        >
          <Icon name="search" size={12} />
          <span>{p.name}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if message}
    <p class="message {message.kind}" role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>
  {/if}
  <p class="attribution">{PLACE_ATTRIBUTION}</p>

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
  </div>
  {/if}
</div>

<style>
  .panel {
    position: relative;
    display: grid;
    gap: 6px;
    width: 320px;
    padding: 8px;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  /* SearchBox: a map widget; what it finds drops down below the input. */
  .panel.floating {
    width: 300px;
    max-width: 100%;
    padding: 0;
    gap: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
  }
  .panel.floating form {
    background: var(--se-control-bg);
    border-color: var(--se-control-border);
    box-shadow: var(--se-shadow-card);
  }
  .drop {
    display: contents;
  }
  .panel.floating .drop {
    display: grid;
    gap: 6px;
    margin-top: 4px;
    padding: 6px;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    box-shadow: var(--se-shadow-elevated);
  }
  form {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 0 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
  }
  form:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .go {
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-left: 1px solid var(--se-input-border);
    border-radius: 0 var(--se-radius-sm) var(--se-radius-sm) 0;
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font: inherit;
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.5;
    cursor: default;
  }
  ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding: 2px 6px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li :global(.icon) {
    flex: none;
    color: var(--se-text-secondary);
  }
  li.active {
    background: var(--se-menu-hover-bg, var(--se-bg-hover));
    color: var(--se-menu-hover-fg, var(--se-text-primary));
  }
  .message {
    margin: 0;
    padding: 0 2px;
    color: var(--se-text-secondary);
  }
  .message.error {
    color: var(--se-error-fg, var(--se-error));
  }
  .attribution {
    margin: 0;
    padding: 0 2px;
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
