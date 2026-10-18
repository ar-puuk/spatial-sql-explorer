<script lang="ts">
  // Spec 013 US1: a geodatabase layer that records no coordinate system asks for
  // one (GeoLibre's rule): the person says what its coordinates are in, and the
  // layer is converted with that. "No coordinate system" goes on without one
  // (longitude and latitude are assumed, and the status bar says so). Esc cancels
  // the open; focus returns to where the open started.
  import { onDestroy, onMount, tick } from 'svelte'
  import CrsPicker from './CrsPicker.svelte'

  interface Props {
    layerName: string
    /** An EPSG code, null to go on without a coordinate system, undefined to cancel the open. */
    onAnswer: (epsg: number | null | undefined) => void
  }
  let { layerName, onAnswer }: Props = $props()

  /** 'result' stands for "none" here: the picker's first row. */
  let choice = $state<'result' | number>('result')
  let openButton = $state<HTMLButtonElement>()
  let returnFocus: HTMLElement | null = null
  let answered = false

  function answer(epsg: number | null | undefined): void {
    if (answered) return
    answered = true
    onAnswer(epsg)
  }

  function onKeydown(e: KeyboardEvent): void {
    // The picker's own popup takes Esc first (it stops it); a bare Esc cancels the open.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault()
      answer(undefined)
    }
  }

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void tick().then(() => openButton?.focus())
  })
  onDestroy(() => {
    if (returnFocus?.isConnected) returnFocus.focus()
  })
</script>

<div class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="gdb-crs-title" aria-describedby="gdb-crs-text" tabindex="-1" onkeydown={onKeydown}>
    <h2 id="gdb-crs-title">Which coordinate system?</h2>
    <p id="gdb-crs-text">
      The layer “{layerName}” doesn’t record a coordinate system. Choose the one its coordinates are in, or go on without: it is then drawn as longitude and latitude, which is only right if it is.
    </p>
    <div class="field">
      <label class="label" for="gdb-crs">Coordinate system</label>
      <CrsPicker
        id="gdb-crs"
        value={choice}
        resultLabel="None recorded (assume WGS84 longitude and latitude)"
        resultSrid={null}
        extent={null}
        onChoose={(c) => (choice = c)}
      />
    </div>
    <footer>
      <button type="button" class="secondary" onclick={() => answer(undefined)}>Cancel</button>
      <button type="button" class="primary" bind:this={openButton} onclick={() => answer(choice === 'result' ? null : choice)}>Open</button>
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
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
  }
  .label {
    color: var(--se-text-secondary);
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
  button:focus-visible {
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
