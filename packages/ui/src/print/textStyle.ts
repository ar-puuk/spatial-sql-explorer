// Print text styles (user decision 2026-11-09): the canvas font and underline for a PrintTextStyle. The canvas has no
// underline, so it is drawn as a thin rule under the text (which also works on svgcanvas, for the SVG and the PDF).
import { fontStack, type PrintTextStyle } from "@spatial-explorer/core";

/** The size of a text style as a factor of its designed size. */
export function textScale(style: PrintTextStyle | undefined): number {
  return style ? style.size / 100 : 1;
}

/**
 * The canvas font for text of a style: `px` is the designed size (the style's own scale is applied by the caller, which
 * also needs it for the layout). Bold is the regular weight 700, otherwise 400.
 */
export function styledFont(style: PrintTextStyle | undefined, px: number): string {
  const italic = style?.italic ? "italic " : "";
  return `${italic}${style?.bold ? 700 : 400} ${px}px ${fontStack(style?.family ?? "")}`;
}

/**
 * Draws a rule under the text just drawn at (x, y) with the context's current alignment and baseline, in the fill color.
 * Alphabetic and middle baselines are the ones the print uses.
 */
export function drawUnderline(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, maxWidth?: number): void {
  const width = Math.min(ctx.measureText(text).width, maxWidth ?? Number.POSITIVE_INFINITY);
  const x0 = ctx.textAlign === "right" || ctx.textAlign === "end" ? x - width : ctx.textAlign === "center" ? x - width / 2 : x;
  const baseline = ctx.textBaseline === "middle" ? y + px * 0.42 : y + px * 0.12;
  const thickness = Math.max(1, px * 0.07);
  ctx.fillRect(x0, baseline, width, thickness);
}

/** Does the page use a font of the user's choosing (not the default sans)? A PDF's built-in fonts cannot set it. */
export function usesCustomFont(opts: { titleStyle?: PrintTextStyle; subtitleStyle?: PrintTextStyle; footerStyle?: PrintTextStyle; panelStyle?: PrintTextStyle }): boolean {
  return [opts.titleStyle, opts.subtitleStyle, opts.footerStyle, opts.panelStyle].some((s) => (s?.family ?? '').trim() !== '')
}

/** `#rgb` or `#rrggbb` as an rgba() string at `alpha`. */
export function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
