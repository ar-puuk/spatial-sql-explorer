<script lang="ts">
  // Spec 008 FR-010 (contracts/ui.md "Filter row"): one column's filter in
  // the row under the table header. Text: "contains"; numbers and dates: an
  // operator (=, ≥, ≤, between) and one or two values; booleans: any / true /
  // false. Typing is debounced (300 ms); an invalid value is marked
  // (aria-invalid, with the reason) and not applied.
  import { filterKindsFor, parseFilter, type ColumnFilter, type FilterKind } from '@spatial-explorer/core'

  interface Props {
    column: string
    type: string
    /** The applied filter on this column, as the session parsed it. */
    filter: ColumnFilter | null
    onChange: (filter: ColumnFilter | null) => void
  }
  let { column, type, filter, onChange }: Props = $props()

  const kinds = $derived(filterKindsFor(type))
  const numeric = $derived(kinds.includes('between'))
  const OPS: Array<{ kind: FilterKind; label: string; name: string }> = [
    { kind: 'eq', label: '=', name: 'equals' },
    { kind: 'gte', label: '≥', name: 'at least' },
    { kind: 'lte', label: '≤', name: 'at most' },
    { kind: 'between', label: '↔', name: 'between' },
  ]

  // The inputs' own text, so typing isn't replaced by the parsed filter.
  // svelte-ignore state_referenced_locally
  let kind = $state<FilterKind>(filter?.kind ?? filterKindsFor(type)[0] ?? 'contains')
  // svelte-ignore state_referenced_locally
  let text = $state(filter && typeof filter.value !== 'boolean' ? String(filter.value) : '')
  // svelte-ignore state_referenced_locally
  let text2 = $state(filter?.value2 !== undefined ? String(filter.value2) : '')
  let timer: ReturnType<typeof setTimeout> | undefined

  // Cleared from outside (Clear filters, a new result): empty the inputs.
  $effect(() => {
    if (filter === null) {
      text = ''
      text2 = ''
    }
  })

  const draft = $derived<ColumnFilter>({ column, kind, value: text, ...(kind === 'between' ? { value2: text2 } : {}) })
  const check = $derived(text || (kind === 'between' && text2) ? parseFilter(draft, type) : null)
  const invalid = $derived(check !== null && !check.valid)
  const reasonId = `filter-reason-${Math.random().toString(36).slice(2, 8)}`

  function schedule(): void {
    clearTimeout(timer)
    timer = setTimeout(commit, 300)
  }

  function commit(): void {
    clearTimeout(timer)
    if (!text && !(kind === 'between' && text2)) {
      if (filter) onChange(null)
      return
    }
    // An invalid value is still reported (the table shows why), but the session doesn't apply it.
    onChange(draft)
  }

  function setBool(v: string): void {
    onChange(v === '' ? null : { column, kind: 'bool', value: v === 'true' })
  }
</script>

{#if kinds.length === 0}
  <span class="none" aria-hidden="true"></span>
{:else if kinds[0] === 'bool'}
  <select class="input" aria-label={`Filter ${column}`} value={filter ? String(filter.value) : ''} onchange={(e) => setBool(e.currentTarget.value)}>
    <option value="">Any</option>
    <option value="true">true</option>
    <option value="false">false</option>
  </select>
{:else}
  <div class="filter" class:invalid>
    {#if numeric}
      <select
        class="op"
        aria-label={`${column} filter operator`}
        value={kind}
        onchange={(e) => {
          kind = e.currentTarget.value as FilterKind
          commit()
        }}
      >
        {#each OPS as o (o.kind)}
          <option value={o.kind} title={o.name}>{o.label}</option>
        {/each}
      </select>
    {/if}
    <input
      class="input"
      type="text"
      aria-label={`Filter ${column}`}
      aria-invalid={invalid}
      aria-describedby={invalid ? reasonId : undefined}
      placeholder={numeric ? (type.toUpperCase().startsWith('DATE') || type.toUpperCase().startsWith('TIMESTAMP') ? 'YYYY-MM-DD' : 'value') : 'contains…'}
      bind:value={text}
      oninput={schedule}
      onkeydown={(e) => e.key === 'Enter' && commit()}
    />
    {#if kind === 'between'}
      <input
        class="input"
        type="text"
        aria-label={`Filter ${column}, upper value`}
        placeholder="and"
        bind:value={text2}
        oninput={schedule}
        onkeydown={(e) => e.key === 'Enter' && commit()}
      />
    {/if}
    {#if invalid}<span class="reason" id={reasonId} role="status">{check?.reason}</span>{/if}
  </div>
{/if}

<style>
  .filter {
    position: relative;
    display: flex;
    gap: 2px;
    min-width: 0;
  }
  .input,
  .op {
    min-width: 0;
    width: 100%;
    height: 20px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
    font-size: 0.92em;
    text-transform: none;
    letter-spacing: normal;
  }
  .op {
    flex: none;
    width: 34px;
    padding: 0 2px;
  }
  .invalid .input[aria-invalid='true'] {
    border-color: var(--se-error);
  }
  .input:focus-visible,
  .op:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .reason {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    z-index: 5;
    padding: 2px 6px;
    background: var(--se-menu-bg);
    color: var(--se-error);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius-sm);
    white-space: nowrap;
    font-size: 0.9em;
  }
</style>
