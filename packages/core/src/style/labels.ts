// Spec 011 US6: labels. The text comes from a column or a SQL expression the
// engine computes (LABEL_COLUMN), drawn with the system's sans-serif font (no
// glyph download: research §3), never overlapping.

export type LabelAnchor = 'above' | 'below' | 'left' | 'right' | 'center'

export type LabelPlacement =
  /** Points: where the text sits around the point, `offset` px away. */
  | { kind: 'point'; anchor: LabelAnchor; offset: number }
  /** Lines: along the line. */
  | { kind: 'line' }
  /** Polygons: inside, at the label point. */
  | { kind: 'polygon' }

export interface LabelSettings {
  enabled: boolean
  source: { kind: 'column'; column: string } | { kind: 'expression'; expression: string }
  /** px */
  size: number
  /** `#rrggbb` */
  color: string
  halo: { enabled: boolean; color: string; width: number }
  placement: LabelPlacement
}
