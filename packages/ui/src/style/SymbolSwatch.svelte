<script lang="ts">
  // A class's symbol as it is drawn on the map (core `SymbolSpec`): the
  // marker shape and size, the line width and pattern, or the polygon fill
  // and outline. Used by the legend, the class list and the shape picker.
  // Data colors are fixed (CLAUDE.md "Theming"); only a hidden class falls
  // back to a hollow outline.
  import { dashPattern, markerExtent, markerPath, type SymbolSpec } from '@spatial-explorer/core'

  interface Props {
    symbol: SymbolSpec
    kind: 'area' | 'line' | 'point'
    /** Drawn hollow (a hidden class). */
    hollow?: boolean
    /** Marker radii are multiplied by this (the legend shrinks big size classes to fit). */
    scale?: number
    /** The box: markers are centered in it; lines and areas fill it. */
    size?: number
  }
  let { symbol, kind, hollow = false, scale = 1, size = 16 }: Props = $props()

  const c = $derived(size / 2)
  // Lines: thick enough to see, thin enough to fit; the dash follows the shown width.
  const lineWidth = $derived(Math.min(Math.max(symbol.lineWidth, 1), size / 2))
  const lineDash = $derived(dashPattern(symbol.dash)?.map((n) => n * lineWidth).join(' '))
  const outline = $derived(Math.min(symbol.strokeWidth, 3))
  const outlineDash = $derived(dashPattern(symbol.dash)?.map((n) => n * Math.max(outline, 1)).join(' '))
  const radius = $derived(Math.max(1.5, Math.min(symbol.radius * scale, (size / 2 - outline / 2) / markerExtent(symbol.shape))))
</script>

<svg class="symbol" width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
  {#if kind === 'line'}
    <line
      x1="1"
      y1={c}
      x2={size - 1}
      y2={c}
      stroke={symbol.lineColor}
      stroke-opacity={hollow ? 0.4 : Math.max(symbol.strokeOpacity, 0.2)}
      stroke-width={lineWidth}
      stroke-dasharray={lineDash}
      stroke-linecap="butt"
    />
  {:else if kind === 'point'}
    <path
      d={markerPath(symbol.shape, radius, c, c)}
      transform={symbol.rotation ? `rotate(${symbol.rotation} ${c} ${c})` : undefined}
      fill={hollow ? 'none' : symbol.fillColor}
      fill-opacity={Math.max(symbol.fillOpacity * (symbol.opacity ?? 1), 0.15)}
      stroke={hollow ? symbol.fillColor : symbol.strokeColor}
      stroke-opacity={hollow ? 1 : symbol.strokeOpacity * (symbol.opacity ?? 1)}
      stroke-width={hollow ? 1.5 : outline}
      stroke-linejoin="miter"
    />
  {:else}
    <rect
      x={1 + outline / 2}
      y={1 + outline / 2}
      width={size - 2 - outline}
      height={size - 2 - outline}
      rx="2"
      fill={hollow ? 'none' : symbol.fillColor}
      fill-opacity={Math.max(symbol.fillOpacity, 0.15)}
      stroke={hollow ? symbol.fillColor : symbol.strokeColor}
      stroke-opacity={hollow ? 1 : symbol.strokeOpacity}
      stroke-width={hollow ? 1.5 : outline}
      stroke-dasharray={hollow ? undefined : outlineDash}
    />
  {/if}
</svg>

<style>
  .symbol {
    display: block;
    flex: none;
    overflow: visible;
  }
</style>
