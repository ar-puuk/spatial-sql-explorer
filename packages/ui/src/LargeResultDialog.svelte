<script lang="ts">
  // FR-012: results above the threshold ask before anything is rendered.
  // Focus-trapped; the safe choice ("Show first 50,000") is the default
  // button, and Esc means Cancel.
  import { onMount } from 'svelte'
  import { LARGE_RESULT_THRESHOLD } from '@spatial-explorer/core'

  interface Props {
    rowCount: number
    onChoose: (choice: 'all' | 'first' | 'cancel') => void
  }
  let { rowCount, onChoose }: Props = $props()
  const nf = new Intl.NumberFormat('en-US')

  let dialog: HTMLDivElement
  let firstButton: HTMLButtonElement

  onMount(() => firstButton?.focus())

  function trap(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onChoose('cancel')
      return
    }
    if (e.key !== 'Tab') return
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = (i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length
    buttons[next]?.focus()
    e.preventDefault()
  }
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Large result" bind:this={dialog} onkeydown={trap} tabindex="-1">
    <p class="text">
      This query returned <strong>{nf.format(rowCount)} rows</strong>. Showing more than {nf.format(LARGE_RESULT_THRESHOLD)} may be slow or run out of memory.
    </p>
    <div class="buttons">
      <button type="button" class="primary" bind:this={firstButton} onclick={() => onChoose('first')}>Show first {nf.format(LARGE_RESULT_THRESHOLD)}</button>
      <button type="button" onclick={() => onChoose('all')}>Show all</button>
      <button type="button" onclick={() => onChoose('cancel')}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--se-bg-base) 55%, transparent);
  }
  .dialog {
    width: min(420px, calc(100% - 32px));
    padding: 16px;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  .text {
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  button {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--se-button-secondary-hover);
  }
  .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .primary:hover {
    background: var(--se-button-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }
</style>
