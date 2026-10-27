<script lang="ts">
  // A decimal number typed: committed on Enter and on blur; anything that is not a number puts the last one back.
  // (kit/NumberField is for whole numbers.)
  interface Props {
    value: number
    onChange: (value: number) => void
    /** The accessible name. */
    label: string
    disabled?: boolean
  }
  let { value, onChange, label, disabled = false }: Props = $props()

  const show = (n: number): string => String(Number(n.toPrecision(8)))
  // What is typed; it follows the number again whenever the number changes.
  let text = $derived(show(value))

  function commit(): void {
    const n = Number(text.trim().replace(',', '.'))
    if (text.trim() === '' || !Number.isFinite(n)) {
      text = show(value)
      return
    }
    if (n !== value) onChange(n)
    text = show(n)
  }
</script>

<input
  type="text"
  inputmode="decimal"
  class="se-value-field"
  aria-label={label}
  {disabled}
  bind:value={text}
  onblur={commit}
  onkeydown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') text = show(value)
  }}
/>

<style>
  .se-value-field {
    width: 100%;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: 12px var(--se-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .se-value-field:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
</style>
