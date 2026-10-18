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

/** The query cut into runs that together read exactly as the query; colored ones carry their token. */
export function highlightSql(text: string): SqlRun[] {
  const runs: SqlRun[] = []
  let at = 0
  const plain = (to: number): void => {
    if (to > at) runs.push({ text: text.slice(at, to), token: null })
    at = Math.max(at, to)
  }
  highlightTree(StandardSQL.language.parser.parse(text), highlighter, (from, to, classes) => {
    if (from < at) return
    plain(from)
    runs.push({ text: text.slice(from, to), token: classes.split(' ')[0] })
    at = to
  })
  plain(text.length)
  return runs
}
