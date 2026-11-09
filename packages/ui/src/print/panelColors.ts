// Adapted from GeoLibre (MIT): PanelColors, the colors of the panels drawn over the map (user request 2026-11-09, GeoLibre PR 3349).

import type { PrintTextStyle } from "@spatial-explorer/core";
import { fontStack } from "@spatial-explorer/core";
import { hexAlpha } from "./textStyle.js";

export type PanelTheme = "light" | "dark";

export interface PanelColors {
  ink: string;
  muted: string;
  border: string;
  /** Solid paper color (the scale bar's pale segments). */
  paperSolid: string;
  /** The panel backing at translucency `alpha`. */
  paper: (alpha: number) => string;
  /** The map credit's two text shades. */
  creditLead: string;
  creditRest: string;
  /** The panels' text style: the CSS family list, bold for all text, italic, and the size factor (the callers scale their unit by it). */
  family: string;
  bold: boolean;
  italic: boolean;
  size: number;
}

/** The canvas font for panel text of a designed weight and size. */
export function panelFont(pc: PanelColors, weight: number, px: number): string {
  return `${pc.italic ? "italic " : ""}${pc.bold ? 700 : weight} ${px}px ${pc.family}`;
}

const LIGHT: PanelColors = {
  ink: "#111827",
  muted: "#6b7280",
  border: "#9ca3af",
  paperSolid: "#ffffff",
  paper: (a) => `rgba(255,255,255,${a})`,
  creditLead: "#374151",
  creditRest: "#6b7280",
  family: "",
  bold: false,
  italic: false,
  size: 1,
};

const DARK: PanelColors = {
  ink: "#f3f4f6",
  muted: "#9ca3af",
  border: "#4b5563",
  paperSolid: "#111827",
  paper: (a) => `rgba(17,24,39,${a})`,
  creditLead: "#e5e7eb",
  creditRest: "#9ca3af",
  family: "",
  bold: false,
  italic: false,
  size: 1,
};

/** The page color when none is chosen: the panels' own paper, so the page and the panels agree. */
export function autoPageBackground(theme: PanelTheme | undefined): string {
  return theme === "dark" ? "#111827" : "#ffffff";
}

export function panelColors(theme: PanelTheme | undefined, style?: PrintTextStyle): PanelColors {
  const base = theme === "dark" ? DARK : LIGHT;
  const font = { family: fontStack(style?.family ?? ""), bold: style?.bold ?? false, italic: style?.italic ?? false, size: (style?.size ?? 100) / 100 };
  // A chosen color is used for all the panels' text (the lighter shade is the same color, a little fainter).
  if (style?.color) return { ...base, ...font, ink: style.color, muted: hexAlpha(style.color, 0.7), creditLead: style.color, creditRest: hexAlpha(style.color, 0.7) };
  return { ...base, ...font };
}

/** WCAG: is white text more readable than black on this #RGB or #RRGGBB color? */
export function prefersLightForeground(hex: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return 1.05 / (L + 0.05) > (L + 0.05) / 0.05;
}
