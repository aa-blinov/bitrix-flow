import { test as setup, expect } from '@playwright/test';

// Логинимся один раз и переиспользуем сессию во всех проектах.
setup('вход в приложение', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/логин/i).fill('tester');
  await page.getByLabel(/пароль/i).fill('tester-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: 'tests/.auth/state.json' });
});
