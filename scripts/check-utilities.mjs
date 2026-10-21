// Проверка того, что классы набора @monos/ui действительно попали в собранный
// CSS.
//
// Случилось так: в Tailwind 4 шкала z-index живёт в пространстве
// `--z-index-*`, а не `--z-*`, как в пресете набора для Tailwind 3. Классы
// `z-modal`, `z-menu` и `z-tooltip` молча не генерировались, и окно
// оказывалось под липкой шапкой таблицы. Класс, которого нет в CSS, не
// выглядит поломкой — он просто ничего не делает.
//
// Проверяются только имена из набора: они приходят из моста в globals.css, и
// любая из них может молча выпасть из-за неверного пространства темы.
//
//   npm run build && node scripts/check-utilities.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const CSS_DIR = path.join(ROOT, '.next/static');

// Значения, которые приходят из токенов набора. Совпадение с ними в любой
// позиции класса означает, что класс обязан существовать в CSS.
const KIT_VALUES = new Set([
  // цвета
  'canvas',
  'surface',
  'surface-2',
  'ink',
  'ink-soft',
  'ink-faint',
  'ink-muted',
  'line',
  'line-strong',
  'accent',
  'danger',
  'warning',
  'success',
  'info',
  'accent-text',
  'danger-text',
  'warning-text',
  'success-text',
  'info-text',
  // радиус, шрифт, кегли
  'ui',
  'whisper',
  'whisper-lg',
  // отступы
  'hair',
  'tight',
  'field',
  'snug',
  'input',
  'base',
  'comfortable',
  'roomy',
  'section',
  // тени, скорости, слои
  'rest',
  'lift',
  'overlay',
  'fast',
  'menu',
  'modal',
  'tooltip',
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
  }
  return files;
}

function findCss(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findCss(full));
    else if (entry.endsWith('.css')) found.push(full);
  }
  return found;
}

const css = findCss(CSS_DIR)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

/** Класс в CSS может быть сгруппирован или экранирован: ищем по имени. */
function hasUtility(name) {
  // В CSS спецсимволы класса экранируются: `hover:text-ink` → `hover\:text-ink`.
  // В исходнике регулярки нужен именно обратный слэш, поэтому экранируем его
  // ещё раз.
  const escaped = name.replace(/[^\w-]/g, (char) => `\\\\${char}`);
  return new RegExp(`\\.${escaped}(?![\\w-])`).test(css);
}

/** Отбрасывает варианты (`hover:`, `sm:`, `max-sm:`, `[&_input]:`). */
function baseUtility(token) {
  const parts = token.split(':');
  return parts[parts.length - 1];
}

/** Класс относится к набору, если заканчивается именем из токенов. */
function isKitClass(token) {
  const base = baseUtility(token);
  if (!base.includes('-')) return false;
  return [...KIT_VALUES].some((value) => base === value || base.endsWith(`-${value}`));
}

// Негативная проверка самого скрипта: если бы он ничего не проверял, он
// рапортовал бы «все классы на месте» при любом CSS.
const SELF_TEST = 'z-modal';
if (!hasUtility(SELF_TEST) && !hasUtility('bg-canvas')) {
  console.error('проверка классов не работает: даже bg-canvas не найден');
  process.exit(1);
}

const found = new Map();
// Классы встречаются и в `className="…"`, и в `cn('…')`, поэтому берём все
// строковые литералы, а разбираем только те, что похожи на класс.
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (!token || token.includes('${')) continue;
      if (!/^[a-z0-9[\]:/.-]+$/i.test(token)) continue;
      if (!isKitClass(token)) continue;
      if (!found.has(token)) found.set(token, new Set());
      found.get(token).add(path.relative(ROOT, file));
    }
  }
}

const missing = [];
for (const [token, files] of found) {
  if (!hasUtility(token)) missing.push({ token, files: [...files] });
}

if (missing.length) {
  for (const { token, files } of missing) {
    console.error(`нет класса .${token} — ${files.join(', ')}`);
  }
  console.error(`\n${missing.length} класс(ов) набора не попали в CSS`);
  process.exit(1);
}
console.log(`Все ${found.size} классов набора из разметки попали в CSS`);
