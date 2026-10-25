import { readFileSync, writeFileSync } from 'node:fs';
import { test as setup, expect } from '@playwright/test';

const STATE = 'tests/.auth/state.json';

// Логинимся один раз и переиспользуем сессию во всех проектах.
setup('вход в приложение', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/логин/i).fill('tester');
  await page.getByLabel(/пароль/i).fill('tester-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: STATE });

  // После входа открывается главная, и она успевает или не успевает записать в
  // localStorage кэш приложения со стадиями проекта. Снимок сессии брался в разный
  // момент, и тесты то стартовали с готовыми стадиями (в карточке задачи рисуется
  // селект фазы), то без них. Оставляем только куки и номер портала, как у чистого входа.
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  state.origins = [
    {
      origin: new URL(page.url()).origin,
      localStorage: [{ name: 'bitrix_member_id', value: 'test-member' }],
    },
  ];
  writeFileSync(STATE, JSON.stringify(state));
});
