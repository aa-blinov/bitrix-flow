import { test, expect, type Page } from '@playwright/test';

// Состояния, которые не видно на голом экране: модалка, фильтры, диалоги,
// тосты, тёмная тема. Для каждого — снимок и проверка поведения.

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

test('карточка задачи открывается по названию', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Перевести справочники на GraphQL');
  await expect(page).toHaveScreenshot('task-modal.png', { mask: [page.locator('time')] });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('фильтр по исполнителю сужает список и ставит чип', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page
    .getByRole('button', { name: /Фильтры/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Фильтр', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Исполнитель', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Мария Орлова' }).click();
  await page.keyboard.press('Escape');
  await settle(page);
  await expect(page.getByRole('button', { name: /Исполнитель/ }).first()).toContainText('Мария');
  await expect(page.getByText('Согласовать лимиты запросов')).toBeVisible();
  await expect(page.getByText('Перевести справочники на GraphQL')).toHaveCount(0);
  await expect(page).toHaveScreenshot('filtered-list.png', { mask: [page.locator('time')] });
});

test('пустой результат предлагает сбросить фильтры', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByPlaceholder('Поиск задач…').fill('такого-текста-нет-нигде');
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Нет задач' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сбросить фильтры/ })).toBeVisible();
  await expect(page).toHaveScreenshot('empty-state.png');
});

test('диалог создания задачи заполнен и готов к отправке', async ({ page }) => {
  await page.goto('/my-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Новая задача' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Название задачи').fill('Черновик из теста');
  await expect(page).toHaveScreenshot('create-dialog.png');
  await page.keyboard.press('Escape');
});

test('тёмная тема рисует список целиком', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.evaluate(() => {
    localStorage.setItem('bitrix-flow-theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('all-tasks-dark.png', { mask: [page.locator('time')] });
});

test('доска проекта раскладывает задачи по колонкам', async ({ page }) => {
  await page.goto('/projects/10');
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Разработка API v2', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Бэклог', level: 2 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Перевести справочники на GraphQL', level: 3 }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot('board.png', { mask: [page.locator('time')] });
});
