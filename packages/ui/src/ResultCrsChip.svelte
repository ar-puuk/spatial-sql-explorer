<script lang="ts">
  // Result CRS chip (spec 002 FR-014; research §4). Always says which CRS the
  // displayed geometry is assumed to be in and why: `layer` (the file's own),
  // `detected` (looks like a transform to lon/lat), `engine` (typed by the
  // engine) or `override` (set here). The dropdown corrects a wrong guess.
  import Icon from './Icon.svelte'

  interface Props {
    label: string
    source: 'layer' | 'detected' | 'engine' | 'override'
    override: number | null
    onOverride: (epsg: number | null) => void
  }
  let { label, source, override, onOverride }: Props = $props()

  let open = $state(false)
  let input = $state('')
  let invalid = $state(false)

  function apply(): void {
    const code = Number(input.replace(/^EPSG:/i, '').trim())
    if (!Number.isInteger(code) || code < 1024 || code > 999999) {
      invalid = true
      return
    }
    invalid = false
    open = false
    onOverride(code)
  }
</script>

<div class="result-crs">
  <button type="button" class="chip" aria-haspopup="dialog" aria-expanded={open} title="Coordinate system of the result's geometry" onclick={() => (open = !open)}>
    <span class="k">Result CRS</span>
    <span class="v">{label}</span>
    <span class="src">({source})</span>
    <Icon name="chevron-down" size={12} />
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label="Result CRS">
      <label>
        EPSG code
        <input
          type="text"
          inputmode="numeric"
          placeholder={override ? String(override) : 'e.g. 3857'}
          bind:value={input}
          aria-invalid={invalid}
          onkeydown={(e) => {
            if (e.key === 'Enter') apply()
            if (e.key === 'Escape') open = false
          }}
        />
      </label>
      {#if invalid}<p class="err">Enter an EPSG code, e.g. 4326 or 26912.</p>{/if}
      <div class="row">
        <button type="button" class="primary" onclick={apply}>Apply</button>
        <button
          type="button"
          onclick={() => {
            open = false
            onOverride(null)
          }}>Automatic</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .result-crs {
    position: relative;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    font: inherit;
    font-size: 0.92em;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--se-control-hover);
  }
  .chip:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .k {
    color: var(--se-text-muted);
  }
  .v {
    color: var(--se-text-primary);
    font-family: var(--se-font-mono);
  }
  .pop {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    z-index: 10;
    display: grid;
    gap: 6px;
    width: 220px;
    padding: 8px;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
  }
  label {
    display: grid;
    gap: 4px;
    color: var(--se-text-secondary);
  }
  input {
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font-family: var(--se-font-mono);
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .err {
    margin: 0;
    color: var(--se-error);
    font-size: 0.9em;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row button {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .row .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
</style>
