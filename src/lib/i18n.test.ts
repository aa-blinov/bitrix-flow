import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EN } from './i18n-en';
import { readLocale, setLocale, t } from './i18n';

const CALL = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.|^i18n/.test(name) ? [path] : [];
  });
}

describe('i18n', () => {
  afterEach(() => setLocale('ru'));

  it('переводит каждую русскую строку из t() на английский', () => {
    const missing = new Set<string>();
    for (const file of sources('src')) {
      for (const match of readFileSync(file, 'utf8').matchAll(CALL)) {
        const key = match[2].replace(/\\(['"])/g, '$1');
        if (/[а-яё]/i.test(key) && !(key in EN)) missing.add(key);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('подставляет значения в {0} и отдаёт русский текст без перевода', () => {
    setLocale('en');
    expect(t('Задача #{0}', 7)).toBe('Task #7');
    expect(t('строки нет в словаре {0}', 1)).toBe('строки нет в словаре 1');
    setLocale('ru');
    expect(t('Задача #{0}', 7)).toBe('Задача #7');
  });

  it('читает язык из cookie', () => {
    expect(readLocale('a=1; bitrix-flow-locale=en')).toBe('en');
    expect(readLocale('')).toBe('ru');
  });
});
