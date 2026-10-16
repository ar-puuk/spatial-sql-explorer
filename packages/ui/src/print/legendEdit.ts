// Spec 016: the legend as the page shows it: the map's legend with the composer's edits applied (GeoLibre's legend
// editor: rename a class, hide it, move it up or down, retitle the legend). Pure, so it is easy to test. A class is
// keyed by its group and its label on the map, which an edit never changes.
import type { LegendGroup, LegendSpec } from '../mapImage.js'

export interface LegendEdits {
  /** The legend's own title, or null for the map's. */
  title: string | null
  /** By `${group}:${original label}`. */
  rows: Record<string, { label?: string; hidden?: boolean }>
  /** A group's classes in the order the user set, by original label. */
  order: Record<number, string[]>
}

export const NO_LEGEND_EDITS: LegendEdits = { title: null, rows: {}, order: {} }

export interface LegendEditorRow {
  key: string
  group: number
  /** The group's title: the row sits under it. */
  groupTitle: string
  original: string
  label: string
  color: string
  hidden: boolean
  first: boolean
  last: boolean
}

const keyOf = (group: number, label: string): string => `${group}:${label}`

/** The legend's groups: the first is the spec itself. */
const groupsOf = (spec: LegendSpec): LegendGroup[] => [spec, ...(spec.groups ?? [])]

/** A group's class labels in the user's order: those set first, the rest in the map's order. */
function ordered(group: LegendGroup, index: number, edits: LegendEdits): LegendGroup['rows'] {
  const wanted = edits.order[index]
  if (!wanted?.length) return group.rows
  const rank = new Map(wanted.map((label, i) => [label, i]))
  return [...group.rows].sort((a, b) => (rank.get(a.label) ?? 1e9) - (rank.get(b.label) ?? 1e9))
}

/** What the editor lists: every class of every group (a bivariate square, a ramp or a heatmap has none to edit). */
export function legendEditorRows(spec: LegendSpec | null, edits: LegendEdits): LegendEditorRow[] {
  if (!spec) return []
  const out: LegendEditorRow[] = []
  groupsOf(spec).forEach((g, gi) => {
    const rows = ordered(g, gi, edits)
    rows.forEach((r, i) => {
      const e = edits.rows[keyOf(gi, r.label)]
      out.push({ key: keyOf(gi, r.label), group: gi, groupTitle: g.title, original: r.label, label: e?.label ?? r.label, color: r.color, hidden: !!e?.hidden, first: i === 0, last: i === rows.length - 1 })
    })
  })
  return out
}

/** The legend with the edits applied: renamed, reordered, hidden classes left out, and the title. */
export function applyLegendEdits(spec: LegendSpec | null, edits: LegendEdits): LegendSpec | null {
  if (!spec) return null
  const edited = (g: LegendGroup, gi: number): LegendGroup => ({
    ...g,
    rows: ordered(g, gi, edits)
      .filter((r) => !edits.rows[keyOf(gi, r.label)]?.hidden)
      .map((r) => {
        const label = edits.rows[keyOf(gi, r.label)]?.label
        return label === undefined ? r : { ...r, label }
      }),
  })
  const [first, ...rest] = groupsOf(spec).map(edited)
  return { ...spec, ...first, title: edits.title ?? spec.title, groups: spec.groups ? rest : undefined }
}

/** The edits with one class renamed or hidden. A label put back to the map's own is no edit. */
export function editRow(edits: LegendEdits, key: string, original: string, patch: { label?: string; hidden?: boolean }): LegendEdits {
  const next = { ...edits.rows[key], ...patch }
  if (next.label === original || next.label === undefined) delete next.label
  if (!next.hidden) delete next.hidden
  const rows = { ...edits.rows }
  if (next.label === undefined && next.hidden === undefined) delete rows[key]
  else rows[key] = next
  return { ...edits, rows }
}

/** The edits with a class moved one place up (-1) or down (1) within its group. */
export function moveRow(spec: LegendSpec | null, edits: LegendEdits, group: number, original: string, direction: -1 | 1): LegendEdits {
  if (!spec) return edits
  const g = groupsOf(spec)[group]
  if (!g) return edits
  const labels = ordered(g, group, edits).map((r) => r.label)
  const from = labels.indexOf(original)
  const to = from + direction
  if (from < 0 || to < 0 || to >= labels.length) return edits
  ;[labels[from], labels[to]] = [labels[to], labels[from]]
  return { ...edits, order: { ...edits.order, [group]: labels } }
}
