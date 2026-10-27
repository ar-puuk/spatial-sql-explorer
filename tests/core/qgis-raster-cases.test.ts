// Spec 026 (SC-003 for rasters): QGIS parity cases for the raster style sidecar. With SE_QGIS_026=<dir>, writes for each case
// a copy of a fixture raster, the QML the app saves for a style, and what that style should mean in QGIS's terms (renderer,
// band, range, opacity, colors, transparent value). tests/qgis/check_raster.py loads each pair in a real QGIS and compares.
// Skipped without the variable (it needs PyQGIS to mean anything).
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { defaultRasterStyle, factsFromTiler, rasterStyleToQml, type FactsInput, type RasterFacts, type RasterStyle } from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

const OUT = process.env.SE_QGIS_026
const FIXTURES = path.resolve(__dirname, '../vscode-ext/fixtures/raster')
const files = captured as unknown as Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const facts = (name: string): RasterFacts => factsFromTiler(files[name])
const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']

interface Case {
  name: string
  tif: string
  facts: RasterFacts
  style: RasterStyle
  ramp?: string[]
}

const dem = facts('dem_32612')
const rgb = facts('rgb_cog')
const classes = facts('classes_pal')

const CASES: Case[] = [
  { name: 'ramp', tif: 'dem-utm12.tif', facts: dem, style: { ...defaultRasterStyle(dem), min: 1500, max: 1900, opacity: 1 }, ramp: RAMP },
  { name: 'ramp-reversed-opacity', tif: 'dem-utm12.tif', facts: dem, style: { ...defaultRasterStyle(dem), min: 1400, max: 2100, reversed: true, opacity: 0.4 }, ramp: RAMP },
  { name: 'gray', tif: 'dem-utm12.tif', facts: dem, style: { ...defaultRasterStyle(dem), colormap: 'gray', min: 1450, max: 2000 } },
  { name: 'gray-reversed', tif: 'dem-utm12.tif', facts: dem, style: { ...defaultRasterStyle(dem), colormap: 'gray', reversed: true, min: 1450, max: 2000 } },
  { name: 'nodata-value', tif: 'dem-utm12.tif', facts: dem, style: { ...defaultRasterStyle(dem), nodata: { mode: 'value', value: -9999 } }, ramp: RAMP },
  { name: 'colors', tif: 'ortho-rgb.tif', facts: rgb, style: { ...defaultRasterStyle(rgb), bands: [3, 2, 1], rescale: [[0, 200], [10, 220], [20, 240]] } },
  { name: 'classes', tif: 'classes.tif', facts: classes, style: defaultRasterStyle(classes) },
]

describe.runIf(OUT)('QGIS parity cases for raster styles (SE_QGIS_026)', () => {
  it('writes the cases', () => {
    const dir = OUT as string
    fs.mkdirSync(dir, { recursive: true })
    for (const c of CASES) {
      fs.copyFileSync(path.join(FIXTURES, c.tif), path.join(dir, `${c.name}.tif`))
      fs.writeFileSync(path.join(dir, `${c.name}.qml`), rasterStyleToQml(c.style, c.facts, { ramp: c.ramp ?? null, palette: c.facts.palette }))
      const s = c.style
      const expected: Record<string, unknown> = {
        renderer: s.mode === 'rgb' ? 'multibandcolor' : s.mode === 'paletted' ? 'paletted' : s.colormap === 'gray' ? 'singlebandgray' : 'singlebandpseudocolor',
        opacity: s.opacity,
        bands: s.bands,
        min: s.min,
        max: s.max,
        reversed: s.reversed,
        ...(s.mode === 'rgb' ? { rescale: s.rescale } : {}),
        ...(s.nodata.mode === 'value' ? { transparentValue: s.nodata.value } : {}),
        ...(c.ramp && s.mode === 'single' && s.colormap !== 'gray' ? { ramp: s.reversed ? [...c.ramp].reverse() : c.ramp } : {}),
        ...(s.mode === 'paletted' ? { classes: c.facts.palette } : {}),
      }
      fs.writeFileSync(path.join(dir, `${c.name}.expected.json`), JSON.stringify(expected, null, 1))
    }
  })
})
