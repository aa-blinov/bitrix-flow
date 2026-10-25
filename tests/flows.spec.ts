import { MongoClient } from 'mongodb';
import { test, expect, type Page } from '@playwright/test';

// Состояния, которые не видно на голом экране: модалка, фильтры, диалоги,
// тосты, тёмная тема. Для каждого — снимок и проверка поведения.

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

test('карточка задачи открывается по названию', async ({ page }) => {
  await page.route('**/api/bitrix/task.stages.get**', (route) =>
    route.fulfill({ json: { result: [] } }),
  );
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Перевести справочники на GraphQL');
  // Селект фазы рисуется, когда подгрузились стадии проекта: в одних прогонах они успевают
  // (на мобильном CI дважды успели), в других нет, и макет шапки чуть меняется. Причину
  // гонки найти не удалось, поэтому допуск шире общего: оба вида проходят, а пропавшая или
  // сломанная карточка (десятки процентов пикселей) нет.
  await expect(page).toHaveScreenshot('task-modal.png', {
    mask: [page.locator('time')],
    maxDiffPixelRatio: 0.05,
  });
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
    const store = window as unknown as { __uploads: string[] };
    store.__uploads = [];
    const describe = (body: FormData) =>
      [...body.entries()]
        .map(([key, value]) => `${key}=${value instanceof File ? value.name : value}`)
        .join('&');
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (init?.body instanceof FormData) store.__uploads.push(describe(init.body));
      return originalFetch(input, init);
    };
    // Файлы уходят через XMLHttpRequest ради хода загрузки.
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData) store.__uploads.push(describe(body));
      return originalSend.call(this, body);
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

test('мессенджер: файл ждёт в очереди и уходит с подписью из поля', async ({ page }) => {
  const uploads = await recordUploads(page);
  const chat = await openDmitry(page);
  await chat.getByLabel('Сообщение', { exact: true }).fill('Вот отчёт');
  await chat
    .getByLabel('Файлы')
    .setInputFiles({ name: 'отчёт.txt', mimeType: 'text/plain', buffer: Buffer.from('данные') });

  // До нажатия «Отправить» ничего не ушло, а файл можно убрать.
  const tray = chat.getByRole('list', { name: 'Прикреплённые файлы' });
  await expect(tray).toContainText('отчёт.txt');
  expect(await uploads()).toBe('');
  await tray.getByRole('button', { name: 'Убрать отчёт.txt' }).click();
  await expect(tray).toHaveCount(0);

  await chat
    .getByLabel('Файлы')
    .setInputFiles({ name: 'отчёт.txt', mimeType: 'text/plain', buffer: Buffer.from('данные') });
  const upload = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/messenger/files'),
  );
  await chat.getByRole('button', { name: 'Отправить' }).click();
  await upload;
  const body = await uploads();
  expect(body).toContain('file=отчёт.txt');
  expect(body).toContain('message=Вот отчёт');
  await expect(chat.getByLabel('Сообщение', { exact: true })).toHaveValue('');
  await expect(tray).toHaveCount(0);
  await expect(chat.getByRole('alert')).toHaveCount(0);
});

test('мессенджер: перетащенные в окно файлы попадают в очередь, отправка показывает ход', async ({
  page,
}) => {
  await page.route('**/api/messenger/files', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ json: { id: 1 } });
  });
  const chat = await openDmitry(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'схема.pdf', { type: 'application/pdf' }));
    return transfer;
  });
  await chat.locator('div.relative.flex').first().dispatchEvent('dragenter', { dataTransfer });
  await expect(chat.getByText('Отпустите файлы, чтобы прикрепить')).toBeVisible();
  await chat.locator('div.relative.flex').first().dispatchEvent('drop', { dataTransfer });
  await expect(chat.getByRole('list', { name: 'Прикреплённые файлы' })).toContainText('схема.pdf');

  await chat.getByRole('button', { name: 'Отправить' }).click();
  await expect(chat.getByRole('progressbar', { name: 'Отправка файла' })).toBeVisible();
  await expect(chat.getByRole('progressbar')).toHaveCount(0);
  await expect(chat.getByRole('list', { name: 'Прикреплённые файлы' })).toHaveCount(0);
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
  // Поле целиком в окне: раньше страница стояла ниже окна, и поле уходило за край.
  expect(field!.y + field!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  // Плавающая кнопка меню на телефоне не лежит на кнопке отправки.
  const menuButton = page.getByRole('button', { name: 'Открыть меню' });
  if (await menuButton.count()) {
    const menu = (await menuButton.boundingBox())!;
    // Под мессенджером оставлена полоса для кнопки меню: поле целиком выше неё.
    expect(field!.y + field!.height).toBeLessThanOrEqual(menu.y);
  }
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

test('мессенджер: пока фото грузится, на его месте заглушка с индикатором', async ({ page }) => {
  await page.route(/\/api\/messenger\/file\?.*fileId=501/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const chat = await openDmitry(page);
  await expect(chat.getByRole('status', { name: 'Загрузка файла' })).toBeVisible();
  await expect(chat.getByRole('status', { name: 'Загрузка файла' })).toHaveCount(0);
  await expect(chat.getByRole('img', { name: 'схема.png' })).toBeVisible();
});

test('мессенджер: фото, которое не загрузилось, можно запросить заново', async ({ page }) => {
  const failing = /\/api\/messenger\/file\?.*fileId=503/;
  await page.route(failing, (route) => route.abort());
  const chat = await openDmitry(page);
  await expect(chat.getByText('Не удалось загрузить фото.jpg')).toBeVisible();

  await page.unroute(failing);
  await chat.getByRole('button', { name: 'Повторить' }).click();
  await expect(chat.getByRole('img', { name: 'фото.jpg' })).toBeVisible();
  await expect(chat.getByText('Не удалось загрузить фото.jpg')).toHaveCount(0);
});

test('мессенджер: в просмотрщике упавшее фото показывает ошибку и повтор', async ({ page }) => {
  const chat = await openDmitry(page);
  await chat.getByRole('img', { name: 'фото.jpg' }).click();
  await expect(page.getByRole('dialog', { name: 'Просмотр: фото.jpg' })).toBeVisible();
  // Следующее фото в просмотрщике не загрузится: роут оборван до листания.
  const failing = /\/api\/messenger\/file\?.*fileId=501/;
  await page.route(failing, (route) => route.abort());
  await page.keyboard.press('ArrowRight');
  const viewer = page.getByRole('dialog', { name: 'Просмотр: схема.png' });
  await expect(viewer.getByText('Не удалось загрузить схема.png')).toBeVisible();
  await page.unroute(failing);
  await viewer.getByRole('button', { name: 'Повторить' }).click();
  await expect(viewer.getByRole('img', { name: 'схема.png' })).toBeVisible();
});

// Панель действий над сообщением видна по наведению, поэтому открываем её явно.
async function bubble(chat: import('@playwright/test').Locator, text: string) {
  const message = chat
    .getByText(text, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]');
  // Панель действий стоит над сообщением: у самого верхнего края ленты её обрезает,
  // поэтому сообщение сначала выводим в середину.
  await message.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await message.hover();
  // На телефоне наведения нет: панель действий открывается нажатием на сообщение.
  if (!(await message.getByRole('button', { name: 'Ответить' }).isVisible()))
    await message.click({ position: { x: 6, y: 6 } });
  return message;
}

test('мессенджер: ответ, лайк и пересылка чужого сообщения', async ({ page }) => {
  const chat = await openDmitry(page);
  const posts: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/messenger\/(messages|message)$/.test(request.url()))
      posts.push(request.postDataJSON());
  });

  const message = await bubble(chat, 'Сообщение 54');
  await message.getByRole('button', { name: 'Нравится' }).click();
  await expect(chat.getByRole('button', { name: 'Нравится: 1' })).toBeVisible();
  expect(posts).toContainEqual({ messageId: 54, action: 'like' });

  await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Ответить' }).click();
  await expect(chat.getByText('Ответ для Дмитрий Соколов: Сообщение 54')).toBeVisible();
  await chat.getByLabel('Сообщение', { exact: true }).fill('Согласен');
  await chat.getByRole('button', { name: 'Отправить' }).click();
  await expect
    .poll(() => JSON.stringify(posts))
    .toContain('[QUOTE]Дмитрий Соколов: Сообщение 54[/QUOTE]');
  await expect(chat.getByText('Ответ для Дмитрий Соколов')).toHaveCount(0);

  await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Переслать' }).click();
  await page
    .getByRole('dialog', { name: 'Переслать в чат' })
    .getByRole('button', { name: /Разработка API v2/ })
    .click();
  await expect(chat.getByRole('status')).toContainText('Переслано в «Разработка API v2»');
  expect(JSON.stringify(posts)).toContain('Переслано от Дмитрий Соколов: Сообщение 54');
});

test('мессенджер: свои сообщения правятся и удаляются, чужие нет', async ({ page }) => {
  const chat = await openDmitry(page);
  const calls: { method: string; body: unknown }[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/message'))
      calls.push({ method: request.method(), body: request.postDataJSON() });
  });

  const foreign = await bubble(chat, 'Сообщение 54');
  await expect(foreign.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
  await expect(foreign.getByRole('button', { name: 'Удалить' })).toHaveCount(0);

  await (await bubble(chat, 'Сообщение 55')).getByRole('button', { name: 'Изменить' }).click();
  const field = chat.getByLabel('Сообщение', { exact: true });
  await expect(field).toHaveValue('Сообщение 55');
  await field.fill('Сообщение 55, поправил');
  await field.press('Enter');
  await expect(chat.getByText('Сообщение 55, поправил')).toBeVisible();
  expect(calls).toContainEqual({
    method: 'PUT',
    body: { messageId: 55, text: 'Сообщение 55, поправил' },
  });

  await (await bubble(chat, 'Сообщение 49')).getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(chat.getByText('Это сообщение было удалено.')).toBeVisible();
  expect(calls).toContainEqual({ method: 'DELETE', body: { messageId: 49 } });
});

test('мессенджер: упоминание в группе становится тегом Битрикса', async ({ page }) => {
  await page.goto('/messenger');
  await page
    .getByRole('region', { name: 'Диалоги' })
    .getByRole('button', { name: /Разработка API v2/ })
    .click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  const field = chat.getByLabel('Сообщение', { exact: true });
  await field.click();
  await field.pressSequentially('Привет @Дми');
  await expect(chat.getByRole('option', { name: 'Дмитрий Соколов' })).toBeVisible();
  await field.press('Enter');
  await expect(field).toHaveValue('Привет @Дмитрий Соколов ');
  const send = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/messenger/messages'),
  );
  await field.press('Enter');
  expect((await send).postDataJSON().text).toBe('Привет [USER=2]Дмитрий Соколов[/USER]');
});

test('мессенджер: поиск по сообщениям ведёт к найденному', async ({ page }) => {
  const chat = await openDmitry(page);
  await chat.getByRole('button', { name: 'Поиск по сообщениям' }).click();
  await chat.getByPlaceholder('Поиск по сообщениям (от двух букв)').fill('Сообщение 30');
  await chat
    .getByRole('list', { name: 'Найденные сообщения' })
    .getByRole('button', { name: /Сообщение 30/ })
    .click();
  // Панель поиска закрывается после ответа портала: считаем только само сообщение в ленте.
  await expect(chat.locator('#message-30')).toBeVisible();
  await expect(chat.getByRole('button', { name: 'К последним сообщениям' })).toBeVisible();
  await chat.getByRole('button', { name: 'К последним сообщениям' }).click();
  await expect(chat).toContainText('Посмотришь ревью?');
});

test('мессенджер: новый личный чат и новая группа', async ({ page }) => {
  await page.goto('/messenger');
  await page.getByRole('button', { name: 'Новый чат' }).click();
  const modal = page.getByRole('dialog', { name: 'Новый чат' });
  await modal.getByLabel('Найти человека').fill('Анн');
  await modal.getByRole('button', { name: /Анна Новикова/ }).click();
  await expect(
    page.getByRole('region', { name: 'Переписка' }).getByRole('heading', { name: 'Анна Новикова' }),
  ).toBeVisible();

  // На телефоне список диалогов прячется за открытым чатом.
  const back = page.getByRole('button', { name: 'К списку диалогов' });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'Новый чат' }).click();
  await modal.getByRole('button', { name: 'Группа' }).click();
  await modal.getByLabel('Название группы').fill('Команда');
  await modal.getByLabel('Найти человека').fill('Анн');
  await modal.getByRole('button', { name: /Анна Новикова/ }).click();
  const create = page.waitForRequest((request) => request.url().endsWith('/api/messenger/chats'));
  await modal.getByRole('button', { name: 'Создать группу' }).click();
  expect((await create).postDataJSON()).toEqual({ title: 'Команда', userIds: [5] });
  await expect(
    page.getByRole('region', { name: 'Переписка' }).getByRole('heading', { name: 'Команда' }),
  ).toBeVisible();
});

test('мессенджер: каналы Битрикса лежат на своей вкладке, писать в них нельзя без прав', async ({
  page,
}) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  await list.getByRole('button', { name: 'Каналы' }).click();
  await expect(list.getByRole('button', { name: /Дмитрий Соколов/ })).toHaveCount(0);
  await list.getByRole('button', { name: /Новости компании/ }).click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  await expect(chat).toContainText('писать могут только администраторы');
  await expect(chat.getByLabel('Сообщение', { exact: true })).toHaveCount(0);
});

test('мессенджер: ссылка на задачу портала открывается в BitrixFlow', async ({ page }) => {
  const chat = await openDmitry(page);
  const link = chat.getByRole('link', { name: 'Задача #4521' });
  await expect(link).toHaveAttribute('href', '/all-tasks?task=4521');
  await expect(link).not.toHaveAttribute('target', '_blank');
});

test('мессенджер: диалог закрепляется, глушится и помечается непрочитанным', async ({ page }) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  const actions: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/dialog')) actions.push(request.postDataJSON());
  });

  const row = list.getByRole('listitem').filter({ hasText: 'Разработка API v2' });
  await row.hover();
  await row.getByRole('button', { name: 'Действия с диалогом' }).click();
  await page.getByRole('menuitem', { name: 'Закрепить' }).click();
  await expect(list.getByRole('listitem').first()).toContainText('Разработка API v2');
  await expect(row.getByLabel('Закреплён')).toBeVisible();

  await row.hover();
  await row.getByRole('button', { name: 'Действия с диалогом' }).click();
  await page.getByRole('menuitem', { name: 'Отключить звук' }).click();
  await expect(row.getByLabel('Звук отключён')).toBeVisible();

  await row.hover();
  await row.getByRole('button', { name: 'Действия с диалогом' }).click();
  await page.getByRole('menuitem', { name: 'Пометить непрочитанным' }).click();
  await expect(row.getByLabel('Непрочитанных: 1')).toBeVisible();

  expect(actions).toEqual([
    { dialogId: 'chat20', action: 'pin' },
    { dialogId: 'chat20', action: 'mute' },
    { dialogId: 'chat20', action: 'unread' },
  ]);
});

test('меню: у «Сообщений» стоит значок непрочитанных', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'на телефоне меню лежит в выдвижной панели');
  await page.route('**/api/messenger/counters', (route) =>
    route.fulfill({ json: { unread: 4, me: 1 } }),
  );
  await page.goto('/');
  await expect(page.locator('aside nav').getByRole('link', { name: /Сообщения/ })).toContainText(
    '4',
  );
});

test('мессенджер: набор текста шлёт сигнал «печатает» не чаще раза в несколько секунд', async ({
  page,
}) => {
  const chat = await openDmitry(page);
  const signals: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/typing')) signals.push(request.postDataJSON());
  });
  await chat.getByLabel('Сообщение', { exact: true }).pressSequentially('Привет, как дела?');
  await expect.poll(() => signals.length).toBe(1);
  expect(signals[0]).toEqual({ dialogId: '2' });
});

test('событие из очереди портала показывает уведомление браузера', async ({ page }) => {
  await page.addInitScript(() => {
    const notes: string[][] = [];
    (window as unknown as { __notes: string[][] }).__notes = notes;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, options: { body?: string }) {
        notes.push([title, options.body || '']);
      }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    localStorage.setItem('bitrix-flow-chat-notify', '1');
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Событие кладёт в очередь поллер сервера; здесь его заменяет запись в events_stream.
  // SSE отдаёт только события новее своего курсора, а курсор ставится при подключении:
  // запись, сделанная раньше, потерялась бы, поэтому повторяем с новым номером сообщения.
  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  const notes = () => page.evaluate(() => (window as unknown as { __notes: string[][] }).__notes);
  try {
    const db = client.db('bitrix_kanban_test');
    const token = await db.collection('user_tokens').findOne({});
    for (let attempt = 0; attempt < 8 && !(await notes()).length; attempt++) {
      await db.collection('events_stream').insertOne({
        member_id: token?.member_id,
        event: {
          type: 'messenger',
          kind: 'add',
          dialogId: '2',
          chatId: 2,
          messageId: 900 + attempt,
          authorId: 2,
          author: 'Дмитрий Соколов',
          chat: 'Дмитрий Соколов',
          text: 'Посмотришь ревью?',
          muted: false,
          at: new Date().toISOString(),
        },
        created_at: new Date(),
      });
      await page.waitForTimeout(1500);
    }
  } finally {
    await client.close();
  }
  await expect.poll(notes).toContainEqual(['Дмитрий Соколов', 'Посмотришь ревью?']);
});

test('мессенджер: у файлов видны имена, голосовое подписано и ускоряется', async ({ page }) => {
  const chat = await openDmitry(page);
  await expect(chat.getByText('фото.jpg · 5 КБ')).toBeVisible();
  await expect(chat.getByText('Голосовое сообщение', { exact: true })).toBeVisible();
  await chat.getByRole('button', { name: 'Скорость воспроизведения 1×' }).click();
  await expect(chat.getByRole('button', { name: 'Скорость воспроизведения 1.5×' })).toBeVisible();
});

test('мессенджер: после обновления страницы открывается тот же диалог', async ({ page }) => {
  const chat = await openDmitry(page);
  await expect(page).toHaveURL(/\?dialog=2$/);
  await page.reload();
  await expect(chat).toContainText('Посмотришь ревью?');
  await expect(chat.getByRole('heading', { name: 'Дмитрий Соколов' })).toBeVisible();

  // Диалог, которого нет на первой странице списка, подгружается отдельным запросом.
  await page.goto('/messenger?dialog=chat777');
  await expect(chat.getByRole('heading', { name: 'Старый чат' })).toBeVisible();
});

test('мессенджер: присутствие по свежей активности и статусу, а не по одному статусу', async ({
  page,
}) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  const row = (name: string) => list.getByRole('listitem').filter({ hasText: name });
  await expect(row('Дмитрий Соколов').getByRole('img', { name: 'В сети' })).toBeVisible();
  await expect(row('Иван Петров').getByRole('img', { name: 'Не беспокоить' })).toBeVisible();
  await expect(row('Ольга Лис').getByRole('img', { name: 'Отошёл' })).toBeVisible();
  // У Марии статус «online», как у всех в Битриксе, но активность давняя: точки нет.
  await expect(row('Мария Орлова')).toBeVisible();
  await expect(
    row('Мария Орлова').getByRole('img', { name: /В сети|Не беспокоить|Отошёл/ }),
  ).toHaveCount(0);
});

test('мессенджер: в шапке видно, где человек, или когда он был в сети', async ({ page }) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  const chat = page.getByRole('region', { name: 'Переписка' });
  const open = async (name: string) => {
    const back = page.getByRole('button', { name: 'К списку диалогов' });
    if (await back.isVisible()) await back.click();
    await list
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click();
  };
  await open('Дмитрий Соколов');
  await expect(chat.getByText('в сети', { exact: true })).toBeVisible();
  await open('Иван Петров');
  await expect(chat.getByText('не беспокоить', { exact: true })).toBeVisible();
  await open('Ольга Лис');
  await expect(chat.getByText('отошла', { exact: true })).toBeVisible();
  await open('Мария Орлова');
  await expect(chat.getByText(/^Была в сети 26 февр/)).toBeVisible();
});

test('мессенджер: в группе рядом с автором и в списке упоминаний стоит точка присутствия', async ({
  page,
}) => {
  await page.goto('/messenger');
  await page
    .getByRole('region', { name: 'Диалоги' })
    .getByRole('button', { name: /Разработка API v2/ })
    .click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  await expect(chat.getByText('Привет, команда')).toBeVisible();
  await expect(chat.getByRole('img', { name: 'В сети' })).toBeVisible();

  const field = chat.getByLabel('Сообщение', { exact: true });
  await field.click();
  await field.pressSequentially('@Дми');
  await expect(
    chat.getByRole('option', { name: /Дмитрий Соколов/ }).getByRole('img', { name: 'В сети' }),
  ).toBeVisible();
});

test('мессенджер: диалог закрепляется кнопкой в шапке', async ({ page }) => {
  const chat = await openDmitry(page);
  const list = page.getByRole('region', { name: 'Диалоги' });
  // На телефоне список прячется за открытым чатом.
  const back = page.getByRole('button', { name: 'К списку диалогов' });
  if (await back.isVisible()) await back.click();
  // Дмитрий и так первый по дате: закрепляем группу ниже, чтобы порядок изменился.
  await list.getByRole('button', { name: /Разработка API v2/ }).click();
  await chat.getByRole('button', { name: 'Закрепить диалог' }).click();
  await expect(chat.getByRole('button', { name: 'Открепить диалог' })).toBeVisible();
  if (await back.isVisible()) await back.click();
  await expect(list.getByRole('listitem').first()).toContainText('Разработка API v2');
});
