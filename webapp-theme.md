# webapp-theme.md — Pukar Bhandari Web Tools Brand Theme

## Purpose
This file defines the unified visual design system for all three browser-based tools:
- **parquet-viewer** — GeoParquet & Parquet file explorer (React + Tailwind)
- **spatial-sql-explorer** — Spatial SQL query tool (current accent: orange → migrate to brand amber)
- **omx-viewer** — HDF5 matrix explorer

Copy this file to the root of any repo. When asking Claude to update the UI, say:
> "Update the UI to match the theme defined in `webapp-theme.md` in this repo."

---

## Brand Foundations

Derived from the `pb-logo.svg` mark and personal portfolio.

| Token | Value | Role |
|---|---|---|
| `brand-dark` | `#0e171e` | Deep navy — dark surfaces, logo background |
| `brand-cream` | `#fffbf2` | Warm cream — light surfaces, logo foreground |
| `brand-amber` | `#b45309` | Amber-700 — primary accent on light backgrounds |
| `brand-amber-bright` | `#fbbf24` | Amber-400 — primary accent on dark backgrounds |

---

## Color System

### Light Mode

**Surfaces**
| Role | Hex | Tailwind equiv |
|---|---|---|
| App root / main content | `#fffbf2` | — (custom, brand cream) |
| Panel chrome / sidebars | `#f2ece0` | — |
| Cards / inputs / table rows | `#ffffff` | `white` |
| Subtle section bg | `#f8f4ec` | — |

**Borders**
| Role | Hex | Tailwind equiv |
|---|---|---|
| Subtle (cell lines, separators) | `#e8dfc8` | — |
| Default (panel edges) | `#d4c5a9` | — |
| Strong (header bottoms, dividers) | `#b8a88a` | — |

**Text**
| Role | Hex | Tailwind equiv |
|---|---|---|
| Primary | `#1c1208` | — (warm near-black) |
| Secondary (labels, captions) | `#6b5e4a` | — |
| Muted (placeholders, disabled) | `#a8977a` | — |

**Accent (Amber)**
| Role | Hex | Notes |
|---|---|---|
| Button bg / active borders | `#b45309` | amber-700 — 4.9:1 contrast with white text ✓ |
| Button hover | `#92400e` | amber-800 |
| Selection / highlight bg | `#fef3c7` | amber-100 |
| Text on highlight bg | `#92400e` | amber-800 |
| Focus ring | `rgba(180, 83, 9, 0.25)` | amber-700 at 25% |

---

### Dark Mode

**Surfaces**
| Role | Hex | Notes |
|---|---|---|
| App root / main content | `#0e171e` | brand-dark — from logo |
| Panel chrome / sidebars | `#131e28` | slightly lighter navy |
| Cards / inputs | `#192430` | elevated surface |
| Overlays / dropdowns | `#1f2d3a` | highest elevation |

**Borders**
| Role | Hex | Notes |
|---|---|---|
| Subtle (cell lines, separators) | `#1e2e3c` | — |
| Default (panel edges) | `#253545` | — |
| Strong (header bottoms) | `#2f4258` | — |

**Text**
| Role | Hex | Notes |
|---|---|---|
| Primary | `#f0ebe0` | warm off-white — matches brand cream |
| Secondary (labels, captions) | `#8a98a8` | cool mid-tone |
| Muted (placeholders, disabled) | `#485868` | — |

**Accent (Amber)**
| Role | Hex | Notes |
|---|---|---|
| Button bg / active indicators | `#fbbf24` | amber-400 — bright on dark navy |
| Button hover | `#f59e0b` | amber-500 |
| Button text | `#1c1208` | dark text on bright amber button |
| Selection / highlight bg | `#2d1c04` | amber-950 tinted |
| Text on highlight bg | `#fcd34d` | amber-300 |
| Focus ring | `rgba(251, 191, 36, 0.25)` | amber-400 at 25% |

---

## Typography

```css
font-family: 'Inter', system-ui, -apple-system, sans-serif;
font-feature-settings: 'cv02', 'cv03', 'cv04';   /* Inter alternates */
-webkit-font-smoothing: antialiased;
text-rendering: optimizeLegibility;

/* Monospace — for data values, SQL, column names, stats */
font-family: 'JetBrains Mono', ui-monospace, 'Fira Code', SFMono-Regular, Menlo, monospace;
font-variant-numeric: tabular-nums;   /* always on mono data cells */
```

**Type scale (GIS tool density)**
| Use | Size | Weight |
|---|---|---|
| Section headers (uppercase) | 10px / `text-[10px]` | 700 + tracking-widest |
| Labels / captions | 11px / `text-[11px]` | 500 |
| Body / cell data | 12px / `text-xs` | 400 |
| Sub-labels | 11px mono | 400 |
| Primary action text | 13px / `text-sm` | 600 |
| Page headings | 18px / `text-lg` | 600 + tracking-tight |

---

## Component Patterns

### Buttons

**Primary (Amber)**
```
Light: bg:#b45309  hover:bg:#92400e  text:white  shadow-sm  rounded-md  px-4 py-2  text-sm font-semibold
Dark:  bg:#fbbf24  hover:bg:#f59e0b  text:#1c1208  shadow-sm  rounded-md  px-4 py-2  text-sm font-semibold
```

**Secondary / Ghost**
```
Light: bg:transparent  hover:bg:#f2ece0  text:#6b5e4a  hover:text:#1c1208  border:#d4c5a9  rounded-md
Dark:  bg:transparent  hover:bg:#1e2e3c  text:#8a98a8  hover:text:#f0ebe0  border:#253545  rounded-md
```

**Destructive**
```
Light: bg:#dc2626  hover:bg:#b91c1c  text:white  rounded-md
Dark:  bg:#ef4444  hover:bg:#dc2626  text:white  rounded-md
```

### Text Inputs

```
Light: bg:#ffffff  border:#d4c5a9  text:#1c1208  placeholder:#a8977a
       focus:border:#b45309  focus:ring:rgba(180,83,9,0.25)  rounded-md
Dark:  bg:#192430  border:#253545  text:#f0ebe0  placeholder:#485868
       focus:border:#fbbf24  focus:ring:rgba(251,191,36,0.25)  rounded-md
```

### Panel Chrome (headers, sidebars)

```
Light: bg:#f2ece0  border-b:#d4c5a9  shadow: 0 1px 3px rgba(0,0,0,0.05)
Dark:  bg:#131e28  border-b:#253545  shadow: 0 1px 3px rgba(0,0,0,0.4)
```

### Table / Data Grid

```
Header row:
  Light: bg:#f8f4ec  border-b-2:#b8a88a  text:uppercase tracking-wide text-[10px] #a8977a
  Dark:  bg:#131e28  border-b-2:#2f4258  text:uppercase tracking-wide text-[10px] #485868

Body rows — even:
  Light: bg:#ffffff    Dark: bg:#0e171e
Body rows — odd:
  Light: bg:#fdf9f4    Dark: bg:#101820
Row separator:
  Light: border-b:#f2ece0    Dark: border-b:#192430

Hover state:
  Light: bg:#fef3c7    Dark: bg:#2d1c04
Selected state:
  Light: bg:#fde68a  border-l-2:#b45309    Dark: bg:#2d1c04  border-l-2:#fbbf24

Numeric cells: font-mono tabular-nums  (light:#1c1208, dark:#e8c87a — warm amber tint for numbers on dark)
Null cells: text:#d4c5a9 (light), #2f4258 (dark), font-mono, content:"—"
```

### Type Badges (column type indicators)

Semantic colors consistent across all tools:

| Type group | Light bg | Light text | Dark bg | Dark text |
|---|---|---|---|---|
| Integer (INT, BIGINT…) | `#dbeafe` | `#1e40af` | `#1e3a5f` | `#93c5fd` |
| Float (FLOAT, DOUBLE, DECIMAL) | `#ede9fe` | `#5b21b6` | `#2e1a5c` | `#c4b5fd` |
| String (VARCHAR, TEXT) | `#d1fae5` | `#065f46` | `#052e16` | `#6ee7b7` |
| Date/Time (DATE, TIMESTAMP) | `#fef3c7` | `#92400e` | `#2d1c04` | `#fcd34d` |
| Boolean | `#ccfbf1` | `#0f766e` | `#042f2e` | `#5eead4` |
| Binary/Blob | `#f1f5f9` | `#64748b` | `#1e293b` | `#94a3b8` |
| Geometry/Spatial | `#ecfdf5` | `#064e3b` | `#022c22` | `#34d399` |
| Unknown | `#f8f4ec` | `#6b5e4a` | `#131e28` | `#8a98a8` |

### Status Bar (bottom, 26px)

```
Light: bg:#f2ece0  border-t:#d4c5a9  text:#a8977a  font-mono text-[10px]
Dark:  bg:#131e28  border-t:#1e2e3c  text:#485868  font-mono text-[10px]
Separator: "·"  color:#d4c5a9 (light), #253545 (dark)
Values: font-semibold  color:#1c1208 (light), #f0ebe0 (dark)
```

### Drag Handles (resize bars)

```
Horizontal / vertical:  size: 3–4px
  Light: bg:#d4c5a9  hover:bg:#b45309
  Dark:  bg:#253545  hover:bg:#fbbf24
Grip dots (3 circles, appear on hover):
  size: 4px  color: matches hover accent
```

### Map Popups (MapLibre GL)

```css
/* Light */
.maplibregl-popup-content {
  background: #ffffff;
  border: 1px solid #d4c5a9;
  box-shadow: 0 4px 16px rgba(0,0,0,0.10);
  border-radius: 8px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 12px;
  color: #1c1208;
}
.maplibregl-popup-close-button { color: #a8977a; }
.maplibregl-popup-close-button:hover { background: #f2ece0; color: #1c1208; }

/* Dark */
.dark .maplibregl-popup-content {
  background: #1f2d3a;
  border: 1px solid #2f4258;
  box-shadow: 0 4px 20px rgba(0,0,0,0.7);
  color: #f0ebe0;
}
.dark .maplibregl-popup-close-button { color: #8a98a8; }
.dark .maplibregl-popup-close-button:hover { background: #253545; color: #f0ebe0; }

/* Tip arrows: Light → #ffffff, Dark → #1f2d3a */
```

### MapLibre Nav Controls

```css
.maplibregl-ctrl-group {
  border-radius: 8px !important;
  overflow: hidden;
  border: 1px solid #d4c5a9 !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10) !important;
}
.maplibregl-ctrl-group button {
  background: #ffffff !important;
  border-bottom: 1px solid #e8dfc8 !important;
  width: 32px !important; height: 32px !important;
}
.maplibregl-ctrl-group button:hover { background: #f8f4ec !important; }

.dark .maplibregl-ctrl-group {
  border-color: #253545 !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;
}
.dark .maplibregl-ctrl-group button {
  background: #192430 !important;
  border-bottom-color: #1e2e3c !important;
}
.dark .maplibregl-ctrl-group button:hover { background: #1f2d3a !important; }
```

---

## Tailwind Config Extension

For Tailwind-based apps, add to `tailwind.config.ts`:

```ts
theme: {
  extend: {
    colors: {
      brand: {
        dark:   '#0e171e',
        cream:  '#fffbf2',
        amber:  '#b45309',
        'amber-bright': '#fbbf24',
      },
      surface: {
        base:    '#fffbf2',
        panel:   '#f2ece0',
        card:    '#ffffff',
        overlay: '#f8f4ec',
      },
      'surface-dark': {
        base:    '#0e171e',
        panel:   '#131e28',
        card:    '#192430',
        overlay: '#1f2d3a',
      },
      border: {
        subtle:  '#e8dfc8',
        default: '#d4c5a9',
        strong:  '#b8a88a',
        'dark-subtle':  '#1e2e3c',
        'dark-default': '#253545',
        'dark-strong':  '#2f4258',
      },
      content: {
        primary:   '#1c1208',
        secondary: '#6b5e4a',
        muted:     '#a8977a',
        'dark-primary':   '#f0ebe0',
        'dark-secondary': '#8a98a8',
        'dark-muted':     '#485868',
      },
      accent: {
        DEFAULT:  '#b45309',
        hover:    '#92400e',
        subtle:   '#fef3c7',
        dark:         '#fbbf24',
        'dark-hover':   '#f59e0b',
        'dark-subtle':  '#2d1c04',
      },
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      mono: ['JetBrains Mono', 'ui-monospace', 'Fira Code', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
    boxShadow: {
      panel:        '0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.03)',
      'panel-dark': '0 1px 3px 0 rgba(0,0,0,0.4)',
      popup:        '0 4px 16px rgba(0,0,0,0.10)',
      'popup-dark': '0 4px 20px rgba(0,0,0,0.70)',
    },
  },
}
```

---

## CSS Custom Properties (non-Tailwind apps)

```css
:root {
  /* Surfaces */
  --color-bg-base:    #fffbf2;
  --color-bg-panel:   #f2ece0;
  --color-bg-card:    #ffffff;
  --color-bg-overlay: #f8f4ec;

  /* Borders */
  --color-border-subtle:  #e8dfc8;
  --color-border-default: #d4c5a9;
  --color-border-strong:  #b8a88a;

  /* Text */
  --color-text-primary:   #1c1208;
  --color-text-secondary: #6b5e4a;
  --color-text-muted:     #a8977a;

  /* Accent */
  --color-accent:         #b45309;
  --color-accent-hover:   #92400e;
  --color-accent-subtle:  #fef3c7;
  --color-focus-ring:     rgba(180, 83, 9, 0.25);

  /* Typography */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'Fira Code', SFMono-Regular, Menlo, monospace;
}

.dark {
  /* Surfaces */
  --color-bg-base:    #0e171e;
  --color-bg-panel:   #131e28;
  --color-bg-card:    #192430;
  --color-bg-overlay: #1f2d3a;

  /* Borders */
  --color-border-subtle:  #1e2e3c;
  --color-border-default: #253545;
  --color-border-strong:  #2f4258;

  /* Text */
  --color-text-primary:   #f0ebe0;
  --color-text-secondary: #8a98a8;
  --color-text-muted:     #485868;

  /* Accent */
  --color-accent:         #fbbf24;
  --color-accent-hover:   #f59e0b;
  --color-accent-subtle:  #2d1c04;
  --color-focus-ring:     rgba(251, 191, 36, 0.25);
}
```

---

## Scrollbars

```css
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #d4c5a9; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #b8a88a; }
::-webkit-scrollbar-corner { background: transparent; }

.dark ::-webkit-scrollbar-thumb { background: #253545; }
.dark ::-webkit-scrollbar-thumb:hover { background: #2f4258; }

* { scrollbar-width: thin; scrollbar-color: #d4c5a9 transparent; }
.dark * { scrollbar-color: #253545 transparent; }
```

---

## Animations

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.fade-in { animation: fadeIn 180ms ease-out both; }

/* Skeleton loader */
.skeleton {
  background: linear-gradient(90deg, #f2ece0 25%, #e8dfc8 50%, #f2ece0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
.dark .skeleton {
  background: linear-gradient(90deg, #192430 25%, #1e2e3c 50%, #192430 75%);
  background-size: 200% 100%;
}
```

---

## App-Specific Notes

### parquet-viewer
- Replace all `indigo-*` classes with brand amber equivalents
- Dark mode root bg: `#0e171e`, panel bg: `#131e28`
- Light mode root bg: `#fffbf2`, panel bg: `#f2ece0`
- Header height: 44px (`h-11`)
- Logo icon fill: `#b45309` (light) / `#fbbf24` (dark)

### spatial-sql-explorer
- Migrate existing `#f0a500` orange → brand amber (`#b45309` light, `#fbbf24` dark)
- Apply surface color system (replace generic white/gray with cream/navy scale)
- Hexagon motif (⬡) color: brand amber

### omx-viewer
- Apply full CSS custom properties from this file
- Surface colors, typography, and accent all from this spec
- If using Bootstrap: override `--bs-primary` with `#b45309` (light) / `#fbbf24` (dark)

---

## Quick Reference Card

```
LIGHT MODE                        DARK MODE
─────────────────────────────     ─────────────────────────────
App bg:     #fffbf2 (cream)       App bg:     #0e171e (navy)
Panel bg:   #f2ece0               Panel bg:   #131e28
Card bg:    #ffffff               Card bg:    #192430
─────────────────────────────     ─────────────────────────────
Border:     #d4c5a9               Border:     #253545
Divider:    #b8a88a               Divider:    #2f4258
─────────────────────────────     ─────────────────────────────
Text:       #1c1208               Text:       #f0ebe0
Label:      #6b5e4a               Label:      #8a98a8
Muted:      #a8977a               Muted:      #485868
─────────────────────────────     ─────────────────────────────
Accent:     #b45309 (amber-700)   Accent:     #fbbf24 (amber-400)
Btn hover:  #92400e               Btn hover:  #f59e0b
Highlight:  #fef3c7 (amber-100)   Highlight:  #2d1c04 (amber-950)
─────────────────────────────     ─────────────────────────────
Font:       Inter (sans)          Font:       Inter (sans)
Data:       JetBrains Mono        Data:       JetBrains Mono
```
