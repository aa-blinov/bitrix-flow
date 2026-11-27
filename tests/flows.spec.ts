import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import type { Locator } from '@playwright/test';
import { test, expect, type Page } from './fixtures';

// Состояния, которые не видно на голом экране: модалка, фильтры, диалоги,
// тосты, тёмная тема. Для каждого — снимок и проверка поведения.

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

// Выпадашка рисует список сама (не нативный select): открыть и нажать пункт по значению.
async function choose(page: Page, field: Locator, value: string) {
  await field.click();
  await page.getByRole('listbox').locator(`[role="option"][data-value="${value}"]`).click();
}

test('карточка задачи открывается по названию', { tag: '@mobile' }, async ({ page }) => {
  // Селект фазы рисуется, только когда у клиента есть стадии проекта; здесь их нет ни из
  // кэша (см. auth.setup.ts), ни от портала, поэтому снимок один и тот же.
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

test('постановщик виден в карточке и меняется', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  const creator = dialog.getByRole('button', { name: 'Анна Кузнецова', exact: true });
  await expect(creator).toBeVisible();
  await creator.click();
  const update = page.waitForRequest(
    (request) =>
      request.url().includes('/api/bitrix/tasks.task.update') &&
      decodeURIComponent(request.postData() || '').includes('"CREATED_BY":"3"'),
  );
  await dialog.getByRole('combobox', { name: 'Постановщик' }).click();
  await page.getByRole('option', { name: /Мария Орлова/ }).click();
  await update;
  await expect(dialog.getByRole('button', { name: 'Мария Орлова', exact: true })).toBeVisible();
});

test('упомянутый не из задачи сначала становится наблюдателем, потом уходит комментарий', async ({
  page,
}) => {
  // Свежая задача из портала: наблюдатель Дмитрий уже есть и не должен потеряться.
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '101',
            title: 'Перевести справочники на GraphQL',
            status: '2',
            groupId: '10',
            responsibleId: '1',
            createdBy: '1',
            accomplices: [],
            auditors: ['2'],
          },
        },
      },
    }),
  );
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  const order: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    const body = decodeURIComponent(request.postData() || '');
    if (url.includes('/api/bitrix/tasks.task.update') && body.includes('AUDITORS'))
      order.push(`auditors ${body.match(/"AUDITORS":\[[^\]]*\]/)?.[0]}`);
    if (url.includes('/api/bitrix/tasks.task.chat.message.send')) order.push('comment');
  });
  const input = dialog.getByRole('textbox', { name: 'Комментарий' });
  await input.fill('глянь @Мар');
  await dialog.getByRole('button', { name: 'Мария Орлова' }).click();
  await input.press('Shift+Enter');
  await expect.poll(() => order).toEqual(['auditors "AUDITORS":["2","3"]', 'comment']);
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

test('новую задачу можно завершить, не начиная', async ({ page }) => {
  // Битрикс сам решает, что доступно: у «Новой» он отдаёт complete, и кнопка должна быть.
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '107',
            title: 'Обновить зависимости',
            status: '2',
            action: { start: true, complete: true, defer: true },
          },
        },
      },
    }),
  );
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Обновить зависимости' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Начать' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Завершить', exact: true })).toBeVisible();
});

test('задачу «Ждёт контроля» принимают через approve, а не complete', async ({ page }) => {
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '107',
            title: 'Обновить зависимости',
            status: '4',
            action: { approve: true, disapprove: true, complete: true },
          },
        },
      },
    }),
  );
  // Статус приходит из списка, а не из карточки: подменяем его там.
  await page.route('**/api/tasks/all**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const task of body.tasks ?? [])
      if (String(task.id ?? task.ID) === '107') task.status = '4';
    await route.fulfill({ json: body });
  });
  const called: string[] = [];
  page.on('request', (request) => {
    const match = /tasks\.task\.(approve|disapprove|complete)/.exec(request.url());
    if (match) called.push(match[1]);
  });
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Обновить зависимости' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Вернуть на доработку' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Принять' }).click();
  await expect.poll(() => called).toEqual(['approve']);
});

test('сводка прячет проекты без задач, а даты вводятся как ДД.ММ.ГГГГ', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'таблица сводки рисуется на десктопе');
  await page.goto('/projects-summary');
  await settle(page);
  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: 'Разработка API v2' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Аналитика' })).toHaveCount(0);
  await page.getByRole('button', { name: /Показать проекты без задач/ }).click();
  await expect(table.getByRole('link', { name: 'Аналитика' })).toBeVisible();

  const from = page.getByLabel('Начальная дата периода');
  await from.fill('15032026');
  await expect(from).toHaveValue('15.03.2026');
  await from.fill('31022026');
  await from.blur();
  // Несуществующая дата не принимается: поле возвращается к последней верной.
  await expect(from).toHaveValue('15.03.2026');
});

test('задачу можно удалить из карточки после подтверждения', async ({ page }) => {
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '107',
            title: 'Обновить зависимости',
            status: '2',
            action: { remove: true },
          },
        },
      },
    }),
  );
  const deleted: string[] = [];
  await page.route('**/api/bitrix/tasks.task.delete**', (route) => {
    deleted.push(route.request().postData() ?? '');
    return route.fulfill({ json: { result: true } });
  });
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Обновить зависимости' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Обновить зависимости/ });
  await dialog.getByRole('button', { name: 'Действия с задачей' }).click();
  await page.getByRole('menuitem', { name: 'Удалить задачу' }).click();
  // Отмена ничего не удаляет.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click();
  expect(deleted).toEqual([]);
  await dialog.getByRole('button', { name: 'Действия с задачей' }).click();
  await page.getByRole('menuitem', { name: 'Удалить задачу' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect.poll(() => deleted.length).toBe(1);
  expect(deleted[0]).toContain('taskId=107');
  await expect(page.getByRole('dialog', { name: /Обновить зависимости/ })).toHaveCount(0);
});

test('перенос в другой проект не закрывает карточку', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Поле искать внутри карточки: в строках таблицы тоже есть свои выпадающие списки
  // проекта. Открытый список один на странице, его пункт уже однозначен.
  await dialog.getByRole('combobox', { name: 'Проект', exact: true }).click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: 'Маркетинг Q4', exact: true })
    .click();
  // Раньше тут карточка закрывалась и открывалась доска нового проекта.
  await expect(page.getByText('Задача перенесена в «Маркетинг Q4»')).toBeVisible();
  await expect(dialog).toContainText('Перевести справочники на GraphQL');
  await expect(page).toHaveURL(/\/all-tasks/);
});

test('фильтр по исполнителю сузает список и ставит чип', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  // Задачам исполнителя теперь дефолтом скрывают закрытые: снимаем «Только
  // активные», иначе список у Марии пустой и сужать нечего.
  await page
    .getByRole('button', { name: /Только активные|Активные/ })
    .first()
    .click();
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

test('пустой результат предлагает сбросить фильтры', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByPlaceholder('Поиск задач…').fill('такого-текста-нет-нигде');
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Нет задач' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сбросить фильтры/ })).toBeVisible();
  await expect(page).toHaveScreenshot('empty-state.png');
});

test('диалог создания задачи заполнен и готов к отправке', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/my-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Новая задача' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Название задачи').fill('Черновик из теста');
  await expect(page).toHaveScreenshot('create-dialog.png');
  await page.keyboard.press('Escape');
});

test('тёмная тема рисует список целиком', { tag: '@mobile' }, async ({ page }) => {
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

test('доска проекта раскладывает задачи по колонкам', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/projects/10');
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Разработка API v2', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Бэклог', level: 2 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Перевести справочники на GraphQL', level: 3 }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot('board.png', { mask: [page.locator('time')] });
});

test('фаза, сменённая в карточке, сразу переносит задачу на доске', async ({ page }) => {
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '101',
            title: 'Перевести справочники на GraphQL',
            status: '2',
            groupId: '10',
            stageId: '100',
            action: { start: true, complete: true },
          },
        },
      },
    }),
  );
  await page.goto('/projects/10');
  await settle(page);
  const title = 'Перевести справочники на GraphQL';
  // Клик по карточке это кнопка-оверлей «Открыть задачу»: заголовок h3 лежит
  // под ней, и клик по «heading» перехватывается кнопкой.
  await page
    .getByRole('button', { name: `Открыть задачу ${title}` })
    .or(page.getByRole('heading', { name: title, level: 3 }))
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await choose(page, dialog.getByRole('combobox', { name: 'Фаза задачи' }), '102');
  const target = 'На ревью';
  await page.keyboard.press('Escape');
  // Колонка по data-stage: хрупкий предок [.//h3] вылезал из опустевшей
  // колонки (закрытые скрыты) на уровень всей доски.
  const columnFor = (name: string, level?: 2 | 3) =>
    page.locator('[data-stage]').filter({ has: page.getByRole('heading', { name, level }) });
  const column = columnFor(target, 2);
  await expect(column.getByRole('heading', { name: title, level: 3 })).toBeVisible();
  // Только колонка, а не вся доска: у опустевшего «Бэклога» (закрытые
  // скрыты) предок по h3 вылезал на уровень контейнера.
  const backlog = page
    .locator('[data-stage]')
    .filter({ has: page.getByRole('heading', { name: 'Бэклог', level: 2 }) });
  await expect(backlog.getByRole('heading', { name: title, level: 3 })).toHaveCount(0);
});

test('перетаскивание на доске переносит задачу в другую колонку', async ({ page }) => {
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '101',
            title: 'Перевести справочники на GraphQL',
            status: '2',
            groupId: '10',
            stageId: '100',
            action: { start: true, complete: true },
          },
        },
      },
    }),
  );
  await page.goto('/projects/10');
  await settle(page);
  const title = 'Перевести справочники на GraphQL';
  const card = page
    .getByRole('heading', { name: title, level: 3 })
    .locator('xpath=ancestor::*[@draggable="true"][1]');
  const target = 'На ревью';
  // Колонка по data-stage: хрупкий предок [.//h3] вылезал из опустевшей
  // колонки (закрытые скрыты) на уровень всей доски, и бросок попадал в центр
  // доски, то есть в ту колонку, что оказалась посередине.
  const columnFor = (name: string, level?: 2 | 3) =>
    page.locator('[data-stage]').filter({ has: page.getByRole('heading', { name, level }) });
  const column = columnFor(target, 2);
  await card.dragTo(column);
  await expect(column.getByRole('heading', { name: title, level: 3 })).toBeVisible();
  // Только колонка, а не вся доска: у опустевшего «Бэклога» (закрытые
  // скрыты) предок по h3 вылезал на уровень контейнера.
  const backlog = page
    .locator('[data-stage]')
    .filter({ has: page.getByRole('heading', { name: 'Бэклог', level: 2 }) });
  await expect(backlog.getByRole('heading', { name: title, level: 3 })).toHaveCount(0);
});

test('кнопка переноса на карточке доски переносит задачу в другую колонку', async ({ page }) => {
  await page.route('**/api/bitrix/tasks.task.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          task: {
            id: '101',
            title: 'Перевести справочники на GraphQL',
            status: '2',
            groupId: '10',
            stageId: '100',
            action: { start: true, complete: true },
          },
        },
      },
    }),
  );
  await page.goto('/projects/10');
  await settle(page);
  const title = 'Перевести справочники на GraphQL';
  const target = 'На ревью';
  await page.getByRole('button', { name: `Переместить задачу ${title}` }).click();
  await page.getByRole('menuitem', { name: target }).click();
  // Колонка по data-stage: хрупкий предок [.//h3] вылезал из опустевшей
  // колонки (закрытые скрыты) на уровень всей доски.
  const columnFor = (name: string, level?: 2 | 3) =>
    page.locator('[data-stage]').filter({ has: page.getByRole('heading', { name, level }) });
  const column = columnFor(target, 2);
  await expect(column.getByRole('heading', { name: title, level: 3 })).toBeVisible();
  // Только колонка, а не вся доска: у опустевшего «Бэклога» (закрытые
  // скрыты) предок по h3 вылезал на уровень контейнера.
  const backlog = page
    .locator('[data-stage]')
    .filter({ has: page.getByRole('heading', { name: 'Бэклог', level: 2 }) });
  await expect(backlog.getByRole('heading', { name: title, level: 3 })).toHaveCount(0);
});

test(
  'мессенджер: диалоги делятся по вкладкам, сообщение уходит',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/messenger');
    const list = page.getByRole('region', { name: 'Диалоги' });
    await expect(list.getByRole('button', { name: /Дмитрий Соколов/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /Разработка API v2/ })).toBeVisible();

    // Вторая страница списка подгружается сама, когда конец списка в окне.
    await expect(list.getByRole('button', { name: /Архивный чат/ })).toBeVisible();

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
  },
);

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
  // Приложение возвращает в последний открытый диалог, а на телефоне список за ним прячется.
  // Ждём, что появится раньше: строка в списке или кнопка «назад» уже открытого диалога.
  const back = page.getByRole('button', { name: 'К списку диалогов' });
  const row = page
    .getByRole('region', { name: 'Диалоги' })
    .getByRole('button', { name: /Дмитрий Соколов/ });
  await expect(row.or(back)).toBeVisible();
  if (await back.isVisible()) await back.click();
  await row.click();
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

test('мессенджер: поле сообщения растёт с переносами строк', async ({ page }) => {
  const chat = await openDmitry(page);
  const input = chat.getByLabel('Сообщение', { exact: true });
  const empty = (await input.boundingBox())!.height;
  await input.fill('первая');
  await input.press('Shift+Enter');
  await input.pressSequentially('вторая');
  await input.press('Shift+Enter');
  await input.pressSequentially('третья');
  await expect(input).toHaveValue('первая\nвторая\nтретья');
  expect((await input.boundingBox())!.height).toBeGreaterThan(empty * 1.8);
  // Очищенное поле возвращается к одной строке.
  await input.fill('');
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(empty + 1);
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
  // Файл собирается в самой странице: setInputFiles гонит 21 МБ через протокол браузера,
  // и на нагруженной машине тест падал по таймауту, не дойдя до проверки.
  await chat.getByLabel('Файлы').evaluate((input: HTMLInputElement) => {
    const files = new DataTransfer();
    files.items.add(new File([new Uint8Array(21 * 1024 * 1024)], 'big.bin'));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
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

test(
  'мессенджер: фото открываются в просмотрщике, а не в новой вкладке, файлы скачиваются',
  { tag: '@mobile' },
  async ({ page }) => {
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
    const pdf = chat.getByRole('link', { name: 'договор.pdf 51 КБ' });
    await expect(pdf).toHaveAttribute('href', /fileId=504.*download=1/);
    await expect(pdf).toHaveAttribute('download', 'договор.pdf');
  },
);

test(
  'мессенджер: скрепка, поле и микрофон стоят в одну линию',
  { tag: '@mobile' },
  async ({ page }) => {
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
    // Открытый чат на телефоне занимает весь экран и закрывает плавающую кнопку меню:
    // она не лежит на кнопке отправки, и под полем нет пустой полосы.
    const menuButton = page.getByRole('button', { name: 'Открыть меню' });
    if (await menuButton.count()) {
      const menu = (await menuButton.boundingBox())!;
      const onTop = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
        { x: menu.x + menu.width / 2, y: menu.y + menu.height / 2 },
      );
      expect(onTop).not.toBe('Открыть меню');
      expect(page.viewportSize()!.height - (field!.y + field!.height)).toBeLessThan(24);
    }
    for (const box of [clip!, mic!]) {
      expect(Math.abs(box.y - field!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - field!.height)).toBeLessThanOrEqual(1);
    }
  },
);

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
  await expect.poll(order).toEqual(['Главная', 'Поиск', 'Сообщения']);

  const from = (await nav.getByRole('link', { name: 'Поиск' }).boundingBox())!;
  const to = (await nav.getByRole('link', { name: 'Главная' }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(order).toEqual(['Поиск', 'Главная', 'Сообщения']);
  await page.reload();
  await expect.poll(order).toEqual(['Поиск', 'Главная', 'Сообщения']);
});

test('меню: группы выплывают вправо и закрываются после перехода', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'на телефоне меню лежит в выдвижной панели');
  const nav = page.locator('aside nav');
  await page.goto('/');
  const reports = nav.getByRole('button', { name: 'Отчёты' });
  await expect(reports).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Аналитика часов' })).toHaveCount(0);
  await reports.click();
  await expect(reports).toHaveAttribute('aria-expanded', 'true');
  // Панель лежит справа от меню: список проектов под группами не сдвигается.
  const sidebar = await page.locator('aside').boundingBox();
  const panel = await nav.getByRole('link', { name: 'Аналитика часов' }).boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  await page.keyboard.press('Escape');
  await expect(reports).toHaveAttribute('aria-expanded', 'false');
  await reports.click();
  await nav.getByRole('link', { name: 'Аналитика часов' }).click();
  await expect(page).toHaveURL(/\/analytics/);
  await expect(reports).toHaveAttribute('aria-expanded', 'false');

  await page.goto('/team-workload');
  await nav.getByRole('button', { name: 'Отчёты' }).click();
  await expect(nav.getByRole('link', { name: 'Нагрузка команды' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('button', { name: 'Задачи' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('мессенджер: пока фото грузится, на его месте заглушка с индикатором', async ({ page }) => {
  // Фото отдаём только после проверки заглушки: с фиксированной задержкой под нагрузкой
  // ответ иногда приходил раньше, чем тест успевал её увидеть.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/messenger\/file\?.*fileId=501/, async (route) => {
    await held;
    await route.continue();
  });
  const chat = await openDmitry(page);
  // В переписке две картинки: под нагрузкой фото.jpg тоже не успевает, и заглушек две.
  const placeholder = chat
    .getByRole('button', { name: /схема\.png/ })
    .getByRole('status', { name: 'Загрузка файла' });
  await expect(placeholder).toBeVisible();
  release();
  await expect(placeholder).toHaveCount(0);
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

test(
  'мессенджер: ответ, лайк и пересылка чужого сообщения',
  { tag: '@mobile' },
  async ({ page }) => {
    const chat = await openDmitry(page);
    const posts: unknown[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/messenger\/(messages|message)$/.test(request.url())
      )
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
    await expect.poll(() => JSON.stringify(posts)).toContain('>>Дмитрий Соколов: Сообщение 54\\n');
    await expect(chat.getByText('Ответ для Дмитрий Соколов')).toHaveCount(0);

    await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Переслать' }).click();
    await page
      .getByRole('dialog', { name: 'Переслать в чат' })
      .getByRole('button', { name: /Разработка API v2/ })
      .click();
    await expect(chat.getByRole('status')).toContainText('Переслано в «Разработка API v2»');
    expect(JSON.stringify(posts)).toContain('Переслано от Дмитрий Соколов: Сообщение 54');
  },
);

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
    body: { messageId: 55, text: 'Сообщение 55, поправил', dialogId: '2' },
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

test('мессенджер: новый личный чат и новая группа', { tag: '@mobile' }, async ({ page }) => {
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

test('мессенджер: реакции, закреп, встреча из сообщения и эмодзи', async ({ page }) => {
  const chat = await openDmitry(page);
  const posts: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/messenger/message'))
      posts.push(request.postDataJSON());
  });

  await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Реакция' }).click();
  await page.getByRole('group', { name: 'Реакции' }).getByRole('button', { name: 'Огонь' }).click();
  await expect(chat.getByRole('button', { name: 'Огонь: 1' })).toBeVisible();
  expect(posts).toContainEqual({ messageId: 54, action: 'react', reaction: 'fire' });

  await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Закрепить сообщение' }).click();
  await expect(chat.getByRole('button', { name: 'Перейти к закреплённому сообщению' })).toHaveText(
    'Сообщение 54',
  );
  expect(posts).toContainEqual({ messageId: 54, action: 'pin' });

  await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Создать встречу' }).click();
  await expect(chat.getByRole('status')).toContainText('Встреча создана в календаре');
  expect(posts).toContainEqual({ messageId: 54, action: 'share', type: 'CALEND', dialogId: '2' });

  await chat.getByRole('button', { name: 'Эмодзи' }).click();
  await page.getByRole('group', { name: 'Эмодзи' }).getByRole('button').first().click();
  await expect(chat.getByLabel('Сообщение', { exact: true })).toHaveValue(
    String.fromCodePoint(0x1f600),
  );
});

test('мессенджер: диалог скрывается из списка, канал создаётся из «Нового чата»', async ({
  page,
}) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  const row = list.getByRole('listitem').filter({ hasText: 'Разработка API v2' });
  await row.hover();
  await row.getByRole('button', { name: 'Действия с диалогом' }).click();
  const hide = page.waitForRequest((request) => request.url().endsWith('/api/messenger/dialog'));
  await page.getByRole('menuitem', { name: 'Скрыть из списка' }).click();
  expect((await hide).postDataJSON()).toEqual({ dialogId: 'chat20', action: 'hide' });
  await expect(row).toHaveCount(0);

  await page.getByRole('button', { name: 'Новый чат' }).click();
  const modal = page.getByRole('dialog', { name: 'Новый чат' });
  await modal.getByRole('button', { name: 'Канал' }).click();
  await modal.getByLabel('Название канала').fill('Новости отдела');
  const create = page.waitForRequest((request) => request.url().endsWith('/api/messenger/chats'));
  await modal.getByRole('button', { name: 'Создать канал' }).click();
  expect((await create).postDataJSON()).toEqual({
    title: 'Новости отдела',
    userIds: [],
    kind: 'channel',
  });
  await expect(
    page
      .getByRole('region', { name: 'Переписка' })
      .getByRole('heading', { name: 'Новости отдела' }),
  ).toBeVisible();
});

test('мессенджер: диалог открывается внизу, стрелка возвращает к последним', async ({ page }) => {
  const chat = await openDmitry(page);
  const feed = chat.locator('[aria-live="polite"]');
  const gap = () => feed.evaluate((box) => box.scrollHeight - box.scrollTop - box.clientHeight);
  await expect.poll(gap).toBeLessThan(80);
  await feed.evaluate((box) => box.scrollTo({ top: 0 }));
  await chat.getByRole('button', { name: 'Прокрутить вниз' }).click();
  await expect.poll(gap).toBeLessThan(80);
  await expect(chat.getByRole('button', { name: 'Прокрутить вниз' })).toHaveCount(0);
});

test('мессенджер: кнопки бота, непрочитано отсюда, файл на Диск и файл с Диска', async ({
  page,
}) => {
  // Кнопки бота подмешиваем в ответ: в моке переписки их нет, а снимки трогать не нужно.
  await page.route('**/api/messenger/messages?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const message of data.messages || [])
      if (message.id === 55)
        message.keyboard = [
          {
            kind: 'button',
            text: 'Вставить ответ',
            disabled: false,
            action: 'PUT',
            value: 'Принято',
          },
          {
            kind: 'button',
            text: 'Создать отчёт',
            disabled: false,
            command: 'report',
            params: '7',
            botId: 2,
          },
        ];
    await route.fulfill({ response, json: data });
  });
  const chat = await openDmitry(page);
  const posts: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/messenger\/(message|disk)$/.test(request.url()))
      posts.push(request.postDataJSON());
  });

  const bot = chat.getByRole('group', { name: 'Кнопки бота' });
  await bot.getByRole('button', { name: 'Вставить ответ' }).click();
  await expect(chat.getByLabel('Сообщение', { exact: true })).toHaveValue('Принято');
  await bot.getByRole('button', { name: 'Создать отчёт' }).click();
  await expect(chat.getByRole('status')).toContainText('Команда отправлена боту');
  expect(posts).toContainEqual({
    messageId: 55,
    action: 'command',
    botId: 2,
    command: 'report',
    params: '7',
  });

  await (await bubble(chat, 'Сообщение 51')).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Сохранить на Диск: договор.pdf' }).click();
  await expect(chat.getByRole('status')).toContainText('сохранён на Диск');
  expect(posts).toContainEqual({ action: 'save', fileId: 504 });

  await (await bubble(chat, 'Сообщение 51')).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Удалить файл: договор.pdf' }).click();
  await expect(chat.getByText('договор.pdf')).toHaveCount(0);
  expect(posts).toContainEqual({ action: 'delete', chatId: 2, fileId: 504 });

  await chat.getByRole('button', { name: 'Файл с Диска' }).click();
  const drive = page.getByRole('dialog', { name: 'Файл с Диска' });
  await drive.getByRole('button', { name: /Документы/ }).click();
  await drive.getByRole('button', { name: /договор\.docx/ }).click();
  await drive.getByRole('button', { name: 'Отправить в чат' }).click();
  await expect(drive).toHaveCount(0);
  expect(posts).toContainEqual({ action: 'commit', dialogId: '2', fileIds: [103] });

  await (await bubble(chat, 'Сообщение 54')).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('menuitem', { name: 'Непрочитано отсюда' }).click();
  await expect(page.getByText('Выберите диалог слева')).toBeVisible();
  expect(posts).toContainEqual({ messageId: 54, action: 'unread', dialogId: '2' });
});

test('мессенджер: свой статус меняется из шапки', async ({ page }) => {
  await page.goto('/messenger');
  const change = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/messenger/status'),
  );
  await page.getByRole('button', { name: 'Мой статус: В сети' }).click();
  await page.getByRole('menuitem', { name: 'Не беспокоить' }).click();
  expect((await change).postDataJSON()).toEqual({ status: 'dnd' });
  await expect(page.getByRole('button', { name: 'Мой статус: Не беспокоить' })).toBeVisible();
});

test('уведомления Битрикс24: приглашение принимается, на личное отвечают, лишнее удаляют', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/portal-notifications'))
      posts.push(request.postDataJSON());
  });
  await page.goto('/notifications');
  await page.getByRole('button', { name: /^Битрикс24/ }).click();
  const list = page.getByRole('list', { name: 'Уведомления Битрикс24' });
  await expect(list).toContainText('Приглашение на встречу «Планёрка»');
  await expect.poll(() => posts).toContainEqual({ action: 'read', ids: [901] });

  await list.getByRole('button', { name: 'Подтвердить участие' }).click();
  const status = page.locator('p[role="status"]');
  await expect(status).toContainText('Подтвердить участие');
  await expect(list).not.toContainText('Планёрка');
  expect(posts).toContainEqual({ action: 'confirm', id: 901, value: 'Y' });

  await list.getByRole('button', { name: 'Ответить' }).click();
  await list.getByLabel('Ответ').fill('Посмотрю сегодня');
  await list.getByRole('button', { name: 'Отправить' }).click();
  await expect(status).toHaveText('Ответ отправлен');
  expect(posts).toContainEqual({ action: 'answer', id: 902, text: 'Посмотрю сегодня' });

  await list
    .getByRole('listitem')
    .filter({ hasText: 'Напоминание о событии' })
    .getByRole('button', { name: 'Удалить уведомление' })
    .click();
  await expect(list).not.toContainText('Напоминание о событии');
  expect(posts).toContainEqual({ action: 'delete', id: 903 });
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

test('событие из очереди портала звенит внутри приложения', async ({ page, testDb }) => {
  await page.addInitScript(() => {
    // Пушей в браузер больше нет: сигнал — звук (AudioContext) внутри приложения.
    let chimes = 0;
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      resume() {
        chimes += 1;
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect: () => ({}),
          start: () => {},
          stop: () => {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect: (node: unknown) => node,
        };
      }
    }
    const scope = window as unknown as {
      AudioContext: unknown;
      __chimes: () => number;
    };
    scope.AudioContext = FakeAudioContext;
    scope.__chimes = () => chimes;
    localStorage.setItem('bitrix-flow-chat-notify', '1');
    // Обычное сообщение звенит только в режиме «на все»: по умолчанию звенят упоминания.
    localStorage.setItem('bitrix-flow-chat-notify-mode', 'all');
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Событие кладёт в очередь поллер сервера; здесь его заменяет запись в events_stream.
  // SSE отдаёт только события новее своего курсора, а курсор ставится при подключении:
  // запись, сделанная раньше, потерялась бы, поэтому повторяем с новым номером сообщения.
  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  const chimes = () =>
    page.evaluate(() => (window as unknown as { __chimes: () => number }).__chimes());
  try {
    const db = client.db(testDb);
    const token = await db.collection('user_tokens').findOne({});
    for (let attempt = 0; attempt < 8 && !(await chimes()); attempt++) {
      await db.collection('events_stream').insertOne({
        member_id: token?.member_id,
        // События чата личные: SSE отдаёт их только своему человеку (в моке это id 1).
        user_id: '1',
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
  await expect.poll(chimes).toBeGreaterThanOrEqual(1);
});
test('мессенджер: звук уведомлений выбирается в меню, по умолчанию на упоминания', async ({
  page,
}) => {
  await openDmitry(page);
  const bell = page.getByRole('button', { name: /^Звук уведомлений/ });
  // По умолчанию звенят упоминания: так новичок не пропустит, что его позвали.
  await expect(bell).toHaveAccessibleName('Звук уведомлений: Только упоминания');
  await bell.click();
  // Нажатие только открывает меню и ничего не меняет; у меню видна подпись,
  // фокус стоит на выбранном пункте, а не на первом.
  await expect(bell).toHaveAccessibleName('Звук уведомлений: Только упоминания');
  const menu = page.getByRole('menu', { name: 'Звук уведомлений' });
  await expect(menu.getByText('Звук уведомлений')).toBeVisible();
  const mentions = page.getByRole('menuitemradio', { name: 'Только упоминания' });
  await expect(mentions).toHaveAttribute('aria-checked', 'true');
  await expect(mentions).toBeFocused();
  await page.getByRole('menuitemradio', { name: 'Без звука' }).click();
  await expect(bell).toHaveAccessibleName('Звук уведомлений: Без звука');
  await bell.click();
  await expect(page.getByRole('menuitemradio', { name: 'Без звука' })).toBeFocused();
  await page.getByRole('menuitemradio', { name: 'На все сообщения' }).click();
  await expect(bell).toHaveAccessibleName('Звук уведомлений: На все сообщения');
});
test('мессенджер: у файлов видны имена, голосовое подписано и ускоряется', async ({ page }) => {
  const chat = await openDmitry(page);
  await expect(chat.getByText('фото.jpg · 5 КБ')).toBeVisible();
  await expect(chat.getByText('Голосовое сообщение', { exact: true })).toBeVisible();
  // Свой плеер вместо нативного: кнопка и перемотка в палитре приложения.
  await expect(chat.getByRole('button', { name: 'Воспроизвести' }).first()).toBeVisible();
  await expect(chat.getByRole('slider', { name: 'Перемотка' }).first()).toBeVisible();
  await chat.getByRole('button', { name: 'Скорость воспроизведения 1×' }).click();
  await expect(chat.getByRole('button', { name: 'Скорость воспроизведения 1.5×' })).toBeVisible();
});

test(
  'мессенджер: после обновления страницы открывается тот же диалог',
  { tag: '@mobile' },
  async ({ page }) => {
    const chat = await openDmitry(page);
    await expect(page).toHaveURL(/\?dialog=2$/);
    await page.reload();
    await expect(chat).toContainText('Посмотришь ревью?');
    await expect(chat.getByRole('heading', { name: 'Дмитрий Соколов' })).toBeVisible();

    // Диалог, которого нет на первой странице списка, подгружается отдельным запросом.
    await page.goto('/messenger?dialog=chat777');
    await expect(chat.getByRole('heading', { name: 'Старый чат' })).toBeVisible();
  },
);

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

test('мессенджер: диалог закрепляется кнопкой в шапке', { tag: '@mobile' }, async ({ page }) => {
  const chat = await openDmitry(page);
  const list = page.getByRole('region', { name: 'Диалоги' });
  // На телефоне список прячется за открытым чатом.
  const back = page.getByRole('button', { name: 'К списку диалогов' });
  const mobile = await back.isVisible();
  if (mobile) await back.click();
  // Дмитрий и так первый по дате: закрепляем группу ниже, чтобы порядок изменился.
  await list.getByRole('button', { name: /Разработка API v2/ }).click();
  // Название диалога видно в шапке и на телефоне: раньше кнопки вытесняли его целиком.
  await expect(chat.getByRole('heading', { name: 'Разработка API v2' })).toBeVisible();
  if (mobile) {
    // На телефоне чат на весь экран, без шапки страницы; закреп живёт в меню строки списка.
    await expect(page.getByRole('heading', { name: 'Сообщения', exact: true })).toBeHidden();
    await back.click();
    const row = list.getByRole('listitem').filter({ hasText: 'Разработка API v2' });
    await row.getByRole('button', { name: 'Действия с диалогом' }).click();
    await page.getByRole('menuitem', { name: 'Закрепить' }).click();
  } else {
    await chat.getByRole('button', { name: 'Закрепить диалог' }).click();
    await expect(chat.getByRole('button', { name: 'Открепить диалог' })).toBeVisible();
  }
  await expect(list.getByRole('listitem').first()).toContainText('Разработка API v2');
});

test('мессенджер: пересылка сообщения с файлами идёт через сервер', async ({ page }) => {
  const chat = await openDmitry(page);
  const forwards: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/forward')) forwards.push(request.postDataJSON());
  });
  await (await bubble(chat, 'Сообщение 59')).getByRole('button', { name: 'Переслать' }).click();
  await page
    .getByRole('dialog', { name: 'Переслать в чат' })
    .getByRole('button', { name: /Разработка API v2/ })
    .click();
  await expect(chat.getByRole('status').filter({ hasText: 'Переслано' })).toBeVisible();
  expect(forwards).toHaveLength(1);
  expect(forwards[0]).toMatchObject({
    fromDialogId: '2',
    toDialogId: 'chat20',
    files: [{ id: 501, name: 'схема.png' }, { id: 502 }],
  });
});

test('мессенджер: администратор группы удаляет чужие сообщения, pdf открывается в новой вкладке', async ({
  page,
}) => {
  await page.goto('/messenger');
  await page
    .getByRole('region', { name: 'Диалоги' })
    .getByRole('button', { name: /Разработка API v2/ })
    .click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  // Привет, команда написал Дмитрий; роль в группе «владелец»: удалить можно.
  await (await bubble(chat, 'Привет, команда')).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();

  const dmitry = await openDmitry(page);
  await expect(
    dmitry.getByRole('link', { name: 'Открыть договор.pdf в новой вкладке' }),
  ).toHaveAttribute('href', /fileId=504/);
  await expect(
    dmitry.getByRole('link', { name: 'Открыть договор.pdf в новой вкладке' }),
  ).toHaveAttribute('target', '_blank');
});

test('мессенджер: чат из людей переименовывается, пополняется и покидается', async ({ page }) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  await list.getByRole('button', { name: /Архивный чат/ }).click();
  const chat = page.getByRole('region', { name: 'Переписка' });
  const calls: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/chat')) calls.push(request.postDataJSON());
  });

  await chat.getByRole('button', { name: 'Настройки чата' }).click();
  const modal = page.getByRole('dialog', { name: 'Настройки чата' });
  await expect(modal.getByRole('list', { name: 'Участники чата' })).toContainText(
    'Дмитрий Соколов',
  );

  await modal.getByLabel('Описание').fill('Архив переписки');
  await modal.getByRole('button', { name: 'Сохранить описание' }).click();
  await expect(modal.getByRole('status')).toHaveText('Описание сохранено');
  await modal.getByRole('radio', { name: 'Цвет mint' }).click();
  await expect(modal.getByRole('radio', { name: 'Цвет mint' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await modal.getByLabel('Название').fill('Новый архив');
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(chat.getByRole('heading', { name: 'Новый архив' })).toBeVisible();

  await chat.getByRole('button', { name: 'Настройки чата' }).click();
  await modal.getByLabel('Добавить участника').fill('Анн');
  await modal
    .getByRole('list', { name: 'Кого добавить' })
    .getByRole('button', { name: /Анна Новикова/ })
    .click();
  // Владелец чата я: рядом со мной подпись, у остальных кнопка передачи владения.
  await expect(modal.getByRole('list', { name: 'Участники чата' })).toContainText('владелец');
  await modal.getByRole('button', { name: 'Сделать владельцем: Дмитрий Соколов' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Передать' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await modal.getByRole('button', { name: 'Исключить Дмитрий Соколов' }).click();
  await modal.getByRole('button', { name: 'Выйти из чата' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Выйти' }).click();
  await expect(list.getByRole('button', { name: /Новый архив/ })).toHaveCount(0);

  expect(calls).toEqual([
    { dialogId: 'chat22', action: 'describe', description: 'Архив переписки' },
    { dialogId: 'chat22', action: 'color', color: 'MINT' },
    { dialogId: 'chat22', action: 'rename', title: 'Новый архив' },
    { dialogId: 'chat22', action: 'add', userIds: [5] },
    { dialogId: 'chat22', action: 'owner', userId: 2 },
    { dialogId: 'chat22', action: 'remove', userId: 2 },
    { dialogId: 'chat22', action: 'leave' },
  ]);
});

test('мессенджер: чат, которого нет в списке, находится по названию на портале', async ({
  page,
}) => {
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  await list.getByLabel('Поиск по диалогам').fill('Старый');
  await expect(list.getByRole('list', { name: 'Найдено на портале' })).toContainText(
    'Старый архив',
  );
  await list.getByRole('list', { name: 'Найдено на портале' }).getByRole('button').click();
  await expect(
    page.getByRole('region', { name: 'Переписка' }).getByRole('heading', { name: 'Старый архив' }),
  ).toBeVisible();
});

test('сводка по проектам и список задач выгружаются в CSV', async ({ page }) => {
  await page.goto('/projects-summary');
  await expect(page.getByRole('heading', { name: 'Сводка по проектам', level: 1 })).toBeVisible();
  // Кнопка оживает, когда в таблице есть строки.
  await expect(page.getByRole('button', { name: /CSV/ })).toBeEnabled();
  const summary = page.waitForEvent('download');
  await page.getByRole('button', { name: /CSV/ }).click();
  const summaryFile = readFileSync((await (await summary).path())!, 'utf8');
  expect(summaryFile.startsWith('\uFEFF"Проект";"Участников"')).toBe(true);
  expect(summaryFile).toContain('"Разработка API v2"');

  await page.goto('/all-tasks');
  await settle(page);
  const grid = page.waitForEvent('download');
  await page.getByRole('button', { name: /CSV/ }).first().click();
  const gridFile = readFileSync((await (await grid).path())!, 'utf8');
  expect(gridFile).toContain('"Перевести справочники на GraphQL"');
});

test('мессенджер: кнопка открывает диалог в самом Битриксе, где есть звонки', async ({ page }) => {
  const chat = await openDmitry(page);
  await expect(chat.getByRole('link', { name: /Открыть диалог в Битриксе/ })).toHaveAttribute(
    'href',
    'https://mock.bitrix24.ru/online/?IM_DIALOG=2',
  );
});

test('мессенджер: действия над сообщением достижимы с клавиатуры', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'на телефоне клавиатуры нет');
  const chat = await openDmitry(page);
  const message = chat
    .getByText('Сообщение 54', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]');
  await message.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  // На сообщение можно встать клавишей Tab: панель действий показывается по фокусу,
  // а не только по наведению мыши.
  await message.focus();
  await expect(message.getByRole('button', { name: 'Ответить' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(message.getByRole('button', { name: 'Ответить' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chat.getByText(/^Ответ для Дмитрий Соколов/)).toBeVisible();
  // Escape в поле отменяет ответ и не уводит фокус из переписки.
  await expect(chat.getByLabel('Сообщение', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chat.getByText(/^Ответ для/)).toHaveCount(0);
});

test('мессенджер: просмотрщик держит фокус внутри и возвращает его при закрытии', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'на телефоне клавиатуры нет');
  const chat = await openDmitry(page);
  const photo = chat
    .getByRole('button')
    .filter({ has: page.getByRole('img', { name: 'фото.jpg' }) });
  await photo.focus();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Просмотр: фото.jpg' });
  await expect(viewer).toBeVisible();
  // Серия Tab не выводит фокус за пределы просмотрщика.
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    expect(await viewer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(photo).toBeFocused();
});

test(
  'английский включается переключателем и переживает перезагрузку',
  { tag: '@mobile' },
  async ({ page, context }) => {
    await page.goto('/all-tasks');
    await settle(page);
    const english = page.getByRole('button', { name: 'EN', exact: true });
    // На мобильном боковая панель спрятана за кнопкой меню.
    if (!(await page.getByRole('button', { name: 'Профиль и настройки' }).isVisible()))
      await page.getByRole('button', { name: 'Открыть меню' }).click();
    // Переключатель языка лежит в панели профиля.
    await page.getByRole('button', { name: 'Профиль и настройки' }).click();
    await english.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('All tasks').and(page.locator(':visible')).first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveTitle('All tasks — BitrixFlow');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('All tasks').and(page.locator(':visible')).first()).toBeVisible();
    await context.clearCookies({ name: 'bitrix-flow-locale' });
  },
);

test('мессенджер: задача создаётся из реплики с цитатой и названием из первой строки', async ({
  page,
}) => {
  const chat = await openDmitry(page);
  await (
    await bubble(chat, 'Сообщение 54')
  )
    .getByRole('button', { name: 'Создать задачу' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Новая задача' });
  await expect(dialog.getByLabel('Название задачи')).toHaveValue('Сообщение 54');
  await expect(dialog.getByLabel('Описание задачи')).toHaveValue(
    /Дмитрий Соколов, .*:\nСообщение 54/,
  );
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('dialog', { name: 'Новая задача' })).toHaveCount(0);
});

test('учётные записи: вошедший через Битрикс виден, блокируется и удаляется', async ({
  page,
  testDb,
}) => {
  // Учётка появляется сама при первом входе через Битрикс: кладём такую в базу.
  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  try {
    const db = client.db(testDb);
    const token = await db.collection('user_tokens').findOne({});
    await db.collection('app_users').deleteMany({ username: 'b24-77' });
    await db.collection('app_users').insertOne({
      username: 'b24-77',
      password_hash: '',
      role: 'user',
      blocked: false,
      created_at: new Date(),
      bitrix_member_id: token?.member_id,
      bitrix_user_id: '77',
      display_name: 'Иван Петров',
    });
  } finally {
    await client.close();
  }

  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Учётные записи' })).toBeVisible();
  // Создавать учётки руками и задавать пароли больше нечем.
  await expect(page.getByRole('button', { name: 'Добавить' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сбросить пароль' })).toHaveCount(0);
  const row = page.getByRole('listitem').filter({ hasText: 'Иван Петров' });
  await expect(row).toContainText('Битрикс: #77');

  await row.getByRole('button', { name: 'Заблокировать' }).click();
  await expect(row.getByText('Заблокирован')).toBeVisible();

  // Себя заблокировать нельзя: сервер отказывает, и это видно словами.
  const me = page.getByRole('listitem').filter({ hasText: 'tester' });
  await me.getByRole('button', { name: 'Заблокировать' }).click();
  await expect(page.getByText('Себя заблокировать, удалить или лишить прав нельзя.')).toBeVisible();
  await expect(me.getByText('Заблокирован')).toHaveCount(0);

  await row.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(row).toHaveCount(0);
});

test('поиск: слово в названии выделяется, лишнее слово ничего не находит', async ({ page }) => {
  await page.goto('/search?q=graphql');
  const first = page.getByRole('heading', { level: 2 }).first();
  await expect(first).toContainText('GraphQL');
  await expect(first.locator('mark').first()).toHaveText(/graphql/i);
  // Слова из запроса, которых нет ни в одном поле, ничего не находят.
  await page.getByLabel('Поиск задач по названию').fill('zzzqx');
  await expect(page.getByText('не найдены')).toBeVisible();
});

test(
  'аналитика часов делит часы по классам и фильтрует по клику на плитку',
  { tag: '@mobile' },
  async ({ page, isMobile, testDb }) => {
    // Класс проекта раскладывает теги по задачам, и они остаются после теста: десктоп и
    // телефон гоняют его в одной базе. Возвращаем бэклог к сиду: без класса и без тегов.
    const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
    try {
      const db = client.db(testDb);
      await db
        .collection('task_mirror')
        .updateMany({ 'data.group.id': '12' }, { $set: { 'data.tags': [] } });
      await db.collection('projects').updateMany({ id: '12' }, { $unset: { keywords: '' } });
      // Память о сменах класса — тоже часть сида: мобильный проект наследует базу
      // после десктопного, и без сброса периодов класс считался бы «с начала времён».
      await db.collection('project_class_periods').deleteMany({ projectId: '12' });
    } finally {
      await client.close();
    }
    // Период из URL: сид кладёт списания на две недели вокруг 2026-03-02.
    await page.goto('/analytics?from=2026-02-23&to=2026-03-08');
    await expect(page.getByRole('heading', { name: 'Аналитика часов', level: 1 })).toBeVisible();
    const unassigned = page.getByRole('button', { name: /Нераспределено/ }).first();
    await expect(unassigned).toContainText('3,5 ч');
    await expect(page.getByRole('button', { name: /Коммерческие/ }).first()).toContainText('16 ч');

    // На телефоне вместо таблиц карточки и список: в таблице часы уезжали за правый край.
    const role = isMobile ? 'list' : 'table';
    const pivot = page.getByRole(role, { name: 'Проекты по классам' }).first();
    const detail = page.getByRole(role, { name: 'Детализация часов' }).first();
    const apiRow = isMobile
      ? pivot.getByRole('listitem', { name: 'Разработка API v2' })
      : pivot.getByRole('row', { name: /Разработка API v2/ });

    // План API v2: подзадача 103 (2 ч) заменяет оценку родителя 101, плюс 102 (4 ч).
    await expect(apiRow).toContainText('+10');
    await expect(page.getByText('Данные на 09.03, 02:00')).toBeVisible();

    // «Обновить» забирает часы из портала заново, а не только перечитывает отчёт.
    const refresh = page.waitForRequest(
      (request) => request.url().endsWith('/api/analytics/hours') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Обновить' }).click();
    await refresh;
    await expect(unassigned).toContainText('3,5 ч');
    await expect(page.getByText(/Не удалось забрать/)).toHaveCount(0);

    await unassigned.click();
    await expect(page).toHaveURL(/class=unassigned/);
    await expect(detail).toContainText('Внутренний бэклог');
    await expect(detail).not.toContainText('Разработка API v2');

    // Класс ставится прямо из детализации: селект пишет тег задачи в Битрикс.
    await detail
      .getByRole('button', { name: /Внутренний бэклог/ })
      .first()
      .click();
    // Детализация идёт проект, исполнитель, задачи: задача в листе, под исполнителем.
    await detail
      .getByRole('button', { name: /Анна Кузнецова/ })
      .first()
      .click();
    await expect(detail).toContainText('Обновить зависимости');
    const pick = detail.getByRole('combobox').first();
    await expect(pick).toHaveAttribute('data-value', '');
    const update = page.waitForRequest(
      (request) =>
        request.url().includes('tasks.task.update') &&
        (request.postData() || '').includes(encodeURIComponent('часы-внутреннее')),
    );
    await choose(page, pick, 'internal');
    await update;
    await expect(pick).toBeEnabled();
    await expect(page.getByText(/Не удалось поставить класс/)).toHaveCount(0);

    // Число класса в сводной ведёт к раскрытым задачам за ним.
    await unassigned.click();
    await expect(page).not.toHaveURL(/class=/);

    // Класс проекта действует «с даты»: смена идёт после подтверждения в набором диалоге.
    const confirm = page.getByRole('alertdialog');
    const confirmChange = async () => {
      await confirm.getByRole('button', { name: 'Продолжить' }).click();
      await expect(confirm).toHaveCount(0);
    };
    const backlogClass = page.getByRole('combobox', { name: 'Класс проекта Внутренний бэклог' });
    const internal = page.getByRole('button', { name: /Внутренняя разработка/ }).first();
    await choose(page, backlogClass, 'internal');
    await confirmChange();
    await expect(internal).toContainText('3,5 ч');
    await expect(unassigned).toContainText('0 ч');
    await choose(page, backlogClass, '');
    await confirmChange();
    await expect(internal).toContainText('3,5 ч');
    await expect(unassigned).toContainText('0 ч');

    await apiRow
      .getByRole('button', { name: isMobile ? /Коммерческие\s*16/ : '16', exact: !isMobile })
      .last()
      .click();
    await expect(page).toHaveURL(/project=10&class=commercial|class=commercial&project=10/);
    const taskLink = detail.getByRole('link').first();
    await expect(taskLink).toHaveAttribute('href', /\/all-tasks\?task=/);
    // Четыре задачи: на телефоне ссылка это вся строка, в таблице ссылки у названия и у часов.
    await expect(detail.getByRole('link')).toHaveCount(isMobile ? 4 : 8);

    // Сумма группы сворачивает группу так же, как стрелка.
    if (isMobile) await detail.getByRole('button', { name: /Разработка API v2/ }).click();
    else await detail.getByRole('row').nth(1).getByRole('button').last().click();
    await expect(detail.getByRole('link')).toHaveCount(0);

    // Итог класса включает фильтр класса по всем проектам.
    if (isMobile)
      await pivot.getByRole('listitem', { name: 'Итого' }).getByRole('button').first().click();
    else await pivot.locator('tfoot').getByRole('button').first().click();
    await expect(page).not.toHaveURL(/project=/);
    await expect(page).toHaveURL(/class=commercial/);

    // Быстрый период ставит обе даты: прошлый месяц целиком, с первого по последнее число.
    const previous = page.getByRole('button', { name: 'Прошлый месяц', exact: true });
    await previous.click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-(28|29|30|31)/);
    await expect(previous).toHaveAttribute('aria-pressed', 'true');
  },
);

test('кнопка «Обновить» крутится, пока список перечитывается, и подтверждает итог', async ({
  page,
}) => {
  await page.goto('/all-tasks');
  await settle(page);
  const refresh = page.getByRole('button', { name: 'Обновить список' });
  const reload = page.waitForRequest((request) => request.url().includes('/api/tasks/all'));
  await refresh.click();
  await expect(refresh).toHaveAttribute('aria-busy', 'true');
  await reload;
  await expect(page.getByText('Список обновлён')).toBeVisible();
  await expect(refresh).toBeEnabled();
});

test(
  'дашборды: несколько своих экранов создаются, сохраняются и не распирают страницу',
  { tag: '@mobile' },
  async ({ page }, info) => {
    await page.goto('/dashboards');
    await page.waitForLoadState('networkidle');

    // Десктоп и телефон идут в одну базу: имена свои на каждый проход, счёт от уже имеющихся.
    const before = await page.getByRole('tab').count();
    // Первый создаётся с пустого экрана, остальные через «+»: имя своё, шаблон пустой.
    const names = Array.from(
      { length: 7 },
      (_, index) => `Экран ${info.project.name} ${index + 1}`,
    );
    const renamed = `Переименован ${info.project.name}`;
    for (const name of names) {
      const plus = page.getByRole('button', { name: 'Новый дашборд' });
      if (await plus.count()) await plus.click();
      await page.getByRole('radio', { name: /Пустой/ }).click();
      await page.getByLabel('Название').fill(name);
      await page.getByRole('button', { name: 'Создать дашборд' }).click();
      await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }

    // Семь вкладок прокручиваются внутри ленты: страница не шире экрана, иначе на
    // телефоне окно создания уезжало вправо и кнопку было не нажать.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('tab', { name: names[6], exact: true })).toBeInViewport();

    // Виджет в своём дашборде и новое имя переживают перезагрузку.
    await page.getByRole('button', { name: 'Добавить виджет' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Действия с дашбордом' }).click();
    await page.getByRole('menuitem', { name: 'Название и описание' }).click();
    await page.getByRole('dialog').getByLabel('Название').fill(renamed);
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('tab', { name: renamed, exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('tab')).toHaveCount(before + 7);
    await expect(page.getByRole('tab', { name: renamed, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Добавить виджет' })).toHaveCount(0);
    await page.getByRole('tab', { name: names[0], exact: true }).click();
    await expect(page.getByRole('button', { name: 'Добавить виджет' })).toBeVisible();

    // Удаление спрашивает и убирает ровно один экран.
    await page.getByRole('button', { name: 'Действия с дашбордом' }).click();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('tab')).toHaveCount(before + 6);
    await expect(page.getByRole('tab', { name: names[0], exact: true })).toHaveCount(0);
  },
);

test('сроки проекта видны в шапке и правятся в настройках', async ({ page }) => {
  await page.goto('/projects/10');
  await settle(page);
  await expect(
    page.getByRole('button', { name: '1 февр. 2026 г. → 30 апр. 2026 г.' }),
  ).toBeVisible();

  await page.goto('/projects/11');
  await settle(page);
  await page.getByRole('button', { name: 'Настройки проекта' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Дата начала').fill('01092026');
  await dialog.getByLabel('Дата окончания').fill('31082026');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Дата окончания не может быть раньше даты начала.',
  );

  await dialog.getByLabel('Дата окончания').fill('31122026');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: '1 сент. 2026 г. → 31 дек. 2026 г.' }),
  ).toBeVisible();
});

test('переносы сроков: перенос из чата задачи виден в отчёте', async ({ page, testDb }) => {
  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  try {
    const db = client.db(testDb);
    const token = await db.collection('user_tokens').findOne({});
    const link = '[URL=/workgroups/group/10/tasks/task/view/101/?chatAction=changeDeadline]';
    await db.collection('notifications').insertMany(
      ['901', '902'].map((messageId) => ({
        member_id: token?.member_id,
        type: 'comment_added',
        taskId: '101',
        messageId,
        projectId: '10',
        message: `[USER=2]Мария[/USER] изменила крайний срок задачи на ${link}[TIMESTAMP=4102444800 FORMAT=LONG_DATE_FORMAT][/URL]`,
        created_at: new Date(),
      })),
    );
  } finally {
    await client.close();
  }
  await page.goto('/reports/shifts');
  const row = page.getByRole('row', { name: /Перевести справочники на GraphQL/ }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('2');
  await page.getByRole('button', { name: /Перенесены повторно/ }).click();
  await expect(row).toBeVisible();
  // База потока общая: оставленные записи попадали в снимок страницы уведомлений.
  const cleanup = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  try {
    await cleanup
      .db(testDb)
      .collection('notifications')
      .deleteMany({ messageId: { $in: ['901', '902'] } });
  } finally {
    await cleanup.close();
  }
});

test('закрытые без списаний: отчёт открывается из меню', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'меню на телефоне в выдвижной панели');
  await page.goto('/');
  const nav = page.locator('aside nav');
  await nav.getByRole('button', { name: 'Контроль' }).click();
  await nav.getByRole('link', { name: 'Закрыты без списаний' }).click();
  await expect(page).toHaveURL(/\/reports\/untracked/);
  await expect(page.getByRole('heading', { name: 'Закрыты без списаний' })).toBeVisible();
});

test('недельная сводка: админ выбирает групповой чат и время', async ({ page, testDb }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Недельная сводка' })).toBeVisible();
  await expect(page.getByText('Как выглядит сводка сейчас')).toBeVisible();
  await page.getByRole('button', { name: 'В групповой чат' }).click();
  await page.getByLabel('Номер чата').fill('1234');
  await page.getByRole('button', { name: 'Сохранить' }).last().click();
  await expect(page.getByText('Настройки сводки сохранены')).toBeVisible();

  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  try {
    const saved = await client
      .db(testDb)
      .collection<{ _id: string }>('app_settings')
      .findOne({ _id: 'digest' });
    expect(saved).toMatchObject({ dialogId: 'chat1234', weekday: 1, hour: 9 });
  } finally {
    await client.close();
  }
});

test('настройки часов: служебная учётка и своя норма сохраняются', async ({ page, testDb }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Учёт часов' })).toBeVisible();
  // Первый пункт списка это подсказка «Добавить…» с пустым значением.
  await page.getByRole('combobox', { name: 'Добавить учётку' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByLabel('Порог «ниже нормы», %').fill('70');
  await page.getByRole('combobox', { name: 'Добавить человека' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page.getByText('Настройки часов сохранены')).toBeVisible();

  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  try {
    const saved = await client
      .db(testDb)
      .collection<{ _id: string; excludedUserIds?: string[]; perUser?: Record<string, number> }>(
        'app_settings',
      )
      .findOne({ _id: 'hours' });
    expect(saved).toMatchObject({ dailyHours: 8, threshold: 0.7 });
    expect(saved?.excludedUserIds).toHaveLength(1);
    expect(Object.values(saved?.perUser ?? {})).toEqual([4]);
  } finally {
    // База общая для потока: служебная учётка из этого теста убрала бы часы из аналитики
    // в следующих тестах.
    await client.db(testDb).collection<{ _id: string }>('app_settings').deleteOne({ _id: 'hours' });
    await client.close();
  }
});

test('токен MCP: выпуск в настройках, поиск, реестр проектов и отзыв', async ({ page, testDb }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Токены MCP' })).toBeVisible();
  // Имя уникальное: seed не чистит токены, и строка прошлого прогона дала бы два совпадения.
  const name = `UI-тест ${Date.now()}`;
  await page.getByLabel('Название токена').fill(name);
  await page.getByRole('button', { name: 'Выпустить токен' }).click();
  const token = (await page.getByText(/^bf_[\w-]{43}$/).textContent()) || '';
  expect(token).toMatch(/^bf_/);

  // Токен работает без куки: так его использует клиент MCP.
  const rpc = (body: object) =>
    page.request.post('/api/mcp', {
      headers: { authorization: `Bearer ${token}`, cookie: '' },
      data: { jsonrpc: '2.0', id: 1, ...body },
    });
  const found = await rpc({
    method: 'tools/call',
    params: { name: 'search_tasks', arguments: { query: 'GraphQL' } },
  });
  expect(JSON.parse((await found.json()).result.content[0].text).tasks[0].title).toContain(
    'GraphQL',
  );

  // Реестр: частичная правка через MCP видна в карточке проекта вместе с историей.
  const tool = async (name: string, args: object) =>
    JSON.parse(
      (await (await rpc({ method: 'tools/call', params: { name, arguments: args } })).json()).result
        .content[0].text,
    );
  const client = new MongoClient(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27018');
  try {
    await tool('update_project_status', {
      project_id: '12',
      status: 'В работе',
      step: 'Разобрать',
    });
    await tool('update_project_status', { project_id: '12', risk: 'Нет владельца' });
    const project = await tool('get_project', { project_id: '12' });
    expect(project.registry).toMatchObject({
      status: 'В работе',
      step: 'Разобрать',
      risk: 'Нет владельца',
    });
    expect(project.history).toHaveLength(2);
    // Удаление снимает запись, но история остаётся и получает событие удаления.
    expect(await tool('delete_project_status', { project_id: '12' })).toEqual({ deleted: '12' });
    const after = await tool('get_project', { project_id: '12' });
    expect(after.registry).toBeNull();
    expect(after.history[0].changes[0]).toMatchObject({ field: 'Запись', to: 'удалена' });
    expect(after.history).toHaveLength(3);
  } finally {
    // Сводка статусов снимается в других тестах: запись проекта 12 их бы сдвинула.
    await client.db(testDb).collection('project_status').deleteOne({ projectId: '12' });
    await client.db(testDb).collection('project_status_history').deleteMany({ projectId: '12' });
    await client.close();
  }

  // Агрегаты: те же цифры, что на экранах отчётов, часов и нагрузки, с подписями вместо кодов.
  const period = { from: '2026-01-01', to: '2026-03-31' };
  const planFact = await tool('report', { kind: 'plan-fact', ...period });
  expect(planFact.tiles[0]).toMatchObject({ name: 'План', value: 22.5 });
  expect(planFact.tables[0].rows[0]).toMatchObject({ state: 'Открыта', deltaShare: '-12.5%' });
  const byProject = planFact.tables[0].byProject as { name: string; count: number }[];
  expect(byProject.reduce((sum, item) => sum + item.count, 0)).toBe(planFact.tables[0].total);
  const byClass = await tool('hours', { ...period, group_by: 'class' });
  expect(byClass.totalHours).toBe(27);
  expect(byClass.groups[0]).toMatchObject({ name: 'коммерция', hours: 16 });
  const plan = await tool('my_plan', { limit: 1 });
  expect(plan[0].total).toBeGreaterThan(1);
  expect(plan[0].tasks).toHaveLength(1);
  const load = await tool('workload', { week: '2026-02-25' });
  expect(load.week).toEqual({ from: '2026-02-23', to: '2026-03-01' });
  expect(load.people[0]).toMatchObject({ name: 'Анна Кузнецова', week: { tasks: 2, hours: 11 } });

  // Строка токена: имя лежит в своём блоке, кнопка отзыва рядом с ним.
  const row = page.getByText(name, { exact: true }).locator('xpath=../..');
  await row.getByRole('button', { name: 'Отозвать' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отозвать' }).click();
  await expect(page.getByText('Доступ отозван')).toBeVisible();
  expect((await rpc({ method: 'ping' })).status()).toBe(401);
});

test('мессенджер: «Прочитать все» гасит счётчики одним запросом', async ({ page }) => {
  const calls: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/messenger/dialog')) calls.push(request.postDataJSON());
  });
  await page.goto('/messenger');
  const list = page.getByRole('region', { name: 'Диалоги' });
  const readAll = list.getByRole('button', { name: 'Прочитать все' });
  await expect(readAll).toBeEnabled();
  await readAll.click();
  await expect(readAll).toBeDisabled();
  expect(calls).toEqual([{ action: 'readAll' }]);
});

test('мессенджер: в открытый раньше чат возврат мгновенный, без ожидания портала', async ({
  page,
}) => {
  const chat = await openDmitry(page);
  const list = page.getByRole('region', { name: 'Диалоги' });
  await list.getByRole('button', { name: /Мария Орлова/ }).click();
  // Ответ на повторную загрузку чата Дмитрия держим 5 секунд: переписка должна показаться
  // из кэша раньше, чем он придёт.
  await page.route('**/api/messenger/messages?dialogId=2*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.continue().catch(() => {});
  });
  await list.getByRole('button', { name: /Дмитрий Соколов/ }).click();
  await expect(chat).toContainText('Посмотришь ревью?', { timeout: 1500 });
});

test('карточка: наблюдение, звук и привязка к CRM', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');
  const actions = dialog.getByRole('button', { name: 'Действия с задачей' });

  await actions.click();
  await page.getByRole('menuitem', { name: 'Наблюдать', exact: true }).click();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Без уведомлений по задаче' }).click();
  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'Перестать наблюдать' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Перестать наблюдать' }).click();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Включить уведомления по задаче' }).click();

  // Поиск идёт по сделкам, контактам, компаниям и лидам сразу.
  await dialog.getByRole('textbox', { name: 'Привязать элемент CRM' }).fill('Ромаш');
  await expect(dialog.getByRole('button', { name: 'Контакт: Олег Ромашкин' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Компания: ООО Ромашка' }).click();
  await expect(dialog.getByText('ООО Ромашка')).toBeVisible();
  await dialog.getByRole('button', { name: 'Отвязать ООО Ромашка' }).click();
  await expect(dialog.getByText('ООО Ромашка')).toHaveCount(0);
});

test('карточка: избранное, связанные задачи и история изменений', async ({ page }) => {
  await page.goto('/all-tasks');
  await settle(page);
  await page.getByRole('button', { name: 'Перевести справочники на GraphQL' }).first().click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Добавить в избранное' }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Убрать из избранного' }).click();
  await expect(dialog.getByRole('button', { name: 'Добавить в избранное' })).toBeVisible();

  const update = page.waitForRequest(
    (request) =>
      request.url().includes('/api/bitrix/tasks.task.update') &&
      decodeURIComponent(request.postData() || '').includes('"DEPENDS_ON":[1002]'),
  );
  await dialog.getByLabel('Добавить связанную задачу').fill('Apollo');
  await dialog.getByRole('button', { name: '#1002, Настроить Apollo Server' }).click();
  await update;
  await expect(dialog.getByRole('link', { name: '#1002 Настроить Apollo Server' })).toBeVisible();
  await expect(dialog.getByText('Ждёт задач: 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Убрать связь с #1002' }).click();
  await expect(dialog.getByRole('link', { name: '#1002 Настроить Apollo Server' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'История изменений' }).click();
  await expect(dialog.getByText('Задача создана')).toBeVisible();
  await expect(dialog.locator('li', { hasText: 'Статус' })).toContainText('Новая → В работе');
  await expect(dialog.locator('li', { hasText: 'Дедлайн' })).toContainText('Дмитрий Соколов');
});

test('счётчик просроченных задач портала виден в меню', async ({ page }) => {
  await page.route('**/api/bitrix/tasks.task.counters.get**', (route) =>
    route.fulfill({
      json: {
        result: {
          expired: { counter: 3 },
          new_comments: { counter: 0 },
          mentioned: { counter: 0 },
        },
      },
    }),
  );
  await page.goto('/all-tasks');
  // Пункт живёт в группе «Задачи»: свёрнутая группа показывает сумму, раскрытая сам счётчик.
  await expect(page.getByRole('button', { name: /Задачи\s*3/ })).toBeVisible();
  await page.getByRole('button', { name: /Задачи\s*3/ }).click();
  await expect(page.getByRole('link', { name: /Мои задачи\s*3 просрочено/ })).toBeVisible();
});

test('проект: роли участников и удаление проекта', async ({ page }) => {
  await page.goto('/projects/12');
  await settle(page);
  await page
    .getByRole('button', { name: /участник/ })
    .first()
    .click();
  const list = page.getByRole('list', { name: 'Участники проекта' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Дмитрий Соколов' })).toContainText(
    'модератор',
  );
  // У владельца нет меню: его не удалить и не понизить.
  await expect(
    page.getByRole('button', { name: 'Действия с участником Анна Кузнецова' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Действия с участником Мария Орлова' }).click();
  await page.getByRole('menuitem', { name: 'Сделать модератором' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Мария Орлова' })).toContainText(
    'модератор',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Настройки проекта' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить проект' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Диском со всеми файлами');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('проект: сроки, календарь и лента', async ({ page }) => {
  await page.goto('/projects/12?view=deadlines');
  await settle(page);
  const overdue = page.getByRole('region', { name: 'Просрочено' });
  const today = page.getByRole('region', { name: 'Сегодня' });
  const card = overdue.getByRole('button', { name: /Обновить зависимости/ });
  await expect(card).toBeVisible();
  const update = page.waitForRequest(
    (request) => request.url().includes('tasks.task.update') && request.method() === 'POST',
  );
  await card.dragTo(today);
  expect((await update).postData()).toContain('DEADLINE');
  await expect(today.getByRole('button', { name: /Обновить зависимости/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Календарь' }).click();
  await page.getByRole('button', { name: 'Встреча', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Встреча в календаре проекта' });
  await dialog.getByLabel('Название').fill('Ретро спринта');
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Ретро спринта').filter({ visible: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Лента' }).click();
  const feed = page.getByRole('list', { name: 'Лента проекта' });
  await expect(feed).toContainText('Демо в пятницу');
  await page.getByLabel('Текст поста').fill('Релиз переносим на вторник');
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await expect(feed.getByRole('listitem').first()).toContainText('Релиз переносим на вторник');
});

test('проект: Гант связывает задачи и снимает связь', async ({ page }) => {
  await page.goto('/projects/10?view=gantt');
  await settle(page);
  await page
    .getByRole('button', { name: 'Связать: после «Перевести справочники на GraphQL»' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'начнётся после' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Начать после выбранной: Описать схему подписок' })
    .click();
  const link = page.getByRole('button', {
    name: 'Связь: Перевести справочники на GraphQL → Описать схему подписок',
  });
  await expect(link).toHaveCount(1);
  await link.dispatchEvent('click');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(link).toHaveCount(0);
});

test('мой план: личные колонки, задача переносится между ними', async ({ page }) => {
  await page.goto('/my-plan');
  await settle(page);
  const unplanned = page.getByRole('region', { name: 'Не спланированы' });
  const week = page.getByRole('region', { name: 'Сделаю на неделе' });
  const card = unplanned.getByRole('button').first();
  const title = (await card.textContent())?.trim().slice(0, 20) || '';
  const move = page.waitForRequest(
    (request) => request.url().includes('/api/my-plan') && request.method() === 'POST',
  );
  await card.dragTo(week);
  expect((await move).postDataJSON()).toMatchObject({ stageId: '33' });
  await expect(week).toContainText(title);
});

test('шаблоны: задача по шаблону и регулярный шаблон', async ({ page }) => {
  await page.goto('/templates');
  await settle(page);
  const list = page.getByRole('list', { name: 'Шаблоны задач' });
  await expect(list).toContainText('Каждую неделю: пт, в 10:00');

  await page.getByRole('button', { name: 'Новый шаблон' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый шаблон' });
  await dialog.getByLabel('Название').fill('Планёрка по понедельникам');
  await dialog.getByLabel('Повторять').click();
  await page.getByRole('option', { name: 'Каждую неделю' }).click();
  await dialog.getByRole('button', { name: 'вт' }).click();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Планёрка по понедельникам' }),
  ).toContainText('Каждую неделю: пн, вт');

  await list
    .getByRole('listitem')
    .filter({ hasText: 'Еженедельный отчёт заказчику' })
    .getByRole('button', { name: 'Создать задачу' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Еженедельный отчёт заказчику' })).toBeVisible();
});

test('спринты: вкладка только у скрама, план спринта размером и переносом', async ({ page }) => {
  // Обычный проект: вкладки нет.
  await page.goto('/projects/10');
  await expect(page.getByRole('tab', { name: 'Канбан' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Спринты' })).toHaveCount(0);

  await page.goto('/projects/12');
  await page.getByRole('tab', { name: 'Спринты' }).click();
  const backlog = page.getByRole('region', { name: 'Бэклог' });
  await expect(backlog.getByText('Обновить зависимости')).toBeVisible();

  await page.getByRole('button', { name: 'Новый спринт' }).click();
  await expect(page.getByText('Спринт создан')).toBeVisible();

  await choose(
    page,
    page.getByRole('combobox', { name: 'Размер задачи Обновить зависимости' }),
    'L',
  );
  await expect(backlog.getByText('задач 1, очков 5')).toBeVisible();

  // Новый спринт последний в списке переноса.
  await page.getByRole('combobox', { name: 'Куда перенести Обновить зависимости' }).click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Спринт/ })
    .last()
    .click();
  await expect(backlog.getByText('Бэклог пуст.')).toBeVisible();
  await expect(page.getByText('Готово задач 0 из 1, очков 0 из 5').last()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ёмкость по людям' }).first()).toContainText(
    'Анна Кузнецова: очков 5, задач 1',
  );

  // Обратно в бэклог: тест оставляет данные мока как были.
  await choose(
    page,
    page.getByRole('combobox', { name: 'Куда перенести Обновить зависимости' }),
    'backlog',
  );
  await expect(backlog.getByText('Обновить зависимости')).toBeVisible();
});

test('скрам включается и выключается в настройках проекта', async ({ page }) => {
  await page.goto('/projects/17');
  await expect(page.getByRole('tab', { name: 'Канбан' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Спринты' })).toHaveCount(0);

  const toggle = async (label: 'Включить' | 'Выключить') => {
    await page.getByRole('button', { name: 'Настройки проекта' }).first().click();
    await page.getByRole('switch', { name: 'Скрам: спринты и размер задач' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: label }).click();
    await expect(
      page.getByRole('switch', { name: 'Скрам: спринты и размер задач' }),
    ).toHaveAttribute('aria-checked', String(label === 'Включить'));
    await page.keyboard.press('Escape');
  };

  await toggle('Включить');
  await page.getByRole('tab', { name: 'Спринты' }).click();
  await expect(page.getByRole('region', { name: 'Бэклог' })).toBeVisible();

  // Выключение уводит со вкладки, которой больше нет: тест оставляет мок как был.
  await toggle('Выключить');
  await expect(page.getByRole('tab', { name: 'Спринты' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Канбан' })).toHaveAttribute('aria-selected', 'true');
});
