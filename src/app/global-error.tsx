'use client';

// Последний рубеж: падение в корневом layout, когда своя разметка уже недоступна.
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { t } from '@/lib/i18n';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { source: 'global-error' } });
  }, [error]);

  return (
    <html lang="ru">
      {/* Этот экран живёт вне корневого layout, токенов приложения здесь нет: тема идёт
          от системной настройки, иначе при тёмной системе вспыхивал белый лист. */}
      <head>
        <style>{`
          :root { --bg: #f5f5f5; --ink: #171717; --soft: #525252; --faint: #595959; --btn: #171717; --btn-ink: #fff; }
          @media (prefers-color-scheme: dark) {
            :root { --bg: #282828; --ink: #ebdbb2; --soft: #bdae93; --faint: #a89984; --btn: #ebdbb2; --btn-ink: #282828; }
          }
          button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
        `}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: 'var(--bg)',
          color: 'var(--ink)',
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>{t('Приложение не запустилось')}</h1>
          <p style={{ fontSize: 14, color: 'var(--soft)' }}>
            {t('Перезагрузите страницу. Если не помогает, проверьте подключение к Битрикс24.')}
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: 'var(--faint)' }}>
              {t('Код:')} {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              height: 40,
              padding: '0 16px',
              borderRadius: 8,
              border: 0,
              background: 'var(--btn)',
              color: 'var(--btn-ink)',
              fontSize: 14,
            }}
          >
            {t('Повторить')}
          </button>
        </div>
      </body>
    </html>
  );
}
