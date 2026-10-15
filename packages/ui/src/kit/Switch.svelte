<script lang="ts">
  // On/off that applies at once: a button with role=switch (Space and Enter toggle it, screen readers say "on" or
  // "off"). Plain markup on purpose: a library switch mounted extra machinery per instance, and the Map controls
  // panel shows fifteen of them (measured at 6x CPU, specs/015-visual-redesign).
  interface Props {
    checked: boolean
    onChange: (checked: boolean) => void
    /** The accessible name (or use `labelledby`). */
    label?: string
    labelledby?: string
    id?: string
    disabled?: boolean
  }
  let { checked, onChange, label, labelledby, id, disabled = false }: Props = $props()
</script>

<button
  type="button"
  class="se-switch"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  aria-labelledby={labelledby}
  {id}
  {disabled}
  data-state={checked ? 'checked' : 'unchecked'}
  onclick={() => onChange(!checked)}
>
  <span class="se-switch-thumb"></span>
</button>

<style>
  :global(.se-switch) {
    all: unset;
    box-sizing: border-box;
    flex: none;
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 8px;
    background: var(--se-input-border);
    cursor: pointer;
    transition: background-color 140ms var(--se-ease);
  }
  :global(.se-switch[data-state='checked']) {
    background: var(--se-accent);
  }
  :global(.se-switch:focus-visible) {
    outline: 2px solid var(--se-focus);
    outline-offset: 2px;
  }
  :global(.se-switch:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  :global(.se-switch-thumb) {
    display: block;
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--se-bg-base);
    box-shadow: 0 0 0 1px color-mix(in srgb, #000 12%, transparent);
    transition: transform 140ms var(--se-ease);
  }
  :global(.se-switch[data-state='checked'] .se-switch-thumb) {
    transform: translateX(12px);
    background: var(--se-button-fg);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.se-switch),
    :global(.se-switch-thumb) {
      transition: none;
    }
  }
  /* High contrast: a visible edge. */
  :global(.se-switch) {
    outline-color: var(--vscode-contrastBorder, transparent);
  }
</style>
