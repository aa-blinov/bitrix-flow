import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const nextConfig: NextConfig = {
  turbopack: {},
  output: 'standalone',
  // Прокси сессии буферизует тело запроса и по умолчанию режет его на 10 МБ,
  // а вложения чата и задач допускают до 20 МБ: обрезанный файл ушёл бы битым.
  experimental: { proxyClientMaxBodySize: '25mb' },
  // Discovery OAuth для MCP живёт по фиксированным адресам /.well-known, а роуты OAuth лежат
  // вместе в /api/mcp-oauth. Вариант с суффиксом /api/mcp клиент спрашивает первым (RFC 9728
  // для ресурса не в корне).
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource/api/mcp',
        destination: '/api/mcp-oauth/resource',
      },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/mcp-oauth/resource' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/mcp-oauth/server' },
    ];
  },
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
