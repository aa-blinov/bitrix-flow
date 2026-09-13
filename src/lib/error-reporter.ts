// Отправка ошибок в GlitchTip (Sentry-совместимый приёмник). Полноценный SDK
// сюда не тянем: нужен один POST на событие, а не трассировки и профайлинг.
// Без GLITCHTIP_DSN модуль молча ничего не делает — локальная разработка и
// тесты не должны никуда стучаться.

type Dsn = { url: string; key: string };

function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const projectId = parsed.pathname.replace(/^\//, '');
    if (!projectId || !parsed.username) return null;
    return {
      url: `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`,
      key: parsed.username,
    };
  } catch {
    return null;
  }
}

const dsn = parseDsn(process.env.GLITCHTIP_DSN || process.env.NEXT_PUBLIC_GLITCHTIP_DSN);
const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const release = process.env.APP_RELEASE || process.env.NEXT_PUBLIC_APP_RELEASE || 'dev';

/** Секунда на отправку: мониторинг не вправе задерживать ответ пользователю. */
const SEND_TIMEOUT_MS = 1000;

export type ErrorContext = {
  route?: string;
  method?: string;
  /** Произвольные пометки: id задачи, имя фоновой джобы и подобное. */
  tags?: Record<string, string>;
};

function frames(stack: string | undefined) {
  return (stack || '')
    .split('\n')
    .slice(1, 25)
    .map((line) => ({ filename: line.trim() }))
    .reverse();
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!dsn) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({
    event_id: crypto.randomUUID().replaceAll('-', ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'bitrix-flow',
    environment,
    release,
    server_name: process.env.HOSTNAME || undefined,
    transaction: context.route,
    tags: { ...context.tags, ...(context.method ? { method: context.method } : {}) },
    exception: {
      values: [
        {
          type: err.name || 'Error',
          value: (err.message || '').slice(0, 2000),
          stacktrace: { frames: frames(err.stack) },
        },
      ],
    },
  });

  void fetch(dsn.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=bitrix-flow/1.0`,
    },
    body,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    // Ошибка доставки ошибки — не повод падать ещё раз.
  }).catch(() => {});
}

export const errorReportingEnabled = Boolean(dsn);
