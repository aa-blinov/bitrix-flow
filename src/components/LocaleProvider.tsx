'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { readLocale, setLocale, type Locale } from '@/lib/i18n';

// Сервер и первый рендер клиента русские, чтобы гидратация сошлась. Выбранный язык применяется
// после монтирования: ключ пересоздаёт дерево, и все t() считаются заново на нужном языке.
export default function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>('ru');
  useEffect(() => {
    const saved = readLocale(document.cookie);
    setLocale(saved);
    document.documentElement.lang = saved;
    setState(saved);
    document.documentElement.removeAttribute('data-locale-pending');
  }, []);
  return <Fragment key={locale}>{children}</Fragment>;
}
