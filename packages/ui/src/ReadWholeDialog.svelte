<script lang="ts">
  // Spec 007 FR-004 (contracts/ui.md): a file that must be parsed in full is
  // announced above the whole-read threshold, with its size and an estimate,
  // before any parsing starts. Open is the default; Esc or Cancel back out,
  // and focus returns to where the open started.
  import { onDestroy, onMount, tick } from 'svelte'

  interface Props {
    sizeBytes: number
    format: string
    onAnswer: (open: boolean) => void
  }
  let { sizeBytes, format, onAnswer }: Props = $props()

  const FORMAT_NAMES: Record<string, string> = {
    geojson: 'GeoJSON',
    shapefile: 'Shapefile',
    csv: 'CSV',
    xlsx: 'Excel workbook',
    gml: 'GML',
    geopackage: 'GeoPackage',
    sqlite: 'SQLite',
    geoparquet: 'GeoParquet',
    flatgeobuf: 'FlatGeobuf',
    geodatabase: 'Geodatabase layers',
  }
  /** Parse rate measured in research §4 (~70 ms per MB of GeoJSON through a handle). */
  const MS_PER_MB = 70

  const mb = $derived(sizeBytes / 1024 / 1024)
  const sizeLabel = $derived(mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`)
  const seconds = $derived(Math.max(5, Math.round((mb * MS_PER_MB) / 1000 / 5) * 5))
  const duration = $derived(seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`)
  const name = $derived(FORMAT_NAMES[format] ?? format)
  // GeoParquet only arrives here when partial reads failed (FR-015); FlatGeobuf is read whole since spec 010.
  const lead = $derived(
    format === 'geoparquet' ? 'Partial reads aren’t available here, so this file must be read in full.' : `${name} files must be read in full.`
  )

  let openButton = $state<HTMLButtonElement>()
  let returnFocus: HTMLElement | null = null
  let answered = false

  function answer(open: boolean): void {
    if (answered) return
    answered = true
    onAnswer(open)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      answer(false)
    } else if (e.key === 'Tab') {
      // Two buttons: keep focus inside the modal.
      const buttons = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]
      e.preventDefault()
      next?.focus()
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
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="read-whole-title" aria-describedby="read-whole-text" tabindex="-1" onkeydown={onKeydown}>
    <h2 id="read-whole-title">Read the whole file?</h2>
    <p id="read-whole-text">
      {lead} This one is {sizeLabel} and may take about {duration}. GeoParquet opens at any size.
    </p>
    <footer>
      <button type="button" class="secondary" onclick={() => answer(false)}>Cancel</button>
      <button type="button" class="primary" bind:this={openButton} onclick={() => answer(true)}>Open</button>
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
    /* A neutral scrim, as in the export dialog. */
    background: color-mix(in srgb, black 40%, transparent);
  }
  .dialog {
    width: min(440px, calc(100vw - 32px));
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
    margin: 0 0 16px;
    line-height: 1.45;
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
