<script lang="ts">
  // Spec 010 layout Option A (T050): the icon rail on the right edge that
  // opens the side panel on Style, Labels (spec 011) or Basemap, as VS Code's activity
  // bar does. Feature details are a card on the map (user decision 2026-10-14). Clicking the active button closes the panel.
  import Icon, { type IconName } from './Icon.svelte'
  import type { SideTab } from './viewerStore.svelte.js'

  interface Props {
    active: SideTab | null
    /** A reason a panel can't open (shown as its tooltip); PMTiles disables Style and Labels. */
    disabled?: { style?: string | null; labels?: string | null }
    /** The Basemap button's tooltip names the basemap shown. */
    basemapName?: string
    /** Spec 011 US6: what labels show, when on (the Labels button's tooltip). */
    labelsOn?: string | null
    onSelect: (panel: SideTab | null) => void
  }
  let { active, disabled = {}, basemapName = '', labelsOn = null, onSelect }: Props = $props()

  const BUTTONS: Array<{ id: SideTab; label: string; icon: IconName }> = [
    { id: 'style', label: 'Style', icon: 'paint' },
    { id: 'labels', label: 'Labels', icon: 'tag' },
    { id: 'basemap', label: 'Basemap', icon: 'map' },
  ]

  let rail = $state<HTMLDivElement>()

  function title(b: (typeof BUTTONS)[number]): string {
    if (b.id === 'style' && disabled.style) return disabled.style
    if (b.id === 'labels') return disabled.labels ? disabled.labels : labelsOn ? `Labels: on (${labelsOn})` : 'Labels'
    if (b.id === 'basemap' && basemapName) return `Basemap: ${basemapName}`
    return 'Layer style'
  }

  /** Arrow keys move focus between the buttons (toolbar pattern). */
  function keydown(e: KeyboardEvent): void {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return
    const buttons = Array.from(rail?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + keys[e.key] + buttons.length) % buttons.length
    e.preventDefault()
    buttons[next]?.focus()
  }
</script>

<div class="rail" role="toolbar" aria-orientation="vertical" aria-label="Panels" tabindex="-1" bind:this={rail} onkeydown={keydown}>
  {#each BUTTONS as b (b.id)}
    <button
      type="button"
      class:active={active === b.id}
      aria-label={b.label}
      aria-pressed={active === b.id}
      title={title(b)}
      data-rail={b.id}
      disabled={(b.id === 'style' && !!disabled.style) || (b.id === 'labels' && !!disabled.labels)}
      onclick={() => onSelect(active === b.id ? null : b.id)}
    >
      <Icon name={b.icon} size={20} />
    </button>
  {/each}
</div>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    flex: none;
    width: 44px;
    background: var(--se-activity-bg, var(--se-bg-panel));
    border-left: 1px solid var(--se-border);
    outline: none;
  }
  button {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-activity-inactive-fg, var(--se-text-secondary));
    cursor: pointer;
  }
  button:hover:not(:disabled),
  button.active {
    color: var(--se-activity-fg, var(--se-text-primary));
  }
  /* The active indicator on the edge next to the panel (VS Code's activity bar, mirrored). */
  button.active::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--se-activity-indicator, var(--se-focus));
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -2px;
  }
</style>
