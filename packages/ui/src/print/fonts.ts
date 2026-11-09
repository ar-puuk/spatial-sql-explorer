// Print text styles (user decision 2026-11-09, constitution v1.10.0): Google Fonts, fetched by family name only after the
// user agrees. The CSS API answers with one @font-face per script subset; the font files are fetched as bytes (so only
// `connect-src` is needed in the webview, no `font-src`) and added to the document's fonts, where the canvas finds them.
// Only the subsets the print needs are fetched: latin and latin-ext always, others when the text uses their characters.
import { FACE_BOLD, FACE_BOLD_ITALIC, FACE_ITALIC, FACE_REGULAR, findGoogleFont, googleFontCatalog, isGoogleFamily } from '@spatial-explorer/core'
import type { PrintTextStyle } from '@spatial-explorer/core'

export const GOOGLE_FONTS_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'] as const

export interface FaceBlock {
  /** The script subset named in the CSS comment (latin, latin-ext, cyrillic, ...). */
  subset: string
  style: string
  weight: string
  unicodeRange: string
  url: string
}

/**
 * The CSS API URL for a family. `faces` is the catalog's mask of the faces it has (regular, bold, italic, bold italic):
 * those are asked for and no others, since the API refuses a face a family lacks. 0 asks for the family's default alone,
 * and null (a name the catalog does not list) for all four.
 */
export function googleCssUrl(family: string, faces: number | null): string {
  const name = encodeURIComponent(family.trim()).replace(/%20/g, '+')
  const mask = faces ?? FACE_REGULAR | FACE_BOLD | FACE_ITALIC | FACE_BOLD_ITALIC
  const tuples = [
    ...(mask & FACE_REGULAR ? ['0,400'] : []),
    ...(mask & FACE_BOLD ? ['0,700'] : []),
    ...(mask & FACE_ITALIC ? ['1,400'] : []),
    ...(mask & FACE_BOLD_ITALIC ? ['1,700'] : []),
  ]
  return `https://fonts.googleapis.com/css2?family=${name}${tuples.length ? `:ital,wght@${tuples.join(';')}` : ''}&display=swap`
}

/** The @font-face blocks of a Google Fonts stylesheet. */
export function parseFontFaces(css: string): FaceBlock[] {
  const blocks: FaceBlock[] = []
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const body = m[2]
    const url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/.exec(body)?.[1]
    if (!url) continue
    blocks.push({
      subset: m[1] ?? 'latin',
      style: /font-style:\s*([^;]+);/.exec(body)?.[1].trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim() ?? '400',
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim() ?? '',
      url,
    })
  }
  return blocks
}

/** Does the unicode-range cover one of the characters (code points) of `text`? */
export function rangeCovers(unicodeRange: string, text: string): boolean {
  const ranges = [...unicodeRange.matchAll(/U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/g)].map((m) => {
    if (m[1].includes('?')) return [parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)] as const
    const lo = parseInt(m[1], 16)
    return [lo, m[2] ? parseInt(m[2], 16) : lo] as const
  })
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) return true
  }
  return false
}

/** The blocks a print with this text needs: the Latin subsets always, any other whose characters the text uses. */
export function neededBlocks(blocks: FaceBlock[], text: string): FaceBlock[] {
  return blocks.filter((b) => b.subset === 'latin' || b.subset === 'latin-ext' || rangeCovers(b.unicodeRange, text))
}

/** The Google families a set of styles asks for. */
export function googleFamiliesOf(styles: (PrintTextStyle | undefined)[]): string[] {
  return [...new Set(styles.map((s) => s?.family.trim() ?? '').filter((f) => f && isGoogleFamily(f)))]
}

const loadedBlocks = new Set<string>()
/** The faces added to the document, so they can be taken out again when the user withdraws their agreement. */
const addedFaces = new Set<FontFace>()
const cssCache = new Map<string, Promise<FaceBlock[] | null>>()

async function stylesheet(family: string, fetchFn: typeof fetch): Promise<FaceBlock[] | null> {
  const cached = cssCache.get(family)
  if (cached) return cached
  const load = (async () => {
    // The faces the catalog lists for it; if the API refuses them (or the name is unlisted), its default face alone.
    await googleFontCatalog().catch(() => [])
    const faces = findGoogleFont(family)?.variants ?? null
    for (const asked of faces === 0 ? [0] : [faces, 0]) {
      try {
        const res = await fetchFn(googleCssUrl(family, asked))
        if (res.ok) return parseFontFaces(await res.text())
      } catch {
        return null
      }
    }
    return null
  })()
  cssCache.set(family, load)
  // A failure is not remembered: the next try asks again.
  void load.then((r) => {
    if (!r) cssCache.delete(family)
  })
  return load
}

/** Takes every Google font out of the page and forgets what was fetched: nothing is drawn with them, and a later yes fetches again. */
export function unloadGoogleFonts(): void {
  for (const face of addedFaces) document.fonts.delete(face)
  addedFaces.clear()
  loadedBlocks.clear()
  cssCache.clear()
}

/**
 * Loads a Google family into the document's fonts for the characters of `text`. Resolves false when it could not be
 * fetched (offline, blocked, no such family): the print then draws with the generic fallback of its font stack.
 */
export async function loadGoogleFont(family: string, text: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const blocks = await stylesheet(family, fetchFn)
  if (!blocks || !blocks.length) return false
  try {
    for (const b of neededBlocks(blocks, text)) {
      const key = `${family}|${b.style}|${b.weight}|${b.subset}`
      if (loadedBlocks.has(key)) continue
      const res = await fetchFn(b.url)
      if (!res.ok) return false
      const face = new FontFace(family, await res.arrayBuffer(), { style: b.style, weight: b.weight, unicodeRange: b.unicodeRange || undefined })
      await face.load()
      document.fonts.add(face)
      addedFaces.add(face)
      loadedBlocks.add(key)
    }
    return true
  } catch {
    return false
  }
}
