// @vitest-environment happy-dom
// Spec 010 phase 11: QGIS reads our rules QML. With SE_QGIS_RULES=<dir>, writes
// a small polygon GeoJSON (continent, pop_est, gdp_md; overlapping and missing
// values), the rules QML and graduated-by-expression QML the app saves, and the
// color each feature gets here (first matching rule). tests/qgis/check_010_rules.py
// loads them into QGIS and compares. Skipped without the variable.
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_LAYER_STYLE, EXPRESSION_VALUE_COLUMN, exportStyle, resolveStyle, type LayerStyle, type RulesRenderer } from '@spatial-explorer/core'

const OUT = process.env.SE_QGIS_RULES

const rows = [
  { continent: 'Africa', pop_est: 2e8, gdp_md: 400000 }, // both rules: the first wins
  { continent: 'Africa', pop_est: 1e6, gdp_md: 2000 },
  { continent: 'Asia', pop_est: 1.4e9, gdp_md: 14e6 },
  { continent: 'Europe', pop_est: 5e6, gdp_md: 300000 },
  { continent: null, pop_est: null, gdp_md: null },
  { continent: 'Asia', pop_est: 3e7, gdp_md: 900000 },
]

describe.runIf(OUT)('QGIS rules cases (SE_QGIS_RULES)', () => {
  it('writes the cases', () => {
    const dir = OUT as string
    fs.mkdirSync(dir, { recursive: true })
    const square = (i: number) => [[[i, 0], [i + 0.8, 0], [i + 0.8, 0.8], [i, 0.8], [i, 0]]]
    const geojson = { type: 'FeatureCollection', features: rows.map((properties, i) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: square(i) } })) }
    fs.writeFileSync(path.join(dir, 'world.geojson'), JSON.stringify(geojson))

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
    // Opaque fills: the QGIS check samples rendered pixels, which must be the rule colors exactly.
    const style: LayerStyle = { ...DEFAULT_LAYER_STYLE, fillOpacity: 1, renderer: rules }
    const columns = [{ name: 'continent', type: 'VARCHAR' }, { name: 'pop_est', type: 'DOUBLE' }, { name: 'gdp_md', type: 'DOUBLE' }]
    const first = (r: (typeof rows)[number]): number => (r.continent === 'Africa' ? 0 : r.pop_est !== null && r.pop_est > 1e8 ? 1 : -1)
    const counts = new Map<number, number>()
    for (const r of rows) counts.set(first(r), (counts.get(first(r)) ?? 0) + 1)
    const resolved = resolveStyle(style, { columns, rowCount: rows.length, ruleCounts: counts })
    fs.writeFileSync(path.join(dir, 'rules.qml'), exportStyle(style, 'qml', 'Polygon', 'world.geojson', resolved).text)
    const colors = [rules.rules[0].color, rules.rules[1].color]
    fs.writeFileSync(path.join(dir, 'rules.expected.json'), JSON.stringify({ features: rows.map((r) => (first(r) >= 0 ? colors[first(r)] : rules.elseColor)) }))

    const graduated: LayerStyle = {
      ...DEFAULT_LAYER_STYLE,
      renderer: { kind: 'graduated', column: 'GDP per person', expression: 'gdp_md * 1e6 / pop_est', method: 'equal', classCount: 3, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} },
    }
    const values = rows.map((r) => (r.gdp_md !== null && r.pop_est ? (r.gdp_md * 1e6) / r.pop_est : null))
    const gResolved = resolveStyle(graduated, { columns: [...columns, { name: EXPRESSION_VALUE_COLUMN, type: 'DOUBLE' }], features: values.map((v, id) => ({ id, geometry: null, attributes: { [EXPRESSION_VALUE_COLUMN]: v } })) })
    fs.writeFileSync(path.join(dir, 'expression.qml'), exportStyle(graduated, 'qml', 'Polygon', 'world.geojson', gResolved).text)
  })
})
