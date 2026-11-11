import { defineConfig, devices } from '@playwright/test';
import { UI_WORKERS, dbName, serverPort, serverUrl, statePath } from './tests/workers';

// UI-тесты идут против отдельной сборки с моками Битрикса и своей базой:
// боевые данные меняются каждую минуту, и скриншоты по ним сравнивать нельзя.
// Потоков два, у каждого свой сервер и база (tests/workers.ts). Внутри файла тесты
// идут по порядку: часть из них опирается на данные, оставленные предыдущими.

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: UI_WORKERS,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: {
    // Сглаживание шрифтов между прогонами даёт пару пикселей разницы.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: serverUrl(0),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Локально берём системный Chrome, в CI — chromium от Playwright.
    channel: process.env.CI ? undefined : 'chrome',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    // Фальшивый микрофон: запись голосовых идёт без живого устройства и без
    // диалога разрешения. launchOptions нельзя задать внутри describe.
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
        storageState: statePath(0),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // На телефоне идут только сценарии с тегом @mobile: экраны, вёрстка и жесты, где
      // телефон ведёт себя иначе. Остальное повторяло десктоп и удваивало прогон.
      name: 'mobile',
      dependencies: ['setup'],
      grep: /@mobile/,
      use: {
        ...devices['Pixel 7'],
        channel: process.env.CI ? undefined : 'chrome',
        storageState: statePath(0),
      },
    },
  ],
  // Серверы Playwright поднимает по очереди: первый собирает приложение (или берёт
  // прошлую сборку, если исходники не менялись), остальные стартуют с той же сборки.
  webServer: Array.from({ length: UI_WORKERS }, (_, index) => ({
    command:
      index === 0
        ? 'bash scripts/ui-build.sh && node .next/standalone/server.js'
        : 'node .next/standalone/server.js',
    url: `${serverUrl(index)}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(serverPort(index)),
      HOSTNAME: '127.0.0.1',
      MOCK_B24: '1',
      MONGO_URL: process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018',
      MONGO_DB: dbName(index),
      AUTH_USERNAME: 'tester',
      AUTH_PASSWORD: 'tester-password',
      AUTH_SESSION_SECRET: 'ui-tests-secret-value',
      BITRIX24_APP_URL: serverUrl(index),
      BITRIX24_REDIRECT_URI: `${serverUrl(index)}/api/oauth`,
    },
  })),
});
