<script lang="ts">
  // Spec 013 US4: a zip holding several datasets asks which one to open. A radio
  // list (arrow keys move, Enter opens, Esc cancels), the first one chosen; focus
  // returns to where the open started.
  import { onDestroy, onMount, tick } from 'svelte'

  interface Props {
    datasets: Array<{ name: string; size: number }>
    onAnswer: (name: string | null) => void
  }
  let { datasets, onAnswer }: Props = $props()

  let chosen = $state(0)
  let list = $state<HTMLElement>()
  let returnFocus: HTMLElement | null = null
  let answered = false

  const sizeLabel = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

  function answer(name: string | null): void {
    if (answered) return
    answered = true
    onAnswer(name)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      answer(null)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      chosen = (chosen + (e.key === 'ArrowDown' ? 1 : -1) + datasets.length) % datasets.length
      void tick().then(() => list?.querySelectorAll<HTMLInputElement>('input')[chosen]?.focus())
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      answer(datasets[chosen].name)
    }
  }

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void tick().then(() => list?.querySelector<HTMLInputElement>('input')?.focus())
  })
  onDestroy(() => {
    if (returnFocus?.isConnected) returnFocus.focus()
  })
</script>

<div class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="zip-choice-title" tabindex="-1" onkeydown={onKeydown}>
    <h2 id="zip-choice-title">Which dataset?</h2>
    <p>This zip holds {datasets.length} datasets. Open one; the others stay in the zip.</p>
    <div class="list" role="radiogroup" aria-labelledby="zip-choice-title" bind:this={list}>
      {#each datasets as d, i (d.name)}
        <label class:chosen={chosen === i}>
          <input type="radio" name="zip-dataset" value={d.name} checked={chosen === i} onchange={() => (chosen = i)} />
          <span class="name">{d.name}</span>
          <span class="size">{sizeLabel(d.size)}</span>
        </label>
      {/each}
    </div>
    <footer>
      <button type="button" class="secondary" onclick={() => answer(null)}>Cancel</button>
      <button type="button" class="primary" onclick={() => answer(datasets[chosen].name)}>Open</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, black 40%, transparent);
  }
  .dialog {
    width: min(480px, calc(100vw - 32px));
    padding: 16px;
    color: var(--se-text-primary);
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.1em;
    font-weight: 600;
  }
  p {
    margin: 0 0 12px;
    line-height: 1.45;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 40vh;
    margin-bottom: 16px;
    overflow: auto;
  }
  label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  label:hover {
    background: var(--se-bg-hover);
  }
  label.chosen {
    background: var(--se-control-active-bg);
    color: var(--se-control-active-fg);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    color: var(--se-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    height: 26px;
    padding: 0 12px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }
  .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .primary:hover {
    background: var(--se-button-hover);
  }
  .secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  .secondary:hover {
    background: var(--se-button-secondary-hover);
  }
</style>
