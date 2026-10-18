// SQL syntax colors, defined once. The editor (SqlEditor.svelte) turns this table into a CodeMirror HighlightStyle; the
// read-only SQL boxes (the Bin into cells dialog) use `highlightSql` to cut a query into colored runs with the same
// parser and the same rules. Every color is a --se-sql-* token, so it follows the VS Code theme (high contrast too) and
// the web palette.
import { StandardSQL } from '@codemirror/lang-sql'
import { highlightTree, tagHighlighter, tags, type Tag } from '@lezer/highlight'

interface TokenRule {
  /** The --se-sql-<color> token that paints it. */
  color: string
  /** The class a read-only box gives the run. */
  token: string
  tags: Tag[]
  italic?: boolean
}

export const SQL_TOKEN_RULES: readonly TokenRule[] = [
  { token: 'keyword', color: 'keyword', tags: [tags.keyword, tags.operatorKeyword, tags.modifier] },
  { token: 'string', color: 'string', tags: [tags.string, tags.special(tags.string)] },
  { token: 'number', color: 'number', tags: [tags.number, tags.bool, tags.null] },
  { token: 'function', color: 'function', tags: [tags.function(tags.variableName), tags.standard(tags.name)] },
  { token: 'operator', color: 'operator', tags: [tags.operator, tags.punctuation, tags.bracket] },
  { token: 'comment', color: 'comment', tags: [tags.comment, tags.lineComment, tags.blockComment], italic: true },
  { token: 'type', color: 'number', tags: [tags.typeName, tags.special(tags.name)] },
]

const highlighter = tagHighlighter(SQL_TOKEN_RULES.map((r) => ({ tag: r.tags, class: r.token })))

/** A run of the query: its text and, when it is colored, the token it belongs to (`keyword`, `string`, ...). */
export interface SqlRun {
  text: string
  token: string | null
}

/**
 * Words the SQL grammar tags as keywords that are called like functions (`count(*)`, `ST_XMax(`: a keyword with an underscore
 * is a function name the grammar half-recognizes): colored as functions where a `(` follows. Real keywords before a
 * parenthesis (`IN (`, `AS (`, `WHERE (`) stay keywords.
 */
const FUNCTION_LIKE = new Set(['count', 'sum', 'avg', 'min', 'max', 'median', 'coalesce', 'cast', 'round', 'extract', 'replace', 'left', 'right'])

/** A name the grammar leaves untagged, and a `(` after it: a function call (`ST_Union(`, `h3_latlng_to_cell(`). */
const CALL = /[A-Za-z_][A-Za-z0-9_]*/g

/** The runs the parser gave, with function calls found: a name or a function-like keyword followed by `(`. */
function withFunctionCalls(text: string, runs: Array<SqlRun & { from: number }>): SqlRun[] {
  const out: SqlRun[] = []
  const callAt = (end: number): boolean => /^\s*\(/.test(text.slice(end, end + 8))
  for (const run of runs) {
    if (run.token === 'keyword') {
      out.push({ text: run.text, token: (FUNCTION_LIKE.has(run.text.toLowerCase()) || run.text.includes('_')) && callAt(run.from + run.text.length) ? 'function' : 'keyword' })
    } else if (run.token === null) {
      let at = 0
      for (const m of run.text.matchAll(CALL)) {
        const end = run.from + m.index + m[0].length
        if (!callAt(end)) continue
        if (m.index > at) out.push({ text: run.text.slice(at, m.index), token: null })
        out.push({ text: m[0], token: 'function' })
        at = m.index + m[0].length
      }
      if (at < run.text.length) out.push({ text: run.text.slice(at), token: null })
    } else {
      out.push({ text: run.text, token: run.token })
    }
  }
  return out
}

/** The query cut into runs that together read exactly as the query; colored ones carry their token. */
export function highlightSql(text: string): SqlRun[] {
  const runs: Array<SqlRun & { from: number }> = []
  let at = 0
  const plain = (to: number): void => {
    if (to > at) runs.push({ text: text.slice(at, to), token: null, from: at })
    at = Math.max(at, to)
  }
  highlightTree(StandardSQL.language.parser.parse(text), highlighter, (from, to, classes) => {
    if (from < at) return
    plain(from)
    runs.push({ text: text.slice(from, to), token: classes.split(' ')[0], from })
    at = to
  })
  plain(text.length)
  return withFunctionCalls(text, runs)
}
