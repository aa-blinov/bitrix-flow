// Dev-only мок Bitrix24. Включается переменной окружения MOCK_B24=1 —
// используется чтобы снять скриншоты UI без живого OAuth-подключения.
// В проде ничего не делает: getMock() возвращает null, код идёт в обычный путь.

const ON = process.env.MOCK_B24 === '1';

const USERS = [
  { ID: '1', NAME: 'Анна', LAST_NAME: 'Кузнецова', EMAIL: 'anna@example.com' },
  { ID: '2', NAME: 'Дмитрий', LAST_NAME: 'Соколов', EMAIL: 'd.sokolov@example.com' },
  { ID: '3', NAME: 'Мария', LAST_NAME: 'Орлова', EMAIL: 'm.orlova@example.com' },
  { ID: '4', NAME: 'Илья', LAST_NAME: 'Беляев', EMAIL: 'i.belyaev@example.com' },
  { ID: '5', NAME: 'Екатерина', LAST_NAME: 'Морозова', EMAIL: 'e.morozova@example.com' },
];

const PROJECTS: Record<string, string>[] = [
  {
    ID: '10',
    NAME: 'Разработка API v2',
    DESCRIPTION: 'Перевод публичного API на GraphQL',
    NUMBER_OF_MEMBERS: '5',
    PROJECT_DATE_START: '2026-02-01T00:00:00+03:00',
    PROJECT_DATE_FINISH: '2026-04-29T22:00:00+03:00',
  },
  {
    ID: '11',
    NAME: 'Маркетинг Q4',
    DESCRIPTION: 'Запуск осенней кампании',
    NUMBER_OF_MEMBERS: '4',
  },
  {
    ID: '12',
    NAME: 'Внутренний бэклог',
    DESCRIPTION: 'Технический долг и улучшения',
    NUMBER_OF_MEMBERS: '3',
  },
  {
    ID: '13',
    NAME: 'Инфраструктура',
    DESCRIPTION: 'CI/CD и observability',
    NUMBER_OF_MEMBERS: '8',
  },
  {
    ID: '14',
    NAME: 'Мобильное приложение',
    DESCRIPTION: 'iOS и Android клиенты',
    NUMBER_OF_MEMBERS: '6',
  },
  {
    ID: '15',
    NAME: 'Аналитика',
    DESCRIPTION: 'Продуктовая аналитика и отчёты',
    NUMBER_OF_MEMBERS: '3',
  },
  {
    ID: '16',
    NAME: 'Документация',
    DESCRIPTION: 'Портал для разработчиков',
    NUMBER_OF_MEMBERS: '2',
  },
  { ID: '17', NAME: 'Дизайн-система', DESCRIPTION: 'UI-kit и компоненты', NUMBER_OF_MEMBERS: '4' },
  { ID: '18', NAME: 'Безопасность', DESCRIPTION: 'Аудит и pentest', NUMBER_OF_MEMBERS: '2' },
  {
    ID: '19',
    NAME: 'Поддержка',
    DESCRIPTION: 'Текущие тикеты и инциденты',
    NUMBER_OF_MEMBERS: '5',
  },
];

const STAGES_10: Record<string, any> = {
  '100': {
    ID: '100',
    TITLE: 'Бэклог',
    SORT: '100',
    COLOR: '47D1E2',
    SYSTEM_TYPE: 'NEW',
    ENTITY_ID: '10',
  },
  '101': {
    ID: '101',
    TITLE: 'В работе',
    SORT: '200',
    COLOR: '75D900',
    SYSTEM_TYPE: 'PROCESS',
    ENTITY_ID: '10',
  },
  '102': {
    ID: '102',
    TITLE: 'На ревью',
    SORT: '300',
    COLOR: 'FFAB00',
    SYSTEM_TYPE: 'WORK',
    ENTITY_ID: '10',
  },
  '103': {
    ID: '103',
    TITLE: 'Готово',
    SORT: '400',
    COLOR: 'D0D0D0',
    SYSTEM_TYPE: 'FINISH',
    ENTITY_ID: '10',
  },
};

const STAGES_11: Record<string, any> = {
  '110': {
    ID: '110',
    TITLE: 'Идеи',
    SORT: '100',
    COLOR: '47D1E2',
    SYSTEM_TYPE: 'NEW',
    ENTITY_ID: '11',
  },
  '111': {
    ID: '111',
    TITLE: 'В работе',
    SORT: '200',
    COLOR: '75D900',
    SYSTEM_TYPE: 'PROCESS',
    ENTITY_ID: '11',
  },
  '112': {
    ID: '112',
    TITLE: 'Согласование',
    SORT: '300',
    COLOR: 'FFAB00',
    SYSTEM_TYPE: 'WORK',
    ENTITY_ID: '11',
  },
  '113': {
    ID: '113',
    TITLE: 'Запущено',
    SORT: '400',
    COLOR: '1EAE43',
    SYSTEM_TYPE: 'FINISH',
    ENTITY_ID: '11',
  },
};

const STAGES_12: Record<string, any> = {
  '120': {
    ID: '120',
    TITLE: 'Новые',
    SORT: '100',
    COLOR: '47D1E2',
    SYSTEM_TYPE: 'NEW',
    ENTITY_ID: '12',
  },
  '121': {
    ID: '121',
    TITLE: 'В работе',
    SORT: '200',
    COLOR: '75D900',
    SYSTEM_TYPE: 'PROCESS',
    ENTITY_ID: '12',
  },
  '122': {
    ID: '122',
    TITLE: 'Готово',
    SORT: '300',
    COLOR: '1EAE43',
    SYSTEM_TYPE: 'FINISH',
    ENTITY_ID: '12',
  },
};

const TASKS_10 = [
  {
    id: '1001',
    title: 'Спроектировать схему GraphQL',
    description: 'Описать основные типы и запросы для публичного API.',
    status: '2',
    subStatus: '-1',
    priority: '2',
    createdDate: '2025-08-01T10:00:00+03:00',
    changedDate: '2025-08-20T15:30:00+03:00',
    deadline: '2025-09-15T18:00:00+03:00',
    timeEstimate: '14400',
    timeSpentInLogs: '7200',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '2',
    responsibleName: 'Дмитрий Соколов',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '3',
    stageId: '101',
  },
  {
    id: '1002',
    title: 'Настроить Apollo Server',
    description: 'Поднять Apollo с плагинами для трейсинга и персистентных запросов.',
    status: '2',
    subStatus: '-1',
    priority: '2',
    createdDate: '2025-08-05T11:00:00+03:00',
    changedDate: '2025-08-22T14:00:00+03:00',
    deadline: '2025-09-20T18:00:00+03:00',
    timeEstimate: '18000',
    timeSpentInLogs: '10800',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '4',
    responsibleName: 'Илья Беляев',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '1',
    stageId: '101',
  },
  {
    id: '1003',
    title: 'Миграция REST-эндпоинтов',
    description: '',
    status: '2',
    subStatus: '-2',
    priority: '1',
    createdDate: '2025-08-10T09:00:00+03:00',
    changedDate: '2025-08-23T12:00:00+03:00',
    deadline: '2025-10-01T18:00:00+03:00',
    timeEstimate: '28800',
    timeSpentInLogs: '0',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '2',
    responsibleName: 'Дмитрий Соколов',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '0',
    stageId: '100',
  },
  {
    id: '1004',
    title: 'Документация для разработчиков',
    status: '2',
    subStatus: '-3',
    priority: '1',
    createdDate: '2025-08-12T13:00:00+03:00',
    changedDate: '2025-08-24T16:00:00+03:00',
    deadline: '2025-09-30T18:00:00+03:00',
    timeEstimate: '10800',
    timeSpentInLogs: '3600',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '5',
    responsibleName: 'Екатерина Морозова',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '2',
    stageId: '102',
  },
  {
    id: '1005',
    title: 'Подключить авторизацию через OAuth',
    status: '3',
    subStatus: '-3',
    priority: '2',
    createdDate: '2025-08-15T10:00:00+03:00',
    changedDate: '2025-08-22T11:00:00+03:00',
    deadline: '2025-09-25T18:00:00+03:00',
    timeEstimate: '14400',
    timeSpentInLogs: '14400',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '4',
    responsibleName: 'Илья Беляев',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '5',
    stageId: '102',
  },
  {
    id: '1006',
    title: 'Запустить canary-релиз',
    status: '5',
    subStatus: '5',
    priority: '1',
    createdDate: '2025-07-20T09:00:00+03:00',
    changedDate: '2025-08-18T17:00:00+03:00',
    deadline: '2025-08-15T18:00:00+03:00',
    timeEstimate: '7200',
    timeSpentInLogs: '9000',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '2',
    responsibleName: 'Дмитрий Соколов',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '8',
    stageId: '103',
  },
  {
    id: '1007',
    title: 'Старый: Сделать ресёрч по Hasura',
    status: '5',
    subStatus: '5',
    priority: '0',
    createdDate: '2025-07-01T09:00:00+03:00',
    changedDate: '2025-07-30T17:00:00+03:00',
    deadline: '2025-07-15T18:00:00+03:00',
    timeEstimate: '3600',
    timeSpentInLogs: '7200',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '3',
    responsibleName: 'Мария Орлова',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '2',
    stageId: '103',
  },
  {
    id: '1008',
    title: 'Добавить поддержку подписок',
    status: '2',
    subStatus: '-1',
    priority: '0',
    createdDate: '2025-08-18T11:00:00+03:00',
    changedDate: '2025-08-24T10:00:00+03:00',
    deadline: undefined,
    timeEstimate: '21600',
    timeSpentInLogs: '0',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '4',
    responsibleName: 'Илья Беляев',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '0',
    stageId: '100',
  },
  {
    id: '1009',
    title: 'Просроченный рефакторинг модулей',
    status: '2',
    subStatus: '-1',
    priority: '2',
    createdDate: '2025-07-25T11:00:00+03:00',
    changedDate: '2025-08-10T10:00:00+03:00',
    deadline: '2025-08-10T18:00:00+03:00',
    timeEstimate: '14400',
    timeSpentInLogs: '3600',
    groupId: '10',
    groupName: 'Разработка API v2',
    responsibleId: '3',
    responsibleName: 'Мария Орлова',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '4',
    stageId: '101',
  },
];

const TASKS_11 = [
  {
    id: '1101',
    title: 'Концепция осенней кампании',
    status: '5',
    priority: '1',
    createdDate: '2025-08-01T09:00:00+03:00',
    changedDate: '2025-08-10T18:00:00+03:00',
    deadline: '2025-08-15T18:00:00+03:00',
    timeEstimate: '7200',
    timeSpentInLogs: '7200',
    groupId: '11',
    groupName: 'Маркетинг Q4',
    responsibleId: '3',
    responsibleName: 'Мария Орлова',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '6',
    stageId: '113',
  },
  {
    id: '1102',
    title: 'Согласовать бюджет с финансами',
    status: '2',
    priority: '2',
    createdDate: '2025-08-20T09:00:00+03:00',
    changedDate: '2025-08-25T16:00:00+03:00',
    deadline: '2025-09-05T18:00:00+03:00',
    timeEstimate: '3600',
    timeSpentInLogs: '0',
    groupId: '11',
    groupName: 'Маркетинг Q4',
    responsibleId: '5',
    responsibleName: 'Екатерина Морозова',
    creatorId: '3',
    creatorName: 'Мария Орлова',
    commentsCount: '2',
    stageId: '112',
  },
  {
    id: '1103',
    title: 'Подготовить лендинг',
    status: '2',
    priority: '1',
    createdDate: '2025-08-22T09:00:00+03:00',
    changedDate: '2025-08-26T11:00:00+03:00',
    deadline: '2025-10-15T18:00:00+03:00',
    timeEstimate: '28800',
    timeSpentInLogs: '7200',
    groupId: '11',
    groupName: 'Маркетинг Q4',
    responsibleId: '4',
    responsibleName: 'Илья Беляев',
    creatorId: '3',
    creatorName: 'Мария Орлова',
    commentsCount: '1',
    stageId: '111',
  },
  {
    id: '1104',
    title: 'Идея: интеграция с Telegram Mini App',
    status: '2',
    priority: '0',
    createdDate: '2025-08-25T12:00:00+03:00',
    changedDate: '2025-08-25T12:00:00+03:00',
    deadline: undefined,
    timeEstimate: '0',
    timeSpentInLogs: '0',
    groupId: '11',
    groupName: 'Маркетинг Q4',
    responsibleId: '3',
    responsibleName: 'Мария Орлова',
    creatorId: '3',
    creatorName: 'Мария Орлова',
    commentsCount: '0',
    stageId: '110',
  },
];

const TASKS_12 = [
  {
    id: '1201',
    title: 'Обновить Node.js до 20 LTS',
    status: '2',
    priority: '1',
    createdDate: '2025-08-15T09:00:00+03:00',
    changedDate: '2025-08-22T12:00:00+03:00',
    deadline: '2025-09-10T18:00:00+03:00',
    timeEstimate: '7200',
    timeSpentInLogs: '3600',
    groupId: '12',
    groupName: 'Внутренний бэклог',
    responsibleId: '4',
    responsibleName: 'Илья Беляев',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '0',
    stageId: '121',
  },
  {
    id: '1202',
    title: 'Покрыть тестами модуль авторизации',
    status: '2',
    priority: '2',
    createdDate: '2025-08-10T09:00:00+03:00',
    changedDate: '2025-08-20T12:00:00+03:00',
    deadline: '2025-08-25T18:00:00+03:00',
    timeEstimate: '14400',
    timeSpentInLogs: '7200',
    groupId: '12',
    groupName: 'Внутренний бэклог',
    responsibleId: '3',
    responsibleName: 'Мария Орлова',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '1',
    stageId: '121',
  },
  {
    id: '1203',
    title: 'CI: добавить кеширование зависимостей',
    status: '5',
    priority: '1',
    createdDate: '2025-07-20T09:00:00+03:00',
    changedDate: '2025-08-05T18:00:00+03:00',
    deadline: '2025-08-01T18:00:00+03:00',
    timeEstimate: '3600',
    timeSpentInLogs: '3600',
    groupId: '12',
    groupName: 'Внутренний бэклог',
    responsibleId: '2',
    responsibleName: 'Дмитрий Соколов',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '2',
    stageId: '122',
  },
  {
    id: '1204',
    title: 'Идея: миграция на pnpm',
    status: '2',
    priority: '0',
    createdDate: '2025-08-26T09:00:00+03:00',
    changedDate: '2025-08-26T09:00:00+03:00',
    deadline: undefined,
    timeEstimate: '0',
    timeSpentInLogs: '0',
    groupId: '12',
    groupName: 'Внутренний бэклог',
    responsibleId: '1',
    responsibleName: 'Анна Кузнецова',
    creatorId: '1',
    creatorName: 'Анна Кузнецова',
    commentsCount: '0',
    stageId: '120',
  },
];

const ALL_TASKS: Record<string, any[]> = {
  '10': TASKS_10,
  '11': TASKS_11,
  '12': TASKS_12,
};

const STAGES_MAP: Record<string, Record<string, any>> = {
  '10': STAGES_10,
  '11': STAGES_11,
  '12': STAGES_12,
};

const COMMENTS: Record<string, any[]> = {
  '1001': [
    {
      id: '1',
      author_id: '2',
      author_name: 'Дмитрий Соколов',
      text: 'Набросал первый драфт схемы в Figma — посмотри, пожалуйста.',
      date: '2025-08-22T10:30:00+03:00',
    },
    {
      id: '2',
      author_id: '1',
      author_name: 'Анна Кузнецова',
      text: 'Отлично, продолжай. Только учти что у нас уже есть /v1/users, его не трогаем.',
      date: '2025-08-22T11:15:00+03:00',
    },
  ],
  '1004': [
    {
      id: '3',
      author_id: '5',
      author_name: 'Екатерина Морозова',
      text: 'Добавила разделы про авторизацию и лимиты. Осталось дописать примеры.',
      date: '2025-08-24T15:50:00+03:00',
    },
  ],
};

const TIME_LOG: Record<string, any[]> = {
  '1001': [
    {
      ID: '1',
      USER_ID: '2',
      USER_NAME: 'Дмитрий Соколов',
      DATE_PLAN: '2025-08-20',
      SECONDS: '7200',
      COMMENT_TEXT: 'Драфт схемы',
    },
  ],
  '1002': [
    {
      ID: '2',
      USER_ID: '4',
      USER_NAME: 'Илья Беляев',
      DATE_PLAN: '2025-08-22',
      SECONDS: '10800',
      COMMENT_TEXT: 'Поднял dev-стенд',
    },
  ],
};

const MOCK_DIALOGS = {
  hasMore: true,
  items: [
    {
      id: '2',
      type: 'user',
      title: 'Дмитрий Соколов',
      // Номер чата нужен действиям с файлами (im.disk.file.delete принимает CHAT_ID).
      chat_id: 2,
      counter: 2,
      date_last_activity: '2026-03-02T10:00:00+03:00',
      message: {
        id: 12,
        text: 'Посмотришь ревью?',
        author_id: 2,
        date: '2026-03-02T10:00:00+03:00',
      },
      // Свежая активность: единственный в моке «в сети».
      user: {
        id: 2,
        name: 'Дмитрий Соколов',
        status: 'online',
        // Getter, а не значение: сервер тестов живёт много минут, а «в сети» считается от текущего времени.
        get last_activity_date() {
          return new Date().toISOString();
        },
      },
    },
    {
      id: '3',
      type: 'user',
      title: 'Мария Орлова',
      counter: 0,
      date_last_activity: '2026-02-26T10:00:00+03:00',
      message: { id: 15, text: 'Спасибо', author_id: 3, date: '2026-02-26T10:00:00+03:00' },
      // status online стоит у всех, но активность давняя: в сети её нет.
      user: {
        id: 3,
        name: 'Мария Орлова',
        gender: 'F',
        status: 'online',
        last_activity_date: '2026-02-26T10:00:00+03:00',
      },
    },
    {
      id: '4',
      type: 'user',
      title: 'Иван Петров',
      counter: 0,
      date_last_activity: '2026-02-25T10:00:00+03:00',
      message: { id: 16, text: 'Созвон?', author_id: 4, date: '2026-02-25T10:00:00+03:00' },
      user: {
        id: 4,
        name: 'Иван Петров',
        status: 'dnd',
        get last_activity_date() {
          return new Date().toISOString();
        },
      },
    },
    {
      id: '6',
      type: 'user',
      title: 'Ольга Лис',
      counter: 0,
      date_last_activity: '2026-02-24T10:00:00+03:00',
      message: { id: 17, text: 'Я на обеде', author_id: 6, date: '2026-02-24T10:00:00+03:00' },
      user: {
        id: 6,
        name: 'Ольга Лис',
        gender: 'F',
        status: 'break',
        get last_activity_date() {
          return new Date().toISOString();
        },
      },
    },
    {
      id: 'chat20',
      type: 'chat',
      title: 'Разработка API v2',
      counter: 0,
      date_last_activity: '2026-03-01T10:00:00+03:00',
      message: { id: 21, text: 'Релиз в четверг', author_id: 1, date: '2026-03-01T10:00:00+03:00' },
      chat: { entity_type: 'SONET_GROUP', entity_id: '10' },
    },
    {
      id: 'chat30',
      type: 'chat',
      title: 'Новости компании',
      counter: 0,
      date_last_activity: '2026-02-27T10:00:00+03:00',
      message: { id: 51, text: 'Итоги квартала', author_id: 3, date: '2026-02-27T10:00:00+03:00' },
      chat: { type: 'openChannel' },
    },
    {
      id: 'chat21',
      type: 'chat',
      title: 'Задача: схема GraphQL',
      counter: 0,
      date_last_activity: '2026-02-28T10:00:00+03:00',
      message: { id: 31, text: 'Схему обновил', author_id: 3, date: '2026-02-28T10:00:00+03:00' },
      chat: { entity_type: 'TASKS_TASK', entity_id: '101' },
    },
  ],
};

const MOCK_DIALOGS_NEXT = {
  hasMore: false,
  items: [
    {
      id: 'chat22',
      type: 'chat',
      title: 'Архивный чат',
      counter: 0,
      date_last_activity: '2026-01-01T10:00:00+03:00',
      message: { id: 41, text: 'Давно было', author_id: 1, date: '2026-01-01T10:00:00+03:00' },
      chat: {},
    },
  ],
};

// 60 сообщений в диалоге с Дмитрием: больше одной страницы (LIMIT 50), чтобы
// проверить подгрузку более ранних. Портал отдаёт новые первыми.
const MOCK_HISTORY = Array.from({ length: 60 }, (_, index) => {
  const id = index + 1;
  return {
    id,
    author_id: id % 2 ? 1 : 2,
    text:
      id === 60
        ? 'Посмотришь ревью?'
        : id === 58
          ? '**Важно**: смотри [схему](https://example.com/schema) и `npm test`'
          : id === 52
            ? '[URL]https://mock.bitrix24.ru/company/personal/user/9/tasks/task/view/4521/[/URL]'
            : id === 56
              ? '[B]Релиз[/B] в [USER=2]Дмитрий[/USER]\n> цитата из markdown\n- первый пункт\n- второй пункт'
              : `Сообщение ${id}`,
    date: `2026-03-02T09:${String(id % 60).padStart(2, '0')}:00+03:00`,
    params:
      id === 59
        ? { FILE_ID: [501, 502] }
        : id === 53
          ? { FILE_ID: [503] }
          : id === 51
            ? { FILE_ID: [504] }
            : id === 57
              ? {
                  ATTACH: [
                    {
                      ID: 1,
                      BLOCKS: [
                        { MESSAGE: 'Мониторинг: сервис недоступен' },
                        { GRID: [{ NAME: 'Хост', VALUE: 'api-1' }] },
                      ],
                    },
                  ],
                }
              : [],
  };
}).reverse();

// Файлы сообщения 59: картинка и голосовое, как их отдаёт портал.
const MOCK_FILES = [
  { id: 501, name: 'схема.png', size: 2144, type: 'image', isVoiceNote: false },
  { id: 502, name: 'Голосовое сообщение 02.03 09-59.webm', size: 9000, type: 'video' },
  { id: 503, name: 'фото.jpg', size: 5000, type: 'image' },
  { id: 504, name: 'договор.pdf', size: 52000, type: 'file' },
];

function mockMessagesPage(params: Record<string, string>) {
  const before = Number(params.LAST_ID) || Infinity;
  const after = Number(params.FIRST_ID) || 0;
  const limit = Math.min(Number(params.LIMIT) || 20, 50);
  const messages = MOCK_HISTORY.filter((m) => m.id < before && m.id > after).slice(0, limit);
  return {
    messages,
    users: [
      { id: 1, name: 'Анна Кузнецова' },
      { id: 2, name: 'Дмитрий Соколов' },
    ],
    files: MOCK_FILES,
  };
}

// Связи и избранное меняются в тестах, но на снимки доски не влияют, поэтому хранятся.
const DEPENDS: Record<string, string[]> = {};
const FAVORITES = new Set<string>();
const WATCHING = new Set<string>();
const TEMPLATES: Record<string, unknown>[] = [
  {
    ID: 1,
    TITLE: 'Еженедельный отчёт заказчику',
    DESCRIPTION: 'Собрать статус по задачам и отправить',
    RESPONSIBLE_ID: 1,
    GROUP_ID: 10,
    PRIORITY: '1',
    REPLICATE: 'Y',
    REPLICATE_PARAMS: { PERIOD: 'weekly', WEEK_DAYS: [5], TIME: '10:00' },
  },
];
const MY_PLAN_STAGES = [
  { ID: '31', TITLE: 'Не спланированы', SORT: '100', COLOR: '00C4FB' },
  { ID: '33', TITLE: 'Сделаю на неделе', SORT: '200', COLOR: '47D1E2' },
  { ID: '35', TITLE: 'Сделаю потом', SORT: '300', COLOR: '75D900' },
];
const MY_PLAN: Record<string, string> = {};
const GANTT_LINKS: { from: string; to: string }[] = [];
const FEED: Record<string, string>[] = [
  {
    ID: '33',
    AUTHOR_ID: '2',
    TITLE: 'Демо в пятницу',
    DETAIL_TEXT: 'Показываем [B]API v2[/B] заказчику, нужны все.',
    DATE_PUBLISH: '2026-03-02T10:00:00+03:00',
    NUM_COMMENTS: '2',
  },
];
const EVENTS: Record<string, string>[] = [];
const MEMBERS: Record<string, { USER_ID: string; ROLE: string }[]> = {};
const MUTED = new Set<string>();
const CRM_LINKS: Record<string, string[]> = {};
const CRM_ITEMS: Record<
  number,
  { id: number; title?: string; name?: string; lastName?: string }[]
> = {
  1: [{ id: 3, title: 'Лид с сайта' }],
  2: [
    { id: 7, title: 'Внедрение CRM для ООО Ромашка' },
    { id: 8, title: 'Поддержка Ромашки на 2026' },
  ],
  3: [{ id: 5, name: 'Олег', lastName: 'Ромашкин' }],
  4: [{ id: 2, title: 'ООО Ромашка' }],
};

export function isMockEnabled(): boolean {
  return ON;
}

export function mockHandle(method: string, params: Record<string, string>): unknown | null {
  if (!ON) return null;

  switch (method) {
    case 'sonet_group.get.json':
    case 'sonet_group.get':
      return PROJECTS;

    // Правка живёт до перезапуска сервера: тестам хватает, чтобы перечитанный список её показал.
    case 'sonet_group.update': {
      const project = PROJECTS.find((item) => item.ID === params.GROUP_ID);
      if (!project) return null;
      for (const key of [
        'NAME',
        'DESCRIPTION',
        'CLOSED',
        'PROJECT_DATE_START',
        'PROJECT_DATE_FINISH',
      ])
        if (params[key] !== undefined) project[key] = params[key];
      return true;
    }

    // Роли меняются в тестах, поэтому хранятся до перезапуска сервера.
    case 'sonet_group.user.get':
      return (MEMBERS[params.ID] ||= [
        { USER_ID: '1', ROLE: 'A' },
        { USER_ID: '2', ROLE: 'E' },
        { USER_ID: '3', ROLE: 'K' },
      ]);
    case 'sonet_group.user.update': {
      const list = MEMBERS[params.GROUP_ID] || [];
      for (const member of list) if (member.USER_ID === params.USER_ID) member.ROLE = params.ROLE;
      return [Number(params.USER_ID)];
    }
    case 'sonet_group.setowner': {
      for (const member of MEMBERS[params.GROUP_ID] || [])
        member.ROLE =
          member.USER_ID === params.USER_ID ? 'A' : member.ROLE === 'A' ? 'K' : member.ROLE;
      return true;
    }
    // Удаление не трогает список: остальные тесты ходят в те же проекты.
    case 'sonet_group.delete':
      return true;

    case 'user.get':
      return USERS;

    case 'user.current':
      return { ID: '1', NAME: 'Анна', LAST_NAME: 'Кузнецова', EMAIL: 'anna@example.com' };

    case 'task.stages.get': {
      if (String(params.entityId) === '0') return MY_PLAN_STAGES;
      const entityId = params.entityId;
      const stages = STAGES_MAP[entityId];
      if (!stages) return [];
      return stages;
    }

    case 'tasks.task.list': {
      const all = Object.values(ALL_TASKS).flat();
      const planFilter = (
        params as unknown as { filter?: { STAGES_ID?: unknown; MEMBER?: number } }
      ).filter;
      if (planFilter?.MEMBER && planFilter.STAGES_ID !== undefined) {
        const wanted = [planFilter.STAGES_ID].flat().map(String);
        const tasks = all.filter((task) =>
          // Как на портале: нераспланированные лежат в первой личной стадии.
          wanted.includes(MY_PLAN[String(task.id)] || '31'),
        );
        return { tasks: tasks.slice(0, 6), next: undefined, total: tasks.length };
      }
      if (params['filter[DEPENDS_ON]']) {
        const id = params['filter[DEPENDS_ON]'];
        const tasks = all.filter((task) => (DEPENDS[String(task.id)] || []).includes(id));
        return { tasks, next: undefined, total: tasks.length };
      }
      if (params['filter[ID]']) {
        const ids = params['filter[ID]'].split(',');
        const tasks = all.filter((task) => ids.includes(String(task.id)));
        return { tasks, next: undefined, total: tasks.length };
      }
      const groupId = params['filter[GROUP_ID]'] || params.groupId;
      const tasks = groupId && ALL_TASKS[groupId] ? ALL_TASKS[groupId] : [];
      return { tasks, next: undefined, total: tasks.length };
    }

    case 'tasks.task.add': {
      // Мок-режим: создаём задачу локально и возвращаем id, чтобы фича
      // inline-добавления была тестируема без реального Битрикса.
      // Прокси шлёт fields строкой, серверные роуты объектом.
      const raw = params.fields as unknown;
      const fields = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
      const id = `mock-${Date.now()}`;
      const task = {
        id,
        title: fields.TITLE || 'Новая задача',
        description: fields.DESCRIPTION || '',
        status: '2',
        subStatus: '-1',
        priority: fields.PRIORITY || '1',
        createdDate: new Date().toISOString(),
        changedDate: new Date().toISOString(),
        timeEstimate: '0',
        timeSpentInLogs: '0',
        groupId: String(fields.GROUP_ID || '0'),
        responsibleId: String(fields.RESPONSIBLE_ID || '0'),
        creatorId: '1',
        commentsCount: '0',
        stageId: fields.STAGE_ID || '0',
      };
      const groupId = String(fields.GROUP_ID || '0');
      if (!ALL_TASKS[groupId]) ALL_TASKS[groupId] = [];
      ALL_TASKS[groupId].push(task);
      return { task: { id } };
    }

    case 'tasks.task.start':
    case 'tasks.task.pause':
    case 'tasks.task.defer':
    case 'tasks.task.complete':
    case 'tasks.task.renew':
    case 'tasks.task.approve':
    case 'tasks.task.disapprove':
    case 'tasks.task.update': {
      if (method === 'tasks.task.update') {
        const fields = JSON.parse(params.fields || '{}');
        if (Array.isArray(fields.DEPENDS_ON))
          DEPENDS[params.taskId] = fields.DEPENDS_ON.map(String);
        if (Array.isArray(fields.UF_CRM_TASK))
          CRM_LINKS[params.taskId] = fields.UF_CRM_TASK.map(String);
      }
      // Подтверждаем правку, но данные не меняем: мок живёт весь прогон
      // UI-тестов, и перенос задачи в одном тесте сдвинул бы снимки остальных.
      return { task: { id: params.taskId } };
    }

    case 'tasks.task.get': {
      const id = params.taskId || params['filter[ID]'];
      const all = Object.values(ALL_TASKS).flat();
      const task = all.find((t) => String(t.id) === String(id));
      return task
        ? {
            ...task,
            chatId: '1',
            favorite: FAVORITES.has(String(id)) ? 'Y' : 'N',
            isMuted: MUTED.has(String(id)) ? 'Y' : 'N',
            auditors: WATCHING.has(String(id)) ? ['1'] : [],
            ufCrmTask: CRM_LINKS[String(id)] || null,
          }
        : null;
    }

    case 'task.item.getdependson':
      return DEPENDS[params.TASKID] || [];

    case 'tasks.task.favorite.add':
      FAVORITES.add(params.taskId);
      return true;

    case 'tasks.task.favorite.remove':
      FAVORITES.delete(params.taskId);
      return true;

    case 'tasks.task.startwatch':
      WATCHING.add(params.taskId);
      return { task: { id: params.taskId } };
    case 'tasks.task.stopwatch':
      WATCHING.delete(params.taskId);
      return { task: { id: params.taskId } };
    case 'tasks.task.mute':
      MUTED.add(params.id);
      return { task: { id: params.id } };
    case 'tasks.task.unmute':
      MUTED.delete(params.id);
      return { task: { id: params.id } };
    // Как и правка, не меняет данные задачи: снимки доски остаются прежними.
    case 'tasks.task.delegate':
      return { task: { id: params.taskId, responsibleId: params.userId } };

    // Лента и календарь проекта живут до перезапуска сервера, как и остальные правки мока.
    case 'log.blogpost.get':
      return FEED;
    case 'log.blogpost.add': {
      const raw = params as unknown as { POST_TITLE?: string; POST_MESSAGE: string };
      const id = String(100 + FEED.length);
      FEED.unshift({
        ID: id,
        AUTHOR_ID: '1',
        TITLE: raw.POST_TITLE || raw.POST_MESSAGE.slice(0, 40),
        DETAIL_TEXT: raw.POST_MESSAGE,
        DATE_PUBLISH: new Date().toISOString(),
        NUM_COMMENTS: '0',
        MICRO: raw.POST_TITLE ? 'N' : 'Y',
      });
      return { id: Number(id) };
    }
    case 'calendar.section.get':
      return [{ ID: '7', NAME: 'Проект', PERM: { add: true } }];
    case 'calendar.event.get':
      return EVENTS;
    case 'calendar.event.add': {
      const id = String(500 + EVENTS.length);
      const toPortal = (value: string) => {
        const [date, time = '00:00'] = value.split(' ');
        const [year, month, day] = date.split('-');
        return `${day}.${month}.${year} ${time}:00`;
      };
      EVENTS.push({
        ID: id,
        NAME: params.name,
        DATE_FROM: toPortal(params.from),
        DATE_TO: toPortal(params.to),
        SKIP_TIME: params.skip_time,
      });
      return Number(id);
    }

    // batch REST v3: тело это массив вызовов, ответ массив их результатов по порядку.
    case 'batch':
      return (params as unknown as { method: string; query: Record<string, string> }[]).map(
        (item) => mockHandle(item.method, item.query),
      );
    case 'tasks.task.gantt.link.list': {
      const raw = params as unknown as { filter: [string, number] };
      const id = String(raw.filter?.[1] ?? '');
      return {
        // Как на портале: связь читается по зависимой задаче, предшественник в dependentId.
        items: GANTT_LINKS.filter((link) => link.to === id).map((link) => ({
          taskId: Number(link.to),
          dependentId: Number(link.from),
          type: 'finish_start',
        })),
      };
    }
    case 'task.dependence.add': {
      const raw = params as unknown as { taskIdFrom: number; taskIdTo: number };
      GANTT_LINKS.push({ from: String(raw.taskIdFrom), to: String(raw.taskIdTo) });
      return [];
    }
    case 'task.dependence.delete': {
      const raw = params as unknown as { taskIdFrom: number; taskIdTo: number };
      const index = GANTT_LINKS.findIndex(
        (link) => link.from === String(raw.taskIdFrom) && link.to === String(raw.taskIdTo),
      );
      if (index >= 0) GANTT_LINKS.splice(index, 1);
      return [];
    }

    case 'task.stages.movetask': {
      const raw = params as unknown as { id: number; stageId: number };
      MY_PLAN[String(raw.id)] = String(raw.stageId);
      return true;
    }

    // Как на портале: список отдаёт параметры повтора пустыми, полные есть только в get.
    case 'tasks.template.list':
      return {
        task_templates: Object.fromEntries(
          TEMPLATES.map((item) => [item.ID, { ...item, REPLICATE_PARAMS: {} }]),
        ),
      };
    case 'tasks.template.get': {
      const id = Number((params as unknown as { templateId: number }).templateId);
      return { task_template: TEMPLATES.find((entry) => entry.ID === id) || null };
    }
    case 'tasks.template.checklist.list':
      return { checkListItems: [] };
    case 'tasks.template.add': {
      const raw = params as unknown as { fields: Record<string, unknown> };
      TEMPLATES.push({ ...raw.fields, ID: 10 + TEMPLATES.length });
      return 10 + TEMPLATES.length - 1;
    }
    case 'tasks.template.update': {
      const raw = params as unknown as { templateId: number; fields: Record<string, unknown> };
      const item = TEMPLATES.find((entry) => entry.ID === raw.templateId);
      if (item) Object.assign(item, raw.fields);
      return true;
    }
    case 'tasks.template.delete': {
      const raw = params as unknown as { templateId: number };
      const index = TEMPLATES.findIndex((entry) => entry.ID === raw.templateId);
      if (index >= 0) TEMPLATES.splice(index, 1);
      return true;
    }

    case 'crm.item.list': {
      const raw = params as unknown as {
        entityTypeId: number;
        filter?: Record<string, unknown>;
      };
      const items = CRM_ITEMS[Number(raw.entityTypeId)] || [];
      const filter = raw.filter || {};
      const ids = filter['@id'] as number[] | undefined;
      const like = Object.entries(filter).find(([key]) => key.startsWith('%'));
      return {
        items: items.filter((item) => {
          if (ids) return ids.map(Number).includes(item.id);
          if (like) {
            const value = String(item[like[0].slice(1) as 'title'] || '').toLowerCase();
            return value.includes(String(like[1]).toLowerCase());
          }
          return true;
        }),
      };
    }

    // Ноль просроченных: иначе счётчик в меню попал бы во все снимки экранов.
    case 'tasks.task.counters.get':
      return {
        expired: { counter: 0 },
        new_comments: { counter: 0 },
        mentioned: { counter: 0 },
      };

    case 'tasks.task.history.list':
      return {
        list: [
          {
            id: 3,
            createdDate: '2026-03-03T10:15:00+03:00',
            field: 'DEADLINE',
            value: { from: '1772700000', to: '1773046800' },
            user: { id: 2, name: 'Дмитрий', lastName: 'Соколов' },
          },
          {
            id: 2,
            createdDate: '2026-03-02T12:00:00+03:00',
            field: 'STATUS',
            value: { from: '2', to: '3' },
            user: { id: 1, name: 'Анна', lastName: 'Кузнецова' },
          },
          {
            id: 1,
            createdDate: '2026-03-01T09:00:00+03:00',
            field: 'NEW',
            value: { from: null, to: null },
            user: { id: 1, name: 'Анна', lastName: 'Кузнецова' },
          },
        ],
      };

    case 'im.recent.list':
      return Number(params.OFFSET) > 0 ? MOCK_DIALOGS_NEXT : MOCK_DIALOGS;

    case 'im.message.add':
      return 1000;

    case 'im.v2.File.upload':
      return { messageId: 1001, file: { id: 600 } };

    // Дмитрий прочитал по 57-е сообщение: мои 1..57 прочитаны, 59-е нет.
    // В канале «Новости компании» писать могут только менеджеры.
    case 'im.dialog.get':
      if (params.DIALOG_ID === 'chat777')
        return {
          id: 777,
          name: 'Старый чат',
          type: 'chat',
          entity_type: '',
          role: 'owner',
          permissions: { canPost: 'member' },
          readed_list: [],
        };
      return params.DIALOG_ID === 'chat30'
        ? { id: 30, role: 'member', permissions: { canPost: 'manager' }, readed_list: [] }
        : {
            id: 2,
            owner: 1,
            // Администратор группы может удалять чужие сообщения, участник личного чата нет.
            role: params.DIALOG_ID === 'chat20' ? 'owner' : 'member',
            permissions: { canPost: 'member' },
            readed_list: [{ user_id: 2, user_name: 'Дмитрий Соколов', message_id: 57, date: null }],
          };

    case 'im.counters.get':
      return { TYPE: { MESSENGER: 0 } };

    // Реакции и закреп мок не хранит: снимки переписки остаются прежними, а действия
    // проверяются по оптимистичному виду и по запросам.
    case 'im.v2.Chat.Message.tail':
      return { messages: [], reactions: [] };
    case 'im.v2.Chat.load':
      return { pins: [], messages: [], additionalMessages: [] };
    case 'im.notify.get':
      return {
        total_unread_count: 1,
        users: [{ id: 2, name: 'Дмитрий Соколов', avatar: '' }],
        notifications: [
          {
            id: 901,
            notify_type: 1,
            notify_module: 'calendar',
            author_id: 2,
            date: '2026-03-04T10:00:00+03:00',
            notify_title: 'Приглашение на встречу «Планёрка»',
            text: 'Приглашаю вас принять участие во встрече «Планёрка»',
            notify_read: 'N',
            notify_buttons: JSON.stringify([
              { COMMAND: 'notifyConfirm', COMMAND_PARAMS: '901|Y', TEXT: 'Подтвердить участие' },
              { COMMAND: 'notifyConfirm', COMMAND_PARAMS: '901|N', TEXT: 'Отказаться' },
            ]),
          },
          {
            id: 902,
            notify_type: 2,
            notify_module: 'im',
            author_id: 2,
            date: '2026-03-03T12:00:00+03:00',
            notify_title: '',
            text: 'Посмотри, пожалуйста, отчёт',
            notify_read: 'Y',
          },
          {
            id: 903,
            notify_type: 4,
            notify_module: 'calendar',
            author_id: 0,
            date: '2026-03-02T09:00:00+03:00',
            notify_title: '',
            text: 'Напоминание о событии «Ретро»',
            notify_read: 'Y',
          },
        ],
      };
    case 'im.notify.confirm':
      return { result_message: ['Ваш выбор: «Подтвердить участие»'] };
    case 'im.notify.answer':
      return { result_message: ['Ваш ответ успешно отправлен.'] };
    case 'im.user.status.get':
      return 'online';
    case 'disk.storage.getlist':
      return [{ ID: '1', ENTITY_TYPE: 'user', ROOT_OBJECT_ID: '100' }];
    case 'disk.folder.getchildren':
      return params.id === '100'
        ? [
            { ID: '101', NAME: 'Документы', TYPE: 'folder' },
            { ID: '102', NAME: 'план.pdf', TYPE: 'file', SIZE: '2048' },
          ]
        : [{ ID: '103', NAME: 'договор.docx', TYPE: 'file', SIZE: '4096' }];
    case 'im.disk.file.save':
      return { folder: { id: 7, name: 'Сохраненные файлы' }, file: { id: 8, name: 'файл' } };
    case 'im.disk.file.commit':
      return { FILES: { disk102: { id: 104 } }, MESSAGE_ID: 1002 };
    case 'im.notify.read.list':
    case 'im.notify.delete':
    case 'im.user.status.set':
    case 'im.dialog.unread':
    case 'im.message.command':
    case 'im.disk.file.delete':
      return true;
    case 'im.v2.Chat.Message.pin':
    case 'im.v2.Chat.Message.unpin':
      return [];
    case 'im.v2.Chat.add':
      return { chat: {}, chatId: 78 };
    case 'im.v2.Chat.Message.Reaction.add':
    case 'im.v2.Chat.Message.Reaction.delete':
    case 'im.v2.Chat.update':
    case 'im.message.share':
    case 'im.recent.hide':
    case 'im.chat.updateColor':
    case 'im.chat.updateAvatar':
    case 'im.message.like':
    case 'im.message.update':
    case 'im.message.delete':
    case 'im.recent.pin':
    case 'im.recent.unread':
    case 'im.dialog.read.all':
    case 'im.chat.mute':
      return true;

    case 'im.chat.add':
      return 77;

    case 'im.chat.updateTitle':
    case 'im.chat.setOwner':
    case 'im.chat.user.add':
    case 'im.chat.user.delete':
    case 'im.chat.leave':
      return true;

    case 'im.search.chat.list':
      return [{ id: 888, name: 'Старый архив', type: 'chat', avatar: '' }];

    case 'im.v2.File.download':
      return { downloadUrl: 'https://mock.invalid/file' };

    case 'im.search.user.list':
      return {
        '5': {
          id: 5,
          name: 'Анна Новикова',
          work_position: 'Дизайнер',
          status: 'online',
          idle: false,
          get last_activity_date() {
            return new Date().toISOString();
          },
        },
      };

    case 'im.dialog.users.list':
      return [
        { id: 1, name: 'Анна Кузнецова', active: true },
        {
          id: 2,
          name: 'Дмитрий Соколов',
          active: true,
          status: 'online',
          get last_activity_date() {
            return new Date().toISOString();
          },
        },
      ];

    case 'im.dialog.messages.search':
      return {
        messages: [
          {
            id: 30,
            author_id: 2,
            text: 'Сообщение 30',
            date: '2026-03-02T09:30:00+03:00',
            params: [],
          },
        ],
        users: [{ id: 2, name: 'Дмитрий Соколов' }],
        files: [],
      };

    case 'im.dialog.read':
      return true;

    case 'im.dialog.messages.get': {
      if (params.DIALOG_ID === '2') return mockMessagesPage(params);
      // Группа: автор сообщения в сети, чтобы рядом с именем стояла точка присутствия.
      if (params.DIALOG_ID === 'chat20')
        return {
          messages: [
            {
              id: 101,
              author_id: 2,
              text: 'Привет, команда',
              date: '2026-03-01T09:00:00+03:00',
              params: [],
            },
          ],
          users: [
            {
              id: 2,
              name: 'Дмитрий Соколов',
              status: 'online',
              get last_activity_date() {
                return new Date().toISOString();
              },
            },
          ],
          files: [],
        };
      if (params.DIALOG_ID) return { messages: [], users: [] };
      const comments = COMMENTS[params.taskId] || [];
      return { messages: comments };
    }

    case 'task.elapseditem.getlist': {
      return TIME_LOG[params.TASKID] || [];
    }

    default:
      return null;
  }
}
