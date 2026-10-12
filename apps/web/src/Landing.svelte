<script lang="ts" module>
  // Drawn once per page load: the landing page comes back after a cancelled
  // open, and must not redo this work then.
  const FORMATS = ['GeoPackage', 'SQLite', 'Shapefile', 'GeoParquet', 'FlatGeobuf', 'GeoJSON', 'CSV', 'GML', 'PMTiles']

  // Fixed data colors (theme-independent, like every data ramp): a warm
  // sequential ramp in the brand's amber family.
  const RAMP = ['#fdecb4', '#fcd27f', '#f9b14f', '#f08a32', '#dd6526', '#b9441f', '#8a2c1b']

  // --- Background: contours of a smooth synthetic terrain (marching squares)
  const W = 1200
  const H = 800
  const hill = (x: number, y: number, cx: number, cy: number, sx: number, sy: number, a: number): number =>
    a * Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2))
  const terrain = (x: number, y: number): number =>
    hill(x, y, 180, 160, 260, 200, 1) +
    hill(x, y, 1040, 640, 300, 220, 1.1) +
    hill(x, y, 1010, 140, 180, 150, 0.7) +
    hill(x, y, 160, 690, 220, 170, 0.75) +
    hill(x, y, 620, 420, 420, 260, 0.35) +
    0.08 * Math.sin(x / 70) * Math.cos(y / 90) +
    0.05 * Math.sin((x + y) / 45)

  function contours(levels: number[]): string[] {
    const step = 30
    const nx = W / step + 1
    const ny = H / step + 1
    const v = new Float64Array(nx * ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = terrain(i * step, j * step)
    const f = (n: number): string => n.toFixed(1)
    return levels.map((t) => {
      let d = ''
      for (let j = 0; j < ny - 1; j++)
        for (let i = 0; i < nx - 1; i++) {
          const a = v[j * nx + i]
          const b = v[j * nx + i + 1]
          const c = v[(j + 1) * nx + i + 1]
          const e = v[(j + 1) * nx + i]
          const x = i * step
          const y = j * step
          const pts: Array<[number, number]> = []
          if (a < t !== b < t) pts.push([x + ((t - a) / (b - a)) * step, y])
          if (b < t !== c < t) pts.push([x + step, y + ((t - b) / (c - b)) * step])
          if (e < t !== c < t) pts.push([x + ((t - e) / (c - e)) * step, y + step])
          if (a < t !== e < t) pts.push([x, y + ((t - a) / (e - a)) * step])
          for (let k = 0; k + 1 < pts.length; k += 2) d += `M${f(pts[k][0])} ${f(pts[k][1])}L${f(pts[k + 1][0])} ${f(pts[k + 1][1])}`
        }
      return d
    })
  }
  const LEVELS = Array.from({ length: 12 }, (_, k) => 0.08 + k * 0.09)
  const contourPaths = contours(LEVELS)

  /**
   * The sheet as one static image (contours over a graticule), per theme:
   * rasterized once, unlike live SVG or repeating gradients, which cost far
   * more to paint (the browser tests' software renderer showed it).
   */
  function sheetImage(stroke: string, grid: string): string {
    const lines: string[] = []
    for (let k = 1; k < 12; k++) lines.push(`M${(k * W) / 12} 0V${H}`)
    for (let k = 1; k < 6; k++) lines.push(`M0 ${(k * H) / 6}H${W}`)
    const paths = contourPaths
      .map((d, k) => `<path d="${d}" stroke="${stroke}" stroke-opacity="${k % 4 === 3 ? 0.3 : 0.15}" stroke-width="${k % 4 === 3 ? 1.4 : 1}"/>`)
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none"><path d="${lines.join('')}" stroke="${grid}" stroke-opacity="0.06"/>${paths}</svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  }
  // The theme's accent and text colors (theme.css), as data: an image can't read CSS variables.
  const SHEET_LIGHT = sheetImage('#b45309', '#1c1208')
  const SHEET_DARK = sheetImage('#fbbf24', '#f0ebe0')

  // --- Drop card: the world's population per hexagon (scripts/landing-world.mjs)
  // The script's class breaks (people per hexagon), for the legend's ends.
  const LEGEND_LOW = '<100k'
  const LEGEND_HIGH = '30M+'

</script>

<script lang="ts">
  // The web app's empty state (no file open): a map sheet. A topographic
  // background (contours with index lines), a neatline with degree ticks, the
  // drop card as a small hex-bin "map", the four things the app does shown in
  // the viewer's own visual language, and a status strip like the map's.
  // Everything is drawn locally: no network and no map engine before a file
  // is chosen. VS Code never renders this (a file is always open there).
  import { onMount } from 'svelte'
  import { Icon } from '@spatial-explorer/ui'

  interface Props {
    isDragOver: boolean
    /** A share link is waiting for this file (spec 008 US7). */
    sharedFileName: string | null
    engine: 'warming' | 'ready' | 'failed'
    onChoose: () => void
    onSample: () => void
    chooseButton?: HTMLButtonElement
  }
  let { isDragOver, sharedFileName, engine, onChoose, onSample, chooseButton = $bindable() }: Props = $props()

  // The sheet is decoration: drawn after first paint and the engine's warm-up
  // have started, so it never delays either.
  let showSheet = $state(false)
  onMount(() => {
    const show = (): void => void (showSheet = true)
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(show, { timeout: 1500 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(show, 300)
    return () => clearTimeout(id)
  })

  // --- Status strip: the pointer as map coordinates, like the viewer's ---
  let coords = $state('—')
  let frame = 0
  function track(e: PointerEvent): void {
    if (frame) return
    const { clientX, clientY } = e
    frame = requestAnimationFrame(() => {
      frame = 0
      const lon = (clientX / window.innerWidth) * 360 - 180
      // Web Mercator: screen y to latitude, clamped like the map.
      const n = Math.PI * (1 - (2 * clientY) / window.innerHeight) * 0.94
      const lat = (180 / Math.PI) * Math.atan(Math.sinh(n))
      coords = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
    })
  }

  const TOP_TICKS = ['150°W', '120°W', '90°W', '60°W', '30°W', '0°', '30°E', '60°E', '90°E', '120°E', '150°E']
  const SIDE_TICKS = ['60°N', '30°N', '0°', '30°S', '60°S']
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="landing" style="--sheet-light: {SHEET_LIGHT}; --sheet-dark: {SHEET_DARK}" onpointermove={track} onpointerleave={() => (coords = '—')}>
  {#if showSheet}
  <div class="sheet" aria-hidden="true">
    <div class="topo"></div>
    <div class="neatline">
      <div class="ticks top">{#each TOP_TICKS as t (t)}<span>{t}</span>{/each}</div>
      <div class="ticks side">{#each SIDE_TICKS as t, k (k)}<span>{t}</span>{/each}</div>
    </div>
    <div class="fade"></div>
  </div>
  {/if}

  <div class="scroll">
    <div class="layout">
      <section class="hero" aria-labelledby="landing-title">
        <p class="eyebrow"><span class="pip"></span>Spatial SQL &amp; map viewer</p>
        <h2 id="landing-title">Open a map file.<br /><span>Query it like a database.</span></h2>
        <p class="lede">
          View GeoPackages, Shapefiles, GeoParquet and more on a map, explore them with SQL, style them and export the result. No install, no
          account: it all runs in this tab.
        </p>
      </section>

      <section class="drop-card" class:drag-over={isDragOver} aria-label="Drop a geospatial file here">
        <div class="preview" aria-hidden="true">
          <span class="caption">World population · estimated per 450 km hexagon</span>
          <div class="map">
            <img src={`${import.meta.env.BASE_URL}landing/world-population.svg`} alt="" decoding="async" />
          </div>
          <span class="legend"><small>{LEGEND_LOW}</small>{#each RAMP as c (c)}<i style="background: {c}"></i>{/each}<small>{LEGEND_HIGH}</small></span>
        </div>
        <div class="body">
          {#if sharedFileName}
            <p class="share-banner" role="status">
              <Icon name="link" size={14} />
              <span>This link shows a view of <strong>{sharedFileName}</strong>. Choose that file to see it.</span>
            </p>
          {/if}
          <p class="title">{isDragOver ? 'Release to open' : 'Drag a geospatial file here'}</p>
          <p class="sub">or choose one or more from your computer.</p>
          <div class="actions">
            <button type="button" class="primary" bind:this={chooseButton} onclick={onChoose}><Icon name="import" size={15} />Choose a file</button>
            <button type="button" class="secondary" onclick={onSample}>
              <Icon name="globe" size={15} />
              <span class="sample">Try sample data<small>US counties · 3,222 polygons</small></span>
            </button>
          </div>
          <div class="formats">
            <span class="label">Opens</span>
            <ul aria-label="Supported formats">
              {#each FORMATS as f (f)}<li>{f}</li>{/each}
            </ul>
          </div>
          <p class="footnote">
            Shapefiles: select the .shp with its .shx, .dbf and .prj. A same-name .qml brings its QGIS style.
          </p>
        </div>
      </section>

      <section class="features" aria-label="What you can do">
        <article>
          <header><span class="num">01</span>Look</header>
          <p>Any projection is reprojected for display. Large files load by viewport.</p>
          <div class="demo chip" aria-hidden="true"><b>EPSG:4326</b><span>3,222 features</span></div>
        </article>
        <article>
          <header><span class="num">02</span>Query</header>
          <p>Spatial SQL with autocomplete. Every result becomes a map layer.</p>
          <div class="demo sql" aria-hidden="true">
            <span class="k">SELECT</span> <span class="fn">ST_Centroid</span>(geom) <span class="k">FROM</span> layer
          </div>
        </article>
        <article>
          <header><span class="num">03</span>Style</header>
          <p>Categorized and graduated styles, with a legend. Reads and writes QGIS QML.</p>
          <div class="demo ramp" aria-hidden="true">
            <span class="bar">{#each RAMP as c (c)}<i style="background: {c}"></i>{/each}</span><span class="cap">Graduated · Jenks</span>
          </div>
        </article>
        <article>
          <header><span class="num">04</span>Export</header>
          <p>Save the result as a file, the map as an image, or the view as a link.</p>
          <div class="demo chip" aria-hidden="true"><span>GeoParquet</span><span>GPKG</span><span>PNG</span><span>Link</span></div>
        </article>
      </section>
    </div>
  </div>

  <footer class="strip">
    <span class="engine {engine}">
      <span class="dot" aria-hidden="true"></span>
      {engine === 'ready' ? 'SQL engine ready' : engine === 'warming' ? 'SQL engine starting…' : 'SQL engine starts when a file opens'}
    </span>
    <span class="sep" aria-hidden="true"></span>
    <span class="private">Files are read in your browser and never uploaded.</span>
    <span class="grow"></span>
    <span class="coords" aria-hidden="true">{coords}</span>
  </footer>
</div>

<style>
  .landing {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--se-bg-base);
  }

  /* --- The map sheet ---------------------------------------------------- */
  .sheet {
    position: absolute;
    inset: 0;
    pointer-events: none;
    animation: sheet-in 0.6s ease-out both;
  }
  @keyframes sheet-in {
    from {
      opacity: 0;
    }
  }
  .topo {
    position: absolute;
    inset: 0;
    background: var(--sheet-light) center / cover no-repeat;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .topo {
      background-image: var(--sheet-dark);
    }
  }
  :global(:root[data-theme='dark']) .topo {
    background-image: var(--sheet-dark);
  }
  /* The sheet recedes behind the content (a plain overlay: masks cost far more to paint). */
  .fade {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 58% 52% at 50% 50%, color-mix(in srgb, var(--se-bg-base) 72%, transparent), transparent 100%);
  }
  .neatline {
    position: absolute;
    inset: 14px 14px 40px;
    border: 1px solid color-mix(in srgb, var(--se-text-primary) 14%, transparent);
    border-radius: 2px;
  }
  .ticks {
    position: absolute;
    display: flex;
    justify-content: space-around;
    font: 500 9.5px var(--se-font-mono);
    letter-spacing: 0.04em;
    color: var(--se-text-muted);
  }
  .ticks span {
    padding: 0 4px;
    background: var(--se-bg-base);
  }
  .ticks.top {
    top: -7px;
    left: 0;
    right: 0;
  }
  .ticks.side {
    top: 0;
    bottom: 0;
    left: -6px;
    flex-direction: column;
    align-items: flex-start;
  }

  /* --- Content ---------------------------------------------------------- */
  .scroll {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 440px);
    grid-template-areas:
      'hero card'
      'features card';
    column-gap: clamp(32px, 5vw, 72px);
    row-gap: 28px;
    align-content: center;
    align-items: start;
    max-width: 1180px;
    min-height: 100%;
    margin: 0 auto;
    padding: 56px clamp(28px, 5vw, 64px);
    box-sizing: border-box;
  }
  .hero {
    grid-area: hero;
    align-self: end;
  }
  .drop-card {
    grid-area: card;
    align-self: center;
  }
  .features {
    grid-area: features;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 18px;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-brand-text);
  }
  .pip {
    width: 7px;
    height: 7px;
    background: var(--se-accent);
    transform: rotate(45deg);
  }
  h2 {
    margin: 0;
    font: 650 clamp(30px, 3.3vw, 44px) / 1.1 var(--se-font-ui);
    text-wrap: balance;
    letter-spacing: -0.025em;
    color: var(--se-text-primary);
  }
  h2 span {
    color: var(--se-text-secondary);
    white-space: nowrap;
  }
  .lede {
    max-width: 50ch;
    margin: 18px 0 0;
    font-size: 15px;
    line-height: 1.6;
    color: var(--se-text-secondary);
  }

  /* The drop card: the viewer's floating-overlay surface. */
  .drop-card {
    overflow: hidden;
    border: 1px solid var(--se-control-border);
    border-radius: 10px;
    background: var(--se-bg-elevated);
    box-shadow: var(--se-shadow-elevated);
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      transform 0.15s;
  }
  .drop-card.drag-over {
    border-color: var(--se-accent);
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--se-accent) 22%, transparent),
      var(--se-shadow-elevated);
    transform: translateY(-2px);
  }
  .preview {
    position: relative;
    display: grid;
    place-items: center;
    height: 236px;
    padding: 4px 0 0;
    box-sizing: border-box;
    background: var(--se-map-bg);
    border-bottom: 1px solid var(--se-border);
  }
  .map {
    position: relative;
    width: calc(100% - 28px);
    aspect-ratio: 800 / 360;
    /* One animation for the whole map: it draws in from the center. */
    animation: reveal 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .map img {
    display: block;
    width: 100%;
    height: 100%;
  }
  @keyframes reveal {
    from {
      clip-path: circle(0% at 50% 50%);
    }
    to {
      clip-path: circle(75% at 50% 50%);
    }
  }
  .drag-over .map {
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.6;
    }
  }
  .caption,
  .legend small {
    font: 500 9.5px/14px var(--se-font-mono);
    color: var(--se-text-secondary);
  }
  .caption {
    position: absolute;
    top: 9px;
    left: 12px;
    letter-spacing: 0.02em;
  }
  .legend {
    position: absolute;
    right: 12px;
    bottom: 9px;
    display: flex;
    align-items: center;
    gap: 0;
  }
  .legend small {
    padding: 0 5px;
  }
  .legend i {
    width: 10px;
    height: 7px;
  }
  .body {
    padding: 22px 24px;
  }
  .title {
    margin: 0;
    font: 600 17px var(--se-font-ui);
    letter-spacing: -0.01em;
    color: var(--se-text-primary);
  }
  .sub {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--se-text-secondary);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }
  .actions button {
    flex: 1 1 auto;
    justify-content: center;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 16px;
    border-radius: var(--se-radius);
    font: 600 13px var(--se-font-ui);
    cursor: pointer;
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }
  .primary {
    border: 0;
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    box-shadow: var(--se-shadow-card);
  }
  .primary:hover {
    background: var(--se-button-hover);
  }
  .secondary {
    border: 1px solid var(--se-input-border);
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
  }
  .secondary:hover {
    border-color: var(--se-accent);
    background: var(--se-control-hover);
  }
  .sample {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.15;
  }
  .sample {
    white-space: nowrap;
  }
  .sample small {
    font: 500 10px var(--se-font-mono);
    color: var(--se-text-secondary);
  }
  button:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 2px;
  }
  .formats {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--se-border);
  }
  .label {
    flex: none;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .formats ul {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .formats li {
    padding: 1px 7px;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-base);
    color: var(--se-text-secondary);
    font: 500 10.5px var(--se-font-mono);
  }
  .footnote {
    margin: 12px 0 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--se-text-muted);
  }
  .share-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px;
    padding: 8px 12px;
    border: 1px solid var(--se-info);
    border-radius: var(--se-radius);
    background: color-mix(in srgb, var(--se-info) 10%, var(--se-bg-base));
    color: var(--se-text-primary);
    font-size: 12.5px;
  }

  /* Capabilities, each shown in the viewer's own visual language. */
  .features {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .features article {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 14px 12px;
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    background: color-mix(in srgb, var(--se-bg-elevated) 94%, transparent);
  }
  .features header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font: 600 13px var(--se-font-ui);
    color: var(--se-text-primary);
  }
  .num {
    font: 600 10px var(--se-font-mono);
    color: var(--se-brand-text);
  }
  .features p {
    flex: 1;
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--se-text-secondary);
  }
  .demo {
    margin-top: 4px;
    font: 500 10.5px var(--se-font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .demo.chip {
    display: flex;
    gap: 0;
    padding: 4px 0;
    color: var(--se-text-secondary);
  }
  .demo.chip > * {
    padding: 0 8px;
    border-left: 1px solid var(--se-border);
  }
  .demo.chip > :first-child {
    padding-left: 0;
    border-left: 0;
  }
  .demo.chip b {
    font-weight: 600;
    color: var(--se-brand-text);
  }
  .demo.sql {
    padding: 4px 8px;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-sql-bg);
    color: var(--se-sql-fg);
  }
  .sql .k {
    color: var(--se-sql-keyword);
    font-weight: 600;
  }
  .sql .fn {
    color: var(--se-sql-function);
  }
  .demo.ramp {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--se-text-secondary);
  }
  .bar {
    display: flex;
    flex: 1;
    max-width: 140px;
    height: 10px;
    overflow: hidden;
    border-radius: 2px;
  }
  .bar i {
    flex: 1;
  }

  /* --- Status strip: the map's status bar -------------------------------- */
  .strip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: 26px;
    padding: 0 14px;
    background: var(--se-statusbar-bg);
    border-top: 1px solid var(--se-statusbar-border);
    color: var(--se-statusbar-fg);
    font: 500 11px var(--se-font-mono);
    white-space: nowrap;
  }
  .engine {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.6;
  }
  .engine.warming .dot {
    background: var(--se-statusbar-accent);
    opacity: 1;
    animation: blink 1s ease-in-out infinite;
  }
  .engine.ready .dot {
    background: #4ade80;
    opacity: 1;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .sep {
    width: 1px;
    height: 12px;
    background: var(--se-statusbar-border);
  }
  .grow {
    flex: 1;
  }
  .coords {
    color: var(--se-statusbar-accent);
    font-variant-numeric: tabular-nums;
  }

  /* Entrance: content settles in once, as the map draws in. */
  .hero,
  .drop-card,
  .features article {
    animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .drop-card {
    animation-delay: 60ms;
  }
  .features article:nth-child(1) {
    animation-delay: 140ms;
  }
  .features article:nth-child(2) {
    animation-delay: 190ms;
  }
  .features article:nth-child(3) {
    animation-delay: 240ms;
  }
  .features article:nth-child(4) {
    animation-delay: 290ms;
  }
  /* Motion only, no fade: text is at full contrast from the first frame. */
  @keyframes rise {
    from {
      transform: translateY(10px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .landing * {
      animation: none !important;
      transition: none !important;
    }
    .drop-card.drag-over {
      transform: none;
    }
  }

  /* --- Narrow windows: one column, the action first after the headline --- */
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'hero' 'card' 'features';
      align-content: start;
      padding: 40px 24px 32px;
    }
    .hero {
      align-self: start;
    }
  }
  @media (max-width: 560px) {
    .layout {
      padding: 28px 16px;
    }
    .features {
      grid-template-columns: minmax(0, 1fr);
    }
    .ticks,
    .neatline {
      display: none;
    }
    .body {
      padding: 18px;
    }
    .actions button {
      flex: 1 1 100%;
    }
    .private,
    .sep,
    .coords {
      display: none;
    }
  }
</style>
