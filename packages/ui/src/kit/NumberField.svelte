<script lang="ts">
  // A whole number typed or stepped: the browser's own spin buttons do not wear the theme, so this is a text field with
  // the spinbutton role (arrow keys, Home and End, Page Up and Down step by 10) and two themed buttons beside it.
  // The number is committed on Enter, on blur and on every step; typing something that is not a number puts the last
  // one back.
  import Icon from '../Icon.svelte'

  interface Props {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
    /** The accessible name. */
    label: string
    disabled?: boolean
  }
  let { value, min, max, onChange, label, disabled = false }: Props = $props()

  // svelte-ignore state_referenced_locally
  let text = $state(String(value))
  $effect(() => {
    text = String(value)
  })

  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)))

  function commit(): void {
    const n = Number(text.trim())
    if (text.trim() === '' || !Number.isFinite(n)) {
      text = String(value)
      return
    }
    const next = clamp(n)
    text = String(next)
    if (next !== value) onChange(next)
  }
  function step(by: number): void {
    const next = clamp(value + by)
    text = String(next)
    if (next !== value) onChange(next)
  }
  function onKeydown(e: KeyboardEvent): void {
    const keys: Record<string, () => void> = {
      ArrowUp: () => step(1),
      ArrowDown: () => step(-1),
      PageUp: () => step(10),
      PageDown: () => step(-10),
      Home: () => step(min - value),
      End: () => step(max - value),
      Enter: commit,
    }
    const run = keys[e.key]
    if (!run) return
    // Enter commits the number; a dialog around the field must not take it for its own default action.
    e.preventDefault()
    e.stopPropagation()
    run()
  }
</script>

<span class="se-number" class:disabled>
  <input
    type="text"
    inputmode="numeric"
    role="spinbutton"
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    {disabled}
    bind:value={text}
    onkeydown={onKeydown}
    onblur={commit}
  />
  <span class="steppers">
    <button type="button" tabindex="-1" aria-label="Increase {label}" disabled={disabled || value >= max} onpointerdown={(e) => e.preventDefault()} onclick={() => step(1)}><Icon name="chevron-up" size={10} /></button>
    <button type="button" tabindex="-1" aria-label="Decrease {label}" disabled={disabled || value <= min} onpointerdown={(e) => e.preventDefault()} onclick={() => step(-1)}><Icon name="chevron-down" size={10} /></button>
  </span>
</span>

<style>
  .se-number {
    display: inline-flex;
    align-items: stretch;
    height: 24px;
    box-sizing: border-box;
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    color: var(--se-text-primary);
  }
  .se-number:focus-within {
    border-color: var(--se-focus);
  }
  .se-number.disabled {
    opacity: 0.5;
  }
  input {
    width: 40px;
    min-width: 0;
    padding: 0 6px;
    border: 0;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-family: var(--se-font-mono);
    text-align: right;
  }
  .steppers {
    display: flex;
    flex-direction: column;
    width: 18px;
    border-left: 1px solid var(--se-input-border);
  }
  button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  button + button {
    border-top: 1px solid var(--se-input-border);
  }
  button:hover:not(:disabled) {
    background: var(--se-bg-hover);
    color: var(--se-text-primary);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
</style>
