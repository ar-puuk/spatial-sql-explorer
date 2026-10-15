<script lang="ts">
  // Color ramp picker (spec 003 FR-007, contracts/ui-style-panel.md; redone in spec 015): a button showing the
  // current ramp's strip and name, a popup with a search box and a listbox of strips in groups (perceptual, sequential,
  // diverging, qualitative; arrows move, Enter applies, Esc closes), and a Reverse toggle. Typing in the list goes to
  // the search box. Spec 008 FR-004: while the list is open, the focused ramp previews on the map (`onPreview`);
  // closing without a choice restores the previous one.
  import { onMount, tick } from 'svelte'
  import { rampColors, rampsFor, type Ramp, type RampRef } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    value: RampRef
    renderer: 'categorized' | 'graduated'
    /** Classes shown in the previews: the ramp as it will be applied. */
    classCount: number
    onChange: (ramp: RampRef) => void
    /** The ramp to show on the map while browsing, or null to restore (FR-004). */
    onPreview?: (ramp: RampRef | null) => void
  }
  let { value, renderer, classCount, onChange, onPreview = () => {} }: Props = $props()

  const all = $derived(rampsFor(renderer))
  const current = $derived(all.find((r) => r.id === value.id) ?? all[0])
  const previewCount = $derived(Math.max(classCount, renderer === 'categorized' ? 8 : 5))

  let query = $state('')
  /** The ramps shown, in the order of the groups. */
  const GROUPS: Array<{ id: string; label: string; test: (r: Ramp) => boolean }> = [
    { id: 'perceptual', label: 'Perceptual', test: (r) => r.family === 'perceptual' },
    { id: 'sequential', label: 'Sequential', test: (r) => r.family === 'brewer' && r.kind === 'sequential' },
    { id: 'diverging', label: 'Diverging', test: (r) => r.kind === 'diverging' },
    { id: 'qualitative', label: 'Qualitative', test: (r) => r.kind === 'qualitative' },
  ]
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const ramps = q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.kind.includes(q)) : all
    const groups = GROUPS.map((g) => ({ ...g, ramps: ramps.filter(g.test) })).filter((g) => g.ramps.length > 0)
    return { groups, flat: groups.flatMap((g) => g.ramps) }
  })

  let open = $state(false)
  let active = $state(0)
  let list = $state<HTMLUListElement>()
  let search = $state<HTMLInputElement>()
  let button = $state<HTMLButtonElement>()
  let root = $state<HTMLDivElement>()

  /** A strip: hard stops, so classes read as classes (no blending, research §2). */
  function strip(id: string, reversed: boolean): string {
    const colors = rampColors({ id, reversed }, previewCount)
    const step = 100 / colors.length
    return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`
  }

  function openList(): void {
    query = ''
    open = true
    active = Math.max(0, shown.flat.findIndex((r) => r.id === value.id))
    queueMicrotask(() => list?.focus())
  }

  /** The ramp shown on the map while the list is open (null: none yet). */
  let previewing: string | null = null

  function close(refocus = true): void {
    open = false
    if (previewing !== null) {
      previewing = null
      onPreview(null)
    }
    if (refocus) button?.focus()
  }

  function choose(i: number): void {
    const r = shown.flat[i]
    if (!r) return
    previewing = null
    onChange({ id: r.id, reversed: value.reversed })
    close()
  }

  // Preview the focused ramp (keyboard or pointer) while the list is open, once the
  // pointer rests on it: sweeping across the list must not paint every ramp it crosses.
  const PREVIEW_DELAY_MS = 90
  $effect(() => {
    if (!open) return
    const r = shown.flat[active]
    if (!r || r.id === (previewing ?? value.id)) return
    const timer = setTimeout(() => {
      previewing = r.id
      onPreview({ id: r.id, reversed: value.reversed })
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  })

  function move(e: KeyboardEvent): boolean {
    const n = shown.flat.length
    if (n === 0) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    else if (e.key === 'Home' || e.key === 'End') active = e.key === 'Home' ? 0 : n - 1
    else return false
    e.preventDefault()
    return true
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (move(e)) {
      // moved
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Tab') {
      close(false)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing in the list searches: the key goes to the box.
      query = e.key
      e.preventDefault()
      void tick().then(() => {
        search?.focus()
        search?.setSelectionRange(1, 1)
      })
    }
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (move(e)) {
      // moved
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  // A new search starts at its first match.
  $effect(() => {
    void query
    active = 0
  })

  $effect(() => {
    if (open) list?.querySelector(`#ramp-${active}`)?.scrollIntoView({ block: 'nearest' })
  })

  onMount(() => {
    const outside = (ev: PointerEvent) => {
      if (open && root && !root.contains(ev.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  })
</script>

<div class="ramp-picker" bind:this={root}>
  <button
    type="button"
    class="current"
    bind:this={button}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={`Colors: ${current?.name ?? ''}${value.reversed ? ', reversed' : ''}`}
    onclick={() => (open ? close() : openList())}
  >
    <span class="strip" style:background={strip(value.id, value.reversed)}></span>
    <span class="current-name">{current?.name}</span>
    <Icon name="chevron-down" size={12} />
  </button>
  <button
    type="button"
    class="reverse"
    aria-pressed={value.reversed}
    aria-label="Reverse colors"
    title="Reverse colors"
    onclick={() => onChange({ id: value.id, reversed: !value.reversed })}
  >
    <Icon name="swap" size={14} />
  </button>

  {#if open}
    <div class="popup">
      <label class="search">
        <Icon name="search" size={14} />
        <input
          type="text"
          bind:this={search}
          bind:value={query}
          aria-label="Search color ramps"
          placeholder="Search {all.length} ramps"
          autocomplete="off"
          spellcheck="false"
          onkeydown={onSearchKeydown}
        />
      </label>
      <ul
        bind:this={list}
        class="list"
        role="listbox"
        aria-label="Color ramps"
        tabindex="0"
        aria-activedescendant={`ramp-${active}`}
        onkeydown={onKeydown}
      >
        {#each shown.groups as g (g.id)}
          <li class="group" role="presentation">{g.label}<span class="n">{g.ramps.length}</span></li>
          {#each g.ramps as r (r.id)}
            {@const i = shown.flat.indexOf(r)}
            <!-- Keys are handled on the listbox (aria-activedescendant pattern). -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              id={`ramp-${i}`}
              role="option"
              aria-selected={r.id === value.id}
              aria-label={`${r.name}, ${r.kind}`}
              class:active={i === active}
              onpointermove={() => (active = i)}
              onclick={() => choose(i)}
            >
              <span class="strip" style:background={strip(r.id, value.reversed)}></span>
              <span class="name">{r.name}</span>
              {#if r.id === value.id}<span class="chosen"><Icon name="check" size={12} /></span>{/if}
            </li>
          {/each}
        {/each}
        {#if shown.flat.length === 0}
          <li class="none" role="presentation">No ramp matches “{query.trim()}”.</li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

<style>
  .ramp-picker {
    position: relative;
    display: flex;
    gap: 4px;
    min-width: 0;
  }
  .current,
  .reverse {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .current {
    flex: 1;
    min-width: 0;
  }
  .current:hover,
  .reverse:hover {
    border-color: var(--se-text-muted);
  }
  .current-name {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    color: var(--se-text-primary);
    font-size: 0.92em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reverse {
    width: 28px;
    padding: 0;
    justify-content: center;
  }
  .reverse[aria-pressed='true'] {
    background: var(--se-control-active-bg);
    border-color: var(--se-control-active-fg);
    color: var(--se-control-active-fg);
  }
  /* A ramp as bands of its colors, with a hairline edge that reads on any panel color. */
  .strip {
    flex: 1;
    min-width: 40px;
    height: 14px;
    border: 1px solid var(--se-swatch-border);
    border-radius: 3px;
  }
  .popup {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: max(100%, 300px);
    max-height: 340px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
  }
  .search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin: 6px 6px 2px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
  }
  .search:focus-within {
    border-color: var(--se-focus);
  }
  .search input {
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
  .list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 2px 4px 4px;
    overflow-y: auto;
    list-style: none;
    outline: none;
  }
  .list:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .group {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 8px 6px 3px;
    background: var(--se-menu-bg);
    color: var(--se-text-secondary);
    font-size: 12px;
    font-weight: 600;
  }
  .group .n {
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  li[role='option'] {
    position: relative;
    display: grid;
    grid-template-columns: 132px 1fr 20px;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 4px 10px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  li[role='option'] .strip {
    min-width: 0;
    height: 16px;
  }
  li[role='option'].active {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  /* The chosen ramp: an edge bar and a tint, a bold name and a check badge, as in the Color type list. */
  li[role='option'][aria-selected='true'] {
    background: var(--se-control-active-bg);
  }
  li[role='option'][aria-selected='true']::before {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 3px;
    border-radius: 2px;
    background: var(--se-accent);
  }
  li[role='option'][aria-selected='true'] .name {
    color: var(--se-control-active-fg);
    font-weight: 600;
  }
  li[role='option'].active[aria-selected='true'] .name {
    color: inherit;
  }
  .chosen {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--se-accent);
    color: var(--se-button-fg);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    padding: 10px 8px;
    color: var(--se-text-secondary);
  }
  .current:focus-visible,
  .reverse:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: -1px;
  }
</style>
