// Spec 014: the drawing tools, on Terra Draw (MIT) through its MapLibre adapter. Loaded on first use (its own
// chunk), so nothing is paid until a tool is opened. The controller keeps the finished shapes as WGS84
// GeoJSON (`DrawnShape`) and reports them; Terra Draw's own helper features (closing points, midpoints,
// coordinate points) never leave this file. Shapes are scratch geometry for queries, never edits to the data.
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { DrawnShape, ShapeKind, ShapePurpose } from '@spatial-explorer/core'

/** Terra Draw's color type. */
type Hex = `#${string}`
const WHITE: Hex = '#ffffff'

/** A drawing tool; `edit` selects a shape to move it, reshape it or delete it. */
export type DrawTool = ShapeKind | 'edit'

export interface DrawColors {
  /** Outline and line color, #rrggbb. */
  stroke: Hex
  /** Fill color, #rrggbb (drawn at low opacity). */
  fill: Hex
  /** The selected shape, #rrggbb. */
  active: Hex
}

export interface DrawHandlers {
  /** The finished shapes changed (drawn, edited, deleted). */
  onShapes: (shapes: DrawnShape[]) => void
  /** A shape was just drawn (not edited). */
  onFinish: (shape: DrawnShape) => void
  /** The shape being drawn right now (for its live measurement), or null. */
  onProgress: (geometry: DrawnShape['geometry'] | null) => void
  /** The shape selected in edit mode, or null. */
  onSelect: (id: string | null) => void
}

export interface DrawController {
  setTool(tool: DrawTool | null, purpose: ShapePurpose): void
  shapes(): DrawnShape[]
  /** Adds shapes back (after the controller was rebuilt for a new theme). */
  load(shapes: readonly DrawnShape[]): void
  remove(ids: readonly string[]): void
  clear(): void
  /** Deletes the shape selected in edit mode. */
  deleteSelected(): void
  undo(): void
  destroy(): void
}

const MODE_OF_TOOL: Record<Exclude<DrawTool, 'edit'>, string> = { point: 'point', line: 'linestring', polygon: 'polygon', rectangle: 'rectangle', circle: 'circle', freehand: 'freehand' }
const KIND_OF_MODE: Record<string, ShapeKind> = { point: 'point', linestring: 'line', polygon: 'polygon', rectangle: 'rectangle', circle: 'circle', freehand: 'freehand' }

type Geometry = DrawnShape['geometry']
const isShapeGeometry = (g: { type: string }): g is Geometry => g.type === 'Point' || g.type === 'LineString' || g.type === 'Polygon'

export async function createDrawController(map: MapLibreMap, colors: DrawColors, handlers: DrawHandlers): Promise<DrawController> {
  const [td, { TerraDrawMapLibreGLAdapter }] = await Promise.all([import('terra-draw'), import('terra-draw-maplibre-gl-adapter')])

  const { stroke, fill, active } = colors
  const common = { outlineColor: stroke, outlineWidth: 2, fillColor: fill, fillOpacity: 0.18 } as const
  const polygonStyles = { ...common, closingPointColor: WHITE, closingPointOutlineColor: stroke, closingPointWidth: 6, closingPointOutlineWidth: 2, coordinatePointColor: stroke, coordinatePointOutlineColor: WHITE } as const
  const selectedFlags = { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } }
  const wholeFlags = { feature: { draggable: true } }

  const draw = new td.TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new td.TerraDrawPointMode({ styles: { pointColor: stroke, pointOutlineColor: WHITE, pointWidth: 7, pointOutlineWidth: 2 } }),
      new td.TerraDrawLineStringMode({ styles: { lineStringColor: stroke, lineStringWidth: 3, closingPointColor: WHITE, closingPointOutlineColor: stroke, closingPointWidth: 6, closingPointOutlineWidth: 2 } }),
      new td.TerraDrawPolygonMode({ styles: polygonStyles }),
      new td.TerraDrawRectangleMode({ styles: common }),
      new td.TerraDrawCircleMode({ styles: common }),
      new td.TerraDrawFreehandMode({ styles: { ...common, closingPointColor: WHITE, closingPointOutlineColor: stroke } }),
      new td.TerraDrawSelectMode({
        flags: { point: wholeFlags, linestring: selectedFlags, polygon: selectedFlags, rectangle: wholeFlags, circle: wholeFlags, freehand: selectedFlags },
        styles: {
          selectedPointColor: active,
          selectedPointOutlineColor: WHITE,
          selectedLineStringColor: active,
          selectedPolygonColor: active,
          selectedPolygonOutlineColor: active,
          selectedPolygonFillOpacity: 0.25,
          selectionPointColor: WHITE,
          selectionPointOutlineColor: active,
          midPointColor: active,
          midPointOutlineColor: WHITE,
        },
      }),
    ],
  })

  let purpose: ShapePurpose = 'draw'
  // Finished shapes by Terra Draw's feature id.
  const finished = new Map<string, DrawnShape>()
  const emit = (): void => handlers.onShapes([...finished.values()])

  function shapeOf(id: string): DrawnShape | null {
    const f = draw.getSnapshotFeature(id)
    const mode = typeof f?.properties.mode === 'string' ? f.properties.mode : ''
    const kind = KIND_OF_MODE[mode]
    if (!f || !kind || !isShapeGeometry(f.geometry)) return null
    // A copy: the store's geometry is Terra Draw's, which keeps mutating its own.
    return { id, kind, purpose: finished.get(id)?.purpose ?? purpose, geometry: JSON.parse(JSON.stringify(f.geometry)) as Geometry }
  }

  draw.on('finish', (id, context) => {
    const key = String(id)
    const shape = shapeOf(key)
    if (!shape) return
    const isNew = !finished.has(key)
    finished.set(key, shape)
    handlers.onProgress(null)
    emit()
    if (isNew && context.action === 'draw') handlers.onFinish(shape)
  })

  draw.on('change', (ids, type) => {
    if (type === 'delete') {
      let changed = false
      for (const id of ids) if (finished.delete(String(id))) changed = true
      if (changed) emit()
      return
    }
    if (type !== 'create' && type !== 'update') return
    let edited = false
    for (const id of ids) {
      const key = String(id)
      const known = finished.get(key)
      if (known) {
        // An edit in progress (dragging a corner): keep the shape current.
        const next = shapeOf(key)
        if (next) {
          finished.set(key, next)
          edited = true
        }
        continue
      }
      const f = draw.getSnapshotFeature(key)
      // The shape being drawn: a line or polygon not finished yet (helper points are Points).
      if (f && typeof f.properties.mode === 'string' && f.properties.mode in KIND_OF_MODE && (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon')) {
        handlers.onProgress(JSON.parse(JSON.stringify(f.geometry)) as Geometry)
      }
    }
    if (edited) emit()
  })

  draw.on('select', (id) => handlers.onSelect(String(id)))
  draw.on('deselect', () => handlers.onSelect(null))

  draw.start()
  draw.setMode('static')

  return {
    setTool(tool, p) {
      purpose = p
      handlers.onProgress(null)
      draw.setMode(tool === null ? 'static' : tool === 'edit' ? 'select' : MODE_OF_TOOL[tool])
    },
    shapes: () => [...finished.values()],
    load(shapes) {
      draw.addFeatures(shapes.map((s) => ({ id: s.id, type: 'Feature' as const, geometry: s.geometry, properties: { mode: MODE_OF_TOOL[s.kind === 'line' ? 'line' : s.kind] } })))
      for (const s of shapes) finished.set(s.id, s)
    },
    remove(ids) {
      const present = ids.filter((id) => draw.hasFeature(id))
      if (present.length) draw.removeFeatures(present)
    },
    clear() {
      draw.clear()
      finished.clear()
      handlers.onProgress(null)
      emit()
    },
    deleteSelected() {
      const selected = draw.getSnapshot().find((f) => f.properties.selected === true && typeof f.properties.mode === 'string' && f.properties.mode in KIND_OF_MODE && isShapeGeometry(f.geometry))
      if (selected && selected.id !== undefined) draw.removeFeatures([selected.id])
    },
    undo() {
      if (draw.canUndo()) draw.undo()
    },
    destroy() {
      try {
        draw.stop()
      } catch {
        // The map may be gone already.
      }
    },
  }
}

/** The draw colors from the theme's tokens (canvas colors do not follow CSS variables: read them, re-read on a theme change). */
export function readDrawColors(el: HTMLElement): DrawColors {
  const css = getComputedStyle(el)
  const token = (name: string, fallback: Hex): Hex => hex(css.getPropertyValue(name).trim(), fallback)
  return { stroke: token('--se-info', '#2563eb'), fill: token('--se-info', '#2563eb'), active: token('--se-focus', '#f59e0b') }
}

/** #rgb, #rrggbb or rgb()/rgba() as #rrggbb; the fallback for anything else (a var() chain, a named color). */
function hex(value: string, fallback: Hex): Hex {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value as Hex
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value)
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
  return fallback
}
