<script lang="ts">
  // Spec 010 layout Option A (T050): the side panel next to the activity
  // rail (Style, Feature details or Basemap). Its left edge is a sash
  // (WAI-ARIA window splitter: drag, or arrow keys); Escape inside closes it.
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  interface Props {
    title: string
    width: number
    /** Overlays the map (narrow viewers) instead of taking width from it. */
    overlay?: boolean
    onResize: (width: number) => void
    onClose: () => void
    /** A drag is in progress (the map waits to resize until it ends). */
    onDragging?: (dragging: boolean) => void
    actions?: Snippet
    children: Snippet
  }
  let { title, width, overlay = false, onResize, onClose, onDragging, actions, children }: Props = $props()

  const MIN = 240
  const MAX = 560
  const clamp = (w: number): number => Math.round(Math.min(MAX, Math.max(MIN, w)))

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    const sash = e.currentTarget as HTMLElement
    const panel = sash.parentElement as HTMLElement
    sash.setPointerCapture(e.pointerId)
    onDragging?.(true)
    const move = (ev: PointerEvent): void => onResize(clamp(panel.getBoundingClientRect().right - ev.clientX))
    const up = (): void => {
      onDragging?.(false)
      sash.removeEventListener('pointermove', move)
      sash.removeEventListener('pointerup', up)
      sash.removeEventListener('pointercancel', up)
    }
    sash.addEventListener('pointermove', move)
    sash.addEventListener('pointerup', up)
    sash.addEventListener('pointercancel', up)
  }

  function sashKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 48 : 16
    // The panel grows to the left.
    if (e.key === 'ArrowLeft') onResize(clamp(width + step))
    else if (e.key === 'ArrowRight') onResize(clamp(width - step))
    else return
    e.preventDefault()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class="side-panel"
  class:overlay
  style:width="{width}px"
  aria-label={title}
  onkeydown={(e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="sash"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize side panel"
    aria-valuemin={MIN}
    aria-valuemax={MAX}
    aria-valuenow={width}
    tabindex="0"
    onpointerdown={startDrag}
    onkeydown={sashKeydown}
  ></div>
  <header>
    <h2>{title}</h2>
    {@render actions?.()}
    <button type="button" class="icon-button" aria-label="Close panel" title="Close panel (Esc)" onclick={onClose}><Icon name="close" /></button>
  </header>
  <div class="body">
    {@render children()}
  </div>
</aside>

<style>
  .side-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: none;
    min-width: 0;
    background: var(--se-bg-panel);
    color: var(--se-text-primary);
    border-left: 1px solid var(--se-border);
  }
  .side-panel.overlay {
    position: absolute;
    top: 0;
    right: 44px;
    bottom: 0;
    z-index: 20;
    max-width: calc(100% - 44px);
    box-shadow: var(--se-shadow-elevated);
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 35px;
    padding: 0 6px 0 12px;
  }
  h2 {
    flex: 1;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  /* VS Code-style sash on the left edge: an invisible hit area that lights up on hover. */
  .sash {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    z-index: 5;
    width: 6px;
    cursor: col-resize;
    outline: none;
    touch-action: none;
  }
  .sash::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 2px;
    background: transparent;
    transition: background-color 0.1s ease-out 0.2s;
  }
  .sash:hover::after,
  .sash:focus-visible::after {
    background: var(--se-sash-hover);
    transition-delay: 0s;
  }
</style>
