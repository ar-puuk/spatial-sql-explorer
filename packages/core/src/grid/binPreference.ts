// Spec 017: what the Bin into cells dialog remembers between sessions, through HostAdapter.saveState('binCells'):
// the grid system and the kind of measure last kept. Not the resolution (it follows the layer) and not the column
// (it belongs to a layer). Read defensively: a saved value from another version, or hand-edited, never breaks the dialog.
import type { BinMeasureKind } from './binSql.js'
import { getGridSystem, type GridSystemId } from './gridSystems.js'

export const BIN_PREFERENCE_KEY = 'binCells'

export interface BinPreference {
  system: GridSystemId
  measureKind: BinMeasureKind
}

export const DEFAULT_BIN_PREFERENCE: Readonly<BinPreference> = Object.freeze({ system: 'h3', measureKind: 'count' })

const MEASURE_KINDS: readonly BinMeasureKind[] = ['count', 'sum', 'avg', 'min', 'max', 'median']

/** The preference as saved, or the default for anything that is not one. */
export function normalizeBinPreference(raw: unknown): BinPreference {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BIN_PREFERENCE }
  const { system, measureKind } = raw as Record<string, unknown>
  return {
    system: typeof system === 'string' && getGridSystem(system) ? (system as GridSystemId) : DEFAULT_BIN_PREFERENCE.system,
    measureKind: typeof measureKind === 'string' && (MEASURE_KINDS as readonly string[]).includes(measureKind) ? (measureKind as BinMeasureKind) : DEFAULT_BIN_PREFERENCE.measureKind,
  }
}
