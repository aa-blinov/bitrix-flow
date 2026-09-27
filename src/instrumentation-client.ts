// Sentry в браузере. Без NEXT_PUBLIC_SENTRY_DSN (локально, в тестах) SDK молчит.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_RELEASE,
  // Внутренний инструмент на пару десятков человек: 10% трасс хватает, чтобы
  // видеть медленные экраны, и не съедает квоту.
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
