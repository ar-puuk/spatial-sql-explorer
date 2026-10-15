<script lang="ts">
  import ColorField from '../kit/ColorField.svelte'
  // Spec 010 phase 11: rule-based styling. Each rule is a SQL condition over
  // the layer's columns with a color; the first rule a feature matches colors
  // it, and the rest are "Everything else". A condition is checked when its
  // field is left (Enter or Tab): its error shows under it, and the rule
  // matches nothing until it is fixed. Order matters, so rules move with up
  // and down buttons.
  import { RULES_ELSE_KEY, type ResolvedStyle, type RuleDef, type RulesRenderer } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'

  interface Props {
    renderer: RulesRenderer
    resolved: ResolvedStyle
    onUpdate: (id: string, patch: Partial<Omit<RuleDef, 'id'>>) => void
    onAdd: () => void
    onRemove: (id: string) => void
    onMove: (id: string, by: -1 | 1) => void
    onElse: (patch: Partial<Pick<RulesRenderer, 'elseColor' | 'elseVisible' | 'elseLabel'>>) => void
  }
  let { renderer, resolved, onUpdate, onAdd, onRemove, onMove, onElse }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const classOf = (id: string) => resolved.classes.find((c) => c.key === `rule:${id}`)
  const rest = $derived(resolved.classes.find((c) => c.key === RULES_ELSE_KEY))
  const name = (rule: RuleDef, i: number): string => rule.label.trim() || `rule ${i + 1}`
</script>

<ol class="rules" aria-label="Rules">
  {#each renderer.rules as rule, i (rule.id)}
    {@const c = classOf(rule.id)}
    <li class:hidden={!rule.visible} data-rule={rule.id}>
      <div class="line">
        <button
          type="button"
          class="icon-button"
          aria-pressed={!rule.visible}
          aria-label={`${rule.visible ? 'Hide' : 'Show'} ${name(rule, i)}`}
          title={rule.visible ? 'Hide on the map' : 'Show on the map'}
          onclick={() => onUpdate(rule.id, { visible: !rule.visible })}
        >
          <Icon name={rule.visible ? 'eye' : 'eye-off'} size={14} />
        </button>
        <ColorField label={`Color of ${name(rule, i)}`} value={rule.color} apply="end" size="sm" onChange={(v) => onUpdate(rule.id, { color: v })} />
        <input
          type="text"
          class="where"
          class:invalid={!!c?.error}
          aria-label={`Condition of ${name(rule, i)}`}
          aria-invalid={!!c?.error}
          aria-describedby={c?.error ? `rule-error-${rule.id}` : undefined}
          placeholder="e.g. pop > 1000"
          spellcheck="false"
          autocomplete="off"
          value={rule.where}
          onkeydown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onchange={(e) => onUpdate(rule.id, { where: e.currentTarget.value.trim() })}
        />
        <span class="count" title="Features this rule colors">{c && !c.error ? nf.format(c.count) : '–'}</span>
      </div>
      <div class="line second">
        <input
          type="text"
          class="label"
          aria-label={`Label of ${name(rule, i)}`}
          placeholder="Label (optional)"
          value={rule.label}
          onkeydown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onchange={(e) => onUpdate(rule.id, { label: e.currentTarget.value })}
        />
        <button type="button" class="icon-button" aria-label={`Move ${name(rule, i)} up`} title="Move up (earlier rules win)" disabled={i === 0} onclick={() => onMove(rule.id, -1)}>
          <Icon name="arrow-up" size={14} />
        </button>
        <button type="button" class="icon-button" aria-label={`Move ${name(rule, i)} down`} title="Move down" disabled={i === renderer.rules.length - 1} onclick={() => onMove(rule.id, 1)}>
          <Icon name="arrow-down" size={14} />
        </button>
        <button type="button" class="icon-button" aria-label={`Remove ${name(rule, i)}`} title="Remove rule" onclick={() => onRemove(rule.id)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      {#if c?.error}
        <p class="error" id={`rule-error-${rule.id}`} role="alert"><Icon name="warning" size={12} />{c.error}</p>
      {/if}
    </li>
  {/each}
</ol>
<button type="button" class="link add" onclick={onAdd}><Icon name="plus" size={12} />Add rule</button>

<div class="else" class:hidden={!renderer.elseVisible}>
  <button
    type="button"
    class="icon-button"
    aria-pressed={!renderer.elseVisible}
    aria-label={`${renderer.elseVisible ? 'Hide' : 'Show'} ${renderer.elseLabel}`}
    title={renderer.elseVisible ? 'Hide on the map' : 'Show on the map'}
    onclick={() => onElse({ elseVisible: !renderer.elseVisible })}
  >
    <Icon name={renderer.elseVisible ? 'eye' : 'eye-off'} size={14} />
  </button>
  <ColorField label={`Color of ${renderer.elseLabel}`} value={renderer.elseColor} apply="end" size="sm" onChange={(v) => onElse({ elseColor: v })} />
  <span class="else-label" title={renderer.elseLabel}>{renderer.elseLabel}</span>
  <span class="count" title="Features no rule matches">{rest ? nf.format(rest.count) : '–'}</span>
</div>

<style>
  .rules {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 3px;
    padding: 4px;
    border: 1px solid var(--se-border-subtle, var(--se-input-border));
    border-radius: var(--se-radius-sm);
  }
  .line {
    display: grid;
    grid-template-columns: 22px 24px 1fr auto;
    align-items: center;
    gap: 4px;
  }
  .line.second {
    grid-template-columns: 1fr 22px 22px 22px;
    padding-left: 50px;
  }
  li.hidden .where,
  li.hidden .count,
  .else.hidden .else-label,
  .else.hidden .count {
    opacity: 0.5;
  }
  input[type='text'] {
    min-width: 0;
    height: 22px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  input[type='text']:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .where {
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  .where.invalid {
    border-color: var(--se-error-fg, var(--se-error));
  }
  .label {
    font-size: 0.92em;
  }
  .count {
    min-width: 3ch;
    text-align: right;
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  .error {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    margin: 0;
    padding-left: 50px;
    color: var(--se-error-fg, var(--se-error));
    font-size: 0.88em;
    line-height: 1.35;
  }
  .error :global(.icon) {
    flex: none;
    margin-top: 2px;
  }
  .else {
    display: grid;
    grid-template-columns: 22px 24px 1fr auto;
    align-items: center;
    gap: 4px;
    padding: 0 5px;
  }
  .else-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .icon-button:hover:not(:disabled) {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .icon-button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-self: start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-link, var(--se-accent));
    font: inherit;
    font-size: 0.92em;
    cursor: pointer;
  }
</style>
