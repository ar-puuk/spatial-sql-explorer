// Spec 027: a chart's SVG text drawn to a PNG (at 2x, so it stays sharp in a document). The SVG is self-contained (core
// chartSvg.ts: fixed colors, white background), so drawing it needs nothing from the page. Images from `blob:` are allowed by
// the webview's content security policy (the print layout and the map image use them too).
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.width = width
    img.height = height
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The picture could not be made: no drawing surface.')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('The picture could not be made.')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
