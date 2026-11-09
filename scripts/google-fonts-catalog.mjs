// Print text styles (user decision 2026-11-09): the Google Fonts families the print's font picker offers.
//
//   node scripts/google-fonts-catalog.mjs
//
// Reads Google's font metadata (https://fonts.google.com/metadata/fonts: the list the Google Fonts site itself uses; it is
// not a documented API, so the app never calls it) and writes packages/core/src/googleFontsCatalog.json: one row per family,
// [name, category, variants], most popular first. `variants` is a bit mask of the faces the print asks for:
// 1 = regular, 2 = bold, 4 = italic, 8 = bold italic, so a font is requested with exactly the faces it has.
// The app loads the file only when the person turns Google Fonts on. Rerun it now and then to pick up new families.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'packages', 'core', 'src', 'googleFontsCatalog.json')
const SOURCE = 'https://fonts.google.com/metadata/fonts'

const CATEGORY = { 'Sans Serif': 'sans', Serif: 'serif', Monospace: 'mono', Display: 'display', Handwriting: 'handwriting' }

const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`)
const { familyMetadataList: families } = await res.json()
if (!Array.isArray(families) || families.length < 1000) throw new Error('The metadata has no family list: its shape changed.')

/** The faces of a family as the print asks for them: 400 and 700, upright and italic. */
function variants(fonts) {
  const has = (key) => Object.prototype.hasOwnProperty.call(fonts, key)
  return (has('400') ? 1 : 0) | (has('700') ? 2 : 0) | (has('400i') ? 4 : 0) | (has('700i') ? 8 : 0)
}

const rows = families
  .filter((f) => CATEGORY[f.category] && f.family)
  .sort((a, b) => a.popularity - b.popularity)
  .map((f) => [f.family, CATEGORY[f.category], variants(f.fonts ?? {})])

fs.writeFileSync(OUT, JSON.stringify(rows) + '\n')
console.log(`${rows.length} families -> ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`)
