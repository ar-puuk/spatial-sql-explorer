<script lang="ts">
  // Spec 008 FR-022 (contracts/ui.md "Web shell chrome"): System / Light /
  // Dark for the web app. System follows the OS live; the choice is
  // remembered. A menu button with menuitemradio items (WAI-ARIA). VS Code has
  // no such control: the viewer follows VS Code's own theme there.
  import { onMount, tick } from 'svelte'
  import { Icon } from '@spatial-explorer/ui'
  import type { ThemePreference } from './hostAdapter.js'

  interface Props {
    value: ThemePreference
    onChange: (value: ThemePreference) => void
  }
  let { value, onChange }: Props = $props()

  const OPTIONS: Array<{ value: ThemePreference; label: string; icon: 'monitor' | 'sun' | 'moon' }> = [
    { value: 'system', label: 'System', icon: 'monitor' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ]
  const current = $derived(OPTIONS.find((o) => o.value === value) ?? OPTIONS[0])

  let open = $state(false)
  let root = $state<HTMLDivElement>()
  let button = $state<HTMLButtonElement>()
  let menu = $state<HTMLDivElement>()
  const items = (): HTMLElement[] => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]

  async function openMenu(): Promise<void> {
    open = true
    await tick()
    const list = items()
    ;(list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus()
  }

  function close(refocus = true): void {
    open = false
    if (refocus) button?.focus()
  }

  function pick(v: ThemePreference): void {
    onChange(v)
    close()
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

<div class="theme-menu" bind:this={root}>
  <button
    type="button"
    class="toggle"
    bind:this={button}
    aria-label={`Theme: ${current.label}`}
    title={`Theme: ${current.label}`}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close() : void openMenu())}
    onkeydown={(e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        void openMenu()
      }
    }}
  >
    <Icon name={current.icon} size={16} />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label="Theme" tabindex="-1" bind:this={menu} onkeydown={menuKeydown}>
      {#each OPTIONS as o (o.value)}
        <button type="button" role="menuitemradio" tabindex="-1" aria-checked={o.value === value} onclick={() => pick(o.value)}>
          <Icon name={o.icon} size={14} />
          <span>{o.label}</span>
          {#if o.value === value}<span class="check"><Icon name="check" size={12} /></span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .theme-menu {
    position: relative;
  }
  .toggle {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .toggle:hover,
  .toggle[aria-expanded='true'] {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .toggle:focus-visible,
  .menu button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 50;
    min-width: 140px;
    padding: 4px;
    background: var(--se-menu-bg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    outline: none;
  }
  .menu button {
    display: grid;
    grid-template-columns: 16px 1fr 12px;
    align-items: center;
    gap: 8px;
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
</style>
