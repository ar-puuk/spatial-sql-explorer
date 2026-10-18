// Geodatabase domains, for display only (spec 013 US3): a coded column shows
// its description ("Freeway") by default and its code ("1") when the user asks.
// SQL, filters, search and exports always use the stored code.
import type { ColumnDomains } from './types.js'

/** The remembered choice (HostAdapter.saveState). */
export const DOMAIN_DISPLAY_KEY = 'domainDisplay'
export type DomainDisplay = 'descriptions' | 'codes'
export const DEFAULT_DOMAIN_DISPLAY: DomainDisplay = 'descriptions'

/** The description for a stored code, or null when the column has no domain or the code is not in it. */
export function describeCode(domains: ColumnDomains | undefined, column: string, value: unknown): string | null {
  const codes = domains?.[column]
  if (!codes || value === null || value === undefined) return null
  const key = typeof value === 'bigint' || typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null
  if (key === null) return null
  return Object.hasOwn(codes, key) ? codes[key] : null
}

/** What a cell shows: the description (when descriptions are on and the code has one), else the value itself. */
export function displayValue(domains: ColumnDomains | undefined, column: string, value: unknown, mode: DomainDisplay): unknown {
  if (mode === 'codes') return value
  return describeCode(domains, column, value) ?? value
}

/** Columns with a coded domain, for the table's switch (offered only when there is something to switch). */
export function hasDomains(domains: ColumnDomains | undefined): boolean {
  return domains !== undefined && Object.keys(domains).length > 0
}

/** The code(s) whose description contains `text` (case-insensitive), for a filter written against what the cell shows. */
export function codesMatching(domains: ColumnDomains | undefined, column: string, text: string): string[] {
  const codes = domains?.[column]
  if (!codes) return []
  const needle = text.toLowerCase()
  return Object.entries(codes)
    .filter(([, description]) => description.toLowerCase().includes(needle))
    .map(([code]) => code)
}
