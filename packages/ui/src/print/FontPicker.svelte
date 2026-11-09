<script lang="ts">
  // A font for the print's text: type to search the system fonts and the Google families, or type any other family name.
  // bits-ui's Combobox in the app's own popup style (the Select's classes), not the browser's suggestion list.
  import { Combobox } from 'bits-ui'
  import { SYSTEM_FONTS, findGoogleFont, googleFontCatalog, type GoogleFont } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'

  interface Props {
    /** The family: empty is the default font. */
    value: string
    onChange: (family: string) => void
    /** The accessible name. */
    label: string
    /** Offer the Google families (and any other name typed): on once the user has agreed to fetch them. */
    google: boolean
  }
  let { value, onChange, label, google: withGoogle }: Props = $props()

  /** The value of the "Default" row (an empty value would read as nothing chosen). */
  const DEFAULT = '__default__'
  // The box shows the font in use, follows a change made elsewhere, and holds what is typed meanwhile.
  let text = $derived(value)
  let typed = $state(false)
  let open = $state(false)

  // The whole Google Fonts list (about 2,000 families, most popular first), read once Google Fonts is on.
  let catalog = $state<readonly GoogleFont[]>([])
  $effect(() => {
    if (withGoogle) void googleFontCatalog().then((c) => (catalog = c))
  })
  /** Rows drawn at most: a typed query narrows the rest. */
  const MAX_ROWS = 80

  const query = $derived(text.trim().toLowerCase())
  const matches = (name: string): boolean => !typed || !query || name.toLowerCase().includes(query)
  const system = $derived(SYSTEM_FONTS.filter((f) => matches(f.name)))
  const googleAll = $derived(withGoogle ? catalog.filter((f) => matches(f.name)) : [])
  const google = $derived(googleAll.slice(0, MAX_ROWS))
  const hidden = $derived(googleAll.length - google.length)
  const showDefault = $derived(matches('default'))
  /** A name that is in neither list is offered as typed: it is looked up as a Google family. */
  const custom = $derived(withGoogle && typed && query !== '' && !SYSTEM_FONTS.some((f) => f.name.toLowerCase() === query) && !findGoogleFont(query) ? text.trim() : '')

  function choose(v: string): void {
    typed = false
    onChange(v === DEFAULT ? '' : v)
  }
</script>

<Combobox.Root
  type="single"
  value={value || DEFAULT}
  bind:open
  inputValue={text}
  onValueChange={(v) => v && choose(v)}
  onOpenChange={(o) => {
    typed = false
    // Closed without a choice: the box shows the font in use again.
    if (!o) setTimeout(() => (text = value), 0)
  }}
>
  <div class="se-font-box">
    <Combobox.Input class="se-font-input" aria-label={label} placeholder="Default" oninput={(e) => { typed = true; text = e.currentTarget.value }} />
    <Combobox.Trigger class="se-font-chevron" aria-label="Show fonts"><Icon name="chevron-down" size={14} /></Combobox.Trigger>
  </div>
  <Combobox.Portal>
    <Combobox.Content class="se-select-pop se-font-pop" sideOffset={4} align="start" collisionPadding={8}>
      <Combobox.Viewport>
        {#if showDefault}
          <Combobox.Item class="se-select-item" value={DEFAULT} label="Default">
            {#snippet children({ selected })}<span>Default</span>{#if selected}<Icon name="check" size={14} />{/if}{/snippet}
          </Combobox.Item>
        {/if}
        {#if custom}
          <Combobox.Item class="se-select-item" value={custom} label={custom}>
            <span>Use “{custom}”</span><span class="se-font-hint">Google Fonts</span>
          </Combobox.Item>
        {/if}
        {#if system.length}
          <Combobox.Group>
            <Combobox.GroupHeading class="se-font-heading">On this computer</Combobox.GroupHeading>
            {#each system as f (f.name)}
              <Combobox.Item class="se-select-item" value={f.name} label={f.name}>
                {#snippet children({ selected })}<span>{f.name}</span>{#if selected}<Icon name="check" size={14} />{/if}{/snippet}
              </Combobox.Item>
            {/each}
          </Combobox.Group>
        {/if}
        {#if google.length}
          <Combobox.Group>
            <Combobox.GroupHeading class="se-font-heading">{typed && query ? `Google Fonts (${googleAll.length})` : 'Google Fonts, most popular first'}</Combobox.GroupHeading>
            {#each google as f (f.name)}
              <Combobox.Item class="se-select-item" value={f.name} label={f.name}>
                {#snippet children({ selected })}<span>{f.name}</span>{#if selected}<Icon name="check" size={14} />{/if}{/snippet}
              </Combobox.Item>
            {/each}
            {#if hidden > 0}<div class="se-font-empty">{hidden} more: keep typing to narrow the list.</div>{/if}
          </Combobox.Group>
        {/if}
        {#if !showDefault && !custom && !system.length && !google.length}
          <div class="se-font-empty">No font matches.</div>
        {/if}
      </Combobox.Viewport>
    </Combobox.Content>
  </Combobox.Portal>
</Combobox.Root>

<style>
  .se-font-box {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
  }
  :global(.se-font-input) {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 28px 0 8px;
    font: inherit;
    color: var(--se-text-primary);
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
  }
  :global(.se-font-input::placeholder) {
    color: var(--se-text-secondary);
  }
  :global(.se-font-input:hover) {
    border-color: var(--se-text-muted);
  }
  :global(.se-font-input:focus-visible) {
    outline: 2px solid var(--se-focus);
    outline-offset: 0;
  }
  :global(.se-font-chevron) {
    all: unset;
    position: absolute;
    right: 0;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  :global(.se-font-pop) {
    width: max-content;
    max-width: 240px;
    min-width: var(--bits-combobox-anchor-width, 160px);
    max-height: min(320px, var(--bits-combobox-content-available-height, 320px));
  }
  :global(.se-font-heading) {
    padding: 6px 8px 2px;
    color: var(--se-text-secondary);
    font-size: 0.9em;
  }
  .se-font-hint {
    color: var(--se-text-secondary);
    font-size: 0.9em;
  }
  .se-font-empty {
    padding: 6px 8px;
    color: var(--se-text-secondary);
  }
</style>
