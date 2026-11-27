// Тулы MCP. Они не дублируют логику, а зовут те же роуты, что и интерфейс, с сессией владельца
// токена: фильтры, ранжирование поиска и проверки доступа остаются в одном месте. Цель MCP это
// ответы о состоянии работы, а не сырые задачи (сырой Битрикс уже есть в bx24 MCP), поэтому
// единственная запись здесь это реестр статусов проектов: его ведёт BitrixFlow.
import { NextRequest } from 'next/server';
import { GET as tasksAll } from '@/app/api/tasks/all/route';
import { GET as myPlan } from '@/app/api/my-plan/route';
import { GET as dashboard } from '@/app/api/dashboard/route';
import { GET as projectsSummary } from '@/app/api/projects/summary/route';
import { GET as statusGet, PUT as statusPut } from '@/app/api/projects/status/route';
import { getDb } from '@/lib/mongo';
import { getSessionPerson } from '@/lib/people';
import { STATUS_OPTIONS, type ProjectStatus } from '@/lib/project-status';
import { mapBitrixTaskStatus } from '@/lib/task-status';
import { sessionCookie } from '@/lib/session';
import { audit } from '@/lib/users';

type Args = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (args: Args, cookie: string) => Promise<unknown>;
};

export class ToolError extends Error {}

const appUrl = () => (process.env.BITRIX24_APP_URL || '').replace(/\/$/, '');
const taskLink = (id: string) => `${appUrl()}/all-tasks?task=${encodeURIComponent(id)}`;
const projectLink = (id: string) => `${appUrl()}/projects/${encodeURIComponent(id)}`;

async function callRoute(
  handler: (req: NextRequest) => Response | Promise<Response>,
  path: string,
  cookie: string,
  params: Record<string, string> = {},
  write?: { method: 'PUT'; body: unknown },
) {
  const url = new URL(path, 'http://mcp.local');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await handler(
    new NextRequest(url, {
      method: write?.method || 'GET',
      headers: {
        cookie: `${sessionCookie.name}=${cookie}`,
        ...(write ? { 'content-type': 'application/json' } : {}),
      },
      body: write ? JSON.stringify(write.body) : undefined,
    }),
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

type Directory = {
  projects: {
    id: string | number;
    name: string;
    isArchived?: boolean;
    startDate?: string;
    finishDate?: string;
  }[];
  users: { id: string | number; name: string }[];
  hiddenUsers?: { id: string | number; name: string }[];
};
type Summary = { id: string; [key: string]: unknown };

// Реестр собирается из трёх роутов интерфейса: справочник проектов и людей, статусы из списка
// портала и сводка по задачам. Все три отдают зеркало или кэш, портал на каждый вызов не дёргается.
async function loadProjects(cookie: string) {
  const [directory, statuses, summary] = await Promise.all([
    callRoute(dashboard, '/api/dashboard', cookie) as Promise<Directory>,
    callRoute(statusGet, '/api/projects/status', cookie) as Promise<{ statuses: ProjectStatus[] }>,
    // Сводка на холодном старте собирается из портала: без неё реестр всё равно полезен.
    (
      callRoute(projectsSummary, '/api/projects/summary', cookie) as Promise<{
        projects: Summary[];
      }>
    ).catch(() => ({ projects: [] as Summary[] })),
  ]);
  const people = new Map(
    [...(directory.users || []), ...(directory.hiddenUsers || [])].map((user) => [
      String(user.id),
      user.name,
    ]),
  );
  const status = new Map((statuses.statuses || []).map((row) => [row.projectId, row]));
  const metrics = new Map((summary.projects || []).map((row) => [String(row.id), row]));
  return (directory.projects || []).map((project) => {
    const id = String(project.id);
    const record = status.get(id);
    const stats = metrics.get(id);
    return {
      id,
      name: project.name,
      archived: Boolean(project.isArchived),
      startDate: project.startDate || null,
      finishDate: project.finishDate || null,
      registry: record
        ? {
            client: record.client,
            status: record.status,
            goal: record.goal,
            state: record.state,
            step: record.step,
            stepDeadline: record.stepDeadline || null,
            risk: record.risk,
            owner: record.ownerId
              ? { id: record.ownerId, name: people.get(record.ownerId) || null }
              : null,
            updatedAt: record.updatedAt || null,
          }
        : null,
      tasks: stats
        ? {
            total: stats.leafTaskCount,
            completed: stats.completed,
            inProgress: stats.inProgress,
            overdue: stats.overdue,
            noDeadline: stats.noDeadline,
            progress: stats.progress,
            plannedHours: stats.plannedHours,
            actualHours: stats.actualHours,
            lastChange: stats.changedAt || null,
          }
        : null,
      url: projectLink(id),
    };
  });
}

const short = (value: string, max = 300) =>
  value.length > max ? `${value.slice(0, max)}...` : value;

// Поля реестра, которые агент может менять. Имена как в форме «Статусы проектов».
const STATUS_FIELDS = {
  client: { key: 'client', description: 'Клиент' },
  status: { key: 'status', description: 'Статус', enum: STATUS_OPTIONS },
  goal: { key: 'goal', description: 'Цель проекта' },
  state: { key: 'state', description: 'Текущее состояние' },
  step: { key: 'step', description: 'Ближайший шаг' },
  step_deadline: { key: 'stepDeadline', description: 'Срок шага, YYYY-MM-DD' },
  risk: { key: 'risk', description: 'Главный риск' },
  owner_id: { key: 'ownerId', description: 'ID пользователя Битрикса, ответственного сейчас' },
} as const;

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

  {
    name: 'list_projects',
    description:
      'Реестр проектов: статус, клиент, ближайший шаг и его срок, главный риск, ответственный, ' +
      'а также задачи (всего, в работе, просрочено, без срока, прогресс) и часы план/факт. ' +
      'Длинные тексты обрезаны, целиком их отдаёт get_project.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Часть названия проекта или клиента' },
        status: { type: 'string', enum: [...STATUS_OPTIONS, 'без статуса'] },
        include_archived: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    async run(args, cookie) {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const wanted = typeof args.status === 'string' ? args.status : '';
      return (await loadProjects(cookie))
        .filter((project) => args.include_archived === true || !project.archived)
        .filter(
          (project) =>
            !query ||
            project.name.toLowerCase().includes(query) ||
            (project.registry?.client || '').toLowerCase().includes(query),
        )
        .filter((project) =>
          !wanted
            ? true
            : wanted === 'без статуса'
              ? !project.registry?.status
              : project.registry?.status === wanted,
        )
        .map((project) => ({
          ...project,
          registry: project.registry && {
            ...project.registry,
            goal: short(project.registry.goal),
            state: short(project.registry.state),
            risk: short(project.registry.risk),
          },
        }));
    },
  },
  {
    name: 'get_project',
    description:
      'Проект целиком: запись реестра без сокращений, метрики задач и часов и история правок ' +
      'реестра (кто и что менял), свежие сверху.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'ID проекта (группы Битрикса)' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    async run(args, cookie) {
      const projectId = id(args.project_id);
      if (!projectId) throw new ToolError('project_id должен быть числом');
      const [projects, history] = await Promise.all([
        loadProjects(cookie),
        callRoute(statusGet, '/api/projects/status', cookie, { history_project_id: projectId }),
      ]);
      const project = projects.find((item) => item.id === projectId);
      if (!project) throw new ToolError('Проект не найден');
      return { ...project, history: (history.timeline || []).slice(0, 30) };
    },
  },
  {
    name: 'update_project_status',
    description:
      'Заполнить или поправить запись проекта в реестре статусов. Передавай только поля, которые ' +
      'меняются, остальные останутся как были; пустая строка очищает поле. Запись уходит в список ' +
      'портала «Статусы проектов» и попадает в историю правок.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID проекта (группы Битрикса)' },
        ...Object.fromEntries(
          Object.entries(STATUS_FIELDS).map(([name, field]) => [
            name,
            {
              type: 'string',
              description: field.description,
              ...('enum' in field ? { enum: [...field.enum, ''] } : {}),
            },
          ]),
        ),
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args, cookie) {
      const projectId = id(args.project_id);
      if (!projectId) throw new ToolError('project_id должен быть числом');
      const changes: Record<string, string> = {};
      for (const [name, field] of Object.entries(STATUS_FIELDS)) {
        if (args[name] === undefined) continue;
        if (typeof args[name] !== 'string') throw new ToolError(`${name} должен быть строкой`);
        changes[field.key] = (args[name] as string).trim();
      }
      if (!Object.keys(changes).length)
        throw new ToolError('Нечего менять: передай хотя бы одно поле');
      // Форма молча сбрасывает неизвестный статус и битую дату, а модели нужна ошибка.
      if (changes.status && !(STATUS_OPTIONS as readonly string[]).includes(changes.status))
        throw new ToolError(`status: одно из ${STATUS_OPTIONS.join(', ')}`);
      if (changes.stepDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(changes.stepDeadline))
        throw new ToolError('step_deadline в формате YYYY-MM-DD');
      if (changes.ownerId && !/^\d+$/.test(changes.ownerId))
        throw new ToolError('owner_id должен быть числом');

      const projects = await loadProjects(cookie);
      const project = projects.find((item) => item.id === projectId);
      if (!project) throw new ToolError('Проект не найден');
      // PUT заменяет запись целиком: сначала текущие значения, поверх только переданные.
      const { statuses } = await callRoute(statusGet, '/api/projects/status', cookie);
      const current = (statuses as ProjectStatus[]).find((row) => row.projectId === projectId);
      const record = {
        projectId,
        client: current?.client || '',
        status: current?.status || '',
        goal: current?.goal || '',
        state: current?.state || '',
        step: current?.step || '',
        stepDeadline: current?.stepDeadline?.slice(0, 10) || '',
        risk: current?.risk || '',
        ownerId: current?.ownerId || '',
        ...changes,
      };
      const saved = await callRoute(
        statusPut,
        '/api/projects/status',
        cookie,
        {},
        {
          method: 'PUT',
          body: record,
        },
      );
      const person = await getSessionPerson(cookie);
      if (person)
        await audit(
          person.user.username,
          'mcp-project-status',
          `${projectId}: ${Object.keys(changes).join(',')}`,
        );
      return { project: project.name, saved: saved.status, url: project.url };
    },
  },
];
