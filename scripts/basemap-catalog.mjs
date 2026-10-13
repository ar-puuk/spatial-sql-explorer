// Spec 010 T041: the "More basemaps…" gallery, generated from
// maplibre-gl-basemap-control's catalog (MIT, © 2026 Qiusheng Wu). The package is a
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

/** Need request rewriting or sessions, or are out of scope (CLAUDE.md "Basemaps"). */
const EXCLUDED_PROVIDERS = new Set(['google', 'tianditu', 'amap', 'tencent', 'here', 'tomtom', 'mapbox', 'amazon', 'waymarkedtrails', 'openrailwaymap'])
const EXCLUDED_CATEGORIES = new Set(['Labels', 'Traffic', '3D'])
/**
 * Providers whose keyed URLs also work without a key. None today: CARTO answers
 * 200 without one, but every tile is an "API KEY REQUIRED" image (research.md S6).
 */
const KEY_OPTIONAL_PROVIDERS = new Set([])
/** Keyed providers: hosts their styles and tiles use (their styles can't be fetched without a key). */
const KEYED_HOSTS = {
  maptiler: ['https://api.maptiler.com'],
  stadia: ['https://tiles.stadiamaps.com'],
  protomaps: ['https://api.protomaps.com', 'https://protomaps.github.io'],
  carto: ['https://*.basemaps.cartocdn.com'],
}

// The featured catalog (packages/core/src/basemapCatalog.ts) is TypeScript: read its URLs as text.
const featuredSource = fs.readFileSync(path.join(ROOT, 'packages/core/src/basemapCatalog.ts'), 'utf8')
const featuredUrls = [...featuredSource.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]).filter(Boolean)
/** Compares URLs without a subdomain letter or `{s}`, so `a.tile.osm.org` matches `tile.osm.org`. */
const sameUrl = (u) => u.replace(/^https?:\/\/(\{s\}|[a-d])\./, 'https://').replace(/\?.*$/, '')
const featured = new Set(featuredUrls.map(sameUrl))

const providerName = new Map(DEFAULT_BASEMAP_PROVIDERS.map((p) => [p.id, p.name]))

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
  if (EXCLUDED_PROVIDERS.has(b.provider)) return true
  if (EXCLUDED_CATEGORIES.has(b.category)) return true
  if (b.type === 'vector-overlay') return true
  if ((b.tags ?? []).includes('overlay')) return true
  if (JSON.stringify(b.source).includes('{session}')) return true
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

const basemaps = []
for (const b of DEFAULT_BASEMAPS) {
  if (excluded(b)) continue
  const url = fixUrl(b, b.source.url)
  const tiles = b.source.tiles
  const first = url ?? tiles?.[0] ?? ''
  if (featured.has(sameUrl(first))) continue
  const keyed = JSON.stringify({ url, tiles }).includes('{api-key}')
  basemaps.push({
    id: `g-${b.id}`,
    name: b.name,
    provider: b.provider,
    providerName: providerName.get(b.provider) ?? b.provider,
    kind: b.type === 'style' ? 'vector' : 'raster',
    category: b.category,
    description: b.description ?? '',
    attribution: sanitizeAttribution(b.attribution),
    ...(b.type === 'style' ? { url } : { tiles }),
    ...(b.source.tileSize ? { tileSize: b.source.tileSize } : {}),
    ...(b.source.maxzoom !== undefined ? { maxzoom: b.source.maxzoom } : {}),
    // Raster sources numbered bottom-up (TMS).
    ...(b.source.scheme ? { scheme: b.source.scheme } : {}),
    key: keyed ? (KEY_OPTIONAL_PROVIDERS.has(b.provider) ? 'optional' : 'required') : 'none',
    tags: b.tags ?? [],
  })
}
basemaps.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))

// --- CSP hosts -------------------------------------------------------------
const hosts = new Set()
const addHost = (u) => {
  const m = /^(https:\/\/[^/?#]+)/.exec(String(u ?? '').replace(/^mapbox:\/\//, ''))
  if (m && !m[1].includes('{')) hosts.add(m[1])
}
for (const b of basemaps) {
  addHost(b.url)
  for (const t of b.tiles ?? []) addHost(t)
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

// Hosts that differ only by a subdomain letter become one wildcard.
const byRest = new Map()
for (const h of hosts) {
  const m = /^https:\/\/([a-d])\.(.+)$/.exec(h)
  const key = m ? m[2] : null
  if (key) byRest.set(key, (byRest.get(key) ?? 0) + 1)
}
const finalHosts = new Set()
for (const h of hosts) {
  const m = /^https:\/\/([a-d])\.(.+)$/.exec(h)
  finalHosts.add(m && byRest.get(m[2]) > 1 ? `https://*.${m[2]}` : h)
}
const hostList = [...finalHosts].sort()

const json = { source: `${PACKAGE}@${version} (MIT, © 2026 Qiusheng Wu)`, basemaps }
fs.writeFileSync(path.join(ROOT, 'packages/core/src/basemapGallery.json'), JSON.stringify(json, null, 2) + '\n')
fs.writeFileSync(
  path.join(ROOT, 'apps/vscode-ext/src/basemapHosts.generated.ts'),
  `// Generated by scripts/basemap-catalog.mjs. Do not edit.\nexport const BASEMAP_HOSTS = '${hostList.join(' ')}'\n`
)
console.log(`basemapGallery.json: ${basemaps.length} basemaps from ${PACKAGE}@${version}; ${hostList.length} CSP hosts`)
