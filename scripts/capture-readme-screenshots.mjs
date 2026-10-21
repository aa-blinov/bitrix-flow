// Скриншоты для README. Снимаются против сборки с моками Битрикса и
// фиксированными данными UI-тестов, чтобы картинки в README не менялись
// вместе с боевыми задачами.
//
//   npm run build && node scripts/seed-test-db.mjs
//   node scripts/capture-readme-screenshots.mjs
//
// Образ тот же, что и у эталонов: `CI=true` включает chromium из образа
// Playwright вместо системного Chrome.

import { chromium, devices } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';

const BASE_URL = process.env.SCREENSHOT_URL || 'http://127.0.0.1:3111';
const OUT_DIR = path.resolve(process.cwd(), 'docs/screenshots');
const USERNAME = process.env.AUTH_USERNAME || 'tester';
const PASSWORD = process.env.AUTH_PASSWORD || 'tester-password';

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // Спиннер мешает кадру: ждём, пока он исчезнет.
  await page
    .getByText('Загрузка…')
    .waitFor({ state: 'hidden', timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });
  const page = await context.newPage();

  // Тёмная тема показывалась в старом README как «вторая картинка» —
  // теперь в наборе шесть палитр, и читательу полезнее видеть рабочий
  // светлый экран, чем конкретную палитру.
  await page.addInitScript(() => {
    localStorage.setItem('bitrix-flow-theme', 'gruvbox:light');
  });

  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Логин').fill(USERNAME);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });

  const shots = [
    { path: '/', name: 'home' },
    { path: '/projects/10', name: 'kanban' },
    { path: '/team-workload', name: 'workload' },
    { path: '/projects-summary', name: 'projects-summary' },
    { path: '/notifications', name: 'notifications' },
    { path: '/search', name: 'search' },
  ];

  for (const shot of shots) {
    await page.goto(`${BASE_URL}${shot.path}`);
    await settle(page);
    await page.screenshot({ path: path.join(OUT_DIR, `${shot.name}.png`) });
    console.log(`saved ${shot.name}.png`);
  }

  // Карточка задачи открывается поверх списка.
  await page.goto(`${BASE_URL}/all-tasks`);
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT_DIR, 'task-modal.png') });
  console.log('saved task-modal.png');

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
