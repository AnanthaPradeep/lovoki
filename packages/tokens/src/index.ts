/**
 * LOVOKI design tokens — the single source of truth for web (CSS variables)
 * and mobile (React Native theme objects). Raw palette first, then semantic
 * roles per theme. Components must consume semantic roles, never raw hex.
 */

export const palette = {
  plum: {
    50: '#F8EEF4', 100: '#EEDBE7', 200: '#DCB8CE', 300: '#C08FAE',
    400: '#9C6688', 500: '#784A68', 600: '#5A3350', 700: '#46243F',
    800: '#381932', 900: '#25101F', 950: '#1A0B16',
  },
  milk: {
    50: '#FFFBF6', 100: '#FFF3E6', 200: '#F8E6D2', 300: '#EBD3BB',
    400: '#D4B79B', 500: '#B39579',
  },
  /** Supporting accent. Reserved for mutual-match moments only. */
  marigold: { 300: '#F0C266', 500: '#C98A1B', 700: '#8A5A06' },
} as const;

export type ThemeName = 'light' | 'dark';

export interface SemanticColors {
  bg: string;            // page background
  surface: string;       // cards, sheets
  surfaceRaised: string; // popovers, active cards
  surfaceSunken: string; // inputs, wells
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;       // primary action fill
  onPrimary: string;
  primarySoft: string;   // selected states, dating chips
  onPrimarySoft: string;
  match: string;         // marigold, match moments only
  onMatch: string;
  focus: string;
  overlay: string;
  success: string; successSoft: string;
  warning: string; warningSoft: string;
  error: string;   errorSoft: string;
  info: string;    infoSoft: string;
  photoFallback: string;
}

export const colors: Record<ThemeName, SemanticColors> = {
  light: {
    bg: palette.milk[100],
    surface: palette.milk[50],
    surfaceRaised: '#FFFFFF',
    surfaceSunken: palette.milk[200],
    border: '#EAD6C4',
    borderStrong: '#CDB29A',
    text: palette.plum[800],
    textMuted: '#5E4558',
    textSubtle: '#7D6576',
    primary: palette.plum[800],
    onPrimary: palette.milk[100],
    primarySoft: palette.plum[100],
    onPrimarySoft: palette.plum[800],
    match: palette.marigold[500],
    onMatch: palette.plum[900],
    focus: '#7A3E6E',
    overlay: 'rgba(37,16,31,0.48)',
    success: '#2E6B4C', successSoft: '#DDEFE3',
    warning: '#8A5300', warningSoft: '#FBE8C8',
    error: '#A3271F',   errorSoft: '#F9DEDA',
    info: '#2D5A8C',    infoSoft: '#DCE8F5',
    photoFallback: palette.milk[300],
  },
  dark: {
    bg: '#1C0E19',
    surface: '#26141F',
    surfaceRaised: '#311A2A',
    surfaceSunken: '#170B14',
    border: '#3F2737',
    borderStrong: '#5C3F52',
    text: '#FBEEE0',
    textMuted: '#D7C2C6',
    textSubtle: '#B39FA8',
    primary: palette.milk[100],
    onPrimary: palette.plum[800],
    primarySoft: '#4A2A42',
    onPrimarySoft: '#F6E2EC',
    match: palette.marigold[300],
    onMatch: palette.plum[900],
    focus: '#F0C266',
    overlay: 'rgba(10,4,9,0.64)',
    success: '#8FD1A9', successSoft: '#1E3A2B',
    warning: '#F0C266', warningSoft: '#3E2E10',
    error: '#F2A49C',   errorSoft: '#4A1D1A',
    info: '#9CC2EC',    infoSoft: '#1C2E44',
    photoFallback: '#3A2232',
  },
};

export const fonts = {
  display: 'Bricolage Grotesque',
  body: 'Figtree',
} as const;

/** Type scale (px). ~1.2 minor-third; body never below 16. */
export const typeScale = {
  caption: { size: 13, line: 18, weight: 500 },
  label:   { size: 14, line: 20, weight: 600 },
  body:    { size: 16, line: 24, weight: 400 },
  bodyLg:  { size: 18, line: 28, weight: 400 },
  title:   { size: 20, line: 26, weight: 650 },
  heading: { size: 26, line: 32, weight: 700 },
  display: { size: 34, line: 38, weight: 700 },
  quote:   { size: 24, line: 30, weight: 600 },
} as const;

export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** Radius has hierarchy: containers > photos > controls. Chips are pills. */
export const radius = { sm: 8, control: 12, photo: 16, card: 22, sheet: 28, pill: 999 } as const;

export const elevation = {
  light: {
    1: '0 1px 2px rgba(56,25,50,0.06), 0 1px 1px rgba(56,25,50,0.04)',
    2: '0 6px 18px -6px rgba(56,25,50,0.18)',
    3: '0 18px 40px -12px rgba(56,25,50,0.28)',
  },
  // Dark: shadows barely read, elevation is carried by lighter surfaces.
  dark: {
    1: '0 0 0 1px rgba(255,243,230,0.04)',
    2: '0 8px 24px -8px rgba(0,0,0,0.6)',
    3: '0 20px 48px -12px rgba(0,0,0,0.7)',
  },
} as const;

export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'cubic-bezier(0.3, 0, 1, 1)' },
} as const;

export const layout = {
  minTouch: 44,
  sidebar: 248,
  content: 640,
  rail: 320,
  breakpoints: { tablet: 768, desktop: 1100, wide: 1280 },
} as const;

/** Emits CSS custom properties for the web app. */
export function toCssVariables(): string {
  const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const block = (t: ThemeName) =>
    Object.entries(colors[t]).map(([k, v]) => `  --c-${kebab(k)}: ${v};`).join('\n') +
    '\n' + Object.entries(elevation[t]).map(([k, v]) => `  --shadow-${k}: ${v};`).join('\n');
  const shared = [
    ...Object.entries(space).map(([k, v]) => `  --space-${k}: ${v}px;`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    ...Object.entries(typeScale).flatMap(([k, v]) => [
      `  --fs-${k}: ${v.size / 16}rem;`, `  --lh-${k}: ${v.line / v.size};`, `  --fw-${k}: ${v.weight};`]),
    `  --font-display: '${fonts.display} Variable', '${fonts.display}', ui-sans-serif, system-ui, sans-serif;`,
    `  --font-body: '${fonts.body} Variable', '${fonts.body}', ui-sans-serif, system-ui, sans-serif;`,
    `  --dur-fast: ${motion.duration.fast}ms;`, `  --dur-base: ${motion.duration.base}ms;`, `  --dur-slow: ${motion.duration.slow}ms;`,
    `  --ease: ${motion.easing.standard};`,
    `  --touch: ${layout.minTouch}px;`,
  ].join('\n');
  return `:root {\n${shared}\n${block('light')}\n  color-scheme: light;\n}\n` +
    `:root[data-theme="dark"] {\n${block('dark')}\n  color-scheme: dark;\n}\n` +
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${block('dark')}\n  color-scheme: dark;\n  }\n}\n`;
}

/** WCAG relative-luminance contrast ratio, used by the token contrast test. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = hex.replace('#', '');
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
