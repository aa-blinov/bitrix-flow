import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

// Обход всех экранов: смоук (заголовок, ключевые элементы, отсутствие ошибок
// в консоли) плюс снимок для сравнения с эталоном.

const SCREENS = [
  { path: '/', name: 'home', heading: 'Главная' },
  { path: '/projects-summary', name: 'summary', heading: 'Сводка по проектам' },
  { path: '/all-tasks', name: 'all-tasks', heading: 'Все задачи' },
  { path: '/my-tasks', name: 'my-tasks', heading: 'Мои задачи' },
  { path: '/team-workload', name: 'workload', heading: 'Нагрузка команды' },
  { path: '/notifications', name: 'notifications', heading: 'Уведомления' },
  { path: '/messenger', name: 'messenger', heading: 'Сообщения' },
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

// Доступность проверяется на каждом экране в обеих темах: палитра меняет
// контраст, а тёмный режим — главный источник «серых на сером».
const AXE_PATH = path.resolve(process.cwd(), 'node_modules/axe-core/axe.min.js');

type AxeViolation = { id: string; impact: string | null; nodes: string[] };

async function audit(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: { run: (context: Document, options: unknown) => Promise<{ violations: unknown[] }> };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
    });
    return result.violations as AxeViolation[];
  });
}

const PALETTES = ['gruvbox', 'github', 'dracula', 'nord', 'solarized', 'catppuccin'] as const;

const MODES = ['light', 'dark'] as const;

// Полный набор экранов — для палитры по умолчанию; остальные проверяются на
// трёх самых разных: список, таблица и доска.
const FULL_SCREENS = SCREENS;
const QUICK_SCREENS = SCREENS.filter((screen) =>
  ['home', 'all-tasks', 'project-board'].includes(screen.name),
);

for (const palette of PALETTES) {
  for (const mode of MODES) {
    test(`${palette}/${mode}: экраны доступны`, async ({ page }) => {
      await page.addInitScript(
        ([theme, value]) => {
          localStorage.setItem('bitrix-flow-theme', `${theme}:${value}`);
        },
        [palette, mode] as const,
      );

      const screens = palette === 'gruvbox' ? FULL_SCREENS : QUICK_SCREENS;
      const violations: unknown[] = [];
      for (const screen of screens) {
        await page.goto(screen.path);
        await settle(page);
        const found = await audit(page);
        violations.push(...found.map((violation) => ({ screen: screen.name, ...violation })));
      }

      expect(
        violations,
        violations.map((violation) => JSON.stringify(violation)).join('\n'),
      ).toHaveLength(0);
    });
  }
}

// Мессенджер богаче остальных экранов: панель действий, просмотрщик, окна. Доступность
// проверяем и на открытом диалоге, и на каждом окне, в обеих темах.
for (const mode of MODES) {
  test(`gruvbox/${mode}: диалог, просмотрщик и настройки чата доступны`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('bitrix-flow-theme', `gruvbox:${value}`);
    }, mode);
    await page.goto('/messenger');
    await settle(page);
    const list = page.getByRole('region', { name: 'Диалоги' });
    const chat = page.getByRole('region', { name: 'Переписка' });
    const found: unknown[] = [];
    const check = async (name: string) => {
      const violations = await audit(page);
      found.push(...violations.map((violation) => ({ screen: name, ...violation })));
    };

    await list.getByRole('button', { name: /Дмитрий Соколов/ }).click();
    await expect(chat).toContainText('Посмотришь ревью?');
    await settle(page);
    await check('диалог');

    await chat.getByRole('img', { name: 'фото.jpg' }).click();
    await expect(page.getByRole('dialog', { name: 'Просмотр: фото.jpg' })).toBeVisible();
    await check('просмотрщик');
    await page.keyboard.press('Escape');

    const back = page.getByRole('button', { name: 'К списку диалогов' });
    if (await back.isVisible()) await back.click();
    await list.getByRole('button', { name: /Архивный чат/ }).click();
    await chat.getByRole('button', { name: 'Настройки чата' }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки чата' })).toBeVisible();
    await check('настройки чата');

    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0);
  });
}
