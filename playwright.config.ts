import { defineConfig, devices } from '@playwright/test';

// UI-тесты идут против отдельной сборки с моками Битрикса и своей базой:
// боевые данные меняются каждую минуту, и скриншоты по ним сравнивать нельзя.
const PORT = 3111;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: {
    // Сглаживание шрифтов между прогонами даёт пару пикселей разницы.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Локально берём системный Chrome, в CI — chromium от Playwright.
    channel: process.env.CI ? undefined : 'chrome',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
        storageState: 'tests/.auth/state.json',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        channel: process.env.CI ? undefined : 'chrome',
        storageState: 'tests/.auth/state.json',
      },
    },
  ],
  webServer: {
    // standalone-сборка не тащит статику рядом с собой: без копирования
    // браузер получает 404 на все чанки и страница остаётся мёртвой.
    command:
      'npm run build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && node .next/standalone/server.js',
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      MOCK_B24: '1',
      MONGO_URL: 'mongodb://127.0.0.1:27018',
      MONGO_DB: 'bitrix_kanban_test',
      AUTH_USERNAME: 'tester',
      AUTH_PASSWORD: 'tester-password',
      AUTH_SESSION_SECRET: 'ui-tests-secret-value',
      BITRIX24_APP_URL: BASE_URL,
      BITRIX24_REDIRECT_URI: `${BASE_URL}/api/oauth`,
    },
  },
});
