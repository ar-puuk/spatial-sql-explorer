<script lang="ts" module>
  // Fixed data colors (theme-independent, like every data ramp): the "tide" ramp, pale to deep blue-teal, the same seven
  // steps the hexagon map (src/landing/world-population.svg, scripts/landing-world.mjs) is drawn in.
  const TIDE = ['#d9e9ef', '#a9cfdb', '#74b0c4', '#3f8fa8', '#26708b', '#1b5470', '#123b52']
  const FORMATS = ['GeoPackage', 'SQLite', 'Shapefile', 'GeoParquet', 'FlatGeobuf', 'GeoJSON', 'CSV', 'Excel', 'GML', 'PMTiles']
</script>

<script lang="ts">
  // The web app's empty state (no file open). One memorable thing: a short demo of the whole idea, a query typed
  // and a map colored by it, played once (still, when the person prefers reduced motion). Everything is drawn
  // locally: no network and no map engine before a file is chosen. VS Code never renders this.
  import { Icon } from '@spatial-explorer/ui'
  // Inline, so each class of hexagons can be colored on its own as the query "runs" (an <img> cannot be animated inside).
  import worldSvg from './landing/world-population.svg?raw'

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
</script>

<div class="landing" class:drag-over={isDragOver}>
  <div class="scroll">
    <div class="layout">
      <section class="copy" aria-labelledby="landing-title">
        <h2 id="landing-title"><span class="open">Open a map file.</span> <span class="query">Query it like a database.</span></h2>
        <p class="lede">
          Look at your data on a map, ask it questions in SQL, style the answer and export it. Nothing to install. Your files never leave this tab.
        </p>
        {#if sharedFileName}
          <p class="share" role="status">
            <Icon name="link" size={14} />
            <span>This link shows a view of <strong>{sharedFileName}</strong>. Open that file to see it.</span>
          </p>
        {/if}
        <div class="actions">
          <button type="button" class="primary" bind:this={chooseButton} onclick={onChoose}><Icon name="import" size={16} />Choose a file</button>
          <button type="button" class="secondary" onclick={onSample}>Try sample data <small>US counties</small></button>
        </div>
        <p class="drop" aria-live="polite">{isDragOver ? 'Release to open' : 'Drag a geospatial file here'}, anywhere on this page.</p>
        <div class="formats">
          <span class="formats-label">Opens</span>
          <ul aria-label="Supported formats">
            {#each FORMATS as f (f)}<li>{f}</li>{/each}
          </ul>
        </div>
        <p class="fine">For a Shapefile, select the .shp with its .shx, .dbf and .prj. A .qml with the same name brings its QGIS style.</p>
      </section>

      <section class="demo" aria-label="A query coloring a map of the world">
        <div class="titlebar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="name">world_countries.parquet</span></div>
        <div class="sql" aria-hidden="true">
          <div class="row" style="--n: 34; --at: 0.4s"><span class="line"><span class="k">SELECT</span> name, pop / area <span class="k">AS</span> density</span><i class="caret"></i></div>
          <div class="row" style="--n: 20; --at: 1.5s"><span class="line"><span class="k">FROM</span> world_countries</span><i class="caret"></i></div>
          <div class="row last" style="--n: 21; --at: 2.2s"><span class="line"><span class="k">ORDER BY</span> density <span class="k">DESC</span></span><i class="caret"></i></div>
        </div>
        <div class="map" aria-hidden="true">
          <!-- A static SVG that ships with the app (src/landing), never user input. -->
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="world">{@html worldSvg}</div>
          <span class="key"><span class="ramp">{#each TIDE as c (c)}<i style="background: {c}"></i>{/each}</span>density</span>
        </div>
      </section>
    </div>
  </div>

  <footer class="strip">
    <span class="engine {engine}">
      <span class="dot" aria-hidden="true"></span>
      {engine === 'ready' ? 'SQL engine ready' : engine === 'warming' ? 'SQL engine starting…' : 'SQL engine starts when a file opens'}
    </span>
    <span>Files are read in your browser and never uploaded.</span>
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
  .landing.drag-over::after {
    content: '';
    position: absolute;
    inset: 10px;
    border: 2px dashed var(--se-accent);
    border-radius: var(--se-radius-lg);
    background: color-mix(in srgb, var(--se-dropzone-active-bg) 55%, transparent);
    pointer-events: none;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: clamp(28px, 5vw, 72px);
    align-items: center;
    max-width: 1180px;
    min-height: 100%;
    margin: 0 auto;
    padding: clamp(24px, 6vh, 64px) clamp(20px, 4vw, 48px);
    box-sizing: border-box;
  }

  /* --- Copy --------------------------------------------------------------- */
  /* The headline is two sentences: the instruction in ink, the promise in the secondary color. Type is the design. */
  h2 {
    margin: 0 0 20px;
    max-width: 13ch;
    font-size: clamp(38px, 5.4vw, 66px);
    font-weight: 600;
    line-height: 1.02;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }
  h2 .open {
    display: block;
    color: var(--se-text-primary);
  }
  h2 .query {
    display: block;
    color: var(--se-text-secondary);
    font-weight: 500;
  }
  .lede {
    margin: 0 0 28px;
    max-width: 40ch;
    font-size: 17px;
    line-height: 1.55;
    letter-spacing: -0.005em;
    color: var(--se-text-secondary);
    text-wrap: pretty;
  }
  .share {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px;
    padding: 6px 10px;
    max-width: 46ch;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius);
    background: var(--se-bg-panel);
    color: var(--se-text-primary);
    font-size: 12.5px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: var(--se-radius-sm);
    font: 500 14px var(--se-font-ui);
    cursor: pointer;
    transition: background-color 120ms var(--se-ease), filter 120ms var(--se-ease);
  }
  .actions small {
    font-size: 12px;
    font-weight: 400;
    color: var(--se-text-secondary);
  }
  .primary {
    border: 1px solid transparent;
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font-weight: 600;
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
    background: var(--se-bg-hover);
  }
  .actions button:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 2px;
  }
  .drop {
    margin: 18px 0 20px;
    font-size: 13px;
    color: var(--se-text-secondary);
  }
  .formats {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin: 0 0 8px;
    max-width: 56ch;
  }
  .formats-label {
    flex: none;
    font-size: 12.5px;
    color: var(--se-text-secondary);
  }
  .formats ul {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin: 0;
    padding: 0;
    list-style: none;
    font: 12px/1.7 var(--se-font-mono);
    color: var(--se-text-primary);
  }
  .fine {
    margin: 0;
    max-width: 52ch;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--se-text-secondary);
  }

  /* --- The demo: a query is typed, the map under it colors in, once ---------- */
  .demo {
    overflow: hidden;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-lg);
    box-shadow: var(--se-shadow-elevated);
  }
  .titlebar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 12px;
    background: var(--se-bg-panel);
    border-bottom: 1px solid var(--se-border);
    color: var(--se-text-secondary);
    font-size: 12px;
  }
  .dots {
    display: flex;
    gap: 5px;
  }
  .dots i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--se-input-border);
  }
  .sql {
    margin: 0;
    min-height: 84px;
    padding: 12px 14px;
    box-sizing: content-box;
    border-bottom: 1px solid var(--se-border);
    color: var(--se-text-primary);
    font: 12.5px/1.65 var(--se-font-mono);
  }
  .k {
    color: var(--se-sql-keyword);
    font-weight: 500;
  }
  /* Typed one line after another: each line opens to its own width (in characters), and the caret sits right behind
     the last typed character, then rests behind DESC. */
  .row {
    display: flex;
    align-items: center;
    height: 1.65em;
  }
  .line {
    display: block;
    width: calc(var(--n) * 1ch);
    overflow: hidden;
    white-space: pre;
    animation: type calc(var(--n) * 30ms) steps(var(--n), end) var(--at) both;
  }
  .caret {
    flex: none;
    width: 1ch;
    height: 1.2em;
    background: var(--se-accent);
    opacity: 0;
    animation: caret-on calc(var(--n) * 30ms + 0.05s) steps(1, end) var(--at) forwards;
  }
  .row.last .caret {
    animation: caret-show 0.01s linear var(--at) forwards, blink 1s steps(2) calc(var(--at) + var(--n) * 30ms) infinite;
  }
  .map {
    position: relative;
    height: clamp(220px, 36vh, 320px);
    background: var(--se-map-bg);
  }
  /* The world, one hexagon per 450 km. The hexagons start alike; when the query has been typed each class takes its own
     color, the light ones first and the densest last (the SVG's paths are the classes, in ramp order). */
  .world {
    position: absolute;
    inset: 0;
    padding: 10px 14px 34px;
    box-sizing: border-box;
  }
  .world :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .world :global(path) {
    animation: shade 0.8s ease-out calc(3.2s + var(--k, 0) * 0.16s) both;
  }
  .world :global(path:nth-child(2)) {
    --k: 1;
  }
  .world :global(path:nth-child(3)) {
    --k: 2;
  }
  .world :global(path:nth-child(4)) {
    --k: 3;
  }
  .world :global(path:nth-child(5)) {
    --k: 4;
  }
  .world :global(path:nth-child(6)) {
    --k: 5;
  }
  .world :global(path:nth-child(7)) {
    --k: 6;
  }
  .key {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-control-bg);
    color: var(--se-text-secondary);
    font-size: 11.5px;
  }
  .ramp {
    display: flex;
  }
  .ramp i {
    width: 16px;
    height: 8px;
  }
  @keyframes type {
    from {
      width: 0;
    }
  }
  @keyframes caret-on {
    0%,
    99% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes caret-show {
    to {
      opacity: 1;
    }
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  /* From one blank color to the path's own (its fill attribute). */
  @keyframes shade {
    from {
      fill: var(--se-input-border);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line,
    .world :global(path),
    .caret {
      animation: none;
    }
    .row.last .caret {
      opacity: 1;
    }
  }

  /* --- Status line ----------------------------------------------------------- */
  .strip {
    display: flex;
    flex: none;
    align-items: center;
    height: 26px;
    background: var(--se-statusbar-bg);
    border-top: 1px solid var(--se-statusbar-border);
    color: var(--se-statusbar-fg);
    font-size: 12px;
  }
  .strip > span {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 100%;
    padding: 0 12px;
  }
  .strip > span + span {
    box-shadow: -1px 0 0 var(--se-statusbar-border);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--se-text-muted);
  }
  .engine.ready .dot {
    background: #2f9e6f;
  }
  .engine.failed .dot {
    background: var(--se-error);
  }

  @media (max-width: 820px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
  }
</style>
