'use client';

// Экран падения рендера: без него пользователь видел пустую страницу, а причина
// оставалась только в консоли.
import Link from 'next/link';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Ошибка страницы', error);
    Sentry.captureException(error, { tags: { source: 'error-boundary' } });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-ui border border-line bg-surface p-6 text-center">
        <h1 className="text-xl font-bold text-ink">Что-то пошло не так</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Страница не отрисовалась. Можно попробовать ещё раз — данные не потеряны.
        </p>
        {error.digest && <p className="mt-2 font-ui text-xs text-ink-faint">Код: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="inline-flex h-11 items-center justify-center rounded-ui px-4 text-sm font-bold uppercase tracking-widest text-ink transition-opacity duration-fast hover:opacity-70"
          >
            Повторить
          </button>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-ui border border-line px-4 text-sm text-ink-soft transition-colors duration-fast hover:text-ink"
          >
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
