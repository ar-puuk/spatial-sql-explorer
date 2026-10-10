<script lang="ts">
  // Query history popover (spec 002 US5, FR-016; contracts/ui-query-panel.md):
  // the newest 20 queries for this file with when they ran and their outcome.
  // Arrow keys move, Enter or click loads the entry into the editor without
  // running it, Esc closes and returns focus to the History button.
  import { onMount } from 'svelte'
  import type { QueryHistoryEntry } from '@spatial-explorer/core'

  interface Props {
    entries: QueryHistoryEntry[]
    onPick: (entry: QueryHistoryEntry) => void
    onClose: () => void
  }
  let { entries, onPick, onClose }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  let active = $state(0)
  let list = $state<HTMLUListElement>()
  let root = $state<HTMLDivElement>()

  function ago(iso: string): string {
    const s = (Date.parse(iso) - Date.now()) / 1000
    if (!Number.isFinite(s)) return ''
    if (s > -60) return 'just now'
    if (s > -3600) return rtf.format(Math.round(s / 60), 'minute')
    if (s > -86_400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86_400), 'day')
  }

  function outcomeText(e: QueryHistoryEntry): string {
    const o = e.outcome
    if (!o.ok) return o.error
    if (o.summary) return o.summary
    return `${nf.format(o.rows)} ${o.rows === 1 ? 'row' : 'rows'}`
  }

  function onKeydown(ev: KeyboardEvent): void {
    const n = entries.length
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      onClose()
    } else if (n && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault()
      active = (active + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n
    } else if (n && (ev.key === 'Home' || ev.key === 'End')) {
      ev.preventDefault()
      active = ev.key === 'Home' ? 0 : n - 1
    } else if (n && ev.key === 'Enter') {
      ev.preventDefault()
      onPick(entries[active])
    } else if (ev.key === 'Tab') {
      onClose()
    }
  }

  $effect(() => {
    list?.querySelector(`#history-${active}`)?.scrollIntoView({ block: 'nearest' })
  })

  onMount(() => {
    list?.focus()
    const outside = (ev: PointerEvent) => {
      if (root && !root.contains(ev.target as Node)) onClose()
    }
    // Registered after the click that opened the popover has finished.
    const t = setTimeout(() => document.addEventListener('pointerdown', outside, true))
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', outside, true)
    }
  })
</script>

<div class="history" bind:this={root}>
  <div class="heading">Recent queries for this file</div>
  {#if entries.length === 0}
    <p class="empty" tabindex="-1">No queries yet for this file.</p>
    <!-- Keep Esc working when there is nothing to list. -->
    <ul bind:this={list} class="sr-only" role="listbox" aria-label="Query history" tabindex="0" onkeydown={onKeydown}></ul>
  {:else}
    <ul
      bind:this={list}
      role="listbox"
      aria-label="Query history"
      tabindex="0"
      aria-activedescendant={`history-${active}`}
      onkeydown={onKeydown}
    >
      {#each entries as entry, i (entry.text)}
        <!-- Keys are handled on the listbox (aria-activedescendant pattern). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`history-${i}`}
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onpointermove={() => (active = i)}
          onclick={() => onPick(entry)}
        >
          <code class="text" title={entry.text}>{entry.text.replace(/\s+/g, ' ')}</code>
          <span class="meta">
            <span class="time">{ago(entry.ranAt)}</span>
            <span class="outcome" class:failed={!entry.outcome.ok}>{entry.outcome.ok ? '✓' : '✗'} {outcomeText(entry)}</span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history {
    position: absolute;
    top: 30px;
    right: 6px;
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: min(440px, calc(100% - 12px));
    max-height: min(340px, calc(100% - 36px));
    min-height: 0;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .heading {
    flex: none;
    padding: 6px 10px 4px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 4px 4px;
    list-style: none;
    overflow: auto;
    outline: none;
  }
  ul:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  li.active {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--se-font-mono);
  }
  .meta {
    display: flex;
    gap: 8px;
    min-width: 0;
    font-size: 0.92em;
    opacity: 0.85;
  }
  .time {
    flex: none;
  }
  .outcome {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .outcome.failed {
    color: var(--se-error);
  }
  li.active .outcome.failed {
    color: inherit;
  }
  .empty {
    margin: 0;
    padding: 4px 10px 10px;
    color: var(--se-text-secondary);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
