// Spec 010 T041: the "More basemaps…" gallery, generated from
// maplibre-gl-basemap-control's catalog (MIT, © 2026 Qiusheng Wu), plus keyless
// vector styles the package lacks (CARTO GL, VersaTiles). The package is a
// devDependency used only here; the app imports the JSON this writes.
//
//   node scripts/basemap-catalog.mjs
//
// Writes packages/core/src/basemapGallery.json and
// apps/vscode-ext/src/basemapHosts.generated.ts (the webview CSP host list).
// Rerun after upgrading maplibre-gl-basemap-control.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_BASEMAPS, DEFAULT_BASEMAP_PROVIDERS } from 'maplibre-gl-basemap-control'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = 'maplibre-gl-basemap-control'
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', PACKAGE, 'package.json'), 'utf8')).version

/**
 * Every provider is offered (user decision 2026-10-13). Still left out: entries
 * meant to sit on top of another basemap (labels-only, traffic, overlays), since
 * one basemap is drawn at a time, and 3D styles (CLAUDE.md: nothing else 3D).
 */
const EXCLUDED_CATEGORIES = new Set(['Labels', 'Traffic', '3D'])
/** Keyed hosts whose URLs hold a placeholder (or come from a style only a key can fetch). */
const KEYED_HOSTS = {
  maptiler: ['https://api.maptiler.com'],
  stadia: ['https://tiles.stadiamaps.com'],
  protomaps: ['https://api.protomaps.com', 'https://protomaps.github.io'],
  carto: ['https://*.basemaps.cartocdn.com'],
  // Styles reference mapbox:// sprites, fonts and tilesets, rewritten to these (basemap.ts).
  mapbox: ['https://api.mapbox.com', 'https://*.tiles.mapbox.com'],
  // maps.geo.<region>.amazonaws.com: the region is the user's.
  amazon: ['https://*.amazonaws.com'],
  // Session tiles (with a key) and the keyless public tiles.
  google: ['https://tile.googleapis.com'],
  tianditu: ['https://*.tianditu.gov.cn'],
}

/** Keyless vector styles the package doesn't list (checked 2026-10-13: styles, tiles, sprites and fonts answer without a key). */
const EXTRA_PROVIDERS = [
  { id: 'carto-gl', name: 'CARTO (vector)' },
  { id: 'versatiles', name: 'VersaTiles' },
]
const CARTO_GL_ATTRIBUTION = '&copy; <a href="https://carto.com/about-carto/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const VERSATILES_ATTRIBUTION = '&copy; <a href="https://versatiles.org">VersaTiles</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const EXTRA_BASEMAPS = [
  ...[
    ['positron', 'Positron', 'Light', 'Light vector basemap for data overlays.'],
    ['positron-nolabels', 'Positron No Labels', 'Light', 'Light vector basemap without labels.'],
    ['voyager', 'Voyager', 'Street', 'Detailed vector street basemap with subtle styling.'],
    ['voyager-nolabels', 'Voyager No Labels', 'Street', 'Voyager without labels.'],
    ['dark-matter', 'Dark Matter', 'Dark', 'Dark vector basemap for high-contrast overlays.'],
    ['dark-matter-nolabels', 'Dark Matter No Labels', 'Dark', 'Dark vector basemap without labels.'],
  ].map(([slug, name, category, description]) => ({
    id: `carto-gl-${slug}`,
    name: `CARTO ${name}`,
    provider: 'carto-gl',
    type: 'style',
    category,
    description,
    attribution: CARTO_GL_ATTRIBUTION,
    source: { type: 'style', url: `https://basemaps.cartocdn.com/gl/${slug}-gl-style/style.json` },
    tags: ['carto', 'vector', 'style', category.toLowerCase()],
  })),
  ...[
    ['colorful', 'Colorful', 'Street', 'Colorful general-purpose vector map.'],
    ['colorful-dark', 'Colorful Dark', 'Dark', 'Dark version of Colorful.'],
    ['gray', 'Gray', 'Light', 'Gray vector map for data overlays.'],
    ['gray-dark', 'Gray Dark', 'Dark', 'Dark gray vector map for data overlays.'],
    ['muted', 'Muted', 'Light', 'Muted, low-contrast vector map.'],
  ].map(([slug, name, category, description]) => ({
    id: `versatiles-${slug}`,
    name: `VersaTiles ${name}`,
    provider: 'versatiles',
    type: 'style',
    category,
    description,
    attribution: VERSATILES_ATTRIBUTION,
    source: { type: 'style', url: `https://tiles.versatiles.org/assets/styles/${slug}/style.json` },
    tags: ['versatiles', 'vector', 'style', 'shortbread', category.toLowerCase()],
  })),
]

// The featured catalog (packages/core/src/basemapCatalog.ts) is TypeScript: read its ids and URLs as text.
const featuredSource = fs.readFileSync(path.join(ROOT, 'packages/core/src/basemapCatalog.ts'), 'utf8')
const featuredRows = [...featuredSource.matchAll(/id:\s*'([^']+)'[\s\S]*?url:\s*'([^']*)'/g)].map((m) => ({ id: m[1], url: m[2] })).filter((r) => r.url)
/** Compares URLs without a subdomain letter or `{s}`, so `a.tile.osm.org` matches `tile.osm.org`. */
const sameUrl = (u) => u.replace(/^https?:\/\/(\{s\}|[a-d])\./, 'https://').replace(/\?.*$/, '')
const featuredByUrl = new Map(featuredRows.map((r) => [sameUrl(r.url), r.id]))

const providerName = new Map([...DEFAULT_BASEMAP_PROVIDERS, ...EXTRA_PROVIDERS].map((p) => [p.id, p.name]))

/** Keeps only `<a href="https://…">text</a>` links; every other tag is stripped. */
function sanitizeAttribution(html) {
  const links = []
  const kept = String(html ?? '').replace(/<a\s[^>]*href="(https:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href, text) => {
    links.push(`<a href="${href}">${text.replace(/<[^>]*>/g, '')}</a>`)
    return `\u0000${links.length - 1}\u0000`
  })
  return kept.replace(/<[^>]*>/g, '').replace(/\u0000(\d+)\u0000/g, (_m, i) => links[Number(i)]).trim()
}

function excluded(b) {
  if (EXCLUDED_CATEGORIES.has(b.category)) return true
  if (b.type === 'vector-overlay') return true
  if ((b.tags ?? []).includes('overlay')) return true
  return false
}

/**
 * Upstream slips (0.14.4): two MapTiler styles end in `?key` / `?key=` without the
 * placeholder; every MapTiler style needs a key (they answer 403 without one).
 */
function fixUrl(b, url) {
  if (b.provider === 'maptiler' && url && !url.includes('{api-key}')) return url.replace(/([?&]key)=?$/, '$1={api-key}')
  return url
}

/** The GCJ-02 datum offset, from the package's own descriptions (Amap, Tencent). */
const warningOf = (description) => (/GCJ-02/.test(description ?? '') ? 'Tiles are in the GCJ-02 datum: WGS84 data appears offset by roughly 100–700 m.' : undefined)

const basemaps = []
for (const b of [...DEFAULT_BASEMAPS, ...EXTRA_BASEMAPS]) {
  if (excluded(b)) continue
  const url = fixUrl(b, b.source.url)
  const tiles = b.source.tiles
  const first = url ?? tiles?.[0] ?? ''
  const keyed = JSON.stringify({ url, tiles }).includes('{api-key}')
  // Google: keyless public tiles, or with a key the Map Tiles API (a session per map type).
  const session = b.source.googleSession && b.source.sessionTiles ? { sessionTiles: b.source.sessionTiles, googleSession: b.source.googleSession } : {}
  const warning = warningOf(b.description)
  basemaps.push({
    id: `g-${b.id}`,
    name: b.name,
    provider: b.provider,
    providerName: providerName.get(b.provider) ?? b.provider,
    kind: b.type === 'style' ? 'vector' : 'raster',
    category: b.category,
    // The datum sentence becomes the row's warning; the description keeps the rest.
    description: (b.description ?? '').replace(/s*Tiles are in the GCJ-02 datum[^.]*.?/, '').trim(),
    attribution: sanitizeAttribution(b.attribution),
    ...(b.type === 'style' ? { url } : { tiles }),
    ...session,
    ...(b.source.tileSize ? { tileSize: b.source.tileSize } : {}),
    ...(b.source.maxzoom !== undefined ? { maxzoom: b.source.maxzoom } : {}),
    // Raster sources numbered bottom-up (TMS).
    ...(b.source.scheme ? { scheme: b.source.scheme } : {}),
    key: keyed ? 'required' : session.sessionTiles ? 'optional' : 'none',
    // Amazon Location: the style URL also names the user's AWS region.
    ...(JSON.stringify({ url, tiles }).includes('{aws-region}') ? { region: true } : {}),
    ...(featuredByUrl.has(sameUrl(first)) ? { featuredId: featuredByUrl.get(sameUrl(first)) } : {}),
    ...(warning ? { warning } : {}),
    tags: b.tags ?? [],
  })
}
basemaps.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name))

// --- CSP hosts -------------------------------------------------------------
const hosts = new Set()
const addHost = (u) => {
  const m = /^(https:\/\/[^/?#]+)/.exec(String(u ?? '').replace(/^mapbox:\/\//, ''))
  if (m && !m[1].includes('{')) hosts.add(m[1])
}
for (const b of basemaps) {
  addHost(b.url)
  for (const t of [...(b.tiles ?? []), ...(b.sessionTiles ?? [])]) addHost(t)
}
for (const list of Object.values(KEYED_HOSTS)) for (const h of list) hosts.add(h)

/** A keyless vector style's own hosts: sprite, glyphs, and each source (and its TileJSON). */
async function styleHosts(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const style = await res.json()
  const sprites = Array.isArray(style.sprite) ? style.sprite.map((s) => s.url) : [style.sprite]
  for (const s of sprites) addHost(s)
  addHost(style.glyphs)
  for (const src of Object.values(style.sources ?? {})) {
    for (const t of src.tiles ?? []) addHost(t)
    if (src.url) {
      addHost(src.url)
      if (/^https:/.test(src.url)) {
        try {
          const tj = await (await fetch(src.url)).json()
          for (const t of tj.tiles ?? []) addHost(t)
        } catch (err) {
          console.warn(`  TileJSON ${src.url}: ${err.message}`)
        }
      }
    }
  }
}
for (const b of basemaps.filter((x) => x.kind === 'vector' && x.key === 'none')) {
  try {
    await styleHosts(b.url)
  } catch (err) {
    console.warn(`  ${b.id}: style not read (${err.message}); only its own host is allowed`)
  }
}

// Hosts that differ only by a subdomain label (a., b., tiles-a., mt1., t0., rt2., wprd03.) become one wildcard.
const shard = /^https:\/\/([a-d]|tiles-[a-d]|mt\d|t\d|rt\d|wprd\d+|webrd\d+|webst\d+)\.(.+)$/
const byRest = new Map()
for (const h of hosts) {
  const m = shard.exec(h)
  if (m) byRest.set(m[2], (byRest.get(m[2]) ?? 0) + 1)
}
const finalHosts = new Set()
for (const h of hosts) {
  const m = shard.exec(h)
  finalHosts.add(m && byRest.get(m[2]) > 1 ? `https://*.${m[2]}` : h)
}
// A wildcard already covers its subdomains.
const wild = [...finalHosts].filter((h) => h.startsWith('https://*.')).map((h) => h.slice('https://*'.length))
const hostList = [...finalHosts].filter((h) => h.startsWith('https://*.') || !wild.some((w) => h.endsWith(w))).sort()

const json = { source: `${PACKAGE}@${version} (MIT, © 2026 Qiusheng Wu), plus CARTO GL and VersaTiles styles`, basemaps }
fs.writeFileSync(path.join(ROOT, 'packages/core/src/basemapGallery.json'), JSON.stringify(json, null, 2) + '\n')
fs.writeFileSync(
  path.join(ROOT, 'apps/vscode-ext/src/basemapHosts.generated.ts'),
  `// Generated by scripts/basemap-catalog.mjs. Do not edit.\nexport const BASEMAP_HOSTS = '${hostList.join(' ')}'\n`
)
const providers = new Set(basemaps.map((b) => b.provider))
console.log(`basemapGallery.json: ${basemaps.length} basemaps from ${providers.size} providers (${PACKAGE}@${version} plus extras); ${hostList.length} CSP hosts`)
