<script lang="ts">
  // Spec 016: the composer's controls (GeoLibre's print-layout editors, one
  // section each): title, page, map frame, and the elements on the page.
  import { PRINT_TEXT_SIZE_RANGE, RAMPS, isGoogleFamily, type PrintLayoutConfig } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'
  import ColorField from '../kit/ColorField.svelte'
  import FontPicker from './FontPicker.svelte'
  import GoogleFontsMark from './GoogleFontsMark.svelte'
  import Segmented from '../kit/Segmented.svelte'
  import Select from '../kit/Select.svelte'
  import Slider from '../kit/Slider.svelte'
  import Switch from '../kit/Switch.svelte'
  import type { PrintComposer } from './composer.svelte.js'
  import { PAPER_SIZES } from './layout.js'
  import { autoPageBackground, panelColors, prefersLightForeground } from './panelColors.js'

  interface Props {
    c: PrintComposer
    /** Sections the composer adds around these (scale and extent, atlas, data blocks, legend editor). */
    scale?: import('svelte').Snippet
    atlas?: import('svelte').Snippet
    blocks?: import('svelte').Snippet
    legendEditor?: import('svelte').Snippet
  }
  let { c, scale, atlas, blocks, legendEditor }: Props = $props()
  const l = $derived(c.layout)

  const CORNERS = [
    { value: 'top-left', label: 'Top left' },
    { value: 'top-right', label: 'Top right' },
    { value: 'bottom-left', label: 'Bottom left' },
    { value: 'bottom-right', label: 'Bottom right' },
  ]
  const PAPER_OPTIONS = [...PAPER_SIZES.filter((p) => p.id !== 'custom').map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom…' }]
  const RAMP_OPTIONS = RAMPS.filter((r) => r.kind !== 'qualitative').map((r) => ({ value: r.id, label: r.name }))

  // The text styles: one editor, for the kind of text chosen.
  type TextKind = 'title' | 'subtitle' | 'footer' | 'panels'
  const TEXT_KINDS: { value: TextKind; label: string; key: 'titleStyle' | 'subtitleStyle' | 'footerStyle' | 'panelStyle' }[] = [
    { value: 'title', label: 'Title', key: 'titleStyle' },
    { value: 'subtitle', label: 'Subtitle', key: 'subtitleStyle' },
    { value: 'footer', label: 'Footer', key: 'footerStyle' },
    { value: 'panels', label: 'Panels', key: 'panelStyle' },
  ]
  let textKind = $state<TextKind>('title')
  const textEntry = $derived(TEXT_KINDS.find((k) => k.value === textKind) ?? TEXT_KINDS[0])
  const st = $derived(l[textEntry.key])
  /** The color the text has while none is chosen: the page's or the panels' own. */
  const autoColor = $derived.by(() => {
    const light = textKind === 'panels' ? l.panelTheme === 'dark' : prefersLightForeground(l.pageBackground || autoPageBackground(l.panelTheme))
    const p = panelColors(light ? 'dark' : 'light')
    return textKind === 'title' || textKind === 'panels' ? p.ink : p.muted
  })
  const setStyle = (patch: Partial<PrintLayoutConfig['titleStyle']>): void => c.setTextStyle(textEntry.key, patch)

  const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value)
  let legendDict = $state('')
  let legendDictError = $state('')

  function importDict(): void {
    try {
      const parsed: unknown = JSON.parse(legendDict)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      const pairs = Object.entries(parsed as Record<string, unknown>)
      if (!pairs.length) throw new Error('empty')
      let seq = 0
      c.set({ customLegendEntries: pairs.map(([label, color]) => ({ id: `cl-${++seq}`, label, color: String(color) })) })
      legendDictError = ''
    } catch {
      legendDictError = 'Not a dictionary of label and color, such as {"Forest": "#228b22"}.'
    }
  }
  function addEntry(): void {
    const next = Math.max(0, ...l.customLegendEntries.map((e) => Number(/^cl-(\d+)$/.exec(e.id)?.[1] ?? 0))) + 1
    c.set({ customLegendEntries: [...l.customLegendEntries, { id: `cl-${next}`, label: '', color: '#888888' }] })
  }
</script>

{#snippet toggle(label: string, checked: boolean, onChange: (v: boolean) => void)}
  <div class="toggle">
    <span id="t-{label.replace(/[^a-zA-Z0-9]+/g, '-')}">{label}</span>
    <Switch labelledby="t-{label.replace(/[^a-zA-Z0-9]+/g, '-')}" {checked} {onChange} />
  </div>
{/snippet}

<div class="controls">
  <section aria-label="Title">
    <h3>Title</h3>
    <label class="row"><span>Title</span><input type="text" value={l.title} placeholder={c.options.title} oninput={(e) => c.set({ title: e.currentTarget.value })} /></label>
    <label class="row"><span>Subtitle</span><input type="text" value={l.subtitle} oninput={(e) => c.set({ subtitle: e.currentTarget.value })} /></label>
    <div class="row">
      <span>Placement</span>
      <Segmented label="Title placement" value={l.titlePlacement} onChange={(v) => c.set({ titlePlacement: v as 'outside' | 'inside' })} options={[{ value: 'outside', label: 'Outside frame' }, { value: 'inside', label: 'Inside frame' }]} />
    </div>
    <div class="row">
      <span>Alignment</span>
      <Segmented label="Title alignment" value={l.titleAlign} onChange={(v) => c.set({ titleAlign: v as 'left' | 'center' | 'right' })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
    </div>
  </section>

  <section aria-label="Page">
    <h3>Page</h3>
    <div class="row">
      <span>Size</span>
      <div class="grow"><Select label="Page size" value={l.paperSize} onChange={(v) => c.set({ paperSize: v as typeof l.paperSize })} options={PAPER_OPTIONS} /></div>
    </div>
    {#if l.paperSize === 'custom'}
      <div class="row">
        <span>Width</span>
        <input type="number" min="1" aria-label="Page width" value={l.customWidth} oninput={(e) => c.set({ customWidth: Math.max(1, num(e) || 1) })} />
        <span class="x">×</span>
        <input type="number" min="1" aria-label="Page height" value={l.customHeight} oninput={(e) => c.set({ customHeight: Math.max(1, num(e) || 1) })} />
        <Segmented label="Custom size unit" value={l.customUnit} onChange={(v) => c.set({ customUnit: v as 'px' | 'mm' })} options={[{ value: 'px', label: 'px' }, { value: 'mm', label: 'mm' }]} />
      </div>
    {:else}
      <div class="row">
        <span>Orientation</span>
        <Segmented label="Orientation" value={l.orientation} onChange={(v) => c.set({ orientation: v as 'portrait' | 'landscape' })} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
      </div>
    {/if}
    <div class="row">
      <span></span>
      <button type="button" class="secondary" disabled={!c.captured} title="A page the size of the map on screen, in pixels: nothing is scaled or cropped" onclick={() => c.useMapSize(1)}>Size of the map on screen</button>
    </div>
    <div class="row">
      <span>Margin</span>
      <Segmented label="Page margin" value={l.pageMargin} onChange={(v) => c.set({ pageMargin: v as 'normal' | 'narrow' | 'none' })} options={[{ value: 'normal', label: 'Normal' }, { value: 'narrow', label: 'Narrow' }, { value: 'none', label: 'None' }]} />
    </div>
    <div class="row">
      <span id="page-bg-label">Page background</span>
      <ColorField labelledby="page-bg-label" value={l.pageBackground || autoPageBackground(l.panelTheme)} apply="end" onChange={(v) => c.commitPageBackground(v)} />
      <input type="text" class="hex" aria-label="Page background color" placeholder="Auto" value={c.pageBackgroundDraft} oninput={(e) => c.commitPageBackground(e.currentTarget.value)} />
      {#if l.pageBackground}<button type="button" class="secondary" title="Follow the Map panels choice again" onclick={() => c.commitPageBackground('')}>Auto</button>{/if}
    </div>
  </section>

  <section aria-label="Map frame">
    <h3>Map frame</h3>
    <div class="row">
      <span>Map panels</span>
      <Segmented label="Map panels" value={l.panelTheme} onChange={(v) => c.set({ panelTheme: v as 'light' | 'dark' })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
    </div>
    <div class="row">
      <span id="bg-label">Map background</span>
      <ColorField labelledby="bg-label" value={l.mapBackground} apply="end" onChange={(v) => c.commitMapBackground(v)} />
      <input type="text" class="hex" aria-label="Map background color" value={c.mapBackgroundDraft} oninput={(e) => c.commitMapBackground(e.currentTarget.value)} />
    </div>
    <div class="row">
      <span id="frame-label">Map frame color</span>
      <ColorField labelledby="frame-label" value={l.mapBorderColor} apply="end" onChange={(v) => c.set({ mapBorderColor: v })} />
    </div>
    <div class="row">
      <span>Map frame width</span>
      <div class="grow"><Slider label="Map frame width" value={l.mapBorderWidth} min={0} max={10} step={1} onChange={(v) => c.set({ mapBorderWidth: v })} /></div>
    </div>
  </section>

  {@render scale?.()}
  {@render atlas?.()}

  <section aria-label="Text">
    <h3>Text</h3>
    <div class="row">
      <span>Style for</span>
      <Segmented label="Text to style" value={textKind} onChange={(v) => (textKind = v as TextKind)} options={TEXT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
    </div>
    <div class="row">
      <span>Font</span>
      <div class="grow fontline">
        <FontPicker label="Font" value={st.family} google={c.fontConsent === 'granted'} onChange={(family) => setStyle({ family })} />
        <button
          type="button"
          class="face gtoggle"
          aria-pressed={c.fontConsent === 'granted'}
          title={c.fontConsent === 'granted' ? 'Google Fonts are in the list. Click to turn them off: your agreement is withdrawn and any text using a Google font goes back to the default font.' : 'Include Google Fonts in the list (fetched from Google once you agree).'}
          aria-label="Google Fonts"
          onclick={() => (c.fontConsent === 'granted' ? c.revokeFontConsent() : (c.askFontConsent = true))}
        ><GoogleFontsMark /></button>
      </div>
    </div>
    <div class="row">
      <span id="text-color-label">Color</span>
      <ColorField labelledby="text-color-label" value={st.color || autoColor} apply="end" onChange={(v) => setStyle({ color: v })} />
      {#if st.color}<button type="button" class="secondary" title="Follow the page and the panels again" onclick={() => setStyle({ color: '' })}>Auto</button>{:else}<span class="hint">Auto</span>{/if}
      <span class="faces" role="group" aria-label="Text face">
        <button type="button" class="face bold" aria-pressed={st.bold} title="Bold" onclick={() => setStyle({ bold: !st.bold })}>B</button>
        <button type="button" class="face italic" aria-pressed={st.italic} title="Italic" onclick={() => setStyle({ italic: !st.italic })}>I</button>
        {#if textKind !== 'panels'}<button type="button" class="face underline" aria-pressed={st.underline} title="Underline" onclick={() => setStyle({ underline: !st.underline })}>U</button>{/if}
      </span>
    </div>
    <div class="row">
      <span>Size</span>
      <div class="grow"><Slider label="Text size" value={st.size} min={PRINT_TEXT_SIZE_RANGE.min} max={textKind === 'panels' ? 200 : PRINT_TEXT_SIZE_RANGE.max} step={5} unit="%" onChange={(v) => setStyle({ size: v })} /></div>
    </div>
    {#if st.family && isGoogleFamily(st.family)}
      <p class="hint">A Google font: it is fetched from Google Fonts (fonts.googleapis.com) once you agree. The PDF then holds the page as a picture.</p>
    {/if}
    {#if c.fontNotice && c.fontConsent !== 'denied'}
      <p class="hint warn" role="status">{c.fontNotice}{#if c.fontConsent !== 'granted' && c.googleFamilies.length} <button type="button" class="link" onclick={() => (c.askFontConsent = true)}>Decide</button>{/if}</p>
    {/if}
  </section>

  <section aria-label="Map elements">
    <h3>Map elements</h3>
    {@render toggle('Title', l.showTitle, (v) => c.set({ showTitle: v }))}
    {@render toggle('Subtitle', l.showSubtitle, (v) => c.set({ showSubtitle: v }))}
    {@render toggle('Legend', l.showLegend, (v) => c.set({ showLegend: v }))}
    {@render toggle('Scale bar', l.showScaleBar, (v) => c.set({ showScaleBar: v }))}
    {@render toggle('North arrow', l.showNorthArrow, (v) => c.set({ showNorthArrow: v }))}
    {@render toggle('Credit on the map', l.showAttribution, (v) => c.set({ showAttribution: v }))}
    <p class="hint">The footer's three places. <code>{'{date}'}</code> is the date, <code>{'{credit}'}</code> the map credit (it leaves the map when named here).</p>
    <label class="row nested"><span>Footer left</span><input type="text" value={l.footerLeft} oninput={(e) => c.set({ footerLeft: e.currentTarget.value })} /></label>
    <label class="row nested"><span>Footer center</span><input type="text" value={l.footerCenter} oninput={(e) => c.set({ footerCenter: e.currentTarget.value })} /></label>
    <label class="row nested"><span>Footer right</span><input type="text" value={l.footerRight} oninput={(e) => c.set({ footerRight: e.currentTarget.value })} /></label>
    {@render toggle('Page border', l.showPageBorder, (v) => c.set({ showPageBorder: v }))}
    {#if l.showPageBorder}
      <div class="row nested">
        <span id="pb-label">Border color</span>
        <ColorField labelledby="pb-label" value={l.pageBorderColor} apply="end" onChange={(v) => c.set({ pageBorderColor: v })} />
      </div>
      <div class="row nested">
        <span>Border width</span>
        <div class="grow"><Slider label="Border width" value={l.pageBorderWidth} min={1} max={10} step={1} onChange={(v) => c.set({ pageBorderWidth: v })} /></div>
      </div>
    {/if}
    {@render toggle('Info block (title block)', l.showInfoBlock, (v) => c.set({ showInfoBlock: v }))}
    {#if l.showInfoBlock}
      <label class="row nested"><span>Author</span><input type="text" value={l.author} oninput={(e) => c.set({ author: e.currentTarget.value })} /></label>
      <label class="row nested"><span>Project no.</span><input type="text" value={l.projectNumber} oninput={(e) => c.set({ projectNumber: e.currentTarget.value })} /></label>
      <label class="row nested"><span>CRS</span><input type="text" value={l.crs} placeholder="EPSG:4326" oninput={(e) => c.set({ crs: e.currentTarget.value })} /></label>
      <label class="row nested"><span>Revision</span><input type="text" value={l.revision} oninput={(e) => c.set({ revision: e.currentTarget.value })} /></label>
    {/if}
    {@render toggle('Colorbar', l.showColorbar, (v) => c.set({ showColorbar: v }))}
    {#if l.showColorbar}
      <div class="row nested">
        <span>Colormap</span>
        <div class="grow"><Select label="Colormap" value={l.colorbarRamp} onChange={(v) => c.set({ colorbarRamp: v })} options={RAMP_OPTIONS} /></div>
      </div>
      <label class="row nested"><span>Min value</span><input type="text" inputmode="decimal" value={l.colorbarMin} oninput={(e) => c.set({ colorbarMin: e.currentTarget.value })} /></label>
      <label class="row nested"><span>Max value</span><input type="text" inputmode="decimal" value={l.colorbarMax} oninput={(e) => c.set({ colorbarMax: e.currentTarget.value })} /></label>
      <label class="row nested"><span>Label</span><input type="text" value={l.colorbarLabel} oninput={(e) => c.set({ colorbarLabel: e.currentTarget.value })} /></label>
      <div class="row nested">
        <span>Orientation</span>
        <Segmented label="Colorbar orientation" value={l.colorbarOrientation} onChange={(v) => c.set({ colorbarOrientation: v as 'vertical' | 'horizontal' })} options={[{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }]} />
      </div>
      <div class="row nested">
        <span>Position</span>
        <div class="grow"><Select label="Colorbar position" value={l.colorbarPosition} onChange={(v) => c.set({ colorbarPosition: v as typeof l.colorbarPosition })} options={CORNERS} /></div>
      </div>
      <div class="row nested">
        <span>Length</span>
        <div class="grow"><Slider label="Colorbar length" value={l.colorbarLength} min={10} max={100} step={1} unit="%" onChange={(v) => c.set({ colorbarLength: v })} /></div>
      </div>
    {/if}
    {@render toggle('Custom legend', l.showCustomLegend, (v) => c.set({ showCustomLegend: v }))}
    {#if l.showCustomLegend}
      <label class="row nested"><span>Legend title</span><input type="text" value={l.customLegendTitle} oninput={(e) => c.set({ customLegendTitle: e.currentTarget.value })} /></label>
      <div class="row nested">
        <span>Position</span>
        <div class="grow"><Select label="Custom legend position" value={l.customLegendPosition} onChange={(v) => c.set({ customLegendPosition: v as typeof l.customLegendPosition })} options={CORNERS} /></div>
      </div>
      <ul class="entries nested">
        {#each l.customLegendEntries as e (e.id)}
          <li>
            <ColorField label={`Color of ${e.label || 'item'}`} value={e.color} apply="end" size="sm" onChange={(v) => c.set({ customLegendEntries: l.customLegendEntries.map((x) => (x.id === e.id ? { ...x, color: v } : x)) })} />
            <input type="text" aria-label="Label" value={e.label} oninput={(ev) => c.set({ customLegendEntries: l.customLegendEntries.map((x) => (x.id === e.id ? { ...x, label: ev.currentTarget.value } : x)) })} />
            <button type="button" class="icon" aria-label={`Remove ${e.label || 'item'}`} title="Remove" onclick={() => c.set({ customLegendEntries: l.customLegendEntries.filter((x) => x.id !== e.id) })}><Icon name="close" size={14} /></button>
          </li>
        {/each}
      </ul>
      <div class="row nested"><button type="button" class="secondary" onclick={addEntry}>Add item</button></div>
      <label class="row nested block">
        <span>Import from dictionary</span>
        <textarea rows="2" placeholder={'{"Forest": "#228b22", "Water": "#1e90ff"}'} bind:value={legendDict}></textarea>
      </label>
      <div class="row nested">
        <button type="button" class="secondary" disabled={!legendDict.trim()} onclick={importDict}>Import</button>
        {#if legendDictError}<span class="error" role="alert">{legendDictError}</span>{/if}
      </div>
    {/if}
    {@render blocks?.()}
    {#if l.showLegend}{@render legendEditor?.()}{/if}
  </section>
</div>

<style>
  .faces {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
  }
  .face {
    min-width: 28px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  /* On: a filled square in the accent color with a light mark, as the app's switches are filled when on. */
  .face[aria-pressed='true'] {
    background: var(--se-accent);
    border-color: var(--se-accent);
    color: var(--se-button-fg, #fff);
  }
  .face[aria-pressed='true']:hover {
    filter: brightness(1.1);
  }
  .fontline {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .gtoggle {
    flex: none;
    display: grid;
    place-items: center;
  }
  .face.bold {
    font-weight: 700;
  }
  .face.italic {
    font-style: italic;
  }
  .face.underline {
    text-decoration: underline;
  }
  .face:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .hint.warn {
    color: var(--se-warning, var(--se-text-secondary));
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--se-text-primary);
    cursor: pointer;
    text-decoration: underline;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    align-content: start;
  }
  section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
  }
  h3 {
    margin: 0 0 2px;
    font: var(--se-section-title-font);
    color: var(--se-text-primary);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    min-width: 0;
  }
  .row > span:first-child {
    flex: none;
    width: 104px;
    color: var(--se-text-secondary);
  }
  .row.block {
    align-items: flex-start;
    flex-direction: column;
  }
  .row.block > span:first-child {
    width: auto;
  }
  .row.block textarea {
    width: 100%;
  }
  .nested {
    margin-left: 14px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .x {
    width: auto !important;
  }
  input[type='text'],
  input[type='number'],
  textarea {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 2px 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
  }
  input[type='text'],
  input[type='number'] {
    height: 24px;
  }
  input[type='number'] {
    flex: none;
    width: 72px;
  }
  .hex {
    flex: none;
    width: 76px;
    font-family: var(--se-font-mono, monospace);
  }
  input:focus-visible,
  textarea:focus-visible,
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
  }
  .entries {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .entries li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .icon {
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
  .icon:hover {
    background: var(--se-bg-hover);
  }
  .secondary {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .secondary:hover:not(:disabled) {
    background: var(--se-button-secondary-hover);
  }
  .secondary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .error {
    color: var(--se-error-fg, var(--se-error));
  }
</style>
