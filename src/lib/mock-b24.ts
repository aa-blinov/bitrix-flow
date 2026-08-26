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

const PROJECTS = [
  { ID: '10', NAME: 'Разработка API v2', DESCRIPTION: 'Перевод публичного API на GraphQL', NUMBER_OF_MEMBERS: '5' },
  { ID: '11', NAME: 'Маркетинг Q4', DESCRIPTION: 'Запуск осенней кампании', NUMBER_OF_MEMBERS: '4' },
  { ID: '12', NAME: 'Внутренний бэклог', DESCRIPTION: 'Технический долг и улучшения', NUMBER_OF_MEMBERS: '3' },
  { ID: '13', NAME: 'Инфраструктура', DESCRIPTION: 'CI/CD и observability', NUMBER_OF_MEMBERS: '8' },
  { ID: '14', NAME: 'Мобильное приложение', DESCRIPTION: 'iOS и Android клиенты', NUMBER_OF_MEMBERS: '6' },
  { ID: '15', NAME: 'Аналитика', DESCRIPTION: 'Продуктовая аналитика и отчёты', NUMBER_OF_MEMBERS: '3' },
  { ID: '16', NAME: 'Документация', DESCRIPTION: 'Портал для разработчиков', NUMBER_OF_MEMBERS: '2' },
  { ID: '17', NAME: 'Дизайн-система', DESCRIPTION: 'UI-kit и компоненты', NUMBER_OF_MEMBERS: '4' },
  { ID: '18', NAME: 'Безопасность', DESCRIPTION: 'Аудит и pentest', NUMBER_OF_MEMBERS: '2' },
  { ID: '19', NAME: 'Поддержка', DESCRIPTION: 'Текущие тикеты и инциденты', NUMBER_OF_MEMBERS: '5' },
];

const STAGES_10: Record<string, any> = {
  '100': { ID: '100', TITLE: 'Бэклог', SORT: '100', COLOR: '47D1E2', SYSTEM_TYPE: 'NEW', ENTITY_ID: '10' },
  '101': { ID: '101', TITLE: 'В работе', SORT: '200', COLOR: '75D900', SYSTEM_TYPE: 'PROCESS', ENTITY_ID: '10' },
  '102': { ID: '102', TITLE: 'На ревью', SORT: '300', COLOR: 'FFAB00', SYSTEM_TYPE: 'WORK', ENTITY_ID: '10' },
  '103': { ID: '103', TITLE: 'Готово', SORT: '400', COLOR: 'D0D0D0', SYSTEM_TYPE: 'FINISH', ENTITY_ID: '10' },
};

const STAGES_11: Record<string, any> = {
  '110': { ID: '110', TITLE: 'Идеи', SORT: '100', COLOR: '47D1E2', SYSTEM_TYPE: 'NEW', ENTITY_ID: '11' },
  '111': { ID: '111', TITLE: 'В работе', SORT: '200', COLOR: '75D900', SYSTEM_TYPE: 'PROCESS', ENTITY_ID: '11' },
  '112': { ID: '112', TITLE: 'Согласование', SORT: '300', COLOR: 'FFAB00', SYSTEM_TYPE: 'WORK', ENTITY_ID: '11' },
  '113': { ID: '113', TITLE: 'Запущено', SORT: '400', COLOR: '1EAE43', SYSTEM_TYPE: 'FINISH', ENTITY_ID: '11' },
};

const STAGES_12: Record<string, any> = {
  '120': { ID: '120', TITLE: 'Новые', SORT: '100', COLOR: '47D1E2', SYSTEM_TYPE: 'NEW', ENTITY_ID: '12' },
  '121': { ID: '121', TITLE: 'В работе', SORT: '200', COLOR: '75D900', SYSTEM_TYPE: 'PROCESS', ENTITY_ID: '12' },
  '122': { ID: '122', TITLE: 'Готово', SORT: '300', COLOR: '1EAE43', SYSTEM_TYPE: 'FINISH', ENTITY_ID: '12' },
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
    { ID: '1', USER_ID: '2', USER_NAME: 'Дмитрий Соколов', DATE_PLAN: '2025-08-20', SECONDS: '7200', COMMENT_TEXT: 'Драфт схемы' },
  ],
  '1002': [
    { ID: '2', USER_ID: '4', USER_NAME: 'Илья Беляев', DATE_PLAN: '2025-08-22', SECONDS: '10800', COMMENT_TEXT: 'Поднял dev-стенд' },
  ],
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

    case 'user.get':
      return USERS;

    case 'user.current':
      return { ID: '1', NAME: 'Анна', LAST_NAME: 'Кузнецова', EMAIL: 'anna@example.com' };

    case 'task.stages.get': {
      const entityId = params.entityId;
      const stages = STAGES_MAP[entityId];
      if (!stages) return [];
      return stages;
    }

    case 'tasks.task.list': {
      const groupId = params['filter[GROUP_ID]'] || params.groupId;
      const tasks = groupId && ALL_TASKS[groupId] ? ALL_TASKS[groupId] : [];
      return { tasks, next: undefined, total: tasks.length };
    }

    case 'tasks.task.add': {
      // Мок-режим: создаём задачу локально и возвращаем id, чтобы фича
      // inline-добавления была тестируема без реального Битрикса.
      const fields = JSON.parse(params.fields || '{}');
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

    case 'tasks.task.get': {
      const id = params.taskId || params['filter[ID]'];
      const all = Object.values(ALL_TASKS).flat();
      const task = all.find((t) => String(t.id) === String(id));
      return task
        ? { ...task, chatId: '1' }
        : null;
    }

    case 'im.dialog.messages.get': {
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
