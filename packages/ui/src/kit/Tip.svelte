<script lang="ts">
  // A name (and shortcut) on hover or keyboard focus, for controls that have only an icon. bits-ui's Tooltip
  // (delay, focus, Esc, collision). The trigger is the consumer's own element: `{#snippet trigger(props)}<button {...props}>`.
  import { Tooltip } from 'bits-ui'
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    shortcut?: string
    side?: 'top' | 'bottom' | 'left' | 'right'
    trigger: Snippet<[Record<string, unknown>]>
  }
  let { text, shortcut, side = 'bottom', trigger }: Props = $props()
</script>

<Tooltip.Provider delayDuration={450} skipDelayDuration={200} disableHoverableContent>
<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}{@render trigger(props)}{/snippet}
  </Tooltip.Trigger>
  <Tooltip.Portal>
    <Tooltip.Content class="se-tip" {side} sideOffset={6} collisionPadding={8}>
      <span>{text}</span>{#if shortcut}<kbd>{shortcut}</kbd>{/if}
    </Tooltip.Content>
  </Tooltip.Portal>
</Tooltip.Root>
</Tooltip.Provider>

<style>
  :global(.se-tip) {
    z-index: 1100;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-family: var(--se-font-ui);
    font-size: 12px;
    color: var(--se-menu-fg);
    background: var(--se-menu-bg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius-sm);
    box-shadow: var(--se-shadow-card);
    pointer-events: none;
  }
  :global(.se-tip kbd) {
    font: 11px var(--se-font-mono);
    color: var(--se-text-secondary);
    border: 1px solid var(--se-border);
    border-radius: 3px;
    padding: 0 4px;
  }
</style>
