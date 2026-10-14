<script lang="ts">
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
    onClass: (key: string, patch: ClassDef) => void
    onLegendHidden: (hidden: boolean) => void
  }
  let { channel, enc, resolved, columns, scales, onColumn, onScale, onClasses, onRange, onRamp, onClass, onLegendHidden }: Props = $props()

  const name = $derived(CHANNEL_NAMES[channel])
  const kind = $derived(OUTPUT_KIND[channel])
  const column = $derived(enc.source.kind === 'column' ? enc.source.column : '')
  const scale = $derived(enc.scale)
  const SCALE_NAMES: Record<ScaleKind, string> = { categories: 'Categories', classes: 'Classes', continuous: 'Continuous', conditions: 'Conditions', identity: 'As is', bivariate: 'Bivariate' }
  const METHODS: Array<Exclude<GraduatedMethod, 'manual'>> = ['equal', 'quantile', 'jenks']
  const COUNTS = Array.from({ length: MAX_CLASS_COUNT - MIN_CLASS_COUNT + 1 }, (_, i) => MIN_CLASS_COUNT + i)
  const range = $derived(scale.kind === 'categories' || scale.kind === 'classes' ? scale.range : undefined)
  const ramp = $derived(scale.kind === 'categories' || scale.kind === 'classes' ? scale.ramp : undefined)
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

<div class="scale-editor">
  <div class="row field">
    <label class="label" for="{uid}-column">Column</label>
    <select id="{uid}-column" aria-label="{name} column" value={column} onchange={(e) => onColumn(e.currentTarget.value)}>
      {#if !columns.some((c) => c.name === column)}
        <option value={column}>{column || 'Choose…'}</option>
      {/if}
      {#each columns as c (c.name)}
        <option value={c.name}>{c.name} · {c.type}</option>
      {/each}
    </select>
  </div>
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
  {#if kind === 'color' && ramp}
    <RampPicker value={ramp} renderer={scale.kind === 'classes' ? 'graduated' : 'categorized'} classCount={classes.filter((c) => c.kind === 'value' || c.kind === 'range').length || 1} onChange={onRamp} />
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
  {:else if classes.length}
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
    {#each resolved?.notes ?? [] as note (note)}
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
  .caption {
    margin: 0;
    color: var(--se-text-secondary);
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
