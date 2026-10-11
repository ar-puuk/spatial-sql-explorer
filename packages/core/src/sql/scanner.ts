// SQL scanner for the query editor (spec 002, FR-004/FR-013). Dependency-free
// on purpose (research §3): the engine exposes no statement-type API, and a
// general SQL parser wouldn't match DuckDB's dialect (FROM-first, PIVOT,
// SUMMARIZE). The scanner only has to know where strings, quoted identifiers
// and comments start and end, so that `;` and keywords inside them are
// never mistaken for real ones.

export interface StatementSpan {
  text: string
  /** Offsets into the scanned source. */
  from: number
  to: number
}

export type TokenType = 'word' | 'quoted' | 'string' | 'number' | 'punct' | 'semicolon' | 'lparen' | 'rparen'

export interface Token {
  type: TokenType
  /** Raw text. For `quoted`, the unquoted identifier (with `""` collapsed). */
  text: string
  from: number
  to: number
}

const isWordStart = (c: string): boolean => /[A-Za-z_\u0080-￿]/.test(c)
const isWordPart = (c: string): boolean => /[A-Za-z0-9_$\u0080-￿]/.test(c)

/**
 * Returns the end offset (exclusive) of a string, quoted identifier or
 * comment starting at `i`, or -1 if none starts there. Unterminated
 * constructs run to the end of the source rather than throwing.
 */
function skipOpaque(src: string, i: number): { end: number; kind: 'comment' | 'string' | 'quoted' } | null {
  const c = src[i]
  const next = src[i + 1]
  if (c === '-' && next === '-') {
    const nl = src.indexOf('\n', i + 2)
    return { end: nl === -1 ? src.length : nl, kind: 'comment' }
  }
  if (c === '/' && next === '*') {
    // DuckDB allows nested block comments.
    let depth = 1
    let j = i + 2
    while (j < src.length && depth > 0) {
      if (src[j] === '/' && src[j + 1] === '*') {
        depth++
        j += 2
      } else if (src[j] === '*' && src[j + 1] === '/') {
        depth--
        j += 2
      } else j++
    }
    return { end: j, kind: 'comment' }
  }
  if ((c === 'E' || c === 'e') && next === "'" && !isWordPart(src[i - 1] ?? ' ')) {
    // E'…': backslash escapes.
    let j = i + 2
    while (j < src.length) {
      if (src[j] === '\\') j += 2
      else if (src[j] === "'" && src[j + 1] === "'") j += 2
      else if (src[j] === "'") return { end: j + 1, kind: 'string' }
      else j++
    }
    return { end: src.length, kind: 'string' }
  }
  if (c === "'" || c === '"') {
    let j = i + 1
    while (j < src.length) {
      if (src[j] === c && src[j + 1] === c) j += 2
      else if (src[j] === c) return { end: j + 1, kind: c === "'" ? 'string' : 'quoted' }
      else j++
    }
    return { end: src.length, kind: c === "'" ? 'string' : 'quoted' }
  }
  if (c === '$') {
    // $tag$ … $tag$ or $$ … $$ (not $1 parameters).
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64))
    if (m) {
      const tag = m[0]
      const close = src.indexOf(tag, i + tag.length)
      return { end: close === -1 ? src.length : close + tag.length, kind: 'string' }
    }
  }
  return null
}

/** Tokens outside comments and whitespace. */
export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const opaque = skipOpaque(src, i)
    if (opaque) {
      if (opaque.kind === 'string') out.push({ type: 'string', text: src.slice(i, opaque.end), from: i, to: opaque.end })
      if (opaque.kind === 'quoted') {
        const raw = src.slice(i + 1, src[opaque.end - 1] === '"' ? opaque.end - 1 : opaque.end)
        out.push({ type: 'quoted', text: raw.replace(/""/g, '"'), from: i, to: opaque.end })
      }
      i = opaque.end
      continue
    }
    if (isWordStart(c)) {
      let j = i + 1
      while (j < src.length && isWordPart(src[j])) j++
      out.push({ type: 'word', text: src.slice(i, j), from: i, to: j })
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[0-9.eE_]/.test(src[j])) j++
      out.push({ type: 'number', text: src.slice(i, j), from: i, to: j })
      i = j
      continue
    }
    const type: TokenType = c === ';' ? 'semicolon' : c === '(' ? 'lparen' : c === ')' ? 'rparen' : 'punct'
    out.push({ type, text: c, from: i, to: i + 1 })
    i++
  }
  return out
}

/**
 * Splits on top-level `;`, ignoring any inside strings, quoted identifiers
 * or comments. Statements with no tokens (whitespace or comments only) are
 * dropped. Each span is trimmed of surrounding whitespace.
 */
export function splitStatements(source: string): StatementSpan[] {
  const spans: StatementSpan[] = []
  const tokens = tokenize(source)
  let start = 0
  let hasTokens = false
  const flush = (end: number): void => {
    if (hasTokens) {
      let from = start
      let to = end
      while (from < to && /\s/.test(source[from])) from++
      while (to > from && /\s/.test(source[to - 1])) to--
      spans.push({ text: source.slice(from, to), from, to })
    }
    hasTokens = false
  }
  for (const t of tokens) {
    if (t.type === 'semicolon') {
      flush(t.from)
      start = t.to
    } else {
      hasTokens = true
    }
  }
  flush(source.length)
  return spans
}

/**
 * FR-004: the selection if it's non-empty (its first statement, with editor
 * offsets), otherwise the statement containing the cursor, otherwise the
 * nearest statement before it, otherwise the first one.
 */
export function statementToRun(source: string, selection: { from: number; to: number }): StatementSpan | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (to > from) {
    const first = splitStatements(source.slice(from, to))[0]
    return first ? { text: first.text, from: first.from + from, to: first.to + from } : null
  }
  const spans = splitStatements(source)
  if (spans.length === 0) return null
  const containing = spans.find((s) => s.from <= from && from <= s.to)
  if (containing) return containing
  const before = [...spans].reverse().find((s) => s.to <= from)
  return before ?? spans[0]
}
