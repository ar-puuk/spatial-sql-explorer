<script lang="ts">
  // Spec 007 (FR-002, contracts/ui.md): what an open is doing, with Cancel,
  // whenever it takes longer than a moment. Shown after 1 s so quick opens
  // don't flash. The label names the phase; reads and indexing show elapsed
  // time, since their length can't be known in advance.
  import type { DatasetFacts, OpenPhase } from '@spatial-explorer/core'
  import ProgressBar from './ProgressBar.svelte'

  interface Props {
    phase: OpenPhase | null
    startedAt: number | null
    facts: DatasetFacts | null
    sizeBytes?: number | null
    onCancel: () => void
  }
  let { phase, startedAt, facts, onCancel }: Props = $props()

  const nf = new Intl.NumberFormat()
  let now = $state(performance.now())
  $effect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => (now = performance.now()), 250)
    return () => clearInterval(timer)
  })

  const active = $derived(phase === 'registering' || phase === 'facts' || phase === 'reading' || phase === 'indexing')
  const elapsed = $derived(startedAt === null ? 0 : Math.max(0, now - startedAt))
  const seconds = $derived(Math.floor(elapsed / 1000))
  const label = $derived.by(() => {
    switch (phase) {
      case 'reading':
        return `Reading the whole file… ${seconds} s`
      case 'indexing':
        return facts ? `Indexing ${nf.format(facts.rows)} features for the map… ${seconds} s` : `Indexing features for the map… ${seconds} s`
      default:
        return 'Reading file facts…'
    }
  })
</script>

{#if active}
  <ProgressBar label="Opening file" />
  {#if elapsed >= 1000}
    <div class="open-progress" role="status">
      <span class="label">{label}</span>
      <button type="button" onclick={onCancel}>Cancel opening</button>
    </div>
  {/if}
{/if}

<style>
  .open-progress {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 21;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px 6px 12px;
    border: 1px solid var(--se-menu-border);
    border-radius: 4px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    box-shadow: var(--se-shadow-elevated);
    font-size: 12px;
    white-space: nowrap;
  }
  .label {
    font-variant-numeric: tabular-nums;
  }
  button {
    height: 22px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border, transparent);
    border-radius: 2px;
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--se-button-secondary-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
