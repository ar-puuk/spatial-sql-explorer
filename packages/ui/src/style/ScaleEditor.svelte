<script lang="ts">
  import ColumnOptions from './ColumnOptions.svelte'
  // Spec 011 (contracts/ui.md "Scale editor"): how one property's column
  // becomes outputs. Categories or classes: the method and class count, the
  // outputs' ramp (colors) or range (numbers), and each class's output,
  // label and visibility. "Hide from legend" leaves the map unchanged.
  import {
    CHANNEL_NAMES,
    LINE_DASHES,
    LINE_DASH_NAMES,
    MARKER_SHAPES,
    MARKER_SHAPE_NAMES,
    METHOD_NAMES,
    MAX_CLASS_COUNT,
    MIN_CLASS_COUNT,
    OUTPUT_KIND,
    type ChannelId,
    type ClassDef,
    type Encoding,
    type GraduatedMethod,
    type Output,
    type RampRef,
    type ResolvedChannel,
    type ScaleKind,
  } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'
  import RampPicker from '../RampPicker.svelte'

  interface Props {
    channel: ChannelId
    enc: Encoding
    resolved: ResolvedChannel | undefined
    /** Columns the property can be set by (name and type). */
    columns: Array<{ name: string; type: string }>
    /** The scales offered here (this phase: categories and classes). */
    scales: ScaleKind[]
    onColumn: (column: string) => void
    onScale: (kind: ScaleKind) => void
    onClasses: (patch: { method?: Exclude<GraduatedMethod, 'manual'>; classCount?: number }) => void
    onRange: (min: number, max: number) => void
    onRamp: (ramp: RampRef) => void
    /** Spec 011 US4, continuous: the domain (null: the column's minimum to maximum) and a number's curve. */
    onDomain?: (domain: { min: number; max: number } | null) => void
    onCurve?: (curve: 'linear' | 'area') => void
    /** Spec 011 US4, conditions: add, change, move and remove them, and Everything else. */
    onCondition?: {
      add: () => void
      update: (id: string, patch: { where?: string; label?: string; output?: Output; visible?: boolean }) => void
      remove: (id: string) => void
      move: (id: string, by: -1 | 1) => void
      otherwise: (patch: { output?: Output; visible?: boolean }) => void
    }
    onClass: (key: string, patch: ClassDef) => void
    onLegendHidden: (hidden: boolean) => void
  }
  let { channel, enc, resolved, columns, scales, onColumn, onScale, onClasses, onRange, onRamp, onDomain = () => {}, onCurve = () => {}, onCondition, onClass, onLegendHidden }: Props = $props()

  const name = $derived(CHANNEL_NAMES[channel])
  const kind = $derived(OUTPUT_KIND[channel])
  const column = $derived(enc.source.kind === 'column' ? enc.source.column : '')
  const scale = $derived(enc.scale)
  const SCALE_NAMES: Record<ScaleKind, string> = { categories: 'Categories', classes: 'Classes', continuous: 'Continuous', conditions: 'Conditions', identity: 'As is', bivariate: 'Bivariate' }
  const METHODS: Array<Exclude<GraduatedMethod, 'manual'>> = ['equal', 'quantile', 'jenks']
  const COUNTS = Array.from({ length: MAX_CLASS_COUNT - MIN_CLASS_COUNT + 1 }, (_, i) => MIN_CLASS_COUNT + i)
  const range = $derived(scale.kind === 'categories' || scale.kind === 'classes' || scale.kind === 'continuous' ? scale.range : undefined)
  const ramp = $derived(scale.kind === 'categories' || scale.kind === 'classes' || scale.kind === 'continuous' ? scale.ramp : undefined)
  /** Continuous: the domain drawn (the scale's own, or the column's). */
  const domain = $derived(scale.kind === 'continuous' ? (scale.domain ?? resolved?.domain) : undefined)
  const fmtDomain = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6, useGrouping: false })
  const classes = $derived(resolved?.classes ?? [])
  const nf = new Intl.NumberFormat('en-US')
  const unit = $derived(kind === 'px' ? 'px' : kind === 'degrees' ? '°' : kind === 'meters' ? 'm' : '')

  /** Outputs as people read them: opacity in percent, the rest as they are. */
  const shown = (v: number): number => (kind === 'opacity' ? Math.round(v * 100) : v)
  const stored = (v: number): number => (kind === 'opacity' ? v / 100 : v)
  const step = $derived(kind === 'opacity' ? 5 : kind === 'degrees' ? 15 : 0.5)
  const max = $derived(kind === 'opacity' ? 100 : kind === 'degrees' ? 360 : kind === 'meters' ? 100000 : 100)
  const uid = `scale-${Math.random().toString(36).slice(2, 8)}`
</script>

{#snippet outputEditor(label: string, value: Output | undefined, set: (o: Output) => void)}
  {#if kind === 'color'}
    <input type="color" aria-label={label} value={String(value ?? '#000000')} onchange={(e) => set(e.currentTarget.value)} />
  {:else if kind === 'shape'}
    <select aria-label={label} value={String(value)} onchange={(e) => set(e.currentTarget.value)}>
      {#each MARKER_SHAPES as s (s)}
        <option value={s}>{MARKER_SHAPE_NAMES[s]}</option>
      {/each}
    </select>
  {:else if kind === 'dash'}
    <select aria-label={label} value={String(value)} onchange={(e) => set(e.currentTarget.value)}>
      {#each LINE_DASHES as d (d)}
        <option value={d}>{LINE_DASH_NAMES[d]}</option>
      {/each}
    </select>
  {:else}
    <input
      class="number"
      type="number"
      aria-label={label}
      min="0"
      {max}
      {step}
      value={shown(Number(value ?? 0))}
      onchange={(e) => {
        const v = Number(e.currentTarget.value)
        if (Number.isFinite(v)) set(stored(v))
      }}
    />
  {/if}
{/snippet}

<div class="scale-editor">
  {#if scale.kind !== 'conditions'}
  <div class="row field">
    <label class="label" for="{uid}-column">Column</label>
    <select id="{uid}-column" class="column-select" aria-label="{name} column" value={column} onchange={(e) => onColumn(e.currentTarget.value)}>
      {#if !columns.some((c) => c.name === column)}
        <option value={column}>{column || 'Choose…'}</option>
      {/if}
      <ColumnOptions columns={columns} />
    </select>
  </div>
  {/if}
  {#if scales.length > 1}
    <div class="row field">
      <label class="label" for="{uid}-scale">Scale</label>
      <select id="{uid}-scale" aria-label="{name} scale" value={scale.kind} onchange={(e) => onScale(e.currentTarget.value as ScaleKind)}>
        {#each scales as s (s)}
          <option value={s}>{SCALE_NAMES[s]}</option>
        {/each}
      </select>
    </div>
  {/if}
  {#if scale.kind === 'classes'}
    <div class="pair">
      <div class="row field">
        <label class="label" for="{uid}-method">Method</label>
        <select id="{uid}-method" aria-label="{name} method" value={scale.method} onchange={(e) => onClasses({ method: e.currentTarget.value as Exclude<GraduatedMethod, 'manual'> })}>
          {#each METHODS as m (m)}
            <option value={m}>{m === 'jenks' ? 'Natural breaks (Jenks)' : METHOD_NAMES[m]}</option>
          {/each}
          {#if scale.method === 'manual'}
            <option value="manual">Manual</option>
          {/if}
        </select>
      </div>
      <div class="row field">
        <label class="label" for="{uid}-count">Classes</label>
        <select id="{uid}-count" class="narrow" aria-label="{name} class count" value={scale.classCount} onchange={(e) => onClasses({ classCount: Number(e.currentTarget.value) })}>
          {#each COUNTS as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </div>
    </div>
  {/if}
  {#if scale.kind === 'continuous' && domain}
    <!-- Spec 011 US4: the values the outputs run between; Auto is the column's minimum to maximum. -->
    <div class="row field">
      <span class="label" aria-hidden="true">Values</span>
      <span class="range">
        <input class="number" type="number" aria-label="{name} from value" value={fmtDomain.format(domain.min)} onchange={(e) => onDomain({ min: Number(e.currentTarget.value), max: domain.max })} />
        <span aria-hidden="true">to</span>
        <input class="number" type="number" aria-label="{name} to value" value={fmtDomain.format(domain.max)} onchange={(e) => onDomain({ min: domain.min, max: Number(e.currentTarget.value) })} />
        {#if scale.domain}
          <button type="button" class="link" title="Use the column's minimum and maximum" onclick={() => onDomain(null)}>Auto</button>
        {/if}
      </span>
    </div>
    {#if kind !== 'color'}
      <div class="row field">
        <label class="label" for="{uid}-curve">Curve</label>
        <select id="{uid}-curve" aria-label="{name} curve" value={scale.curve ?? 'linear'} onchange={(e) => onCurve(e.currentTarget.value as 'linear' | 'area')}>
          <option value="linear">Linear</option>
          <option value="area">By area</option>
        </select>
      </div>
    {/if}
  {:else if scale.kind === 'conditions' && onCondition}
    <!-- Spec 011 US4: SQL conditions in order; the first that holds wins, then Everything else. -->
    {@const rules = scale.rules}
    {@const other = classes.find((x) => x.kind === 'other')}
    <ol class="conditions" aria-label="{name} conditions">
      {#each rules as rule, i (rule.id)}
        {@const c = classes.find((x) => x.ruleId === rule.id)}
        <li class:hidden={!rule.visible}>
          <div class="line">
            <button type="button" class="eye" aria-pressed={!rule.visible} aria-label="{rule.visible ? 'Hide' : 'Show'} condition {i + 1}" title={rule.visible ? 'Hide these features' : 'Show these features'} onclick={() => onCondition.update(rule.id, { visible: !rule.visible })}>
              <Icon name={rule.visible ? 'eye' : 'eye-off'} size={14} />
            </button>
            {@render outputEditor(`Condition ${i + 1} ${name.toLowerCase()}`, rule.output, (o) => onCondition.update(rule.id, { output: o }))}
            <input
              type="text"
              class="where"
              class:invalid={!!c?.error}
              aria-label="Condition {i + 1}"
              aria-invalid={!!c?.error}
              aria-describedby={c?.error ? `${uid}-error-${rule.id}` : undefined}
              placeholder="e.g. lanes > 2"
              spellcheck="false"
              autocomplete="off"
              value={rule.where}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onchange={(e) => onCondition.update(rule.id, { where: e.currentTarget.value.trim() })}
            />
            <span class="count" title="Features this condition sets">{c && !c.error && rule.where ? nf.format(c.count) : '–'}</span>
          </div>
          <div class="line tools">
            <button type="button" class="icon-button" aria-label="Move condition {i + 1} up" disabled={i === 0} onclick={() => onCondition.move(rule.id, -1)}><Icon name="arrow-up" size={14} /></button>
            <button type="button" class="icon-button" aria-label="Move condition {i + 1} down" disabled={i === rules.length - 1} onclick={() => onCondition.move(rule.id, 1)}><Icon name="arrow-down" size={14} /></button>
            <button type="button" class="icon-button" aria-label="Delete condition {i + 1}" onclick={() => onCondition.remove(rule.id)}><Icon name="trash" size={14} /></button>
          </div>
          {#if c?.error}<p class="error" id="{uid}-error-{rule.id}" role="alert">{c.error}</p>{/if}
        </li>
      {/each}
      <li class:hidden={!scale.else.visible}>
        <div class="line">
          <button type="button" class="eye" aria-pressed={!scale.else.visible} aria-label="{scale.else.visible ? 'Hide' : 'Show'} {scale.else.label}" title={scale.else.visible ? 'Hide these features' : 'Show these features'} onclick={() => onCondition.otherwise({ visible: !scale.else.visible })}>
            <Icon name={scale.else.visible ? 'eye' : 'eye-off'} size={14} />
          </button>
          {@render outputEditor(`${scale.else.label} ${name.toLowerCase()}`, scale.else.output, (o) => onCondition.otherwise({ output: o }))}
          <span class="name">{scale.else.label}</span>
          <span class="count">{other ? nf.format(other.count) : ''}</span>
        </div>
      </li>
    </ol>
    <button type="button" class="add" onclick={() => onCondition.add()}><Icon name="plus" size={14} />Add condition</button>
  {:else if scale.kind === 'identity'}
    <p class="hint">
      {kind === 'color' ? 'Each feature takes the color in the column (#rrggbb).' : kind === 'opacity' ? 'Each feature takes the opacity in the column (0 to 1).' : kind === 'degrees' ? 'Each feature turns by the degrees in the column.' : 'Each feature takes the pixels in the column.'}
    </p>
  {/if}
  {#if kind === 'color' && ramp}
    <RampPicker value={ramp} renderer={scale.kind === 'categories' ? 'categorized' : 'graduated'} classCount={classes.filter((c) => c.kind === 'value' || c.kind === 'range').length || 1} onChange={onRamp} />
  {:else if range && (kind === 'px' || kind === 'opacity' || kind === 'degrees' || kind === 'meters')}
    <div class="row field">
      <span class="label" aria-hidden="true">From</span>
      <span class="range">
        <input class="number" type="number" aria-label="Smallest {name.toLowerCase()}" min="0" {max} {step} value={shown(range.min)} onchange={(e) => onRange(stored(Number(e.currentTarget.value)), range.max)} />
        <span aria-hidden="true">to</span>
        <input class="number" type="number" aria-label="Largest {name.toLowerCase()}" min="0" {max} {step} value={shown(range.max)} onchange={(e) => onRange(range.min, stored(Number(e.currentTarget.value)))} />
        <span>{kind === 'opacity' ? '%' : unit}</span>
      </span>
    </div>
  {/if}

  {#if resolved?.status === 'fallback'}
    <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.reason} Every feature uses the fixed {name.toLowerCase()}.</p>
  {:else if scale.kind !== 'conditions' && classes.length}
    {#if resolved?.caption}<p class="caption">{resolved.caption}</p>{/if}
    <ul class="classes" aria-label="{name} classes">
      {#each classes as c (c.key)}
        <li>
          <button
            type="button"
            class="eye"
            aria-pressed={!c.visible}
            aria-label="{c.visible ? 'Hide' : 'Show'} {c.label}"
            title={c.visible ? 'Hide these features' : 'Show these features'}
            onclick={() => onClass(c.key, { visible: !c.visible })}
          >
            <Icon name={c.visible ? 'eye' : 'eye-off'} size={14} />
          </button>
          {#if kind === 'color'}
            <input type="color" aria-label="{c.label} {name.toLowerCase()}" value={String(c.output ?? '#000000')} onchange={(e) => onClass(c.key, { output: e.currentTarget.value as Output })} />
          {:else if kind === 'shape'}
            <select aria-label="{c.label} {name.toLowerCase()}" value={String(c.output)} onchange={(e) => onClass(c.key, { output: e.currentTarget.value })}>
              {#each MARKER_SHAPES as s (s)}
                <option value={s}>{MARKER_SHAPE_NAMES[s]}</option>
              {/each}
            </select>
          {:else if kind === 'dash'}
            <select aria-label="{c.label} {name.toLowerCase()}" value={String(c.output)} onchange={(e) => onClass(c.key, { output: e.currentTarget.value })}>
              {#each LINE_DASHES as d (d)}
                <option value={d}>{LINE_DASH_NAMES[d]}</option>
              {/each}
            </select>
          {:else}
            <input
              class="number"
              type="number"
              aria-label="{c.label} {name.toLowerCase()}"
              min="0"
              {max}
              {step}
              value={shown(Number(c.output ?? 0))}
              onchange={(e) => {
                const v = Number(e.currentTarget.value)
                if (Number.isFinite(v)) onClass(c.key, { output: stored(v) })
              }}
            />
          {/if}
          <span class="name" title={c.label}>{c.label}</span>
          <span class="count">{nf.format(c.count)}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <!-- Notes of every scale (a continuous one may have no classes to list). -->
  {#if resolved?.status === 'ok'}
    {#each resolved.notes as note (note)}
      <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
    {/each}
  {/if}
  <label class="check">
    <input type="checkbox" checked={enc.legend?.hidden === true} onchange={(e) => onLegendHidden(e.currentTarget.checked)} />
    <span>Hide from legend</span>
  </label>
</div>

<style>
  .scale-editor {
    display: grid;
    gap: 6px;
  }
  .row.field {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
  }
  .pair {
    display: grid;
    gap: 6px;
  }
  .range {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  select,
  input.number {
    min-width: 0;
    padding: 2px 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
  }
  input.number {
    width: 64px;
  }
  select:focus-visible,
  input:focus-visible,
  .eye:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .caption,
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
  }
  .conditions {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .conditions .line {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
  }
  .conditions .line.tools {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
  }
  .conditions li.hidden .where,
  .conditions li.hidden .name {
    opacity: 0.6;
  }
  .where {
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
  .where.invalid {
    border-color: var(--se-error-border);
  }
  .error {
    margin: 0;
    color: var(--se-error-fg);
    font-size: 0.88em;
  }
  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: none;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button:hover:not(:disabled) {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .add {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .add:hover {
    background: var(--se-button-secondary-hover);
  }
  .link {
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--se-link, var(--se-accent));
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .classes {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .classes li {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
  }
  .classes select {
    width: 92px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--se-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .eye {
    display: inline-flex;
    padding: 2px;
    border: none;
    background: none;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .inline-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--se-text-secondary);
  }
  .inline-note.warning {
    color: var(--se-warning-fg, var(--se-text-primary));
  }
</style>
