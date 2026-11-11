import { readFileSync, writeFileSync } from 'node:fs';
import { test as setup, expect } from '@playwright/test';
import { UI_WORKERS, serverUrl, statePath } from './workers';

// Логинимся один раз на сервер каждого потока: сессия хранится в базе сервера,
// и кука одного потока на сервере другого недействительна.
setup('вход в приложение', async ({ browser }) => {
  for (let index = 0; index < UI_WORKERS; index++) {
    const context = await browser.newContext({ baseURL: serverUrl(index) });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/логин/i).fill('tester');
    await page.getByLabel(/пароль/i).fill('tester-password');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    const path = statePath(index);
    await context.storageState({ path });

    // После входа открывается главная, и она успевает или не успевает записать в
    // localStorage кэш приложения со стадиями проекта. Снимок сессии брался в разный
    // момент, и тесты то стартовали с готовыми стадиями (в карточке задачи рисуется
    // селект фазы), то без них. Оставляем только куки и номер портала, как у чистого входа.
    const state = JSON.parse(readFileSync(path, 'utf8'));
    state.origins = [
      {
        origin: new URL(page.url()).origin,
        localStorage: [{ name: 'bitrix_member_id', value: 'test-member' }],
      },
    ];
    writeFileSync(path, JSON.stringify(state));
    await context.close();
  }
});
