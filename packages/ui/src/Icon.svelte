<script lang="ts" module>
  // A small inline 16px icon set drawn in the same stroked style as VS Code's
  // codicons, so the controls read as native without shipping the codicon
  // font (which would need its own CSP font-src entry and license notice).
  // `currentColor` keeps every icon on the active theme's foreground token.
  export type IconName =
    | 'plus'
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
    | 'check'
    | 'list'

  const PATHS: Record<IconName, string> = {
    plus: 'M8 3.5v9M3.5 8h9',
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
    check: 'M3 8.5l3 3 7-7',
    list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5',
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
