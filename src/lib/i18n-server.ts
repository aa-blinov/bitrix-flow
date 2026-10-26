import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { EN } from './i18n-en';
import { LOCALE_COOKIE } from './i18n';

// Заголовок вкладки собирается на сервере, где глобальный язык из t() общий для всех
// запросов, поэтому язык берётся из cookie запроса, а словарь читается напрямую.
export async function titled(ru: string): Promise<Metadata> {
  const english = (await cookies()).get(LOCALE_COOKIE)?.value === 'en';
  return { title: english ? (EN[ru] ?? ru) : ru };
}
