'use strict';
// Single source of truth for Nevix's visual identity. Served to every UI and internal page as
// nevix://res/tokens.css and used by the main process (window background, reader mode).
// Brand colours: primary #9D64A3, background #1F171D, danger #783124.

const DARK = {
  'color-background': '#1F171D',
  'color-surface': '#281E26',
  'color-surface-secondary': '#322730',
  'color-surface-tertiary': '#3E313B',
  'color-border': '#43353F',
  'color-text': '#EDE5EB',
  'color-text-secondary': '#A89AA5',
  'color-primary': '#9D64A3',
  'color-on-primary': '#0E080D',
  'color-primary-text': '#C99BCF',
  'color-danger': '#783124',
  'color-danger-text': '#E58F7D',
  'color-on-danger': '#FFF1EC',
  'color-warning': '#C99A4E',
  'color-success': '#74B08D',
  'color-scrim': 'rgba(12, 7, 11, .62)',
};

const LIGHT = {
  'color-background': '#EFE8ED',
  'color-surface': '#F8F4F7',
  'color-surface-secondary': '#E6DCE3',
  'color-surface-tertiary': '#D8CBD3',
  'color-border': '#CDBFC8',
  'color-text': '#1F171D',
  'color-text-secondary': '#665762',
  'color-primary': '#7E4A84',
  'color-on-primary': '#FFFFFF',
  'color-primary-text': '#6A3A70',
  'color-danger': '#783124',
  'color-danger-text': '#8E3322',
  'color-on-danger': '#FFF1EC',
  'color-warning': '#8A6016',
  'color-success': '#2F7A4D',
  'color-scrim': 'rgba(31, 23, 29, .35)',
};

// Private windows: same identity, a darker, slightly cooler ground so they're unmistakable.
const PRIVATE = {
  'color-background': '#150F14',
  'color-surface': '#1D151B',
  'color-surface-secondary': '#271D25',
  'color-surface-tertiary': '#33262F',
  'color-border': '#3A2C36',
};

const FONT_UI = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`;
const FONT_MONO = `ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace`;

const decl = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join('');

/** Builds the stylesheet. `accent` optionally overrides the primary colour (user setting). */
function css(accent) {
  const derived = `
    --color-primary-hover: color-mix(in srgb, var(--color-primary) 82%, white);
    --color-primary-active: color-mix(in srgb, var(--color-primary) 80%, black);
    --color-primary-subtle: color-mix(in srgb, var(--color-primary) 16%, transparent);
    --color-danger-hover: color-mix(in srgb, var(--color-danger) 82%, white);
    --color-danger-subtle: color-mix(in srgb, var(--color-danger) 28%, transparent);
    --color-focus-ring: color-mix(in srgb, var(--color-primary) 55%, transparent);
    --radius-sm: 3px; --radius: 5px; --radius-lg: 8px;
    --font-ui: ${FONT_UI}; --font-mono: ${FONT_MONO};`;
  const override = accent && /^#[0-9a-f]{6}$/i.test(accent) ? `--color-primary:${accent};` : '';
  return `/* generated from src/main/theme.js */
:root{${decl(DARK)}${derived}color-scheme:dark}
@media (prefers-color-scheme: light){:root{${decl(LIGHT)}color-scheme:light}}
body.private{${decl(PRIVATE)}${decl({ 'color-text': DARK['color-text'], 'color-text-secondary': DARK['color-text-secondary'], 'color-primary': DARK['color-primary'], 'color-primary-text': DARK['color-primary-text'], 'color-on-primary': DARK['color-on-primary'] })}color-scheme:dark}
${override ? `:root{${override}}` : ''}
`;
}

module.exports = { DARK, LIGHT, PRIVATE, css, FONT_UI, FONT_MONO };
