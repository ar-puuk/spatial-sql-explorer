<script lang="ts">
  // Editable class list (spec 003 FR-009, contracts/ui-style-panel.md).
  // Each row: visibility, color, label (F2 or the edit button; Enter commits,
  // Esc cancels), count, delete. "Edit values" swaps labels for the category
  // values or the range bounds; changing those fixes the classes (Manual).
  // Arrow Up/Down move between rows, keeping the column.
  import { tick } from 'svelte'
  import type { ResolvedStyle } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    resolved: ResolvedStyle
    kind: 'categorized' | 'graduated'
    /** True when values/bounds were edited: the classes are fixed. */
    manual: boolean
    onColor: (key: string, color: string) => void
    onLabel: (key: string, label: string) => void
    onVisible: (key: string, visible: boolean) => void
    onValue: (key: string, value: string) => void
    onBound: (index: number, side: 'lower' | 'upper', value: number) => void
    onAdd: () => void
    onDelete: (key: string) => void
  }
  let { resolved, kind, manual, onColor, onLabel, onVisible, onValue, onBound, onAdd, onDelete }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  let editingValues = $state(false)
  let editingLabel = $state<string | null>(null)
  let draft = $state('')
  let root = $state<HTMLUListElement>()

  const editable = (k: string) => k.startsWith('v:') || k.startsWith('range:')
  const rangeIndex = (k: string) => Number(k.slice(6))

  async function startLabel(key: string, label: string): Promise<void> {
    editingLabel = key
    draft = label
    await tick()
    root?.querySelector<HTMLInputElement>(`[data-label-input="${CSS.escape(key)}"]`)?.select()
  }

  function commitLabel(key: string): void {
    if (editingLabel !== key) return
    editingLabel = null
    onLabel(key, draft)
  }

  /** Arrow keys move to the same control in the next/previous row. */
  function rowKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (e.key === 'F2' && !(target instanceof HTMLInputElement && target.type === 'text')) {
      const row = target.closest('li')
      const key = row?.dataset.key
      const c = resolved.classes.find((x) => x.key === key)
      if (c) {
        e.preventDefault()
        void startLabel(c.key, c.label)
      }
      return
    }
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || target instanceof HTMLSelectElement) return
    if (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')) return
    const row = target.closest('li')
    const col = target.dataset.col
    const next = (e.key === 'ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling) as HTMLElement | null
    const control = next?.querySelector<HTMLElement>(`[data-col="${col}"]`) ?? next?.querySelector<HTMLElement>('button, input')
    if (control) {
      e.preventDefault()
      control.focus()
    }
  }
</script>

<div class="head">
  <span class="caption">{resolved.caption}</span>
  <button type="button" class="link" aria-pressed={editingValues} onclick={() => (editingValues = !editingValues)}>
    {editingValues ? 'Done' : kind === 'graduated' ? 'Edit bounds' : 'Edit values'}
  </button>
</div>
{#if editingValues && !manual}
  <p class="hint">Changing {kind === 'graduated' ? 'a bound' : 'a value'}, adding or deleting a class fixes the classes (Manual).</p>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul class="classes" aria-label="Class list" bind:this={root} onkeydown={rowKeydown}>
  {#each resolved.classes as c (c.key)}
    <li data-key={c.key} class:hidden={!c.visible}>
      <button
        type="button"
        class="icon-button"
        data-col="visible"
        aria-pressed={!c.visible}
        aria-label={`${c.visible ? 'Hide' : 'Show'} ${c.label}`}
        title={c.visible ? 'Hide on the map' : 'Show on the map'}
        onclick={() => onVisible(c.key, !c.visible)}
      >
        <Icon name={c.visible ? 'eye' : 'eye-off'} size={14} />
      </button>
      <input type="color" data-col="color" aria-label={`Color of ${c.label}`} value={c.color} onchange={(e) => onColor(c.key, e.currentTarget.value)} />

      {#if editingValues && c.kind === 'value'}
        <input
          type="text"
          class="value"
          aria-label={`Value of ${c.label}`}
          value={c.value}
          onkeydown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onchange={(e) => onValue(c.key, e.currentTarget.value)}
        />
      {:else if editingValues && c.kind === 'range'}
        <span class="bounds">
          <input
            type="number"
            aria-label={`Lower bound of ${c.label}`}
            value={c.lower}
            onchange={(e) => onBound(rangeIndex(c.key), 'lower', Number(e.currentTarget.value))}
          />
          <span aria-hidden="true">–</span>
          <input type="number" aria-label={`Upper bound of ${c.label}`} value={c.upper} onchange={(e) => onBound(rangeIndex(c.key), 'upper', Number(e.currentTarget.value))} />
        </span>
      {:else if editingLabel === c.key}
        <input
          type="text"
          class="value"
          data-label-input={c.key}
          aria-label={`Label of ${c.label}`}
          bind:value={draft}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitLabel(c.key)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              editingLabel = null
            }
          }}
          onblur={() => commitLabel(c.key)}
        />
      {:else}
        <span class="label" title={c.label}>{c.label}</span>
      {/if}

      <span class="count">{nf.format(c.count)}</span>
      <button type="button" class="icon-button" data-col="edit" aria-label={`Rename ${c.label}`} title="Rename (F2)" onclick={() => void startLabel(c.key, c.label)}>
        <Icon name="edit" size={14} />
      </button>
      {#if editable(c.key)}
        <button type="button" class="icon-button" data-col="delete" aria-label={`Delete ${c.label}`} title="Delete class" onclick={() => onDelete(c.key)}>
          <Icon name="trash" size={14} />
        </button>
      {:else}
        <span></span>
      {/if}
    </li>
  {/each}
</ul>
<button type="button" class="link add" onclick={onAdd}><Icon name="plus" size={12} />Add class</button>

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .caption {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-link, var(--se-accent));
    font: inherit;
    font-size: 0.92em;
    cursor: pointer;
  }
  .link.add {
    justify-self: start;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.88em;
  }
  .classes {
    display: grid;
    gap: 1px;
    max-height: 240px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 22px 24px 1fr auto 22px 22px;
    align-items: center;
    gap: 4px;
    min-height: 24px;
  }
  li.hidden .label,
  li.hidden .count {
    opacity: 0.5;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  input[type='color'] {
    width: 22px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--se-swatch-border);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
  }
  input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  input[type='color']::-webkit-color-swatch {
    border: 0;
  }
  input[type='text'],
  input[type='number'] {
    min-width: 0;
    height: 20px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  .bounds {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:focus-visible,
  input:focus-visible,
  .link:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
