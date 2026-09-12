'use client';

// Последний рубеж: падение в корневом layout, когда своя разметка уже недоступна.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f5f5f5',
          color: '#171717',
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Приложение не запустилось</h1>
          <p style={{ fontSize: 14, color: '#525252' }}>
            Перезагрузите страницу. Если не помогает, проверьте подключение к Битрикс24.
          </p>
          {error.digest && <p style={{ fontSize: 12, color: '#737373' }}>Код: {error.digest}</p>}
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              height: 40,
              padding: '0 16px',
              borderRadius: 8,
              border: 0,
              background: '#171717',
              color: '#fff',
              fontSize: 14,
            }}
          >
            Повторить
          </button>
        </div>
      </body>
    </html>
  );
}
