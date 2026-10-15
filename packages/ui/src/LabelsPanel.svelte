<script lang="ts">
  import ColorField from './kit/ColorField.svelte'
  // Spec 011 US6 (contracts/ui.md "Labels panel"): the label settings of the
  // layer, in their own side panel (not part of the style). Text from a column
  // or a SQL expression the engine computes; size, color, halo, and where point
  // labels sit. Every edit is a `LabelPatch` (core `setLabels`).
  import { LABEL_HALO_WIDTH, LABEL_OFFSET, LABEL_SIZE, type LabelAnchor, type LabelPatch, type LabelSettings, type StyleGeometry } from '@spatial-explorer/core'
  import ColumnOptions from './style/ColumnOptions.svelte'

  interface Props {
    labels: LabelSettings | undefined
    columns: ReadonlyArray<{ name: string; type: string }>
    geometryType: StyleGeometry | null
    /** Why the expression can't be used (from the engine). */
    error?: string
    onChange: (patch: LabelPatch) => void
  }
  let { labels, columns, geometryType, error, onChange }: Props = $props()

  const EXPRESSION = '__expression'
  const ANCHORS: Array<{ id: LabelAnchor; label: string }> = [
    { id: 'above', label: 'Above' },
    { id: 'below', label: 'Below' },
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
    { id: 'center', label: 'Center' },
  ]

  const usable = $derived(columns.filter((c) => !c.name.startsWith('__se_') && !/^(GEOMETRY|BLOB|WKB)/i.test(c.type)))
  /** "SQL expression…" chosen before an expression is written. */
  let expressionMode = $state(false)
  const source = $derived(labels?.source)
  const usingExpression = $derived(source?.kind === 'expression' || expressionMode)
  const enabled = $derived(!!labels?.enabled)
  const hasPoints = $derived(geometryType === 'Point' || geometryType === 'Mixed' || geometryType === null)
  const placement = $derived(labels?.placement.kind === 'point' ? labels.placement : { kind: 'point' as const, anchor: 'above' as LabelAnchor, offset: LABEL_OFFSET.default })
  const size = $derived(labels?.size ?? LABEL_SIZE.default)
  const halo = $derived(labels?.halo ?? { enabled: true, color: '#ffffff', width: LABEL_HALO_WIDTH.default })

  function chooseText(value: string): void {
    if (value === EXPRESSION) {
      expressionMode = true
      return
    }
    expressionMode = false
    onChange({ source: { kind: 'column', column: value } })
  }
  function commitExpression(text: string): void {
    const expression = text.trim()
    if (!expression || (source?.kind === 'expression' && source.expression === expression)) return
    onChange({ source: { kind: 'expression', expression } })
  }
</script>

<div class="labels">
  <label class="check">
    <input type="checkbox" checked={enabled} disabled={!labels && usable.length === 0} onchange={(e) => onChange({ enabled: e.currentTarget.checked })} />
    Show labels
  </label>
  {#if !labels && usable.length === 0}
    <p class="hint">This layer has no columns to label with.</p>
  {/if}

  <fieldset class="settings" disabled={!enabled}>
    <section aria-labelledby="labels-sec-text">
      <h3 id="labels-sec-text">Text</h3>
      <div class="row field">
        <label class="label" for="labels-text">From</label>
        <select id="labels-text" class="column-select" value={usingExpression ? EXPRESSION : source?.kind === 'column' ? source.column : ''} onchange={(e) => chooseText(e.currentTarget.value)}>
          {#if !usingExpression && !source}
            <option value="">Choose…</option>
          {/if}
          <ColumnOptions columns={usable} />
          <option value={EXPRESSION}>SQL expression…</option>
        </select>
      </div>
      {#if usingExpression}
        <div class="expression">
          <input
            type="text"
            class="mono"
            class:invalid={!!error}
            aria-label="Label expression"
            aria-invalid={!!error}
            aria-describedby={error ? 'labels-expression-error' : 'labels-expression-hint'}
            placeholder="name || ' (' || lanes || ')'"
            spellcheck="false"
            autocomplete="off"
            value={source?.kind === 'expression' ? source.expression : ''}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onchange={(e) => commitExpression(e.currentTarget.value)}
          />
          {#if error}
            <p class="error" id="labels-expression-error" role="alert">{error}</p>
          {:else}
            <p class="hint" id="labels-expression-hint">A SQL expression over this layer's columns, shown as text.</p>
          {/if}
        </div>
      {/if}
    </section>

    <section aria-labelledby="labels-sec-look">
      <h3 id="labels-sec-look">Appearance</h3>
      <div class="row">
        <span class="label" id="labels-size-label">Size</span>
        <input
          type="range"
          class="wide"
          aria-labelledby="labels-size-label"
          aria-valuetext="{size} pixels"
          min={LABEL_SIZE.min}
          max={LABEL_SIZE.max}
          step="1"
          value={size}
          oninput={(e) => onChange({ size: Number(e.currentTarget.value) })}
        />
        <span class="value">{size} px</span>
      </div>
      <div class="row">
        <span class="label" id="labels-color-label">Color</span>
        <ColorField labelledby="labels-color-label" value={labels?.color ?? '#1f2937'} apply="live" size="md" onChange={(v) => onChange({ color: v })} />
      </div>
      <!-- The halo on one row: on or off, then its color and width (kept readable on any basemap). -->
      <div class="row">
        <label class="check label">
          <input type="checkbox" checked={halo.enabled} onchange={(e) => onChange({ halo: { enabled: e.currentTarget.checked } })} />
          Halo
        </label>
        <ColorField label="Halo color" disabled={!halo.enabled} value={halo.color} apply="live" size="md" onChange={(v) => onChange({ halo: { color: v } })} />
        <input
          type="range"
          aria-label="Halo width"
          aria-valuetext="{halo.width} pixels"
          disabled={!halo.enabled}
          min={LABEL_HALO_WIDTH.min}
          max={LABEL_HALO_WIDTH.max}
          step="0.5"
          value={halo.width}
          oninput={(e) => onChange({ halo: { width: Number(e.currentTarget.value) } })}
        />
        <span class="value">{halo.width} px</span>
      </div>
    </section>

    <section aria-labelledby="labels-sec-place">
      <h3 id="labels-sec-place">Placement</h3>
      {#if hasPoints}
        <div class="anchors" role="radiogroup" aria-label="Point labels">
          {#each ANCHORS as a (a.id)}
            <label class="anchor">
              <input type="radio" name="labels-anchor" value={a.id} checked={placement.anchor === a.id} onchange={() => onChange({ placement: { anchor: a.id } })} />
              {a.label}
            </label>
          {/each}
        </div>
        {#if placement.anchor !== 'center'}
          <div class="row">
            <span class="label" id="labels-offset-label">Offset</span>
            <input
              type="range"
              class="wide"
              aria-labelledby="labels-offset-label"
              aria-valuetext="{placement.offset} pixels"
              min={LABEL_OFFSET.min}
              max={LABEL_OFFSET.max}
              step="1"
              value={placement.offset}
              oninput={(e) => onChange({ placement: { offset: Number(e.currentTarget.value) } })}
            />
            <span class="value">{placement.offset} px</span>
          </div>
        {/if}
      {/if}
      {#if geometryType !== 'Point'}
        <p class="hint">
          {geometryType === 'LineString' ? 'Above the lines, never upside down.' : geometryType === 'Polygon' ? 'Inside the polygons.' : 'Lines: above the line. Polygons: inside.'}
          Labels that would overlap are left out.
        </p>
      {:else}
        <p class="hint">Labels that would overlap are left out.</p>
      {/if}
    </section>
  </fieldset>
</div>

<style>
  .labels {
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 12px;
    overflow-y: auto;
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    color: var(--se-text-primary);
  }
  .settings {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .settings:disabled {
    opacity: 0.55;
  }
  section {
    display: grid;
    gap: 6px;
  }
  h3 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .row {
    display: grid;
    grid-template-columns: 72px 28px 1fr 44px;
    align-items: center;
    gap: 8px;
  }
  .row.field {
    grid-template-columns: 72px 1fr;
  }
  /* A slider without a swatch spans the swatch's column too. */
  .row input.wide {
    grid-column: 2 / 4;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .value {
    text-align: right;
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  select {
    min-width: 0;
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--se-accent);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .check input,
  .anchor input {
    margin: 0;
    accent-color: var(--se-button-bg);
  }
  .anchors {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .anchor {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .expression {
    display: grid;
    gap: 3px;
  }
  .expression input {
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  .expression input.invalid {
    border-color: var(--se-error-border, var(--se-error));
  }
  select:focus-visible,
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .hint,
  .error {
    margin: 0;
    font-size: 0.88em;
    line-height: 1.35;
  }
  .hint {
    color: var(--se-text-secondary);
  }
  .error {
    color: var(--se-error-fg, var(--se-error));
  }
</style>
