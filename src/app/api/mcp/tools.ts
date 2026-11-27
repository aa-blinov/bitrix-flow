// Тулы MCP. Они не дублируют логику, а зовут те же роуты, что и интерфейс, с сессией владельца
// токена: фильтры, ранжирование поиска и проверки доступа остаются в одном месте. Только чтение:
// записи в портал идут через bx24 MCP или интерфейс.
import { NextRequest } from 'next/server';
import { GET as tasksAll } from '@/app/api/tasks/all/route';
import { GET as myPlan } from '@/app/api/my-plan/route';
import { getDb } from '@/lib/mongo';
import { getSessionPerson } from '@/lib/people';
import { mapBitrixTaskStatus } from '@/lib/task-status';
import { sessionCookie } from '@/lib/session';

type Args = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Args, cookie: string) => Promise<unknown>;
};

export class ToolError extends Error {}

const appUrl = () => (process.env.BITRIX24_APP_URL || '').replace(/\/$/, '');
const taskLink = (id: string) => `${appUrl()}/all-tasks?task=${encodeURIComponent(id)}`;

async function callRoute(
  handler: (req: NextRequest) => Response | Promise<Response>,
  path: string,
  cookie: string,
  params: Record<string, string> = {},
) {
  const url = new URL(path, 'http://mcp.local');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await handler(
    new NextRequest(url, { headers: { cookie: `${sessionCookie.name}=${cookie}` } }),
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ToolError(body?.error || `HTTP_${response.status}`);
  return body;
}

// Портал отдаёт описание с HTML-сущностями (&#91; вместо скобки BB-кода): модели нужен текст.
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
export const decodeEntities = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const point =
      code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });

const text = (value: unknown, max: number) => {
  const raw = typeof value === 'string' ? decodeEntities(value) : '';
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
};
const id = (value: unknown) => (/^\d{1,12}$/.test(String(value ?? '')) ? String(value) : '');
const limitOf = (value: unknown, fallback: number) =>
  Math.min(100, Math.max(1, Math.trunc(Number(value)) || fallback));

// Список задач для модели: без описаний и аватаров, иначе 50 задач съедают контекст.
function compactTask(task: any) {
  return {
    id: task.id,
    title: decodeEntities(String(task.title || '')),
    status: mapBitrixTaskStatus(task.status),
    project: task.groupName || null,
    projectId: task.groupId,
    responsible: task.responsibleName || null,
    deadline: task.deadline || null,
    changed: task.changedDate || null,
    tags: task.tags || undefined,
    url: taskLink(task.id),
  };
}

// Полный снимок без служебного: карта прав и аватары модели не нужны.
const OMIT = new Set(['action', 'favorite', 'notViewed', 'isMuted', 'isPinned', 'isPinnedInGroup']);
function fullTask(task: any) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task || {}))
    if (!OMIT.has(key)) result[key] = key === 'description' ? text(value, 20_000) : value;
  for (const key of ['creator', 'responsible'] as const)
    if (task?.[key]) result[key] = { id: task[key].id, name: task[key].name };
  if (typeof task?.title === 'string') result.title = decodeEntities(task.title);
  result.url = taskLink(String(task.id ?? task.ID));
  return result;
}

export const TOOLS: Tool[] = [
  {
    name: 'search_tasks',
    description:
      'Поиск задач Bitrix24 по словам в названии, описании, проекте и исполнителе, или по номеру. ' +
      'Читает зеркало BitrixFlow, лучшие совпадения первыми. Описание задачи отдаёт get_task.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Слова или номер задачи' },
        project_id: { type: 'string', description: 'Ограничить проектом (ID группы)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async run(args, cookie) {
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : '';
      if (!query) throw new ToolError('query обязателен');
      const params: Record<string, string> = {
        query,
        rank: 'true',
        limit: String(limitOf(args.limit, 20)),
      };
      if (id(args.project_id)) params.projectId = id(args.project_id);
      const data = await callRoute(tasksAll, '/api/tasks/all', cookie, params);
      return { total: data.total, tasks: (data.tasks || []).map(compactTask) };
    },
  },
  {
    name: 'get_task',
    description:
      'Задача Bitrix24 целиком по ID: описание, участники, сроки, чек-лист, теги, учёт времени.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'ID задачи' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args, cookie) {
      const taskId = id(args.id);
      if (!taskId) throw new ToolError('id должен быть числом');
      const person = await getSessionPerson(cookie);
      if (!person) throw new ToolError('MEMBER_ID_REQUIRED');
      const db = await getDb();
      // Зеркало обновляют события задачи. tasks нужен для новой задачи, которую зеркало ещё не
      // догнало: кэш проекта пишет id как пришёл из портала, строкой или числом, и без member_id.
      const [mirrored, cached] = await Promise.all([
        db.collection('task_mirror').findOne({ member_id: person.memberId, id: taskId }),
        db.collection('tasks').findOne({ id: { $in: [taskId, Number(taskId)] } }),
      ]);
      const task = mirrored?.data || cached?.data;
      if (!task) throw new ToolError('Задача не найдена в зеркале');
      return fullTask(task);
    },
  },
  {
    name: 'my_plan',
    description:
      'Личный план владельца токена («Мой план» Bitrix24): стадии и незавершённые задачи в каждой.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, cookie) {
      const data = await callRoute(myPlan, '/api/my-plan', cookie);
      return (data.stages || []).map((stage: any) => ({
        stage: stage.title,
        tasks: stage.tasks.map((task: any) => ({ ...task, url: taskLink(task.id) })),
      }));
    },
  },
];
