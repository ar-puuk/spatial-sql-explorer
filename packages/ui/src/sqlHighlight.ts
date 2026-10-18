// SQL syntax colors, defined once: the editor (SqlEditor.svelte) turns this table into its CodeMirror HighlightStyle. Every
// color is a --se-sql-* token, so it follows the VS Code theme (high contrast too) and the web palette.
import { tags, type Tag } from '@lezer/highlight'

interface TokenRule {
  /** The --se-sql-<color> token that paints it. */
  color: string
  tags: Tag[]
  italic?: boolean
}

export const SQL_TOKEN_RULES: readonly TokenRule[] = [
  { color: 'keyword', tags: [tags.keyword, tags.operatorKeyword, tags.modifier] },
  { color: 'string', tags: [tags.string, tags.special(tags.string)] },
  { color: 'number', tags: [tags.number, tags.bool, tags.null] },
  { color: 'function', tags: [tags.function(tags.variableName), tags.standard(tags.name)] },
  { color: 'operator', tags: [tags.operator, tags.punctuation, tags.bracket] },
  { color: 'comment', tags: [tags.comment, tags.lineComment, tags.blockComment], italic: true },
  { color: 'number', tags: [tags.typeName, tags.special(tags.name)] },
]
