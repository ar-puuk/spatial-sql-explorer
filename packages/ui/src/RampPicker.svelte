<script lang="ts">
  // Color ramp picker (spec 003 FR-007, contracts/ui-style-panel.md): a
  // button showing the current ramp strip, a listbox of strips grouped by
  // kind (arrows move, Enter applies, Esc closes), and a Reverse toggle.
  import { onMount } from 'svelte'
  import { rampColors, rampsFor, type RampRef } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    value: RampRef
    renderer: 'categorized' | 'graduated'
    /** Classes shown in the previews: the ramp as it will be applied. */
    classCount: number
    onChange: (ramp: RampRef) => void
  }
  let { value, renderer, classCount, onChange }: Props = $props()

  const ramps = $derived(rampsFor(renderer))
  const kinds = $derived([...new Set(ramps.map((r) => r.kind))])
  const KIND_LABEL = { sequential: 'Sequential', diverging: 'Diverging', qualitative: 'Qualitative' } as const
  const current = $derived(ramps.find((r) => r.id === value.id) ?? ramps[0])
  const previewCount = $derived(Math.max(classCount, renderer === 'categorized' ? 8 : 5))

  let open = $state(false)
  let active = $state(0)
  let list = $state<HTMLUListElement>()
  let button = $state<HTMLButtonElement>()
  let root = $state<HTMLDivElement>()

  /** A strip: hard stops, so classes read as classes (no blending, research §2). */
  function strip(id: string, reversed: boolean): string {
    const colors = rampColors({ id, reversed }, previewCount)
    const step = 100 / colors.length
    return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`
  }

  function openList(): void {
    open = true
    active = Math.max(0, ramps.findIndex((r) => r.id === value.id))
    queueMicrotask(() => list?.focus())
  }

  function close(refocus = true): void {
    open = false
    if (refocus) button?.focus()
  }

  function choose(i: number): void {
    onChange({ id: ramps[i].id, reversed: value.reversed })
    close()
  }

  function onKeydown(e: KeyboardEvent): void {
    const n = ramps.length
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      active = e.key === 'Home' ? 0 : n - 1
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

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
    <ul
      bind:this={list}
      class="list"
      role="listbox"
      aria-label="Color ramps"
      tabindex="0"
      aria-activedescendant={`ramp-${active}`}
      onkeydown={onKeydown}
    >
      {#each kinds as kind (kind)}
        <li class="group" role="presentation">{KIND_LABEL[kind]}</li>
        {#each ramps as r, i (r.id)}
          {#if r.kind === kind}
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
              {#if r.id === value.id}<Icon name="check" size={12} />{/if}
            </li>
          {/if}
        {/each}
      {/each}
    </ul>
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
    gap: 6px;
    height: 24px;
    padding: 0 6px;
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
  .reverse[aria-pressed='true'] {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .strip {
    flex: 1;
    min-width: 40px;
    height: 12px;
    border: 1px solid var(--se-swatch-border);
    border-radius: 2px;
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    width: max(100%, 280px);
    max-height: 240px;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    list-style: none;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    outline: none;
  }
  .list:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .group {
    padding: 6px 6px 2px;
    color: var(--se-text-secondary);
    font-size: 0.85em;
  }
  li[role='option'] {
    display: grid;
    grid-template-columns: 96px 1fr 12px;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  li[role='option'].active {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current:focus-visible,
  .reverse:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
</style>
