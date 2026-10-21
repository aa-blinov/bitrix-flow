// Контраст палитр набора @monos/ui.
//
// В наборе приглушённые роли подобраны на глаз и в части палитр не дотягивают
// до WCAG AA (4.5:1 для текста). Приложение эту планку держит, поэтому
// недостающие значения переопределены в src/app/globals.css — и вот этот
// скрипт проверяет, что переопределения живые.
//
//   node scripts/check-palette-contrast.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KIT_THEMES = path.join(ROOT, 'node_modules/@monos/ui/src/styles/themes.css');
const APP_CSS = path.join(ROOT, 'src/app/globals.css');

const TEXT_ON = ['bg', 'surface', 'surface-2'];
const TEXT_ROLES = ['ink', 'ink-soft', 'ink-faint'];
const SIGNAL_ROLES = ['accent', 'danger', 'warning', 'success', 'info'];

function parseThemes(css) {
  const themes = new Map();
  const blockRe = /\[data-theme="([^"]+)"\]\[data-mode="([^"]+)"\]\s*\{([^}]*)\}/g;
  let match;
  while ((match = blockRe.exec(css))) {
    const [, name, mode, body] = match;
    const tokens = {};
    for (const [, key, value] of body.matchAll(/--ui-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
      tokens[key] = value;
    }
    themes.set(`${name}/${mode}`, tokens);
  }
  return themes;
}

/** Переопределения приложения из globals.css. */
function parseOverrides(css) {
  const overrides = new Map();
  const blockRe = /\[data-theme='([^']+)'\]\[data-mode='([^']+)'\]\s*\{([^}]*)\}/g;
  let match;
  while ((match = blockRe.exec(css))) {
    const [, name, mode, body] = match;
    const tokens = {};
    for (const [, key, value] of body.matchAll(/--ui-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
      tokens[key] = value;
    }
    overrides.set(`${name}/${mode}`, tokens);
  }
  return overrides;
}

const hexToRgb = (hex) => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
};

const channel = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (fg, bg) => {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/** Цвет поверх фона с прозрачностью pct. */
const overlay = (fg, bg, pct) =>
  fg.map((value, index) => Math.round(value * pct + bg[index] * (1 - pct)));

const TARGET = 4.5;

const kit = parseThemes(readFileSync(KIT_THEMES, 'utf8'));
const overrides = parseOverrides(readFileSync(APP_CSS, 'utf8'));

let failures = 0;
for (const [key, kitTokens] of kit) {
  const tokens = { ...kitTokens, ...(overrides.get(key) ?? {}) };
  const bg = hexToRgb(tokens.bg);
  const surfaces = TEXT_ON.map((role) => hexToRgb(tokens[role]));

  for (const role of TEXT_ROLES) {
    for (const [index, surface] of surfaces.entries()) {
      const value = contrast(hexToRgb(tokens[role]), surface);
      if (value < TARGET) {
        console.error(`${key}: ${role} на ${TEXT_ON[index]} — ${value.toFixed(2)}:1`);
        failures += 1;
      }
    }
  }

  for (const role of SIGNAL_ROLES) {
    const text = hexToRgb(tokens[`${role}-text`]);
    const tints = [
      overlay(hexToRgb(tokens[role]), bg, 0.1),
      overlay(hexToRgb(tokens[role]), hexToRgb(tokens.surface), 0.1),
    ];
    for (const [index, background] of [...surfaces, ...tints].entries()) {
      const value = contrast(text, background);
      if (value < TARGET) {
        const name = index < surfaces.length ? TEXT_ON[index] : `подложка ${role}/10`;
        console.error(`${key}: ${role}-text на ${name} — ${value.toFixed(2)}:1`);
        failures += 1;
      }
    }
  }
}

if (failures) {
  console.error(`\n${failures} пар(ы) не проходят WCAG AA (${TARGET}:1)`);
  process.exit(1);
}
console.log(`Все ${kit.size} палитр проходят WCAG AA (${TARGET}:1)`);
