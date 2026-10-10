// Engine error -> what the user sees (spec 002 FR-008; research §8).
// DuckDB messages look like:
//   Binder Error: Referenced column "nope" not found in FROM clause!
//   Candidate bindings: "name", "geom"
//
//   LINE 1: SELECT nope FROM layer
//                  ^
// Parser errors repeat the LINE block. Long lines are echoed truncated, with
// a leading "...". LINE numbers count from the start of the SQL actually
// sent, which for queries is "CREATE … AS\n" + the statement (one line
// before it).

export interface EngineErrorInfo {
  kind: string
  message: string
  hints: string[]
  position?: { line: number; column: number; offset: number }
}

export interface ErrorContext {
  /** Full editor text, for absolute line/column. */
  editorText: string
  /** Where the executed statement starts in the editor. */
  statementOffset: number
  /** Lines the runner prepended before the statement (1 for the CTAS wrapper). */
  ctasLineOffset: number
  /** Characters the runner prepended (the CTAS prefix length), for the JSON `position`. */
  ctasPrefixLength?: number
}

/**
 * The streaming API (`send`, which every user query uses so it can be
 * cancelled) reports errors as JSON, e.g.
 *   {"exception_type":"Parser","exception_message":"syntax error …\n\nLINE 3: …","position":"58"}
 * while `query()` reports plain text (what the Phase 0 spike saw). Normalizes
 * both to the text form, plus the exact character position when there is one.
 */
function unwrapJson(raw: string): { text: string; position: number | null } {
  const start = raw.indexOf('{"exception_type"')
  if (start < 0) return { text: raw, position: null }
  try {
    const j = JSON.parse(raw.slice(start)) as { exception_type?: string; exception_message?: string; position?: string | number }
    const type = j.exception_type && j.exception_type !== 'Error' ? `${j.exception_type} ` : ''
    const position = j.position !== undefined && Number.isFinite(Number(j.position)) ? Number(j.position) : null
    return { text: `${type}Error: ${j.exception_message ?? ''}`, position }
  } catch {
    return { text: raw, position: null }
  }
}

/** "Did you mean" suggestions pointing at engine internals are noise, not help. */
const INTERNAL = /^(pg_|duckdb_|sqlite_|information_schema|__se_)/i

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** Keeps a "Did you mean" only when it's plausibly what the user meant. */
function usefulSuggestion(hint: string, message: string): boolean {
  const suggested = /Did you mean "([^"]+)"/.exec(hint)?.[1]
  if (!suggested) return true
  if (INTERNAL.test(suggested)) return false
  const missing = /with name (\S+) does not exist|column "([^"]+)"/.exec(message)
  const name = (missing?.[1] ?? missing?.[2] ?? '').toLowerCase()
  if (!name) return true
  return levenshtein(name, suggested.toLowerCase()) <= Math.max(2, Math.ceil(name.length / 3))
}

export function parseEngineError(raw: string, ctx: ErrorContext): EngineErrorInfo {
  const unwrapped = unwrapJson(raw)
  const text = unwrapped.text.replace(/\r\n/g, '\n').trim()
  const lines = text.split('\n')
  const head = /^([A-Za-z][A-Za-z ]*?) Error: (.*)$/.exec(lines[0])
  const kind = head ? head[1] : 'Error'
  const message = head ? head[2] : lines[0]

  // Hints: everything between the first line and the first LINE block.
  const hints: string[] = []
  let i = 1
  for (; i < lines.length && !/^LINE \d+:/.test(lines[i]); i++) {
    const h = lines[i].trim()
    if (h && usefulSuggestion(h, message)) hints.push(h)
  }

  const result: EngineErrorInfo = { kind, message, hints }

  // The exact character position (JSON form) beats the caret when present.
  if (unwrapped.position !== null && ctx.ctasPrefixLength !== undefined) {
    const inStatement = unwrapped.position - ctx.ctasPrefixLength
    if (inStatement >= 0 && inStatement <= ctx.editorText.length - ctx.statementOffset) {
      const offset = ctx.statementOffset + inStatement
      const before = ctx.editorText.slice(0, offset)
      result.position = { line: before.split('\n').length, column: offset - (before.lastIndexOf('\n') + 1) + 1, offset }
      return result
    }
  }

  const lineMatch = i < lines.length ? /^LINE (\d+): (.*)$/.exec(lines[i]) : null
  const caretLine = lines[i + 1]
  if (!lineMatch || caretLine === undefined || !caretLine.includes('^')) return result

  const sentLine = Number(lineMatch[1])
  const statementLine = sentLine - ctx.ctasLineOffset // 1-based within the statement
  if (statementLine < 1) return result
  const prefixWidth = lines[i].length - lineMatch[2].length
  let echo = lineMatch[2]
  let col = caretLine.indexOf('^') - prefixWidth
  const statementText = ctx.editorText.slice(ctx.statementOffset)
  const statementLines = statementText.split('\n')
  const actual = statementLines[statementLine - 1]
  if (actual === undefined) return result

  // Truncated echo: find where the visible fragment sits in the real line.
  if (echo.startsWith('...')) {
    echo = echo.slice(3)
    col -= 3
    const at = actual.indexOf(echo.slice(0, Math.min(echo.length, 40)))
    if (at < 0) return result
    col += at
  }
  col = Math.max(0, Math.min(col, actual.length))

  let offsetInStatement = 0
  for (let l = 0; l < statementLine - 1; l++) offsetInStatement += statementLines[l].length + 1
  const offset = ctx.statementOffset + offsetInStatement + col
  const before = ctx.editorText.slice(0, offset)
  const editorLine = before.split('\n').length
  const column = offset - (before.lastIndexOf('\n') + 1) + 1
  result.position = { line: editorLine, column, offset }
  return result
}
