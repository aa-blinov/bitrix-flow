<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev`; verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — agent context for `bitrix-flow`

BitrixFlow: рабочее пространство для задач и проектов Bitrix24 в духе Asana. Вход через
Bitrix24 OAuth, зеркало задач в MongoDB, события портала и Next.js-доска.

## Run / build / test

```bash
cp .env.example .env.local      # заполнить BITRIX24_*, MONGO_*, AUTH_*
npm ci                          # зависимости; .npmrc уже несёт legacy-peer-deps
npm run dev                     # локальная разработка на http://localhost:3000
npm test                        # юнит-тесты Vitest
npm run build                   # продакшен-сборка и проверка TypeScript
```

Полный набор проверок, как в CI:

```bash
npm run format:check
npm run lint
npm test
npm run check:contrast
npm run build
npm run check:utilities
```

UI-тесты идут против отдельной базы и мока Битрикса:

```bash
npm run test:ui:db              # MongoDB 7 на 127.0.0.1:27018
npm run test:ui                 # seed + Playwright, системный Chrome
./scripts/ui-tests-docker.sh    # то же в образе Playwright, как в CI
```

Продакшен:

```bash
docker compose --env-file .env.local up -d --build
```

Версии: Node.js 20 (Dockerfile и CI), MongoDB 7 (compose), Playwright 1.63.0
(`mcr.microsoft.com/playwright:v1.63.0-noble`).

## Where things live

| Path                    | Что там                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `src/app/(dashboard)/`  | Страницы: главная, мои задачи, все задачи, проекты, сводка, нагрузка, уведомления, поиск. |
| `src/app/api/`          | OAuth, сессия, события Bitrix24, задачи, уведомления, нагрузка, health.                   |
| `src/components/`       | Клиентские компоненты доски, карточки, фильтров и сайдбара.                               |
| `src/components/monos/` | Примитивы `@monos/ui`, перенесённые из Svelte в React.                                    |
| `src/lib/`              | Серверная логика: Mongo, OAuth, сессии, зеркало, запросы к Bitrix24.                      |
| `src/store/`            | Zustand-состояние доски и фильтров.                                                       |
| `src/hooks/`            | `useSSE`, `useIsMobile` и другие клиентские хуки.                                         |
| `tests/`                | Playwright-тесты, скриншот-эталоны, авторизация тестового пользователя.                   |
| `scripts/`              | Бэкапы, health-watch, seed тестовой базы, скриншоты, проверки палитры.                    |
| `docs/`                 | [architecture.md](docs/architecture.md), порт `@monos/ui`, скриншоты.                     |
| `.github/workflows/`    | CI и house-style.                                                                         |
| `caddy/Caddyfile`       | TLS, security-заголовки, SSE без буферизации.                                             |
| `docker-compose.yml`    | Приложение, MongoDB 7, Caddy, фиксированная подсеть.                                      |

## Traps

- **`.npmrc` обязателен.** В нём `legacy-peer-deps=true`: `@monos/ui` объявляет Tailwind 3
  peer-зависимостью, а приложение на Tailwind 4. Без флага `npm ci` падает на ERESOLVE.
- **Списки читают MongoDB, а не Bitrix.** `/api/tasks/all` собирает данные из `task_mirror`
  и `tasks`. Bitrix REST остаётся только на холодном старте, когда зеркала ещё нет.
  Добавленный запрос в портал на каждый рендер превращает открытие списка в десятки
  вызовов и 500.
- **Событие проверяет `application_token`.** Не ослабляй сравнение и не принимай событие
  по одному `member_id`. Токен установки подхватывается только в течение часа после
  установки, для старых установок.
- **URL обработчика берётся из `BITRIX24_APP_URL`.** Не из `Host` и не из тела запроса:
  иначе приложение станет пересыльщиком событий на чужой адрес.
- **Обработчик отвечает до синхронизации.** Тяжёлая работа идёт в `after()`. Если
  синхронизировать зеркало до ответа, Bitrix24 упрётся в таймаут.
- **Удаление задачи чистит обе коллекции.** `removeTask` удаляет запись из `task_mirror`
  и `tasks`; запись, снесённая только в одной, возвращается призраком из второй.
- **Теги требуют второго запроса.** `tasks.task.get` без `select` не отдаёт теги, а с
  `select` отдаёт только их. Оба вызова идут параллельно в `syncTaskMirror`.
- **Параллельный перебор адресов только для чтения.** Мутации идут по одному адресу:
  повтор POST создаёт вторую задачу или комментарий. IPv4 и таймауты живут в
  `src/lib/bitrix-request.ts`.
- **UI-тесты требуют `MOCK_B24=1` и базу `bitrix_kanban_test`.** Эталоны сняты в образе
  Playwright 1.63.0; локальный Chrome рисует шрифты иначе и ломает попиксельное сравнение.
- **Compose использует фиксированные адреса.** `172.32.10.0/24` появился потому, что
  Docker DNS периодически переставал резолвить имена, и Caddy отдавал 502 при живом
  приложении. У MongoDB нет порта на хост.
- **Мессенджер не пускает произвольные `im.*`.** Роуты `/api/messenger/*` проверяют
  `DIALOG_ID` и вызывают фиксированные методы; не добавляй `im.*` в белый список
  прокси задач. Сообщения не зеркалятся в MongoDB, события о них портал не шлёт,
  поэтому обновление идёт опросом.
- **Файлы чата не открываются ссылками портала.** `urlShow` и `urlDownload` из
  `im.dialog.messages.get` без cookie портала ведут на страницу входа; отдаёт файл
  `/api/messenger/file` через `im.v2.File.download`. Отправка файла это один вызов
  `im.v2.File.upload` (JSON, base64), `im.message.add` файл не несёт. Признак
  голосового сообщения REST выставить не даёт: свои записи узнаются по имени
  `VOICE_NAME`. `readed_list` из `im.dialog.get` нет в документации, но он есть в ответе.
- **REST не отдаёт «ответ на сообщение».** `REPLY_ID` принимается в `im.message.add`, но в
  `im.dialog.messages.get` связь не возвращается, поэтому ответ и пересылка уходят цитатой
  `[QUOTE]` в тексте. Пустой `MESSAGE` в `im.message.update` удаляет сообщение: роут правки
  отклоняет пустой текст сам.
- **События чата читает серверный поллер, а не браузер.** `im.v2.Event.get` подтверждает
  прочитанное, и один пользователь отдаёт очередь только одному приложению: не запускай второй
  читатель с тем же токеном, он украдёт события. Поллер спит без вкладок и в mock-режиме.
- **Микрофон открывает заголовок `Permissions-Policy`.** С `microphone=()` браузер молча
  отказывает в `getUserMedia`, и запрос разрешения не появляется. Боевой Caddy читает
  `/home/ubuntu/infra/caddy/Caddyfile`, а не копию в `caddy/`; файл примонтирован одним
  файлом, поэтому после `sed -i` контейнер видит старый inode, и правку надо подавать через
  `docker cp` и `caddy reload --config <копия>`. В iframe портала запись заработает только
  при `allow="microphone"` на самом iframe.
- **Публичный маршрут добавляется в `src/proxy.ts`.** Список `PUBLIC_PATHS` это
  единственное место, где маршрут обходит проверку сессии.
- **`next dev` перезаписывает блок в начале файла.** Не удаляй его из диффа, иначе он
  вернётся как незакоммиченное изменение.

## Style / safety rails

- **Комментарии объясняют почему, а не что.** Код говорит, что он делает. Комментарий
  нужен для причины: почему таймаут короткий, почему адрес считается мёртвым, почему
  выбрана одна коллекция вместо другой.
- **Без эмодзи** в любом файле. House-style падает на них.
- **Новая зависимость только с причиной**, записанной рядом. Стек уже большой, и каждая
  зависимость это поверхность обновления.
- **Цвет только ролью.** `bg-surface`, `text-ink-soft`, `border-line`, `rounded-ui`.
  Сырые `#fff` и `text-slate-500` запрещены, `dark:`-варианты тоже: тему задаёт палитра.
- **Обе темы обязательны.** Любая новая поверхность проверяется в светлом и тёмном режиме.
- **Bitrix24 главный.** Новых сущностей, которых нет в портале, не заводим; зеркало не
  становится источником правды.
- **Не ослабляй вход.** `timingSafeEqual`, лимит попыток, серверная запись сессии и
  HttpOnly-кука это не украшение, а защита от подбора и кражи куки.
- **Документы на русском.** README, PRODUCT, DESIGN, AGENTS и `docs/` говорят на языке
  команды, кроме названий канонических секций.

## Before push

CI гоняет `npm run format:check`, `npm run lint`, `npm test`, `npm run check:contrast`,
`npm run build` и `npm run check:utilities`. UI-тесты идут отдельной джобой. Прогоняй
локально то же самое:

```bash
npm run format && npm run lint && npm test
```

`npm run format` (prettier --write) лучше, чем `format:check`: сразу чинит вместо того,
чтобы ругаться. Перед коммитом проверь, что `.env.local`, `node_modules` и `.next` не
попали в индекс.
