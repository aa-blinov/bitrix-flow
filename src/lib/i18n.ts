// Переводы интерфейса. Исходный язык русский: строки в коде остаются русскими, а t() подменяет
// их английскими из словаря (src/lib/i18n-en.ts), если выбран английский. Нет перевода — русский
// текст как есть, поэтому пропуск виден глазами, а не ломает экран; тест i18n.test.ts не даёт
// пропустить строку молча.
//
// Язык один на вкладку и хранится в cookie. Сервер и первый рендер клиента всегда русские
// (так совпадает гидратация), английский включается сразу после монтирования
// (LocaleProvider), а до этого страница спрятана, чтобы не мелькал русский.
import { EN } from './i18n-en';

export type Locale = 'ru' | 'en';

export const LOCALE_COOKIE = 'bitrix-flow-locale';

let current: Locale = 'ru';

export function setLocale(locale: Locale) {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** Тег для Intl: даты и числа выводятся на выбранном языке. */
export function dateLocale(): string {
  return current === 'en' ? 'en-GB' : 'ru-RU';
}

// Подстановки {0}, {1}: порядок слов в языках разный, поэтому значения идут в ключ
// по номеру, а не склеиваются снаружи.
function fill(text: string, args: unknown[]): string {
  return args.length
    ? text.replace(/\{(\d+)\}/g, (match, i) => String(args[Number(i)] ?? match))
    : text;
}

export function t(text: string, ...args: unknown[]): string {
  return fill(current === 'en' ? (EN[text] ?? text) : text, args);
}

/** Для таблиц на уровне модуля: сохраняет русский текст, а перевод берётся при показе. */
export const L = (text: string) => text;

export function readLocale(cookie: string): Locale {
  const match = new RegExp(`(?:^|; )${LOCALE_COOKIE}=(en|ru)`).exec(cookie);
  return match?.[1] === 'en' ? 'en' : 'ru';
}

// Форматтеры Intl живут на уровне модуля, а язык известен только после монтирования, поэтому
// форматтер создаётся при первом вызове на каждом языке и кэшируется.
function lazy<T extends { format(value: never): string }>(make: (locale: string) => T) {
  const cache = new Map<string, T>();
  return {
    format(value: Parameters<T['format']>[0]): string {
      const locale = dateLocale();
      let formatter = cache.get(locale);
      if (!formatter) cache.set(locale, (formatter = make(locale)));
      return formatter.format(value as never);
    },
  };
}

export const dateFormat = (options?: Intl.DateTimeFormatOptions) =>
  lazy((locale) => new Intl.DateTimeFormat(locale, options));

export const numberFormat = (options?: Intl.NumberFormatOptions) =>
  lazy((locale) => new Intl.NumberFormat(locale, options));

export const relativeFormat = (options?: Intl.RelativeTimeFormatOptions) => {
  const cache = new Map<string, Intl.RelativeTimeFormat>();
  return {
    format(value: number, unit: Intl.RelativeTimeFormatUnit): string {
      const locale = dateLocale();
      let formatter = cache.get(locale);
      if (!formatter) cache.set(locale, (formatter = new Intl.RelativeTimeFormat(locale, options)));
      return formatter.format(value, unit);
    },
  };
};
