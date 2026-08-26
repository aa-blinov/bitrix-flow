// Next.js instrumentation hook — запускается ровно один раз при старте сервера
// (production) или при первом импорте (dev). Используем чтобы запустить
// фоновые задачи, которые должны жить всё время жизни процесса.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Импорт динамический — чтобы клиентский бандл не тянул server-only код.
  const { startBackgroundSync } = await import('./lib/background-sync');
  startBackgroundSync();
}
