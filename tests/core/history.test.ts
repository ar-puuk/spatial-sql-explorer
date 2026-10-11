// T043 (spec 002, US5, FR-016/SC-007): per-file query history through the
// HostAdapter state store: newest first, 20 entries, de-duplicated, error
// first line only, isolated per file, and tolerant of corrupt storage.
import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, historyEntryFromOutcome, historyKey, loadHistory, recordHistory, type QueryHistoryEntry, type RunOutcome } from '@spatial-explorer/core'

function fakeHost(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    store,
    loadState: <T>(key: string) => Promise.resolve(store.get(key) as T | undefined),
    saveState: (key: string, value: unknown) => {
      store.set(key, JSON.parse(JSON.stringify(value)))
      return Promise.resolve()
    },
  }
}

const entry = (text: string, rows = 1): QueryHistoryEntry => ({ text, ranAt: new Date(0).toISOString(), outcome: { ok: true, rows } })
const statement = (text: string) => ({ text, editorOffset: 0 })

describe('query history', () => {
  it('lists newest first', async () => {
    const host = fakeHost()
    await recordHistory(host, 'a', entry('SELECT 1'))
    await recordHistory(host, 'a', entry('SELECT 2'))
    await recordHistory(host, 'a', entry('SELECT 3'))
    expect((await loadHistory(host, 'a')).map((e) => e.text)).toEqual(['SELECT 3', 'SELECT 2', 'SELECT 1'])
  })

  it(`keeps at most ${HISTORY_LIMIT} entries`, async () => {
    const host = fakeHost()
    for (let i = 0; i < 25; i++) await recordHistory(host, 'a', entry(`SELECT ${i}`))
    const list = await loadHistory(host, 'a')
    expect(list).toHaveLength(HISTORY_LIMIT)
    expect(list[0].text).toBe('SELECT 24')
    expect(list.at(-1)?.text).toBe('SELECT 5')
  })

  it('moves a re-run of identical text to the top instead of repeating it', async () => {
    const host = fakeHost()
    await recordHistory(host, 'a', entry('SELECT 1', 1))
    await recordHistory(host, 'a', entry('SELECT 2'))
    await recordHistory(host, 'a', entry('  SELECT 1\n', 7))
    const list = await loadHistory(host, 'a')
    expect(list.map((e) => e.text)).toEqual(['SELECT 1', 'SELECT 2'])
    expect(list[0].outcome).toEqual({ ok: true, rows: 7 })
  })

  it('stores only the first line of an error', () => {
    const outcome: RunOutcome = {
      kind: 'error',
      error: { kind: 'Binder', message: 'Referenced column "nme" not found\nLINE 1: SELECT nme FROM layer\n               ^', hints: [] },
      durationMs: 3,
      statement: statement('SELECT nme FROM layer'),
    } as RunOutcome
    expect(historyEntryFromOutcome(outcome)?.outcome).toEqual({ ok: false, error: 'Referenced column "nme" not found' })
  })

  it('records results, temp DDL and errors, but not refusals or cancels', () => {
    const refused = { kind: 'refused', reason: 'no', statement: statement('DELETE FROM layer') } as RunOutcome
    const cancelled = { kind: 'cancelled', durationMs: 1, statement: statement('SELECT 1') } as RunOutcome
    const ddl = { kind: 'ddl', summary: 'Created temp table `t` (3 rows)', durationMs: 1, statement: statement('CREATE TEMP TABLE t AS SELECT 1') } as RunOutcome
    expect(historyEntryFromOutcome(refused)).toBeNull()
    expect(historyEntryFromOutcome(cancelled)).toBeNull()
    expect(historyEntryFromOutcome({ kind: 'empty' })).toBeNull()
    expect(historyEntryFromOutcome(ddl)?.outcome).toEqual({ ok: true, rows: 0, summary: 'Created temp table `t` (3 rows)' })
  })

  it('keeps each file separate', async () => {
    const host = fakeHost()
    await recordHistory(host, 'file-a', entry('SELECT 1'))
    expect(await loadHistory(host, 'file-b')).toEqual([])
    expect([...host.store.keys()]).toEqual([historyKey('file-a')])
  })

  it('reads corrupt stored data as an empty history, keeping valid entries', async () => {
    expect(await loadHistory(fakeHost({ [historyKey('a')]: 'garbage' }), 'a')).toEqual([])
    expect(await loadHistory(fakeHost({ [historyKey('a')]: [{ text: 1 }, null, entry('SELECT 1')] }), 'a')).toEqual([entry('SELECT 1')])
    const throwing = { loadState: () => Promise.reject(new Error('boom')), saveState: () => Promise.resolve() }
    expect(await loadHistory(throwing, 'a')).toEqual([])
  })
})
