// Spec 012: basemap previews. Bundled thumbnails for every keyless vector
// style, and one live raster tile of the same place for raster rows.
import { describe, expect, it } from 'vitest'
import { BASEMAP_CATALOG, BASEMAP_PREVIEW_VIEW, GALLERY, basemapPreviewTile, catalogPreviewTile, loadBasemapThumbnails } from '@spatial-explorer/core'

describe('bundled thumbnails', () => {
  it('cover every keyless vector style, featured rows by their own id (rerun scripts/basemap-thumbnails.mjs when one is missing)', async () => {
    const thumbs = await loadBasemapThumbnails()
    const wanted = GALLERY.filter((g) => g.kind === 'vector' && g.key === 'none').map((g) => g.featuredId ?? g.id)
    for (const e of BASEMAP_CATALOG.filter((e) => e.type === 'vector')) expect(wanted).toContain(e.id)
    expect(wanted.filter((id) => !thumbs[id])).toEqual([])
    for (const id of wanted) expect(thumbs[id]).toMatch(/^data:image\/webp;base64,/)
  })

  it('frame one place, the same as the script renders', async () => {
    const doc = (await import('../../packages/core/src/basemapThumbnails.json')).default
    expect(doc.view).toEqual({ center: [...BASEMAP_PREVIEW_VIEW.center], zoom: BASEMAP_PREVIEW_VIEW.zoom })
  })
})

describe('raster preview tiles', () => {
  it('take the tile holding the preview place, two zooms past the vector view, with the place within it', () => {
    const t = basemapPreviewTile('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    // Zurich at z12.
    expect(t.src).toBe('https://tile.openstreetmap.org/12/2145/1434.png')
    expect(t.x).toBeGreaterThan(0)
    expect(t.x).toBeLessThan(1)
    expect(t.y).toBeGreaterThan(0)
    expect(t.y).toBeLessThan(1)
  })

  it("respect the provider's maxzoom, TMS rows, subdomains and {r}", () => {
    expect(basemapPreviewTile('https://x/{z}/{x}/{y}', { maxzoom: 9 }).src).toBe('https://x/9/268/179')
    expect(basemapPreviewTile('https://x/{z}/{x}/{y}', { maxzoom: 9, scheme: 'tms' }).src).toBe(`https://x/9/268/${2 ** 9 - 1 - 179}`)
    expect(basemapPreviewTile('https://{s}.x/{z}/{x}/{y}{r}.png', { maxzoom: 9, subdomains: ['b', 'c'] }).src).toBe('https://b.x/9/268/179.png')
  })

  it('featured raster rows have one; vector rows and Blank use thumbnails', () => {
    expect(catalogPreviewTile(BASEMAP_CATALOG.find((e) => e.id === 'esri-imagery')!)?.src).toContain('/tile/12/1434/2145')
    expect(catalogPreviewTile(BASEMAP_CATALOG.find((e) => e.id === 'openfreemap-positron')!)).toBeNull()
    expect(catalogPreviewTile(BASEMAP_CATALOG.find((e) => e.id === 'blank')!)).toBeNull()
  })
})
