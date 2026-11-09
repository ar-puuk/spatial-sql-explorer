// Adapted from GeoLibre (MIT): PanelColors, the colors of the panels drawn over the map (user request 2026-11-09, GeoLibre PR 3349).

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
}

const LIGHT: PanelColors = {
  ink: "#111827",
  muted: "#6b7280",
  border: "#9ca3af",
  paperSolid: "#ffffff",
  paper: (a) => `rgba(255,255,255,${a})`,
  creditLead: "#374151",
  creditRest: "#6b7280",
};

const DARK: PanelColors = {
  ink: "#f3f4f6",
  muted: "#9ca3af",
  border: "#4b5563",
  paperSolid: "#111827",
  paper: (a) => `rgba(17,24,39,${a})`,
  creditLead: "#e5e7eb",
  creditRest: "#9ca3af",
};

export function panelColors(theme: PanelTheme | undefined): PanelColors {
  return theme === "dark" ? DARK : LIGHT;
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
