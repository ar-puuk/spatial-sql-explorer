// Out of memory (spec 007 FR-014, contracts/core-data-access.md "Errors"):
// running out at any stage ends in a clear message that names a way forward,
// and the viewer stays usable. The engine itself survives an out-of-memory
// error (research §1); what breaks is a source read in parts, whose
// registered handle reads as empty afterwards, so the session re-registers it.
// Tests: tests/core/sql-errors.test.ts.

/** Engine and allocation failures that mean "too big". */
export function isOutOfMemory(err: unknown): boolean {
  if (err instanceof OutOfMemoryError || err instanceof RangeError) return true
  const message = err instanceof Error ? err.message : String(err)
  return /out of memory|could not allocate|failed to allocate|allocation failed/i.test(message)
}

/** Engine work that ran out of memory; the session has recovered before this is thrown. */
export class OutOfMemoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OutOfMemoryError'
  }
}

/** "3.1 GiB" → "3.1 GB": users read the limit, not the unit convention. */
export function memoryLimitLabel(setting: string | null): string {
  const m = setting?.match(/^\s*([\d.]+)\s*([KMGT])i?B\s*$/i)
  return m ? `${m[1]} ${m[2].toUpperCase()}B` : '3.1 GB'
}

/**
 * The message for each stage:
 * - `open-whole`: a whole-read file that doesn't fit;
 * - `open`: any other open (a file read in parts, e.g. its bbox index);
 * - `work`: a query, map view, table page or style.
 * Exports keep their own message (export/run.ts exportErrorMessage).
 */
export function outOfMemoryMessage(stage: 'open-whole' | 'open' | 'work', limitSetting: string | null): string {
  const limit = memoryLimitLabel(limitSetting)
  switch (stage) {
    case 'open-whole':
      return 'This file is too large to read in full here (out of memory). Convert it to GeoParquet to open it at any size.'
    case 'open':
      return `Opening this file ran out of memory (${limit} limit). Convert it to GeoParquet to open it at any size.`
    case 'work':
      return `That ran out of memory (${limit} limit). Filter the result, or select fewer columns.`
  }
}
