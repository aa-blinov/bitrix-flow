import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const nextConfig: NextConfig = {
  turbopack: {},
  output: 'standalone',
  // Прокси сессии буферизует тело запроса и по умолчанию режет его на 10 МБ,
  // а вложения чата и задач допускают до 20 МБ: обрезанный файл ушёл бы битым.
  experimental: { proxyClientMaxBodySize: '25mb' },
};

export default withSentryConfig(nextConfig, {
  org: 'no-company-flr',
  project: 'bitrix-flow',
  // Без токена source maps просто не загружаются: сборка и отправка ошибок
  // работают, только стеки в Sentry будут по минифицированному коду.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Тот же релиз, что у событий: иначе артефакты не свяжутся с ошибками.
  release: { name: process.env.APP_RELEASE },
  silent: !process.env.CI,
  telemetry: false,
});
