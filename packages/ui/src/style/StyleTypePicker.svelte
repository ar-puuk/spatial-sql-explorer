<script lang="ts" generics="K extends string">
  // The style type: a button showing the current type and what it does, and a
  // listbox of every type, each with a one-line description (or why it can't
  // be used for this layer). Arrows move (skipping unusable types), Enter
  // applies, Esc closes: RampPicker's pattern.
  import { onMount } from 'svelte'
  import Icon from '../Icon.svelte'

  interface Option {
    kind: K
    label: string
    /** One line: what the type does. */
    hint: string
    /** Why the type can't be used for this layer, or null. */
    unavailable: string | null
  }
  interface Props {
    options: Option[]
    value: K
    onChange: (kind: K) => void
  }
  let { options, value, onChange }: Props = $props()

  const current = $derived(options.find((o) => o.kind === value) ?? options[0])
  let open = $state(false)
  let active = $state(0)
  let list = $state<HTMLUListElement>()
  let button = $state<HTMLButtonElement>()
  let root = $state<HTMLDivElement>()
  const id = `style-type-${Math.random().toString(36).slice(2, 8)}`

  function openList(): void {
    open = true
    active = Math.max(0, options.findIndex((o) => o.kind === value))
    queueMicrotask(() => list?.focus())
  }

  function close(refocus = true): void {
    open = false
    if (refocus) button?.focus()
  }

  function choose(i: number): void {
    const o = options[i]
    if (!o || o.unavailable) return
    close()
    if (o.kind !== value) onChange(o.kind)
  }

  /** The next usable option from `from` in direction `by` (wrapping), or `from`. */
  function step(from: number, by: 1 | -1): number {
    const n = options.length
    for (let k = 1; k <= n; k++) {
      const i = (((from + by * k) % n) + n) % n
      if (!options[i].unavailable) return i
    }
    return from
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      active = step(active, e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      active = e.key === 'Home' ? step(options.length - 1, 1) : step(0, -1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  /** On the closed button, arrows open the list (as a native select's do). */
  function onButtonKeydown(e: KeyboardEvent): void {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      openList()
    }
  }

  onMount(() => {
    const outside = (ev: PointerEvent) => {
      if (open && root && !root.contains(ev.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  })
</script>

<div class="type-picker" bind:this={root}>
  <button
    type="button"
    class="current"
    bind:this={button}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={`Style type: ${current?.label ?? ''}`}
    aria-describedby={`${id}-hint`}
    onclick={() => (open ? close() : openList())}
    onkeydown={onButtonKeydown}
  >
    <span class="text">
      <span class="name">{current?.label}</span>
      <span class="hint" id={`${id}-hint`}>{current?.hint}</span>
    </span>
    <Icon name="chevron-down" size={12} />
  </button>

  {#if open}
    <ul bind:this={list} class="list" role="listbox" aria-label="Style types" tabindex="0" aria-activedescendant={`${id}-${active}`} onkeydown={onKeydown}>
      {#each options as o, i (o.kind)}
        <!-- Keys are handled on the listbox (aria-activedescendant pattern). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`${id}-${i}`}
          role="option"
          data-kind={o.kind}
          aria-selected={o.kind === value}
          aria-disabled={o.unavailable !== null}
          aria-labelledby={`${id}-${i}-name`}
          aria-describedby={`${id}-${i}-hint`}
          class:active={i === active}
          onpointermove={() => {
            if (!o.unavailable) active = i
          }}
          onclick={() => choose(i)}
        >
          <span class="text">
            <span class="name" id={`${id}-${i}-name`}>{o.label}</span>
            <span class="hint" id={`${id}-${i}-hint`}>{o.unavailable ?? o.hint}</span>
          </span>
          {#if o.kind === value}<Icon name="check" size={12} />{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .type-picker {
    position: relative;
    min-width: 0;
  }
  .current {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .current:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
  .hint {
    overflow: hidden;
    color: var(--se-text-secondary);
    font-size: 0.92em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    width: 100%;
    max-height: 320px;
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
  li[role='option'] {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  li[role='option'].active {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  /* In the list, descriptions wrap rather than cut off. */
  li[role='option'] .hint {
    white-space: normal;
  }
  li[role='option'].active .hint {
    color: inherit;
    opacity: 0.85;
  }
  li[aria-disabled='true'] {
    cursor: default;
  }
  li[aria-disabled='true'] .name {
    opacity: 0.55;
  }
  li[aria-disabled='true'] .hint {
    font-style: italic;
  }
</style>
