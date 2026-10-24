import { test, expect, type Page } from '@playwright/test';

// Состояния, которые не видно на голом экране: модалка, фильтры, диалоги,
// тосты, тёмная тема. Для каждого — снимок и проверка поведения.

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

test('карточка задачи открывается по названию', async ({ page }) => {
  // Селект фазы рисуется, только когда успели подгрузиться стадии проекта, и
  // снимок зависел от скорости загрузки: на одной машине с селектом, на другой
  // без. Стадии здесь пустые всегда, поэтому снимок один и тот же.
  await page.route('**/api/bitrix/task.stages.get**', (route) =>
    route.fulfill({ json: { result: [] } }),
  );
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

test('тег добавляется и убирается в карточке', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByLabel('Добавить тег');
  await input.fill('регрессия');
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Убрать тег регрессия' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Убрать тег регрессия' }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать тег регрессия' })).toHaveCount(0);
});

test('кнопки статуса задачи пропускает прокси', async ({ page }) => {
  // Прокси пускает только методы из белого списка; «Начать», «Отложить» и
  // остальные кнопки статуса туда не попали и отвечали METHOD_NOT_ALLOWED.
  await page.goto('/all-tasks');
  for (const action of ['start', 'pause', 'defer', 'complete', 'renew']) {
    const response = await page.request.post(`/api/bitrix/tasks.task.${action}`, {
      form: { taskId: '101' },
    });
    expect(response.status(), `tasks.task.${action}`).toBe(200);
  }
});

test('перенос в другой проект не закрывает карточку', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Список вариантов искать внутри карточки: в строках таблицы тоже есть
  // свои выпадающие списки проекта, и без области поиска Playwright
  // находит девять одинаковых «Маркетинг Q4». Список нативный, поэтому
  // вариант выбирается через selectOption, а не кликом по option.
  await dialog
    .getByRole('combobox', { name: 'Проект', exact: true })
    .selectOption({ label: 'Маркетинг Q4' });
  // Раньше тут карточка закрывалась и открывалась доска нового проекта.
  await expect(page.getByText('Задача перенесена в «Маркетинг Q4»')).toBeVisible();
  await expect(dialog).toContainText('Перевести справочники на GraphQL');
  await expect(page).toHaveURL(/\/all-tasks/);
});

test('фильтр по исполнителю сужает список и ставит чип', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  // Панель фильтров: кнопка «Фильтры» открывает её, дальше — «Фильтр» со
  // списком полей и значения с галочками. В наборе @monos/ui меню состоит
  // из данных, поэтому полей и значений два шага, а не вложенное подменю.
  await page
    .getByRole('button', { name: /Фильтры/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Фильтр', exact: true }).click();
  // Поля фильтра живут в поповере: без области поиска под кнопку «Исполнитель»
  // попадает ещё и заголовок таблицы с сортировкой.
  const filterPanel = page.getByRole('dialog');
  await filterPanel.getByRole('button', { name: 'Исполнитель', exact: true }).click();
  await filterPanel.getByRole('checkbox', { name: 'Мария Орлова' }).check();
  await page.keyboard.press('Escape');
  await settle(page);
  // Чип рисуется и в панели над списком, и в ящике фильтров на телефоне, поэтому
  // берём видимый, а не первый подходящий.
  await expect(page.getByText('Исполнитель: Мария Орлова').filter({ visible: true })).toBeVisible();
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
  // Палитра и режим в наборе @monos/ui живут атрибутами на <html>:
  // data-theme — палитра, data-mode — светлое или тёмное.
  await page.evaluate(() => {
    localStorage.setItem('bitrix-flow-theme', 'gruvbox:dark');
    document.documentElement.setAttribute('data-theme', 'gruvbox');
    document.documentElement.setAttribute('data-mode', 'dark');
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

test('мессенджер: диалоги делятся по вкладкам, сообщение уходит', async ({ page }) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  await expect(list.getByRole('button', { name: /Дмитрий Соколов/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Разработка API v2/ })).toBeVisible();

  await list.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(list.getByRole('button', { name: /Архивный чат/ })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);

  await list.getByRole('button', { name: 'Группы' }).click();
  await expect(list.getByRole('button', { name: /Дмитрий Соколов/ })).toHaveCount(0);
  await expect(list.getByRole('button', { name: /Разработка API v2/ })).toBeVisible();

  await list.getByRole('button', { name: 'Личные' }).click();
  await list.getByRole('button', { name: /Дмитрий Соколов/ }).click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  await expect(chat).toContainText('Посмотришь ревью?');

  // Страница истории: в мок-диалоге 60 сообщений, первая пачка берёт последние 50.
  await expect(chat.getByText('Сообщение 1', { exact: true })).toHaveCount(0);
  await chat.getByRole('button', { name: 'Показать более ранние' }).click();
  await expect(chat.getByText('Сообщение 1', { exact: true })).toHaveCount(1);
  await expect(chat.getByRole('button', { name: 'Показать более ранние' })).toHaveCount(0);

  const send = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/messenger/messages'),
  );
  await chat.getByLabel('Сообщение', { exact: true }).fill('Да, смотрю');
  await chat.getByRole('button', { name: 'Отправить' }).click();
  expect((await send).postDataJSON()).toEqual({ dialogId: '2', text: 'Да, смотрю' });
  await expect(chat.getByLabel('Сообщение', { exact: true })).toHaveValue('');
});

test('мессенджер: чужой формат DIALOG_ID не уходит в портал', async ({ page }) => {
  const response = await page.request.get('/api/messenger/messages?dialogId=user2');
  expect(response.status()).toBe(400);
});

// Playwright не видит тело multipart-запроса с файлом (postData пустой), поэтому
// поля формы записываются прямо в fetch страницы.
async function recordUploads(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as unknown as { __uploads: string[] }).__uploads = [];
    window.fetch = (input, init) => {
      if (init?.body instanceof FormData)
        (window as unknown as { __uploads: string[] }).__uploads.push(
          [...init.body.entries()]
            .map(([key, value]) => `${key}=${value instanceof File ? value.name : value}`)
            .join('&'),
        );
      return original(input, init);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { __uploads: string[] }).__uploads.join('\n'));
}

async function openDmitry(page: import('@playwright/test').Page) {
  await page.goto('/messenger');
  await page
    .getByRole('region', { name: 'Диалоги' })
    .getByRole('button', { name: /Дмитрий Соколов/ })
    .click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  await expect(chat).toContainText('Посмотришь ревью?');
  return chat;
}

test('мессенджер: Markdown и теги Битрикса, файлы, карточки и прочитанность', async ({ page }) => {
  const chat = await openDmitry(page);

  // Сообщение 58 написано Markdown, 56 смесью тегов Битрикса и Markdown.
  await expect(chat.locator('strong', { hasText: 'Важно' })).toBeVisible();
  await expect(chat.getByRole('link', { name: 'схему' })).toHaveAttribute(
    'href',
    'https://example.com/schema',
  );
  await expect(chat.locator('code', { hasText: 'npm test' })).toBeVisible();
  await expect(chat.locator('strong', { hasText: 'Релиз' })).toBeVisible();
  await expect(chat.locator('blockquote', { hasText: 'цитата из markdown' })).toBeVisible();
  await expect(chat.getByRole('listitem').filter({ hasText: 'второй пункт' })).toBeVisible();

  // Карточка (params.ATTACH) вместо пустого сообщения.
  await expect(chat.getByText('Мониторинг: сервис недоступен')).toBeVisible();
  await expect(chat.getByText('api-1')).toBeVisible();

  // Файлы идут через наш роут, а не ссылкой портала, которая ведёт на вход.
  await expect(chat.getByRole('img', { name: 'схема.png' })).toHaveAttribute(
    'src',
    /\/api\/messenger\/file\?dialogId=2&fileId=501/,
  );
  await expect(chat.locator('audio[aria-label^="Голосовое сообщение"]')).toHaveCount(1);
  await expect(chat.getByText('[Вложение]')).toHaveCount(0);

  // Дмитрий прочитал по 57-е: свои сообщения до него прочитаны, 59-е нет.
  await expect(chat.getByRole('img', { name: 'Прочитано: Дмитрий Соколов' }).first()).toBeVisible();
  await expect(chat.getByRole('img', { name: 'Не прочитано' })).toHaveCount(1);
});

test('мессенджер: файл уходит multipart-запросом с подписью из поля', async ({ page }) => {
  const uploads = await recordUploads(page);
  const chat = await openDmitry(page);
  await chat.getByLabel('Сообщение', { exact: true }).fill('Вот отчёт');
  const upload = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/messenger/files'),
  );
  await chat
    .getByLabel('Файлы')
    .setInputFiles({ name: 'отчёт.txt', mimeType: 'text/plain', buffer: Buffer.from('данные') });
  await upload;
  const body = await uploads();
  expect(body).toContain('file=отчёт.txt');
  expect(body).toContain('message=Вот отчёт');
  await expect(chat.getByLabel('Сообщение', { exact: true })).toHaveValue('');
  await expect(chat.getByRole('alert')).toHaveCount(0);
});

test('мессенджер: слишком большой файл не уходит', async ({ page }) => {
  const chat = await openDmitry(page);
  let called = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/files')) called = true;
  });
  await chat.getByLabel('Файлы').setInputFiles({
    name: 'big.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(21 * 1024 * 1024),
  });
  await expect(chat.getByRole('alert')).toContainText('больше');
  expect(called).toBe(false);
});

test.describe('мессенджер: голосовые', () => {
  test.use({ permissions: ['microphone'] });

  test('запись уходит файлом «Голосовое сообщение»', async ({ page }) => {
    const uploads = await recordUploads(page);
    const chat = await openDmitry(page);
    await chat.getByRole('button', { name: 'Записать голосовое' }).click();
    await expect(chat.getByRole('timer')).toContainText('Запись');
    await page.waitForTimeout(1200);
    const upload = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/api/messenger/files'),
    );
    await chat.getByRole('button', { name: 'Отправить голосовое' }).click();
    await upload;
    expect(await uploads()).toContain('file=Голосовое сообщение');
    await expect(chat.getByRole('button', { name: 'Записать голосовое' })).toBeVisible();
  });
});

test('мессенджер: фото открываются в просмотрщике, а не в новой вкладке, файлы скачиваются', async ({
  page,
}) => {
  let popups = 0;
  page.on('popup', () => popups++);
  const chat = await openDmitry(page);

  await chat.getByRole('img', { name: 'фото.jpg' }).click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр: фото.jpg' });
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('1 из 2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'Просмотр: схема.png' })).toContainText('2 из 2');
  await expect(page.getByRole('link', { name: 'Скачать' })).toHaveAttribute(
    'href',
    /fileId=501.*download=1/,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(popups).toBe(0);

  // Остальные форматы это ссылка на скачивание с именем файла.
  const pdf = chat.getByRole('link', { name: /договор\.pdf/ });
  await expect(pdf).toHaveAttribute('href', /fileId=504.*download=1/);
  await expect(pdf).toHaveAttribute('download', 'договор.pdf');
});

test('мессенджер: скрепка, поле и микрофон стоят в одну линию', async ({ page }) => {
  const chat = await openDmitry(page);
  const boxes = await Promise.all(
    [
      chat.getByRole('button', { name: 'Прикрепить файл' }),
      chat.getByLabel('Сообщение', { exact: true }),
      chat.getByRole('button', { name: 'Записать голосовое' }),
    ].map((locator) => locator.boundingBox()),
  );
  const [clip, field, mic] = boxes;
  expect(clip && field && mic).toBeTruthy();
  for (const box of [clip!, mic!]) {
    expect(Math.abs(box.y - field!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - field!.height)).toBeLessThanOrEqual(1);
  }
});

test('меню: пункты переставляются перетаскиванием, порядок переживает перезагрузку', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'на телефоне меню лежит в выдвижной панели');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const nav = page.locator('aside nav');
  // Во время перезагрузки страницы чтение падает с «контекст уничтожен»: пустой ответ
  // заставляет poll повторить попытку, а не упасть.
  const order = async () =>
    (
      await nav
        .getByRole('link')
        .allInnerTexts()
        .catch(() => [])
    ).slice(0, 3);
  await expect.poll(order).toEqual(['Главная', 'Сводка проектов', 'Поиск']);

  const from = (await nav.getByRole('link', { name: 'Поиск' }).boundingBox())!;
  const to = (await nav.getByRole('link', { name: 'Главная' }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(order).toEqual(['Поиск', 'Главная', 'Сводка проектов']);
  await page.reload();
  await expect.poll(order).toEqual(['Поиск', 'Главная', 'Сводка проектов']);
});
