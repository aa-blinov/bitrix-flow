import * as Sentry from '@sentry/nextjs';

// Next.js instrumentation hook — запускается ровно один раз при старте сервера
// (production) или при первом импорте (dev). Используем чтобы запустить
// фоновые задачи, которые должны жить всё время жизни процесса.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
    return;
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./sentry.server.config');
  // Импорт динамический — чтобы клиентский бандл не тянул server-only код.
  const { startBackgroundSync } = await import('./lib/background-sync');
  startBackgroundSync();
}

// Next вызывает этот хук на каждую необработанную ошибку серверного рендера и
// route handler'а — единственная точка, где их видно целиком.
export const onRequestError = Sentry.captureRequestError;
