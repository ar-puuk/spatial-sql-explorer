<script lang="ts">
  // Spec 008 FR-006 (contracts/ui.md "Save"): one split button. The main part
  // saves the QGIS sidecar (VS Code) or downloads it (web); the arrow opens a
  // menu of every style format (WAI-ARIA menu button pattern).
  import { onMount, tick } from 'svelte'
  import type { StyleFormat } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'

  interface Props {
    canSaveSidecar: boolean
    sidecarName: string
    /** Per format, what it can't carry (shown under the menu item), if anything. */
    losses: (format: StyleFormat) => string[]
    onSave: () => void
    onSaveAs: (format: StyleFormat) => void
  }
  let { canSaveSidecar, sidecarName, losses, onSave, onSaveAs }: Props = $props()

  const FORMATS: Array<{ format: StyleFormat; label: string }> = [
    { format: 'qml', label: 'QGIS style (.qml)' },
    { format: 'sld', label: 'OGC SLD (.sld)' },
    { format: 'mapbox', label: 'Mapbox GL style (.json)' },
  ]

  let open = $state(false)
  let root = $state<HTMLDivElement>()
  let arrow = $state<HTMLButtonElement>()
  let menu = $state<HTMLDivElement>()

  const items = (): HTMLElement[] => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  async function openMenu(focus: 'first' | 'last' = 'first'): Promise<void> {
    open = true
    await tick()
    const list = items()
    ;(focus === 'first' ? list[0] : list[list.length - 1])?.focus()
  }

  function close(refocus = true): void {
    open = false
    if (refocus) arrow?.focus()
  }

  function pick(format: StyleFormat): void {
    close()
    onSaveAs(format)
  }

  function arrowKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void openMenu('first')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      void openMenu('last')
    }
  }

  function menuKeydown(e: KeyboardEvent): void {
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLElement)
    const move = (to: number): void => {
      e.preventDefault()
      list[(to + list.length) % list.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(list.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  onMount(() => {
    const outside = (ev: PointerEvent): void => {
      if (open && root && !root.contains(ev.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  })
</script>

<div class="split" bind:this={root}>
  <button
    type="button"
    class="main"
    onclick={onSave}
    title={canSaveSidecar ? `Save ${sidecarName} next to the data. QGIS loads it automatically.` : `Download ${sidecarName}. Keep it next to the data so QGIS loads it automatically.`}
  >
    <Icon name="save" size={14} />{canSaveSidecar ? 'Save style (QML)' : 'Download style (QML)'}
  </button>
  <button
    type="button"
    class="arrow"
    bind:this={arrow}
    aria-label="More style formats"
    title="More style formats"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close() : void openMenu())}
    onkeydown={arrowKeydown}
  >
    <Icon name="chevron-down" size={12} />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label="Style formats" tabindex="-1" bind:this={menu} onkeydown={menuKeydown}>
      {#each FORMATS as f (f.format)}
        {@const loss = losses(f.format)}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          aria-describedby={loss.length ? `style-loss-${f.format}` : undefined}
          onclick={() => pick(f.format)}
        >
          <span class="label">{f.label}</span>
          {#if loss.length}<span class="loss" id={`style-loss-${f.format}`}>{loss.join(' ')}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .split {
    position: relative;
    display: inline-flex;
  }
  .main,
  .arrow {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    border: 1px solid var(--se-button-border);
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .main {
    padding: 0 8px;
    border-radius: var(--se-radius-sm) 0 0 var(--se-radius-sm);
  }
  .arrow {
    padding: 0 4px;
    border-left: 1px solid color-mix(in srgb, var(--se-button-fg) 35%, transparent);
    border-radius: 0 var(--se-radius-sm) var(--se-radius-sm) 0;
  }
  .main:hover,
  .arrow:hover,
  .arrow[aria-expanded='true'] {
    background: var(--se-button-hover);
  }
  .main:focus-visible,
  .arrow:focus-visible,
  .menu button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 10;
    min-width: 220px;
    max-width: 280px;
    padding: 4px;
    background: var(--se-menu-bg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    outline: none;
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-menu-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover,
  .menu button:focus {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .loss {
    display: block;
    margin-top: 2px;
    color: var(--se-text-secondary);
    font-size: 0.85em;
    line-height: 1.35;
    white-space: normal;
  }
  .menu button:hover .loss,
  .menu button:focus .loss {
    color: inherit;
  }
</style>
