<script lang="ts">
  // One way in for every file: a split button. The main part opens the file picker (what most people want);
  // the arrow offers the one other kind of source, a File Geodatabase folder, which a file picker cannot
  // choose (spec 013, experimental). Menu pattern as ThemeMenu: WAI-ARIA menu, arrow keys, Esc.
  import { onMount, tick } from 'svelte'
  import { Icon } from '@spatial-explorer/ui'

  interface Props {
    label: string
    /** 'large' is the landing page's button, 'small' the header's. */
    size?: 'large' | 'small'
    onFile: () => void
    onFolder: () => void
    /** The main button, for focus. */
    button?: HTMLButtonElement
  }
  let { label, size = 'small', onFile, onFolder, button = $bindable() }: Props = $props()

  let open = $state(false)
  let root = $state<HTMLDivElement>()
  let arrow = $state<HTMLButtonElement>()
  let menu = $state<HTMLDivElement>()
  const items = (): HTMLElement[] => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  async function openMenu(): Promise<void> {
    open = true
    await tick()
    items()[0]?.focus()
  }
  function close(refocus = true): void {
    open = false
    if (refocus) arrow?.focus()
  }
  function choose(action: () => void): void {
    close(false)
    action()
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

<div class="split {size}" bind:this={root}>
  <button type="button" class="main" bind:this={button} onclick={onFile}><Icon name="import" size={size === 'large' ? 16 : 14} />{label}</button>
  <button
    type="button"
    class="arrow"
    bind:this={arrow}
    aria-label="More ways to open"
    title="More ways to open"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close() : void openMenu())}
    onkeydown={(e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        void openMenu()
      }
    }}><Icon name="chevron-down" size={14} /></button
  >
  {#if open}
    <div class="menu" role="menu" aria-label="Open" tabindex="-1" bind:this={menu} onkeydown={menuKeydown}>
      <button type="button" role="menuitem" tabindex="-1" onclick={() => choose(onFile)}><Icon name="import" size={14} /><span>File…</span></button>
      <button type="button" role="menuitem" tabindex="-1" title="A File Geodatabase is a folder that ends in .gdb" onclick={() => choose(onFolder)}
        ><Icon name="folder" size={14} /><span>Geodatabase folder…</span><span class="badge">Experimental</span></button
      >
    </div>
  {/if}
</div>

<style>
  .split {
    position: relative;
    display: inline-flex;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid transparent;
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font-family: var(--se-font-ui);
    cursor: pointer;
  }
  button:hover {
    background: var(--se-button-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 2px;
  }
  .small button {
    height: 28px;
    font-size: 13px;
    font-weight: 500;
  }
  .large button {
    height: 38px;
    font-size: 14px;
    font-weight: 600;
  }
  .small .main {
    padding: 0 10px 0 11px;
  }
  .large .main {
    gap: 8px;
    padding: 0 14px 0 16px;
  }
  .main {
    border-radius: var(--se-radius-sm) 0 0 var(--se-radius-sm);
  }
  .arrow {
    justify-content: center;
    padding: 0;
    border-radius: 0 var(--se-radius-sm) var(--se-radius-sm) 0;
    border-left-color: color-mix(in srgb, var(--se-button-fg) 30%, transparent);
  }
  .small .arrow {
    width: 24px;
  }
  .large .arrow {
    width: 32px;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 270px;
    padding: 4px;
    background: var(--se-menu-bg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    outline: none;
  }
  .small .menu {
    left: auto;
    right: 0;
  }
  .menu button {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: auto;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-menu-fg);
    font: 400 13px var(--se-font-ui);
    text-align: left;
    white-space: nowrap;
  }
  .menu button:hover,
  .menu button:focus {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
  .menu button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .badge {
    padding: 0 5px;
    border: 1px solid currentColor;
    border-radius: var(--se-radius-sm);
    font-size: 11px;
    line-height: 16px;
    opacity: 0.8;
  }
</style>
