'use client';

// Экран падения рендера: без него пользователь видел пустую страницу, а причина
// оставалась только в консоли.
import Link from 'next/link';
import { useEffect } from 'react';
import { reportError } from '@/lib/error-reporter';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Ошибка страницы', error);
    reportError(error, { route: window.location.pathname, tags: { source: 'error-boundary' } });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold text-foreground">Что-то пошло не так</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Страница не отрисовалась. Можно попробовать ещё раз — данные не потеряны.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Код: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Повторить
          </button>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
          >
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
