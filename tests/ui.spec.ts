import { test, expect, type Page } from '@playwright/test';

// Обход всех экранов: смоук (заголовок, ключевые элементы, отсутствие ошибок
// в консоли) плюс снимок для сравнения с эталоном.

const SCREENS = [
  { path: '/', name: 'home', heading: 'Главная' },
  { path: '/projects-summary', name: 'summary', heading: 'Сводка по проектам' },
  { path: '/all-tasks', name: 'all-tasks', heading: 'Все задачи' },
  { path: '/my-tasks', name: 'my-tasks', heading: 'Мои задачи' },
  { path: '/team-workload', name: 'workload', heading: 'Нагрузка команды' },
  { path: '/notifications', name: 'notifications', heading: 'Уведомления' },
  { path: '/search', name: 'search', heading: 'Поиск' },
  { path: '/projects/10', name: 'project-board', heading: 'Разработка API v2' },
  { path: '/projects/10?view=grid', name: 'project-grid', heading: 'Разработка API v2' },
];

/** Ждём, пока экран догрузит данные: иначе в кадр попадает спиннер. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByText('Загрузка…'))
    .toHaveCount(0, { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(600);
}

function trackConsole(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Падения загрузки картинок из мока нас не интересуют.
    if (/favicon|\.png|\.jpg/i.test(message.text())) return;
    problems.push(`console: ${message.text()}`);
  });
  return problems;
}

for (const screen of SCREENS) {
  test(`${screen.name}: открывается без ошибок`, async ({ page }) => {
    const problems = trackConsole(page);
    await page.goto(screen.path);
    await settle(page);
    await expect(page.getByRole('heading', { name: screen.heading, level: 1 })).toBeVisible();
    expect(problems, problems.join('\n')).toHaveLength(0);
  });

  test(`${screen.name}: совпадает с эталоном`, async ({ page }) => {
    await page.goto(screen.path);
    await settle(page);
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: false,
      // Время «обновлено N минут назад» и подобное меняется само по себе.
      mask: [page.locator('time')],
    });
  });
}

test('задачи из зеркала действительно отрисованы', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await expect(page.getByText('Перевести справочники на GraphQL')).toBeVisible();
  await expect(page.getByText('Свести бюджет кампании')).toBeVisible();
});
