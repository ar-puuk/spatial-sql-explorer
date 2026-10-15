<script lang="ts" module>
  // A small inline 16px icon set drawn in the same stroked style as VS Code's
  // codicons, so the controls read as native without shipping the codicon
  // font (which would need its own CSP font-src entry and license notice).
  // `currentColor` keeps every icon on the active theme's foreground token.
  export type IconName =
    | 'plus'
    | 'key'
    | 'minus'
    | 'fit'
    | 'paint'
    | 'chevron-down'
    | 'chevron-up'
    | 'arrow-up'
    | 'arrow-down'
    | 'close'
    | 'file'
    | 'zoom'
    | 'warning'
    | 'error'
    | 'info'
    | 'save'
    | 'export'
    | 'import'
    | 'reset'
    | 'layers'
    | 'map'
    | 'check'
    | 'copy'
    | 'list'
    | 'history'
    | 'eye'
    | 'eye-off'
    | 'edit'
    | 'trash'
    | 'swap'
    | 'filter'
    | 'columns'
    | 'globe'
    | 'cube'
    | 'tag'
    | 'image'
    | 'search'
    | 'link'
    | 'sun'
    | 'moon'
    | 'monitor'
    | 'maximize'
    | 'restore'
    | 'sliders'

  const PATHS: Record<IconName, string> = {
    plus: 'M8 3.5v9M3.5 8h9',
    maximize: 'M3 3.5h10v9H3z',
    restore: 'M5 5.5h8v7H5zM3 10.5V3.5h8',
    minus: 'M3.5 8h9',
    fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10M5.5 5.5h5v5h-5z',
    paint: 'M10.5 2.5l3 3-6.25 6.25-3-3zM4.25 8.75L2.5 13.5l4.75-1.75',
    'chevron-down': 'M4 6l4 4 4-4',
    'chevron-up': 'M4 10l4-4 4 4',
    'arrow-up': 'M8 13V3M4.5 6.5L8 3l3.5 3.5',
    'arrow-down': 'M8 3v10M4.5 9.5L8 13l3.5-3.5',
    close: 'M4 4l8 8M12 4l-8 8',
    file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
    zoom: 'M7 2.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9zM10.25 10.25L13.5 13.5',
    warning: 'M8 2l6.5 11.5h-13zM8 6.5v3.25M8 11.5v.25',
    error: 'M8 1.75a6.25 6.25 0 110 12.5 6.25 6.25 0 010-12.5zM5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5',
    info: 'M8 1.75a6.25 6.25 0 110 12.5 6.25 6.25 0 010-12.5zM8 7v4.25M8 4.75V5',
    save: 'M2.5 2.5h9l2 2v9h-11zM5 2.5v3.5h5.5V2.5M5 13.5V9h6v4.5',
    export: 'M8 10V2M5 5l3-3 3 3M2.5 9v4.5h11V9',
    import: 'M8 2v8M5 7l3 3 3-3M2.5 9v4.5h11V9',
    reset: 'M3 8a5 5 0 105-5H5.5M5.5 1v2.5H8',
    layers: 'M8 2l6 3.25-6 3.25-6-3.25zM2 8.25l6 3.25 6-3.25M2 11.25l6 3.25 6-3.25',
    // The basemap: a folded paper map (Lucide's "map" shape, drawn on this 16 px grid).
    map: 'M2 4l4-2 4 2 4-2v10l-4 2-4-2-4 2zM6 2v10M10 4v10',
    check: 'M3 8.5l3 3 7-7',
    // Two overlapping sheets (Lucide's "copy" shape).
    copy: 'M6.5 5.5h6a1 1 0 011 1v6a1 1 0 01-1 1h-6a1 1 0 01-1-1v-6a1 1 0 011-1zM3.5 10.5a1 1 0 01-1-1v-6a1 1 0 011-1h6a1 1 0 011 1',
    list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5',
    history: 'M2.75 8a5.25 5.25 0 101.6-3.8M2.5 2.25V4.5h2.25M8 5v3.25l2.25 1.5',
    eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 110 4 2 2 0 010-4z',
    'eye-off': 'M2.5 2.5l11 11M6.6 6.65A2 2 0 009.35 9.4M4.2 4.75C2.5 6 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.3 0 2.45-.45 3.4-1.1M7 3.6c.33-.06.66-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.55 1-1.6 2.1',
    edit: 'M10.5 2.5l3 3-7.5 7.5H3v-3zM9 4l3 3',
    trash: 'M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.75 9h6.5l.75-9M6.75 7v4.25M9.25 7v4.25',
    swap: 'M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13',
    // Spec 008.
    filter: 'M2 3h12l-4.5 5.5V13l-3 1.25V8.5z',
    columns: 'M2.5 3h11v10h-11zM6.25 3v10M9.75 3v10',
    globe: 'M8 2a6 6 0 110 12A6 6 0 018 2zM2 8h12M8 2c-2.2 2.2-2.2 9.8 0 12M8 2c2.2 2.2 2.2 9.8 0 12',
    cube: 'M8 1.75l5.5 2.75v7L8 14.25 2.5 11.5v-7zM2.5 4.5L8 7.25l5.5-2.75M8 7.25v7',
    // Spec 011 US6: labels.
    tag: 'M2 2.5h5.25l6.75 6.75-4.75 4.75L2.5 7.25V2.5zM5 5.25v.25',
    image: 'M2 3h12v10H2zM2 11l3.5-3.5 3 3 2-2L14 12M10.5 5.5v.5',
    // A key: a round bow and a shaft with two teeth (needs an API key).
    key: 'M5.5 7a3 3 0 110 6 3 3 0 010-6zM7.6 7.9L13 2.5M11 4.5l1.5 1.5M9.5 6l1.25 1.25',
    search: 'M7 2.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9zM10.25 10.25L13.5 13.5',
    link: 'M6.75 9.25a2.75 2.75 0 003.9 0l2-2a2.75 2.75 0 00-3.9-3.9l-.75.75M9.25 6.75a2.75 2.75 0 00-3.9 0l-2 2a2.75 2.75 0 003.9 3.9l.75-.75',
    sun: 'M8 5a3 3 0 110 6 3 3 0 010-6zM8 1v1.75M8 13.25V15M1 8h1.75M13.25 8H15M3 3l1.25 1.25M11.75 11.75L13 13M3 13l1.25-1.25M11.75 4.25L13 3',
    moon: 'M13.25 9.5A5.5 5.5 0 016.5 2.75a5.5 5.5 0 106.75 6.75z',
    monitor: 'M2 2.5h12v8.5H2zM5.5 14h5M8 11v3',
    // Spec 014: two sliders (Map controls).
    sliders: 'M2.5 4.5h4.25M11.25 4.5h2.25M2.5 11.5h2.25M9.25 11.5h4.25M9 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM7 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  }
</script>

<script lang="ts">
  interface Props {
    name: IconName
    size?: number
  }
  let { name, size = 16 }: Props = $props()
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={PATHS[name]} />
</svg>

<style>
  .icon {
    display: block;
    flex-shrink: 0;
  }
</style>
