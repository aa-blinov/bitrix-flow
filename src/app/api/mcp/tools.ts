// Тулы MCP. Они не дублируют логику, а зовут те же роуты, что и интерфейс, с сессией владельца
// токена: фильтры, ранжирование поиска и проверки доступа остаются в одном месте. Цель MCP это
// ответы о состоянии работы, а не сырые задачи (сырой Битрикс уже есть в bx24 MCP), поэтому
// единственная запись здесь это реестр статусов проектов: его ведёт BitrixFlow.
import { NextRequest } from 'next/server';
import { GET as tasksAll } from '@/app/api/tasks/all/route';
import { GET as myPlan } from '@/app/api/my-plan/route';
import { GET as dashboard } from '@/app/api/dashboard/route';
import { GET as projectsSummary } from '@/app/api/projects/summary/route';
import {
  DELETE as statusDelete,
  GET as statusGet,
  PUT as statusPut,
} from '@/app/api/projects/status/route';
import { GET as reportGet } from '@/app/api/reports/[kind]/route';
import { GET as hoursGet } from '@/app/api/analytics/hours/route';
import { GET as workloadGet } from '@/app/api/workload/summary/route';
import { HOUR_CLASS_TAG, type HourClass } from '@/lib/hour-class';
import type { HourRow } from '@/lib/hours';
import { mondayFor } from '@/lib/planned-hours';
import { PM_REPORTS, PRESETS, REASON, STATE, STATUS } from '@/lib/pm-report-meta';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { REPORT_KINDS, type ReportKind } from '@/lib/pm-reports-data';
import type { ReportRow } from '@/lib/pm-reports';
import { isDay } from '@/lib/report-period';
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
  write?: { method: 'PUT' | 'DELETE'; body?: unknown },
) {
  const url = new URL(path, 'http://mcp.local');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await handler(
    new NextRequest(url, {
      method: write?.method || 'GET',
      headers: {
        cookie: `${sessionCookie.name}=${cookie}`,
        ...(write?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: write?.body !== undefined ? JSON.stringify(write.body) : undefined,
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
  users: { id: string | number; name: string; email?: string }[];
  hiddenUsers?: { id: string | number; name: string }[];
  currentUser?: { id: string | number; name: string } | null;
};

const peopleOf = (directory: Directory) =>
  new Map(
    [...(directory.users || []), ...(directory.hiddenUsers || [])].map((user) => [
      String(user.id),
      user.name,
    ]),
  );
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
  const people = peopleOf(directory);
  const status = new Map((statuses.statuses || []).map((row) => [row.projectId, row]));
  const metrics = new Map((summary.projects || []).map((row) => [String(row.id), row]));
  return Object.assign(
    (directory.projects || []).map((project) => {
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
    }),
    { people },
  );
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
  owner_id: { key: 'ownerId', description: 'ID ответственного сейчас, его даёт find_user' },
} as const;

// Справочник людей и проектов для подписей: отчёты и часы отдают только ID.
async function names(cookie: string) {
  const directory = (await callRoute(dashboard, '/api/dashboard', cookie)) as Directory;
  const projects = new Map((directory.projects || []).map((p) => [String(p.id), p.name]));
  const people = peopleOf(directory);
  return {
    project: (value: unknown) =>
      String(value ?? '') === NO_PROJECT_ID
        ? NO_PROJECT_NAME
        : value
          ? projects.get(String(value)) || `#${value}`
          : null,
    person: (value: unknown) => (value ? people.get(String(value)) || `#${value}` : null),
  };
}

// Период по умолчанию как у экрана отчёта; свой период проверяется той же функцией, что в роуте.
function period(args: Args, preset: keyof typeof PRESETS) {
  const from = typeof args.from === 'string' ? args.from : '';
  const to = typeof args.to === 'string' ? args.to : '';
  if (!from && !to) return PRESETS[preset]();
  if (!isDay(from) || !isDay(to) || from > to)
    throw new ToolError('from и to в формате YYYY-MM-DD, from не позже to');
  return { from, to };
}

const HOUR_CLASS_LABEL = (value: string) =>
  value in HOUR_CLASS_TAG ? HOUR_CLASS_TAG[value as HourClass].replace(/^часы-/, '') : 'без класса';

function countBy(rows: ReportRow[], key: string, name: (value: unknown) => string | null) {
  if (!rows.some((row) => key in row)) return undefined;
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(String(row[key] ?? ''), (counts.get(String(row[key] ?? '')) || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 15)
    .map(([value, count]) => ({ name: name(value) || 'Не назначен', count }));
}

const REPORT_LEGEND = REPORT_KINDS.map(
  (kind) => `${kind}: ${PM_REPORTS[kind].title()}. ${PM_REPORTS[kind].description()}`,
).join('\n');

const PERIOD_PROPS = {
  from: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
  to: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
};

export const TOOLS: Tool[] = [
  {
    name: 'search_tasks',
    description:
      'Поиск и выборка задач Bitrix24 из зеркала BitrixFlow. По словам в названии, описании, ' +
      'проекте и исполнителе или по номеру (лучшие совпадения первыми) и/или по фильтрам: ' +
      'исполнитель, проект, статус, срок. Без query работает как список по фильтрам, сначала ' +
      'свежие (с фильтром срока: ближайшие сроки первыми). ID людей даёт find_user, свой ID whoami. ' +
      'Описание задачи отдаёт get_task. Для вопросов про зависшие задачи, перерасход, сроки ' +
      'закрытия и закрытые без списаний бери report: там готовый расчёт по последней активности, ' +
      'а не перебор задач.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Слова или номер задачи' },
        responsible_id: {
          type: 'string',
          description: 'ID исполнителя, можно несколько через запятую',
        },
        project_id: { type: 'string', description: 'ID проекта (группы)' },
        status: {
          type: 'string',
          enum: ['active', 'new', 'in_progress', 'testing', 'done', 'deferred'],
          description: 'active это все незавершённые; testing это ждёт контроля',
        },
        deadline: {
          type: 'string',
          enum: ['overdue', 'week', 'none'],
          description:
            'overdue просрочены, week срок в ближайшие 7 дней, none без срока (незавершённые)',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    async run(args, cookie) {
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : '';
      const params: Record<string, string> = { limit: String(limitOf(args.limit, 20)) };
      if (query) Object.assign(params, { query, rank: 'true' });
      if (args.responsible_id !== undefined) {
        const ids = String(args.responsible_id)
          .split(',')
          .map((item) => id(item.trim()));
        if (!ids.length || ids.some((item) => !item))
          throw new ToolError('responsible_id: числовые ID через запятую');
        params.assigneeId = ids.join(',');
      }
      if (args.project_id !== undefined) {
        if (!id(args.project_id)) throw new ToolError('project_id должен быть числом');
        params.projectId = id(args.project_id);
      }
      if (typeof args.status === 'string') params.status = args.status;
      if (typeof args.deadline === 'string') {
        params.deadline = args.deadline;
        if (!query && args.deadline !== 'none')
          Object.assign(params, { sortKey: 'deadline', sortDirection: 'asc' });
      }
      if (Object.keys(params).length === 1)
        throw new ToolError('Нужен query или хотя бы один фильтр');
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
      'Личный план владельца токена («Мой план» Bitrix24): стадии и незавершённые задачи в каждой. ' +
      'В план попадают все задачи, где человек участник, не только исполнитель: поле mine ' +
      'показывает, исполнитель ли он сам, responsible это кто исполняет.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, cookie) {
      const [data, person] = await Promise.all([
        callRoute(myPlan, '/api/my-plan', cookie),
        getSessionPerson(cookie),
      ]);
      // План портала отдаёт только номер и название. Исполнителя берём из зеркала: без него
      // агент советовал человеку чужие задачи, где тот лишь постановщик или наблюдатель.
      const ids = (data.stages || []).flatMap((stage: any) => stage.tasks.map((t: any) => t.id));
      const mirrored = person
        ? await (
            await getDb()
          )
            .collection('task_mirror')
            .find(
              { member_id: person.memberId, id: { $in: ids } },
              {
                projection: {
                  id: 1,
                  'data.responsible': 1,
                  'data.responsibleId': 1,
                  'data.status': 1,
                },
              },
            )
            .toArray()
        : [];
      const byId = new Map(mirrored.map((doc) => [String(doc.id), doc.data || {}]));
      return (data.stages || []).map((stage: any) => ({
        stage: stage.title,
        tasks: stage.tasks.map((task: any) => {
          const known = byId.get(String(task.id));
          const responsibleId = String(known?.responsible?.id || known?.responsibleId || '');
          return {
            ...task,
            title: decodeEntities(String(task.title || '')),
            status: known?.status ? mapBitrixTaskStatus(String(known.status)) : undefined,
            responsible: known?.responsible?.name || null,
            mine: responsibleId ? responsibleId === person?.userId : null,
            url: taskLink(task.id),
          };
        }),
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
      // Старые записи истории знают только портал: для них «кто» неизвестен.
      const timeline = (history.timeline || []).slice(0, 30).map((entry: any) => ({
        at: entry.at,
        by: entry.userId
          ? { id: entry.userId, name: projects.people.get(entry.userId) || null }
          : null,
        changes: entry.changes,
      }));
      return { ...project, history: timeline };
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

  {
    name: 'delete_project_status',
    description:
      'Удалить запись проекта из реестра статусов: из списка портала и из BitrixFlow. Сам проект ' +
      'и задачи не трогает. История правок остаётся, в неё пишется событие удаления. Чтобы ' +
      'только очистить поля, используй update_project_status с пустыми строками.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'ID проекта (группы Битрикса)' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async run(args, cookie) {
      const projectId = id(args.project_id);
      if (!projectId) throw new ToolError('project_id должен быть числом');
      const { statuses } = await callRoute(statusGet, '/api/projects/status', cookie);
      if (!(statuses as ProjectStatus[]).some((row) => row.projectId === projectId))
        throw new ToolError('У проекта нет записи в реестре');
      await callRoute(
        statusDelete,
        '/api/projects/status',
        cookie,
        { project_id: projectId },
        {
          method: 'DELETE',
        },
      );
      const person = await getSessionPerson(cookie);
      if (person) await audit(person.user.username, 'mcp-project-status-delete', projectId);
      return { deleted: projectId };
    },
  },

  {
    name: 'whoami',
    description:
      'Кто владелец токена: ID и имя в Битриксе. Нужен для вопросов «мои задачи», «где я ответственный».',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, cookie) {
      const person = await getSessionPerson(cookie);
      if (!person) throw new ToolError('MEMBER_ID_REQUIRED');
      const directory = (await callRoute(dashboard, '/api/dashboard', cookie)) as Directory;
      return {
        id: person.userId,
        name: peopleOf(directory).get(person.userId) || person.user.display_name || null,
        login: person.user.username,
        role: person.user.role,
      };
    },
  },
  {
    name: 'find_user',
    description:
      'Найти сотрудника портала по имени, фамилии или почте и получить его ID: для фильтра ' +
      'search_tasks и поля owner_id в update_project_status.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Имя, фамилия или почта' } },
      required: ['query'],
      additionalProperties: false,
    },
    async run(args, cookie) {
      const words = (typeof args.query === 'string' ? args.query : '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .split(/\s+/)
        .filter(Boolean);
      if (!words.length) throw new ToolError('query обязателен');
      const directory = (await callRoute(dashboard, '/api/dashboard', cookie)) as Directory;
      const norm = (value: string) => value.toLowerCase().replace(/ё/g, 'е');
      // Каждое слово должно встретиться: «юлия поп» находит «Юлия Попондопуло».
      return (directory.users || [])
        .filter((user) => {
          const hay = norm(`${user.name} ${user.email || ''}`);
          return words.every((word) => hay.includes(word));
        })
        .slice(0, 20)
        .map((user) => ({ id: String(user.id), name: user.name, email: user.email || null }));
    },
  },

  {
    name: 'report',
    description:
      'Отчёт ПМ, те же цифры, что на экране «Отчёты». Плитки это итоги, таблицы это строки по ' +
      'задачам или людям (по умолчанию первые 30, total показывает сколько всего). Без периода ' +
      'берётся период экрана по умолчанию. Виды:\n' +
      REPORT_LEGEND,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...REPORT_KINDS] },
        ...PERIOD_PROPS,
        project_id: { type: 'string', description: 'ID проекта (для client обязателен)' },
        idle_days: {
          type: 'integer',
          minimum: 1,
          description: 'Для stale: сколько дней без активности считать зависанием, по умолчанию 14',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async run(args, cookie) {
      const kind = String(args.kind) as ReportKind;
      if (!REPORT_KINDS.includes(kind))
        throw new ToolError(`kind: одно из ${REPORT_KINDS.join(', ')}`);
      const meta = PM_REPORTS[kind];
      const range = period(args, meta.defaultPeriod);
      const params: Record<string, string> = { ...range };
      if (args.project_id !== undefined) {
        if (!id(args.project_id)) throw new ToolError('project_id должен быть числом');
        params.project = id(args.project_id);
      }
      if (meta.needsProject && !params.project)
        throw new ToolError('Этот отчёт строится по одному проекту: передай project_id');
      if (args.idle_days !== undefined)
        params.days = String(Math.trunc(Number(args.idle_days)) || 14);
      const [data, label] = await Promise.all([
        callRoute(
          (req) => reportGet(req, { params: Promise.resolve({ kind }) }),
          `/api/reports/${kind}`,
          cookie,
          params,
        ),
        names(cookie),
      ]);
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(args.limit)) || 30));
      const tileMeta = new Map(meta.tiles.map((tile) => [tile.id, tile]));
      return {
        report: meta.title(),
        period: range,
        project: params.project ? label.project(params.project) : null,
        tiles: (data.tiles || []).map((tile: { id: string; value: number | null }) => ({
          name: tileMeta.get(tile.id)?.label() || tile.id,
          value:
            tileMeta.get(tile.id)?.kind === 'percent' && typeof tile.value === 'number'
              ? `${Math.round(tile.value * 1000) / 10}%`
              : tile.value,
          unit: tileMeta.get(tile.id)?.kind === 'percent' ? undefined : tileMeta.get(tile.id)?.kind,
          hint: tileMeta.get(tile.id)?.hint?.() || undefined,
        })),
        tables: (data.tables || []).map((table: { id: string; rows: ReportRow[] }) => {
          const tableMeta = meta.tables.find((item) => item.id === table.id);
          return {
            title: tableMeta?.title() || table.id,
            columns: Object.fromEntries(
              (tableMeta?.columns || []).map((column) => [column.id, column.label()]),
            ),
            total: table.rows.length,
            // Раскладка по всем строкам, а не по показанным: на «сколько у кого» агенту не
            // нужно тянуть сотни строк и считать самому.
            byProject: countBy(table.rows, 'projectId', label.project),
            byResponsible: countBy(table.rows, 'responsibleId', label.person),
            rows: table.rows.slice(0, limit).map((row) => {
              const { filters: _filters, ...rest } = row;
              const out: Record<string, unknown> = { ...rest };
              // Коды ячеек в слова, как на экране: open, idle и 0.125 модель читала буквально.
              for (const column of tableMeta?.columns || []) {
                const value = row[column.id];
                if (value === null || value === undefined) continue;
                if (column.kind === 'status') out[column.id] = STATUS[String(value)]?.() || value;
                if (column.kind === 'state') out[column.id] = STATE[String(value)]?.() || value;
                if (column.kind === 'reasons')
                  out[column.id] = String(value)
                    .split(',')
                    .map((reason) => REASON[reason]?.() || reason)
                    .join(', ');
                if (column.kind === 'percent' && typeof value === 'number')
                  out[column.id] = `${Math.round(value * 1000) / 10}%`;
              }
              if ('projectId' in row) out.project = label.project(row.projectId);
              if ('responsibleId' in row) out.responsible = label.person(row.responsibleId);
              if ('userId' in row) out.user = label.person(row.userId);
              if (row.taskId) out.url = taskLink(String(row.taskId));
              return out;
            }),
          };
        }),
        notes: [...(data.notes || []), ...(meta.notes ? [meta.notes()] : [])],
      };
    },
  },
  {
    name: 'hours',
    description:
      'Списанные часы за период с разбивкой: по проектам, людям, классам часов (коммерция, ' +
      'брак, внутреннее, пресейл, прочее), месяцам или задачам. Те же данные, что в «Аналитике ' +
      'часов»; служебные учётки исключены. Без периода текущий месяц.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PERIOD_PROPS,
        group_by: {
          type: 'string',
          enum: ['project', 'user', 'class', 'month', 'task'],
          default: 'project',
        },
        project_id: { type: 'string', description: 'Только этот проект' },
        user_id: { type: 'string', description: 'Только этот человек' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    async run(args, cookie) {
      const range = period(args, 'month');
      const groupBy = typeof args.group_by === 'string' ? args.group_by : 'project';
      if (!['project', 'user', 'class', 'month', 'task'].includes(groupBy))
        throw new ToolError('group_by: project, user, class, month или task');
      const [data, label] = await Promise.all([
        callRoute(hoursGet, '/api/analytics/hours', cookie, range),
        names(cookie),
      ]);
      const rows = ((data.rows || []) as HourRow[]).filter(
        (row) =>
          (args.project_id === undefined || row.projectId === id(args.project_id)) &&
          (args.user_id === undefined || row.userId === id(args.user_id)),
      );
      const groups = new Map<string, { name: string | null; hours: number; extra?: object }>();
      for (const row of rows) {
        const key =
          groupBy === 'project'
            ? row.projectId
            : groupBy === 'user'
              ? row.userId
              : groupBy === 'class'
                ? row.hourClass
                : groupBy === 'month'
                  ? row.month
                  : row.taskId;
        const group = groups.get(key) || {
          name:
            groupBy === 'project'
              ? label.project(row.projectId)
              : groupBy === 'user'
                ? label.person(row.userId)
                : groupBy === 'class'
                  ? HOUR_CLASS_LABEL(row.hourClass)
                  : groupBy === 'task'
                    ? decodeEntities(row.task)
                    : row.month,
          hours: 0,
          ...(groupBy === 'task'
            ? { extra: { project: label.project(row.projectId), url: taskLink(row.taskId) } }
            : {}),
        };
        group.hours += row.hours;
        groups.set(key, group);
      }
      const round = (value: number) => Math.round(value * 100) / 100;
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(args.limit)) || 50));
      const sorted = [...groups.entries()]
        .map(([key, group]) => ({
          id: key,
          name: group.name,
          hours: round(group.hours),
          ...group.extra,
        }))
        .sort((a, b) => (groupBy === 'month' ? a.id.localeCompare(b.id) : b.hours - a.hours));
      const plans = data.projectPlans || {};
      return {
        period: range,
        totalHours: round(rows.reduce((sum, row) => sum + row.hours, 0)),
        groups: sorted
          .slice(0, limit)
          .map((group) =>
            groupBy === 'project' && plans[group.id] !== undefined
              ? { ...group, planHours: round(plans[group.id]) }
              : group,
          ),
        totalGroups: sorted.length,
        // Неполные данные надо видеть: без этого агент выдаст заниженные часы за точные.
        warnings: [
          ...(data.missingWeeks?.length
            ? [`Нет собранных списаний за недели: ${data.missingWeeks.join(', ')}`]
            : []),
          ...(data.partialWeeks?.length
            ? [`Недели собраны с пропусками, часы занижены: ${data.partialWeeks.join(', ')}`]
            : []),
          ...(data.refreshing ? ['Идёт сбор списаний из портала, цифры могут обновиться'] : []),
        ],
        collectedAt: data.oldestCollectedAt || data.collectedAt || null,
      };
    },
  },
  {
    name: 'workload',
    description:
      'Нагрузка команды на неделю по срокам открытых задач: у кого сколько задач и оценённых ' +
      'часов приходится на каждый день недели, сколько просрочено и сколько без срока. Те же ' +
      'цифры, что на экране «Нагрузка». Неделя с понедельника, по умолчанию текущая.',
    inputSchema: {
      type: 'object',
      properties: {
        week: { type: 'string', description: 'Любой день нужной недели, YYYY-MM-DD' },
        project_id: { type: 'string', description: 'Только этот проект' },
      },
      additionalProperties: false,
    },
    async run(args, cookie) {
      const day =
        typeof args.week === 'string'
          ? args.week
          : new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
      if (!isDay(day)) throw new ToolError('week в формате YYYY-MM-DD');
      const start = mondayFor(day);
      const params: Record<string, string> = { start };
      if (args.project_id !== undefined) {
        if (!id(args.project_id)) throw new ToolError('project_id должен быть числом');
        params.projectId = id(args.project_id);
      }
      const [data, label] = await Promise.all([
        callRoute(workloadGet, '/api/workload/summary', cookie, params),
        names(cookie),
      ]);
      type Bucket = { userId: string; count: number; hours: number; day?: string };
      const people = new Map<string, Record<string, any>>();
      const personOf = (userId: string) => {
        if (!people.has(userId))
          people.set(userId, {
            id: userId,
            name: userId === 'unassigned' ? 'Не назначен' : label.person(userId),
            week: { tasks: 0, hours: 0 },
            days: {} as Record<string, { tasks: number; hours: number }>,
            overdue: { tasks: 0, hours: 0 },
            noDeadline: { tasks: 0, hours: 0 },
          });
        return people.get(userId)!;
      };
      for (const bucket of (data.days || []) as Bucket[]) {
        const entry = personOf(bucket.userId);
        entry.days[bucket.day!] = { tasks: bucket.count, hours: bucket.hours };
        entry.week.tasks += bucket.count;
        entry.week.hours += bucket.hours;
      }
      for (const bucket of (data.overdue || []) as Bucket[])
        personOf(bucket.userId).overdue = { tasks: bucket.count, hours: bucket.hours };
      for (const bucket of (data.noDeadline || []) as Bucket[])
        personOf(bucket.userId).noDeadline = { tasks: bucket.count, hours: bucket.hours };
      return {
        week: {
          from: start,
          to: new Date(new Date(`${start}T12:00:00Z`).getTime() + 6 * 86_400_000)
            .toISOString()
            .slice(0, 10),
        },
        project: params.projectId ? label.project(params.projectId) : null,
        people: [...people.values()].sort((a, b) => b.week.hours - a.week.hours),
        note: 'Часы это оценки задач со сроком в этот день; задачи без оценки считаются в tasks, но не в hours.',
      };
    },
  },
];
