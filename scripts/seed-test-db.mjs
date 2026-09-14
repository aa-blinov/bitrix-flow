// Данные для UI-тестов: фиксированный набор задач и проектов в отдельной базе.
// Скриншоты сравниваются попиксельно, поэтому всё должно быть детерминированным —
// никаких «сегодня» и случайных id.
import { MongoClient } from 'mongodb';

const url = process.env.MONGO_URL || 'mongodb://127.0.0.1:27018';
const dbName = process.env.MONGO_DB || 'bitrix_kanban_test';
const MEMBER_ID = 'test-member';

// Дата отсчёта: все сроки задаются относительно неё, чтобы «просрочено» и
// «на неделе» не зависели от дня прогона.
const BASE = new Date('2026-03-02T09:00:00.000Z');
const day = (offset) => new Date(BASE.getTime() + offset * 86400000).toISOString();

const USERS = [
  { id: '1', name: 'Анна Кузнецова' },
  { id: '2', name: 'Дмитрий Соколов' },
  { id: '3', name: 'Мария Орлова' },
];

const PROJECTS = [
  { id: '10', name: 'Разработка API v2' },
  { id: '11', name: 'Маркетинг Q4' },
  { id: '12', name: 'Внутренний бэклог' },
];

const TASKS = [
  ['101', 'Перевести справочники на GraphQL', '10', '1', '2', -6, 3, 28800, 25200],
  ['102', 'Описать схему подписок', '10', '2', '1', -2, 2, 14400, 3600],
  ['103', 'Согласовать лимиты запросов', '10', '3', '5', 4, 1, 7200, 0],
  ['104', 'Свести бюджет кампании', '11', '1', '3', -1, 2, 10800, 12600],
  ['105', 'Подготовить креативы', '11', '2', '2', 6, 1, 18000, 0],
  ['106', 'Почистить очередь техдолга', '12', '3', '5', null, 1, 0, 0],
  ['107', 'Обновить зависимости', '12', '1', '1', 9, 2, 5400, 1800],
  ['108', 'Разобрать входящие обращения', '11', '3', '3', null, 2, 3600, 900],
];

const task = ([
  id,
  title,
  groupId,
  responsibleId,
  status,
  deadlineOffset,
  priority,
  estimate,
  spent,
]) => ({
  id,
  title,
  description: `Описание задачи ${id}`,
  status: String(status),
  priority: String(priority),
  createdDate: day(-20),
  changedDate: day(-1),
  deadline: deadlineOffset === null ? '' : day(deadlineOffset),
  timeEstimate: String(estimate),
  timeSpentInLogs: String(spent),
  responsible: { id: responsibleId, name: USERS.find((user) => user.id === responsibleId).name },
  creator: { id: '1', name: 'Анна Кузнецова' },
  group: { id: groupId, name: PROJECTS.find((project) => project.id === groupId).name },
  // Стадии совпадают с мок-доской проекта, иначе колонки канбана пустые.
  stageId:
    {
      10: { 101: '100', 102: '101', 103: '100' },
      11: { 104: '111', 105: '110', 108: '110' },
      12: { 106: '120', 107: '121' },
    }[groupId]?.[id] || '0',
  accomplices: [],
  auditors: [],
  commentsCount: '0',
  parentId: id === '103' ? '101' : '0',
});

const client = new MongoClient(url);
await client.connect();
const db = client.db(dbName);

for (const name of [
  'task_mirror',
  'tasks',
  'projects',
  'user_tokens',
  'sessions',
  'notifications',
  'events_stream',
  'cache',
]) {
  await db.collection(name).deleteMany({});
}

await db.collection('user_tokens').insertOne({
  member_id: MEMBER_ID,
  domain: 'mock.bitrix24.ru',
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  application_token: 'test-app-token',
  installed_at: new Date(),
  updated_at: new Date(),
});

await db.collection('projects').insertMany(
  PROJECTS.map((project) => ({
    member_id: MEMBER_ID,
    id: project.id,
    data: { ID: project.id, NAME: project.name, NUMBER_OF_MEMBERS: '3' },
    cachedAt: new Date(),
  })),
);

await db.collection('task_mirror').insertMany(
  TASKS.map((row) => ({
    member_id: MEMBER_ID,
    id: row[0],
    data: task(row),
    updated_at: new Date(),
  })),
);

await db.collection('notifications').insertMany([
  {
    member_id: MEMBER_ID,
    id: 'n1',
    type: 'task_added',
    title: 'Новая задача',
    message: 'Перевести справочники на GraphQL',
    taskId: '101',
    projectId: '10',
    created_at: new Date(day(-1)),
  },
  {
    member_id: MEMBER_ID,
    id: 'n2',
    type: 'comment_added',
    title: 'Комментарий',
    message: 'Уточните лимиты, пожалуйста',
    taskId: '103',
    projectId: '10',
    created_at: new Date(day(-2)),
  },
]);

console.log(`[seed] база ${dbName}: задач ${TASKS.length}, проектов ${PROJECTS.length}`);
await client.close();
