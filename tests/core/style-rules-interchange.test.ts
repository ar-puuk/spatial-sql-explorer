// @vitest-environment happy-dom
// Spec 010 phase 11: rules and graduated-by-expression in style files. QML
// keeps both (a QGIS rule-based renderer; the expression as the graduated
// attribute), exactly through a custom property; SLD and Mapbox GL keep rules
// whose conditions are simple comparison chains, else the single symbol and a
// notice.
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  COMPLEX_RULES_NOTE,
  DEFAULT_LAYER_STYLE,
  EXPRESSION_VALUE_COLUMN,
  exportStyle,
  importStyle,
  previewExportNotice,
  resolveStyle,
  type LayerStyle,
  type ResolvedStyle,
  type RulesRenderer,
  rendererOf,
} from '@spatial-explorer/core'

const rules: RulesRenderer = {
  kind: 'rules',
  rules: [
    { id: 'r1', label: '', where: "continent = 'Africa'", color: '#66c2a5', visible: true },
    { id: 'r2', label: 'Populous', where: 'pop_est > 100000000', color: '#fc8d62', visible: true },
  ],
  elseColor: '#bdbdbd',
  elseVisible: true,
  elseLabel: 'Everything else',
}
const columns = [
  { name: 'continent', type: 'VARCHAR' },
  { name: 'pop_est', type: 'BIGINT' },
]
const rulesStyle: LayerStyle = { ...DEFAULT_LAYER_STYLE, renderer: rules }
const resolvedRules = (style: LayerStyle): ResolvedStyle => resolveStyle(style, { columns, rowCount: 10, ruleCounts: new Map([[0, 3], [1, 2], [-1, 5]]) })

function evaluate(expr: unknown, properties: Record<string, unknown>, type: string): unknown {
  if (!Array.isArray(expr)) return expr
  const parsed = expression.createExpression(expr, { type } as never)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type: 'Polygon', properties } as never, {} as never)
}

describe('QML', () => {
  it('writes a rule-based renderer: guarded filters (first match), labels, ELSE, hidden rules unchecked', () => {
    const style = { ...rulesStyle, renderer: { ...rules, rules: [rules.rules[0], { ...rules.rules[1], visible: false }] } }
    const { text } = exportStyle(style, 'qml', 'Polygon', 'world.geojson', resolvedRules(style))
    expect(text).toContain('type="RuleRenderer"')
    expect(text).toContain(`filter="continent = &apos;Africa&apos;"`.replace(/&apos;/g, "'"))
    expect(text).toContain(`filter="(pop_est &gt; 100000000) AND NOT coalesce((continent = 'Africa'), FALSE)"`)
    expect(text).toContain(`label="continent = 'Africa'"`)
    expect(text).toMatch(/label="Populous" symbol="1" checkstate="0"/)
    expect(text).toContain('filter="ELSE"')
    expect(text).toContain('spatialExplorer/rules')
  })

  it('round-trips rules exactly through the custom property', () => {
    const { text } = exportStyle(rulesStyle, 'qml', 'Polygon', 'world.geojson', resolvedRules(rulesStyle))
    const back = importStyle('world.qml', text)
    expect(rendererOf(back.style)).toEqual(rules)
    expect(back.notes).toEqual([])
  })

  it('reads a rule-based renderer without our property (guards removed, ELSE as everything else)', () => {
    const { text } = exportStyle(rulesStyle, 'qml', 'Polygon', 'world.geojson', resolvedRules(rulesStyle))
    const foreign = text.replace(/\s*<customproperties>[\s\S]*<\/customproperties>/, '')
    const back = rendererOf(importStyle('world.qml', foreign).style) as RulesRenderer
    expect(back.kind).toBe('rules')
    expect(back.rules.map((r) => [r.where, r.label, r.color, r.visible])).toEqual([
      ["continent = 'Africa'", '', '#66c2a5', true],
      ['pop_est > 100000000', 'Populous', '#fc8d62', true],
    ])
    expect([back.elseColor, back.elseLabel, back.elseVisible]).toEqual(['#bdbdbd', 'Everything else', true])
  })

  it('a bivariate QML still imports as bivariate', async () => {
    const { startStyle, setBivariateAxis } = await import('@spatial-explorer/core')
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, geometry: null, attributes: { a: i, b: (i * 7) % 11 } }))
    const layer = { features: rows, columns: [{ name: 'a', type: 'INTEGER' }, { name: 'b', type: 'INTEGER' }] }
    const biv = setBivariateAxis(setBivariateAxis(startStyle(DEFAULT_LAYER_STYLE as LayerStyle, 'bivariate', layer), 'x', { column: 'a' }), 'y', { column: 'b' })
    const { text } = exportStyle(biv, 'qml', 'Polygon', 'x.geojson', resolveStyle(biv, layer))
    expect(rendererOf(importStyle('x.qml', text).style)?.kind).toBe('bivariate')
  })

  it('graduated by expression: the expression is the attribute, and comes back as the expression with its label', () => {
    const graduated: LayerStyle = {
      ...DEFAULT_LAYER_STYLE,
      renderer: { kind: 'graduated', column: 'GDP per person', expression: 'gdp_md * 1e6 / pop_est', method: 'quantile', classCount: 4, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} },
    }
    const values = [1, 2, 3, 4, 5, 6, 7, 8]
    const resolved = resolveStyle(graduated, { columns: [...columns, { name: EXPRESSION_VALUE_COLUMN, type: 'DOUBLE' }], features: values.map((v, id) => ({ id, geometry: null, attributes: { [EXPRESSION_VALUE_COLUMN]: v } })) })
    expect(resolved.status).toBe('ok')
    const { text } = exportStyle(graduated, 'qml', 'Polygon', 'world.geojson', resolved)
    expect(text).toContain('attr="gdp_md * 1e6 / pop_est"')
    const back = rendererOf(importStyle('world.qml', text).style)
    expect(back).toMatchObject({ kind: 'graduated', column: 'GDP per person', expression: 'gdp_md * 1e6 / pop_est', method: 'quantile', classCount: 4 })
    // A QGIS file classifying an expression (no property of ours): imported as the expression, with a note.
    const foreign = importStyle('world.qml', text.replace(/\s*<customproperties>[\s\S]*<\/customproperties>/, ''))
    expect(rendererOf(foreign.style)).toMatchObject({ kind: 'graduated', expression: 'gdp_md * 1e6 / pop_est' })
    expect(foreign.notes.join(' ')).toContain('imported as a SQL expression')
  })
})

describe('SLD', () => {
  it('simple rules: one rule each, excluding earlier rules, then the ElseFilter', () => {
    const { text, notes } = exportStyle(rulesStyle, 'sld', 'Polygon', 'world.geojson', resolvedRules(rulesStyle))
    expect(notes).toEqual([])
    const rulesXml = text.match(/<Rule>[\s\S]*?<\/Rule>/g) ?? []
    expect(rulesXml).toHaveLength(3)
    expect(rulesXml[0]).toContain('<ogc:PropertyIsEqualTo><ogc:PropertyName>continent</ogc:PropertyName><ogc:Literal>Africa</ogc:Literal></ogc:PropertyIsEqualTo>')
    expect(rulesXml[1]).toContain('<ogc:And><ogc:PropertyIsGreaterThan><ogc:PropertyName>pop_est</ogc:PropertyName><ogc:Literal>100000000</ogc:Literal></ogc:PropertyIsGreaterThan><ogc:Not><ogc:PropertyIsEqualTo>')
    expect(rulesXml[1]).toContain('#fc8d62')
    expect(rulesXml[2]).toContain('<ElseFilter/>')
  })

  it('LIKE becomes PropertyIsLike; a hidden rule is left out and the rest is "none of the rules"', () => {
    const style: LayerStyle = { ...rulesStyle, renderer: { ...rules, rules: [{ ...rules.rules[0], where: "name LIKE 'A%'", visible: false }, rules.rules[1]] } }
    const resolved = resolvedRules(style)
    const { text } = exportStyle(style, 'sld', 'Polygon', 'world.geojson', resolved)
    expect(text).toContain('<ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\\">')
    expect(text.match(/<Rule>/g)).toHaveLength(2)
    expect(text).not.toContain('<ElseFilter/>')
    expect(previewExportNotice(style, 'sld', resolved).items).toContain("SLD can't mark a rule as hidden: 1 hidden rule will be left out.")
  })

  it('a complex condition: the single symbol, with the notice', () => {
    const style: LayerStyle = { ...rulesStyle, renderer: { ...rules, rules: [rules.rules[0], { ...rules.rules[1], where: 'pop_est / 2 > 5' }] } }
    const resolved = resolvedRules(style)
    expect(previewExportNotice(style, 'sld', resolved).items).toContain(COMPLEX_RULES_NOTE)
    const { text, notes } = exportStyle(style, 'sld', 'Polygon', 'world.geojson', resolved)
    expect(notes).toContain(COMPLEX_RULES_NOTE)
    expect(text).toContain('<Name>Single symbol</Name>')
    // QML keeps them.
    expect(previewExportNotice(style, 'qml', resolved).items).not.toContain(COMPLEX_RULES_NOTE)
  })
})

describe('Mapbox GL', () => {
  const layers = (text: string) => (JSON.parse(text) as { layers: Array<{ type: string; paint: Record<string, unknown>; filter?: unknown }> }).layers
  it('simple rules: a case on the data columns, first match wins, NULL matches nothing', () => {
    const { text, notes } = exportStyle(rulesStyle, 'mapbox', 'Polygon', 'world.geojson', resolvedRules(rulesStyle))
    expect(notes).toEqual([])
    const color = layers(text).find((l) => l.type === 'fill')!.paint['fill-color']
    expect(evaluate(color, { continent: 'Africa', pop_est: 2e8 }, 'color')).toBe('#66c2a5')
    expect(evaluate(color, { continent: 'Asia', pop_est: 2e8 }, 'color')).toBe('#fc8d62')
    expect(evaluate(color, { continent: null, pop_est: null }, 'color')).toBe('#bdbdbd')
  })
  it('hidden rules filter their features out', () => {
    const style: LayerStyle = { ...rulesStyle, renderer: { ...rules, rules: [{ ...rules.rules[0], visible: false }, rules.rules[1]] } }
    const fill = layers(exportStyle(style, 'mapbox', 'Polygon', 'world.geojson', resolvedRules(style)).text).find((l) => l.type === 'fill')!
    expect(evaluate(fill.filter, { continent: 'Africa', pop_est: 2e8 }, 'boolean')).toBe(false)
    expect(evaluate(fill.filter, { continent: 'Asia', pop_est: 2e8 }, 'boolean')).toBe(true)
  })
  it('LIKE or a complex condition: the single color, with the notice', () => {
    const style: LayerStyle = { ...rulesStyle, renderer: { ...rules, rules: [{ ...rules.rules[0], where: "continent LIKE 'Af%'" }] } }
    const { text, notes } = exportStyle(style, 'mapbox', 'Polygon', 'world.geojson', resolvedRules(style))
    expect(notes).toContain(COMPLEX_RULES_NOTE)
    expect(layers(text).find((l) => l.type === 'fill')!.paint['fill-color']).toBe(DEFAULT_LAYER_STYLE.fillColor)
  })
  it('graduated by expression: the single color, with a notice (the style is kept in metadata)', () => {
    const graduated: LayerStyle = {
      ...DEFAULT_LAYER_STYLE,
      renderer: { kind: 'graduated', column: '', expression: 'a / b', method: 'equal', classCount: 3, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} },
    }
    const resolved = resolveStyle(graduated, { columns: [{ name: EXPRESSION_VALUE_COLUMN, type: 'DOUBLE' }], features: [1, 5, 9].map((v, id) => ({ id, geometry: null, attributes: { [EXPRESSION_VALUE_COLUMN]: v } })) })
    const { text, notes } = exportStyle(graduated, 'mapbox', 'Polygon', 'x.geojson', resolved)
    expect(notes.join(' ')).toContain("can't classify an expression")
    expect(layers(text).find((l) => l.type === 'fill')!.paint['fill-color']).toBe(DEFAULT_LAYER_STYLE.fillColor)
    expect(rendererOf(importStyle('x.json', text).style)).toMatchObject({ kind: 'graduated', expression: 'a / b' })
    const sld = exportStyle(graduated, 'sld', 'Polygon', 'x.geojson', resolved)
    expect(sld.notes.join(' ')).toContain("SLD can't classify an expression")
    expect(sld.text).toContain('<Name>Single symbol</Name>')
  })
})
