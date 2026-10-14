// Spec 010 phase 11: the subset of rule conditions SLD and Mapbox GL styles
// can carry: `column op literal` comparisons joined by AND / OR (with
// parentheses). Anything else (functions, arithmetic, NOT, IN, IS NULL…) is
// "complex": QML keeps it, the other formats can't.
import { tokenize, type Token } from '../sql/scanner.js'

export type SimpleOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like'

export type SimpleWhere =
  | { kind: 'cmp'; column: string; op: SimpleOp; value: string | number }
  | { kind: 'and' | 'or'; items: SimpleWhere[] }

const OPS: Record<string, SimpleOp> = { '=': '=', '==': '=', '!=': '!=', '<>': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' }

/** The condition as a tree, or null when it is not a simple comparison chain. */
export function parseSimpleWhere(text: string): SimpleWhere | null {
  const tokens = tokenize(text)
  let i = 0
  const peek = (): Token | undefined => tokens[i]
  const word = (w: string): boolean => peek()?.type === 'word' && peek()?.text.toLowerCase() === w

  function operator(): SimpleOp | null {
    const t = peek()
    if (!t) return null
    if (t.type === 'word' && t.text.toLowerCase() === 'like') {
      i++
      return 'like'
    }
    if (t.type !== 'punct') return null
    // Two-character operators arrive as two adjacent punctuation tokens.
    const next = tokens[i + 1]
    if (next?.type === 'punct' && next.from === t.to && OPS[t.text + next.text]) {
      i += 2
      return OPS[t.text + next.text]
    }
    if (OPS[t.text]) {
      i++
      return OPS[t.text]
    }
    return null
  }

  function literal(): string | number | null {
    let t = peek()
    let sign = 1
    if (t?.type === 'punct' && (t.text === '-' || t.text === '+')) {
      sign = t.text === '-' ? -1 : 1
      i++
      t = peek()
      if (t?.type !== 'number') return null
    }
    if (!t) return null
    if (t.type === 'number') {
      const n = Number(t.text.replace(/_/g, ''))
      if (!Number.isFinite(n)) return null
      i++
      return sign * n
    }
    if (t.type === 'string' && t.text.startsWith("'") && t.text.endsWith("'") && t.text.length >= 2) {
      i++
      return t.text.slice(1, -1).replace(/''/g, "'")
    }
    return null
  }

  function comparison(): SimpleWhere | null {
    const t = peek()
    if (!t) return null
    if (t.type === 'lparen') {
      i++
      const inner = disjunction()
      if (!inner || peek()?.type !== 'rparen') return null
      i++
      return inner
    }
    if (t.type !== 'word' && t.type !== 'quoted') return null
    if (t.type === 'word' && ['and', 'or', 'not', 'null', 'true', 'false'].includes(t.text.toLowerCase())) return null
    i++
    const op = operator()
    if (!op) return null
    const value = literal()
    if (value === null) return null
    if (op === 'like' && typeof value !== 'string') return null
    return { kind: 'cmp', column: t.text, op, value }
  }

  function chain(kind: 'and' | 'or', item: () => SimpleWhere | null): SimpleWhere | null {
    const first = item()
    if (!first) return null
    const items = [first]
    while (word(kind)) {
      i++
      const next = item()
      if (!next) return null
      items.push(next)
    }
    return items.length === 1 ? first : { kind, items }
  }

  const conjunction = (): SimpleWhere | null => chain('and', comparison)
  function disjunction(): SimpleWhere | null {
    return chain('or', conjunction)
  }

  const tree = disjunction()
  return tree && i === tokens.length ? tree : null
}

/** True when the condition has a LIKE (Mapbox GL expressions can't match patterns). */
export function hasLike(w: SimpleWhere): boolean {
  return w.kind === 'cmp' ? w.op === 'like' : w.items.some(hasLike)
}
