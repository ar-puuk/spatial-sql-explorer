// Per-file query history (spec 002 FR-016, SC-007; data-model.md
// QueryHistoryEntry). Stored through HostAdapter.loadState/saveState under
// `history.<stateKey>` (VS Code globalState, web localStorage), so it stays on
// the machine (FR-018) and survives closing and reopening the file.
import type { HostAdapter } from '../hostAdapter.js'
import type { QueryHistoryEntry } from '../models.js'
import type { RunOutcome } from './session.js'

export const HISTORY_LIMIT = 20

type StateStore = Pick<HostAdapter, 'loadState' | 'saveState'>

export const historyKey = (stateKey: string): string => `history.${stateKey}`

function isEntry(v: unknown): v is QueryHistoryEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Partial<QueryHistoryEntry>
  const o = e.outcome as Record<string, unknown> | undefined
  return (
    typeof e.text === 'string' &&
    typeof e.ranAt === 'string' &&
    !!o &&
    ((o.ok === true && typeof o.rows === 'number') || (o.ok === false && typeof o.error === 'string'))
  )
}

/** Newest first. Anything unreadable in storage reads as an empty history. */
export async function loadHistory(host: StateStore, stateKey: string): Promise<QueryHistoryEntry[]> {
  try {
    const stored = await host.loadState<unknown>(historyKey(stateKey))
    return Array.isArray(stored) ? stored.filter(isEntry).slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

/** Puts `entry` on top; an identical text moves up instead of repeating. */
export function addHistoryEntry(list: readonly QueryHistoryEntry[], entry: QueryHistoryEntry): QueryHistoryEntry[] {
  const text = entry.text.trim()
  return [{ ...entry, text }, ...list.filter((e) => e.text.trim() !== text)].slice(0, HISTORY_LIMIT)
}

/**
 * Re-reads storage before writing, so two viewers of the same file don't
 * overwrite each other's entries. Returns the saved list.
 */
export async function recordHistory(host: StateStore, stateKey: string, entry: QueryHistoryEntry): Promise<QueryHistoryEntry[]> {
  const next = addHistoryEntry(await loadHistory(host, stateKey), entry)
  await host.saveState(historyKey(stateKey), next)
  return next
}

/**
 * The entry a run leaves in history: results, temp DDL and engine errors.
 * Refusals, cancels and empty runs leave nothing (T046).
 */
export function historyEntryFromOutcome(outcome: RunOutcome, now: Date = new Date()): QueryHistoryEntry | null {
  const ranAt = now.toISOString()
  switch (outcome.kind) {
    case 'result':
      return { text: outcome.statement.text.trim(), ranAt, outcome: { ok: true, rows: outcome.result.totalRows } }
    case 'ddl':
      return { text: outcome.statement.text.trim(), ranAt, outcome: { ok: true, rows: 0, summary: outcome.summary } }
    case 'error':
      return { text: outcome.statement.text.trim(), ranAt, outcome: { ok: false, error: outcome.error.message.split('\n')[0].trim() } }
    default:
      return null
  }
}
