<script lang="ts" module>
  // Colors picked in this session, newest first, shared by every color field.
  let RECENT: string[] = $state([])
  const remember = (hex: string): void => {
    RECENT = [hex, ...RECENT.filter((c) => c !== hex)].slice(0, 8)
  }

  /** The suggested colors: Okabe & Ito's color-blind-safe eight, the "tide" blues of the app, and neutrals. */
  const SUGGESTED = [
    '#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#000000',
    '#d9e9ef', '#a9cfdb', '#74b0c4', '#3f8fa8', '#26708b', '#1b5470', '#123b52', '#ffffff',
    '#f3f5f8', '#c9d1de', '#8592ab', '#5a6882', '#2e3a52', '#1c2f55', '#b91c1c', '#15803d',
  ]

  /** `#rgb` or `#rrggbb`, with or without the hash, as lowercase `#rrggbb`; null when it is not a color. */
  export function parseHex(text: string): string | null {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
    if (!m) return null
    const h = m[1].toLowerCase()
    return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h)
  }
</script>

<script lang="ts">
  // A color, picked in a popup that wears the theme (the browser's own picker does not): a saturation and hue area
  // (vanilla-colorful, MIT, a 2 kB web component), a hex box, the eyedropper where the browser has one, suggested
  // colors and the ones used lately. `apply="live"` reports every change while dragging (cheap styles); "end" reports
  // when the popup closes or a value is typed or chosen (styles that classify again on every change).
  import 'vanilla-colorful/hex-color-picker.js'
  import { tick } from 'svelte'
  import Icon from '../Icon.svelte'

  interface Props {
    value: string
    onChange: (hex: string) => void
    /** The accessible name of the button (or `labelledby`). */
    label?: string
    labelledby?: string
    disabled?: boolean
    apply?: 'live' | 'end'
    /** The button's size: `md` for a form row, `sm` inside a list of classes. */
    size?: 'md' | 'sm'
    /** For a color opened from elsewhere (no button of its own): whether the popup is open, and what it hangs from. */
    open?: boolean
    anchor?: HTMLElement | null
    hideTrigger?: boolean
    /** For a list's keyboard navigation (data-col). */
    dataCol?: string
  }
  let { value, onChange, label, labelledby, disabled = false, apply = 'live', size = 'md', open = $bindable(false), anchor = null, hideTrigger = false, dataCol }: Props = $props()

  let trigger = $state<HTMLButtonElement>()
  let pop = $state<HTMLDivElement>()
  let picker = $state<HTMLElement>()
  let hexBox = $state<HTMLInputElement>()
  let draft = $state('#000000')
  let hexText = $state('')
  let pos = $state({ left: 0, top: 0 })
  const canDropper = typeof window !== 'undefined' && 'EyeDropper' in window
  let dirty = false

  function place(): void {
    const from = (anchor ?? trigger)?.getBoundingClientRect()
    if (!from || !pop) return
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    const left = Math.max(8, Math.min(from.left, window.innerWidth - w - 8))
    const below = from.bottom + 6
    const top = below + h > window.innerHeight - 8 ? Math.max(8, from.top - h - 6) : below
    pos = { left, top }
  }

  $effect(() => {
    if (!open) return
    draft = parseHex(value) ?? '#000000'
    hexText = draft
    dirty = false
    void tick().then(() => {
      place()
      hexBox?.focus()
      hexBox?.select()
    })
    const outside = (e: PointerEvent): void => {
      const t = e.target as Node
      if (pop?.contains(t) || trigger?.contains(t) || anchor?.contains(t)) return
      close(false)
    }
    const away = (e: Event): void => {
      if (!(e.target instanceof Node) || !pop?.contains(e.target)) close(false)
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  })

  // The picker element reports through a DOM event.
  $effect(() => {
    const el = picker
    if (!el) return
    const on = (e: Event): void => pick((e as CustomEvent<{ value: string }>).detail.value)
    el.addEventListener('color-changed', on)
    return () => el.removeEventListener('color-changed', on)
  })

  function pick(hex: string, commit = false): void {
    const c = parseHex(hex)
    if (!c || c === draft) {
      if (c && commit) finish()
      return
    }
    draft = c
    hexText = c
    dirty = true
    if (apply === 'live') onChange(c)
    if (commit) finish()
  }

  /** Reports the chosen color (the "end" style) and remembers it. */
  function finish(): void {
    if (apply === 'end' && draft !== (parseHex(value) ?? '')) onChange(draft)
    if (dirty || draft !== parseHex(value)) remember(draft)
    dirty = false
  }

  function close(refocus = true): void {
    if (!open) return
    finish()
    open = false
    if (refocus) (trigger ?? anchor)?.focus()
  }

  function onHexKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      const c = parseHex(hexText)
      if (c) pick(c, true)
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  async function dropper(): Promise<void> {
    try {
      const result = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open()
      pick(result.sRGBHex, true)
    } catch {
      // Cancelled.
    }
  }
</script>

{#if !hideTrigger}
  <button
    type="button"
    class="se-color {size}"
    bind:this={trigger}
    aria-label={label}
    aria-labelledby={labelledby}
    data-col={dataCol}
    aria-haspopup="dialog"
    aria-expanded={open}
    {disabled}
    style:--c={value}
    onclick={() => (open = !open)}
  ></button>
{/if}

{#if open}
  <div class="se-color-pop" role="dialog" aria-label="{label ?? 'Color'} picker" tabindex="-1" bind:this={pop} style:left="{pos.left}px" style:top="{pos.top}px" onkeydown={onKeydown}>
    <hex-color-picker bind:this={picker} color={draft}></hex-color-picker>
    <div class="row">
      <span class="chip" style:background={draft} aria-hidden="true"></span>
      <label class="hex">
        <input
          type="text"
          bind:this={hexBox}
          bind:value={hexText}
          aria-label="Hex color"
          spellcheck="false"
          autocomplete="off"
          maxlength="7"
          onkeydown={onHexKey}
          onblur={() => {
            const c = parseHex(hexText)
            if (c) pick(c)
            else hexText = draft
          }}
        />
      </label>
      {#if canDropper}
        <button type="button" class="tool" title="Pick a color from the screen" aria-label="Pick a color from the screen" onclick={() => void dropper()}><Icon name="pipette" size={14} /></button>
      {/if}
    </div>
    {#if RECENT.length > 0}
      <div class="group">Recent</div>
      <div class="swatches" role="group" aria-label="Recent colors">
        {#each RECENT as c (c)}
          <button type="button" class="sw" class:on={c === draft} style:background={c} aria-label={c} title={c} onclick={() => pick(c, true)}></button>
        {/each}
      </div>
    {/if}
    <div class="group">Suggested</div>
    <div class="swatches" role="group" aria-label="Suggested colors">
      {#each SUGGESTED as c (c)}
        <button type="button" class="sw" class:on={c === draft} style:background={c} aria-label={c} title={c} onclick={() => pick(c, true)}></button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .se-color {
    display: inline-block;
    flex: none;
    padding: 0;
    border: 1px solid var(--se-swatch-border, var(--se-input-border));
    border-radius: var(--se-radius-sm);
    background: var(--c);
    cursor: pointer;
  }
  .se-color.md {
    width: 28px;
    height: 22px;
  }
  .se-color.sm {
    width: 22px;
    height: 18px;
    border-radius: 2px;
  }
  .se-color:focus-visible,
  .se-color[aria-expanded='true'] {
    outline: 2px solid var(--se-focus);
    outline-offset: 1px;
  }
  .se-color:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .se-color-pop {
    position: fixed;
    z-index: 1200;
    box-sizing: border-box;
    width: 232px;
    padding: 10px;
    display: grid;
    gap: 8px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius-lg, 8px);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  /* The picker takes the popup's width; its parts are restyled (vanilla-colorful exposes them as ::part). */
  hex-color-picker {
    width: 100%;
    height: 176px;
  }
  hex-color-picker::part(saturation) {
    border-radius: var(--se-radius) var(--se-radius) 0 0;
    border-bottom-width: 10px;
  }
  hex-color-picker::part(hue) {
    flex-basis: 14px;
    border-radius: 0 0 var(--se-radius) var(--se-radius);
  }
  hex-color-picker::part(saturation-pointer),
  hex-color-picker::part(hue-pointer) {
    width: 18px;
    height: 18px;
    border-width: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chip {
    flex: none;
    width: 26px;
    height: 26px;
    border: 1px solid var(--se-swatch-border, var(--se-input-border));
    border-radius: var(--se-radius-sm);
  }
  .hex {
    flex: 1;
    min-width: 0;
  }
  .hex input {
    box-sizing: border-box;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    color: var(--se-text-primary);
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    font: 12.5px var(--se-font-mono);
    text-transform: lowercase;
  }
  .hex input:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 0;
  }
  .tool {
    display: grid;
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    padding: 0;
    color: var(--se-text-secondary);
    background: transparent;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    cursor: pointer;
  }
  .tool:hover {
    color: var(--se-text-primary);
    background: var(--se-control-hover);
  }
  .group {
    margin-bottom: -4px;
    color: var(--se-text-secondary);
    font-size: 12px;
    font-weight: 600;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .sw {
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid var(--se-swatch-border, var(--se-input-border));
    border-radius: 3px;
    cursor: pointer;
  }
  .sw:hover {
    transform: scale(1.12);
  }
  .sw.on {
    outline: 2px solid var(--se-focus);
    outline-offset: 1px;
  }
  .sw:focus-visible,
  .tool:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
