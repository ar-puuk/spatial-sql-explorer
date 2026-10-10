// Statement allowlist (spec 002, FR-013; contracts/statement-policy.md).
// Fails closed: anything not explicitly allowed is refused with a reason the
// user can act on. This is one of two independent layers. The engine is also
// locked down (no file/network access outside the source directory, no
// extension loading, configuration locked; research §2), so a gap here still
// can't reach the file system, the network or the settings.
import { tokenize, type Token } from './scanner.js'

export type StatementClass =
  | { allowed: true; kind: 'query' }
  | { allowed: true; kind: 'utility' }
  | { allowed: true; kind: 'tempDdl'; action: 'create' | 'drop'; object: 'table' | 'view'; name: string }
  | { allowed: false; reason: string }

export const REFUSAL = {
  createNotTemp: 'Only temporary tables and views can be created; they live in this viewer only. Use CREATE TEMP TABLE …',
  protectedName: "`layer` is the opened file and can't be replaced or dropped.",
  modify: "Spatial Explorer doesn't modify data. Create a temp table from a query instead.",
  export: "Exporting results isn't available yet.",
  extensions: "Extensions and other databases can't be used here.",
  unsupported: "This statement isn't supported in Spatial Explorer.",
} as const

const QUERY_STARTS = new Set(['SELECT', 'FROM', 'VALUES', 'TABLE', 'PIVOT', 'UNPIVOT'])
const UTILITY_STARTS = new Set(['DESCRIBE', 'SHOW', 'SUMMARIZE', 'EXPLAIN'])
const MODIFY = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'ALTER', 'TRUNCATE'])
const EXPORT = new Set(['COPY', 'EXPORT'])
const EXTENSIONS = new Set(['INSTALL', 'LOAD', 'ATTACH', 'DETACH', 'USE', 'FORCE'])
/** Top-level words that turn a WITH … into something other than a query. */
const WITH_WRITES = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY', 'CREATE', 'DROP', 'ALTER'])

const refuse = (reason: string): StatementClass => ({ allowed: false, reason })

function isProtected(name: string, protectedNames: string[]): boolean {
  const n = name.toLowerCase()
  return n.startsWith('__se_') || protectedNames.some((p) => p.toLowerCase() === n)
}

/** Reads a possibly dotted object name (`a`, `"A b"`, `temp.main.x`), returning its last part. */
function readName(tokens: Token[], i: number): { name: string; next: number } | null {
  let name: string | null = null
  let j = i
  while (j < tokens.length && (tokens[j].type === 'word' || tokens[j].type === 'quoted')) {
    name = tokens[j].text
    j++
    if (tokens[j]?.type === 'punct' && tokens[j].text === '.') j++
    else break
  }
  return name === null ? null : { name, next: j }
}

export function classifyStatement(text: string, protectedNames: string[]): StatementClass {
  const tokens = tokenize(text)
  const upper = (i: number): string => (tokens[i]?.type === 'word' ? tokens[i].text.toUpperCase() : '')

  // `(SELECT 1) UNION (SELECT 2)`: look past leading parentheses.
  let first = 0
  while (tokens[first]?.type === 'lparen') first++
  const head = upper(first)
  if (!head) return refuse(REFUSAL.unsupported)

  if (QUERY_STARTS.has(head)) return { allowed: true, kind: 'query' }
  if (UTILITY_STARTS.has(head)) return { allowed: true, kind: 'utility' }

  if (head === 'WITH') {
    let depth = 0
    for (let i = first + 1; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type === 'lparen') depth++
      else if (t.type === 'rparen') depth--
      else if (depth === 0 && t.type === 'word') {
        const w = t.text.toUpperCase()
        if (WITH_WRITES.has(w)) return refuse(w === 'COPY' ? REFUSAL.export : REFUSAL.modify)
      }
    }
    return { allowed: true, kind: 'query' }
  }

  if (head === 'CREATE') {
    let i = first + 1
    if (upper(i) === 'OR' && upper(i + 1) === 'REPLACE') i += 2
    const temp = upper(i) === 'TEMP' || upper(i) === 'TEMPORARY'
    if (temp) i++
    const object = upper(i)
    if (object !== 'TABLE' && object !== 'VIEW') return refuse(REFUSAL.unsupported)
    i++
    if (upper(i) === 'IF' && upper(i + 1) === 'NOT' && upper(i + 2) === 'EXISTS') i += 3
    const named = readName(tokens, i)
    if (named && isProtected(named.name, protectedNames)) return refuse(REFUSAL.protectedName)
    if (!temp) return refuse(REFUSAL.createNotTemp)
    if (!named) return refuse(REFUSAL.unsupported)
    return { allowed: true, kind: 'tempDdl', action: 'create', object: object === 'TABLE' ? 'table' : 'view', name: named.name }
  }

  if (head === 'DROP') {
    let i = first + 1
    const object = upper(i)
    if (object !== 'TABLE' && object !== 'VIEW') return refuse(REFUSAL.unsupported)
    i++
    if (upper(i) === 'IF' && upper(i + 1) === 'EXISTS') i += 2
    const named = readName(tokens, i)
    if (!named) return refuse(REFUSAL.unsupported)
    if (isProtected(named.name, protectedNames)) return refuse(REFUSAL.protectedName)
    return { allowed: true, kind: 'tempDdl', action: 'drop', object: object === 'TABLE' ? 'table' : 'view', name: named.name }
  }

  if (MODIFY.has(head)) return refuse(REFUSAL.modify)
  if (EXPORT.has(head)) return refuse(REFUSAL.export)
  if (EXTENSIONS.has(head)) return refuse(REFUSAL.extensions)
  return refuse(REFUSAL.unsupported)
}
