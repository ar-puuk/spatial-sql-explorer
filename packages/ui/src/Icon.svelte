<script lang="ts" module>
  // The icon set is Lucide (ISC, https://lucide.dev), one inline SVG per icon, imported one by one so unused icons
  // are never bundled. Our names stay the call sites' vocabulary; this file maps each to a Lucide icon. `currentColor`
  // keeps every icon on the active theme's foreground token. No icon font, so no CSP font-src entry.
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'
  import Blend from '@lucide/svelte/icons/blend'
  import Box from '@lucide/svelte/icons/box'
  import Bubbles from '@lucide/svelte/icons/bubbles'
  import ChartNoAxesColumn from '@lucide/svelte/icons/chart-no-axes-column'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Circle from '@lucide/svelte/icons/circle'
  import CircleX from '@lucide/svelte/icons/circle-x'
  import BrushCleaning from '@lucide/svelte/icons/brush-cleaning'
  import Navigation2 from '@lucide/svelte/icons/navigation-2'
  import Columns3 from '@lucide/svelte/icons/columns-3'
  import Copy from '@lucide/svelte/icons/copy'
  import Download from '@lucide/svelte/icons/download'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import File from '@lucide/svelte/icons/file'
  import Flame from '@lucide/svelte/icons/flame'
  import Funnel from '@lucide/svelte/icons/funnel'
  import Globe from '@lucide/svelte/icons/globe'
  import ChartScatter from '@lucide/svelte/icons/chart-scatter'
  import Library from '@lucide/svelte/icons/library'
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3'
  import Hexagon from '@lucide/svelte/icons/hexagon'
  import Image from '@lucide/svelte/icons/image'
  import Printer from '@lucide/svelte/icons/printer'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Info from '@lucide/svelte/icons/info'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import Layers from '@lucide/svelte/icons/layers'
  import Link from '@lucide/svelte/icons/link'
  import List from '@lucide/svelte/icons/list'
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import MapIcon from '@lucide/svelte/icons/map'
  import MapPin from '@lucide/svelte/icons/map-pin'
  import Maximize2 from '@lucide/svelte/icons/maximize-2'
  import Minimize2 from '@lucide/svelte/icons/minimize-2'
  import Minus from '@lucide/svelte/icons/minus'
  import Monitor from '@lucide/svelte/icons/monitor'
  import Moon from '@lucide/svelte/icons/moon'
  import MountainSnow from '@lucide/svelte/icons/mountain-snow'
  import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2'
  import Paintbrush from '@lucide/svelte/icons/paintbrush'
  import Palette from '@lucide/svelte/icons/palette'
  import Pencil from '@lucide/svelte/icons/pencil'
  import PencilLine from '@lucide/svelte/icons/pencil-line'
  import PenTool from '@lucide/svelte/icons/pen-tool'
  import Pentagon from '@lucide/svelte/icons/pentagon'
  import Pipette from '@lucide/svelte/icons/pipette'
  import Plus from '@lucide/svelte/icons/plus'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import RotateCcwClock from '@lucide/svelte/icons/rotate-ccw-clock'
  import RulerDimensionLine from '@lucide/svelte/icons/ruler-dimension-line'
  import Redo2 from '@lucide/svelte/icons/redo-2'
  import Save from '@lucide/svelte/icons/save'
  import Scan from '@lucide/svelte/icons/scan'
  import Search from '@lucide/svelte/icons/search'
  import TextSearch from '@lucide/svelte/icons/text-search'
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import CalendarRange from '@lucide/svelte/icons/calendar-range'
  import Shapes from '@lucide/svelte/icons/shapes'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import Spline from '@lucide/svelte/icons/spline'
  import Square from '@lucide/svelte/icons/square'
  import SquareDashedMousePointer from '@lucide/svelte/icons/square-dashed-mouse-pointer'
  import Sun from '@lucide/svelte/icons/sun'
  import Tag from '@lucide/svelte/icons/tag'
  import Trash from '@lucide/svelte/icons/trash'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import Undo2 from '@lucide/svelte/icons/undo-2'
  import Upload from '@lucide/svelte/icons/upload'
  import X from '@lucide/svelte/icons/x'

  const ICONS = {
    plus: Plus,
    key: KeyRound,
    minus: Minus,
    fit: Scan,
    paint: Paintbrush,
    'chevron-down': ChevronDown,
    'chevron-up': ChevronUp,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'arrow-up': ArrowUp,
    'arrow-down': ArrowDown,
    close: X,
    file: File,
    zoom: Search,
    warning: TriangleAlert,
    error: CircleX,
    info: Info,
    save: Save,
    export: Upload,
    import: Download,
    reset: RotateCcw,
    // Reset view: an arrow that points north (MapView turns it with the map's bearing).
    north: Navigation2,
    // Reset style: a brush sweeping the style clean (the round arrow stays for "back to the default" elsewhere).
    'reset-style': BrushCleaning,
    layers: Layers,
    map: MapIcon,
    check: Check,
    copy: Copy,
    list: List,
    history: RotateCcwClock,
    snippets: Library,
    eye: Eye,
    'eye-off': EyeOff,
    edit: Pencil,
    trash: Trash,
    swap: ArrowRightLeft,
    filter: Funnel,
    columns: Columns3,
    globe: Globe,
    grid: Hexagon,
    cube: Box,
    tag: Tag,
    image: Image,
    printer: Printer,
    refresh: RefreshCw,
    search: Search,
    textSearch: TextSearch,
    play: Play,
    pause: Pause,
    timeSlider: CalendarRange,
    dots: ChartScatter,
    link: Link,
    sun: Sun,
    moon: Moon,
    monitor: Monitor,
    maximize: Maximize2,
    restore: Minimize2,
    sliders: SlidersHorizontal,
    mountain: MountainSnow,
    draw: PenTool,
    ruler: RulerDimensionLine,
    'select-shape': SquareDashedMousePointer,
    'shape-point': MapPin,
    'shape-line': Spline,
    'shape-polygon': Pentagon,
    'shape-rect': Square,
    'shape-circle': Circle,
    'shape-freehand': PencilLine,
    pointer: MousePointer2,
    undo: Undo2,
    redo: Redo2,
    // The color styles (single, categorized, graduated, continuous, as is, bivariate, rules, heatmap, clusters).
    'style-single': Palette,
    'style-categorized': Shapes,
    'style-graduated': ChartNoAxesColumn,
    'style-continuous': Blend,
    pipette: Pipette,
    'style-identity': Pipette,
    'style-bivariate': Grid3x3,
    'style-rules': ListChecks,
    'style-heatmap': Flame,
    'style-clusters': Bubbles
  }

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  interface Props {
    name: IconName
    size?: number
    /** Degrees, clockwise (an arrow that follows the map's bearing). */
    rotate?: number
  }
  let { name, size = 16, rotate = 0 }: Props = $props()
  const Component = $derived(ICONS[name])
</script>

<Component class="icon" {size} strokeWidth={1.6} aria-hidden="true" focusable="false" style={rotate ? `transform: rotate(${rotate}deg)` : undefined} />

<style>
  :global(.icon) {
    display: block;
    flex-shrink: 0;
  }
</style>
