<script lang="ts">
  // T040 (User Story 4): basemap picker, rendered from the catalog (CLAUDE.md:
  // the catalog is data; adding a provider is adding a row). Each option
  // previews its style's own land/water colors.
  //
  // There is no separate "Match theme" entry (user decision, 2026-10-10):
  // until the user picks one, the theme's default (Positron or Dark) is simply
  // the checked entry, and it follows theme changes (FR-009/FR-017). Blank's
  // color matches the theme by default; the user can set their own, which is
  // remembered (HostAdapter.saveState).
  import { BASEMAP_CATALOG, getDefaultBasemap, type BasemapChoice } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    /** The entry actually shown (the theme default while following the theme). */
    activeId: string
    followingTheme: boolean
    appearance: 'light' | 'dark'
    blankColor: string | null
    notice: string | null
    /** Spec 010: the active basemap when it came from "More basemaps…" (shown under the featured list). */
    galleryEntry: { id: string; name: string } | null
    onChoose: (choice: BasemapChoice) => void
    onMore: () => void
    onBlankColor: (color: string | null) => void
    onClose: () => void
    /** Spec 010: inside the side panel (its title and close button are the panel's). */
    embedded?: boolean
  }
  let { activeId, followingTheme, appearance, blankColor, notice, galleryEntry, onChoose, onMore, onBlankColor, onClose, embedded = false }: Props = $props()

  let themeDefaultId = $derived(getDefaultBasemap(appearance).id)
  let blankInput = $state<HTMLInputElement>()

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      onClose()
      e.stopPropagation()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if ((e.target as HTMLElement).getAttribute('role') !== 'radio') return
    e.preventDefault()
    // From a gallery basemap (not in the list), arrows start at the list's ends.
    const i = BASEMAP_CATALOG.findIndex((o) => o.id === activeId)
    const from = i >= 0 ? i : e.key === 'ArrowDown' ? -1 : 0
    const next = BASEMAP_CATALOG[(from + (e.key === 'ArrowDown' ? 1 : BASEMAP_CATALOG.length - 1)) % BASEMAP_CATALOG.length]
    onChoose(next.id)
    queueMicrotask(() => (document.querySelector(`[data-basemap="${next.id}"]`) as HTMLElement | null)?.focus())
  }
</script>

<div class="panel" class:embedded role={embedded ? 'region' : 'dialog'} aria-label="Basemap" tabindex="-1" onkeydown={handleKeydown}>
  {#if !embedded}
    <header>
      <h2>Basemap</h2>
      <button type="button" class="icon-button" aria-label="Close" title="Close" onclick={onClose}><Icon name="close" /></button>
    </header>
  {/if}
  <div class="options" role="radiogroup" aria-label="Basemap">
    {#each BASEMAP_CATALOG as entry (entry.id)}
      <div class="row" class:checked={entry.id === activeId}>
        <button
          type="button"
          role="radio"
          aria-checked={entry.id === activeId}
          tabindex={entry.id === activeId ? 0 : -1}
          data-basemap={entry.id}
          class="option"
          onclick={() => onChoose(entry.id)}
        >
          {#if entry.preview}
            <span class="swatch" aria-hidden="true">
              <span class="land" style:background={entry.preview.land}></span>
              <span class="water" style:background={entry.preview.water}></span>
            </span>
          {:else}
            <span class="swatch blank" class:custom={blankColor} style:background={blankColor ?? undefined} aria-hidden="true"></span>
          {/if}
          <span class="name">{entry.name}</span>
          {#if entry.type === 'blank'}
            <span class="detail">{blankColor ? blankColor.toUpperCase() : 'Theme color'}</span>
          {:else if entry.id === themeDefaultId && followingTheme}
            <span class="detail">Theme default</span>
          {/if}
          <span class="spacer"></span>
          {#if entry.id === activeId}<Icon name="check" size={14} />{/if}
        </button>
        {#if entry.type === 'blank'}
          <span class="blank-tools">
            <button type="button" class="icon-button small" title="Choose blank background color" aria-label="Choose blank background color" onclick={() => blankInput?.click()}>
              <Icon name="paint" size={14} />
            </button>
            {#if blankColor}
              <button type="button" class="icon-button small" title="Match theme color" aria-label="Match theme color" onclick={() => onBlankColor(null)}>
                <Icon name="reset" size={14} />
              </button>
            {/if}
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
          </span>
        {/if}
      </div>
    {/each}
    {#if galleryEntry}
      <div class="row checked">
        <button type="button" role="radio" aria-checked="true" tabindex="0" data-basemap={galleryEntry.id} class="option" onclick={onMore}>
          <span class="swatch gallery" aria-hidden="true"></span>
          <span class="name">{galleryEntry.name}</span>
          <span class="spacer"></span>
          <Icon name="check" size={14} />
        </button>
      </div>
    {/if}
  </div>
  <div class="more">
    <button type="button" class="more-button" onclick={onMore}>More basemaps…</button>
  </div>
  {#if notice}
    <p class="notice" role="status"><Icon name="warning" size={14} />{notice}</p>
  {/if}
  <p class="credit">Vector tiles: OpenFreeMap · © OpenStreetMap contributors</p>
</div>

<style>
  .panel {
    /* Spec 008: nine entries with the raster basemaps; the list scrolls within the popover. */
    display: flex;
    flex-direction: column;
    max-height: 100%;
    width: 248px;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  /* Spec 010: inside the side panel, which has the title and the close button. */
  .panel.embedded {
    flex: 1;
    width: auto;
    min-height: 0;
    max-height: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  header {
    display: flex;
    align-items: center;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--se-border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .options {
    display: grid;
    padding: 4px;
    min-height: 0;
    overflow-y: auto;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--se-radius-sm);
  }
  .row:hover {
    background: var(--se-bg-hover);
  }
  .row.checked {
    background: var(--se-selected-inactive-bg);
    color: var(--se-selected-inactive-fg);
  }
  .option {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .option:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .swatch {
    position: relative;
    flex: none;
    width: 28px;
    height: 20px;
    overflow: hidden;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
  }
  .swatch.blank:not(.custom) {
    background: var(--se-map-bg);
  }
  .land {
    position: absolute;
    inset: 0;
  }
  .water {
    position: absolute;
    right: -6px;
    bottom: -8px;
    width: 18px;
    height: 16px;
    border-radius: 50%;
  }
  .detail {
    color: var(--se-text-secondary);
    font-size: 0.9em;
    white-space: nowrap;
  }
  .row .detail {
    font-family: var(--se-font-ui);
  }
  .spacer {
    flex: 1;
  }
  .blank-tools {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 4px;
  }
  .color-input {
    position: absolute;
    right: 8px;
    bottom: 0;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }
  .swatch.gallery {
    background: linear-gradient(135deg, var(--se-bg-hover), var(--se-map-bg));
  }
  .more {
    padding: 4px 8px 8px;
  }
  .more-button {
    width: 100%;
    height: 24px;
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
  .more-button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .notice {
    display: flex;
    gap: 6px;
    margin: 0 8px 8px;
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
  .icon-button.small {
    width: 22px;
    height: 22px;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
</style>
