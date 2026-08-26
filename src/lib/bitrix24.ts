// Используем in-memory fallback для клиента, MongoDB для сервера
const isClient = typeof window !== 'undefined';

// In-memory кеш для клиента
const memoryCache = new Map<string, { data: any; expires: number }>();

async function cacheGet<T>(key: string): Promise<T | null> {
  if (isClient) {
    const item = memoryCache.get(key);
    if (!item || item.expires < Date.now()) return null;
    return item.data as T;
  }
  const { cacheGet } = await import('./mongo');
  return cacheGet<T>(key);
}

async function cacheSet<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  if (isClient) {
    memoryCache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 });
    return;
  }
  const { cacheSet } = await import('./mongo');
  return cacheSet(key, data, ttlSeconds);
}

async function cacheInvalidate(key: string): Promise<void> {
  if (isClient) {
    memoryCache.delete(key);
    return;
  }
  const { cacheInvalidate } = await import('./mongo');
  return cacheInvalidate(key);
}

async function cacheInvalidateByPrefix(prefix: string): Promise<void> {
  if (isClient) {
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) memoryCache.delete(key);
    }
    return;
  }
  const { cacheInvalidateByPrefix } = await import('./mongo');
  return cacheInvalidateByPrefix(prefix);
}

async function stagesCacheGet(entityId: string): Promise<any[] | null> {
  if (isClient) {
    const item = memoryCache.get(`stages:${entityId}`);
    if (!item || item.expires < Date.now()) return null;
    return item.data;
  }
  const { stagesCacheGet } = await import('./mongo');
  return stagesCacheGet(entityId);
}

async function stagesCacheSet(entityId: string, stages: any[]): Promise<void> {
  if (isClient) {
    memoryCache.set(`stages:${entityId}`, { data: stages, expires: Date.now() + 10 * 60 * 1000 });
    return;
  }
  const { stagesCacheSet } = await import('./mongo');
  return stagesCacheSet(entityId, stages);
}

async function tasksCacheGet(groupId: string): Promise<any[] | null> {
  if (isClient) {
    const item = memoryCache.get(`tasks:${groupId}`);
    if (!item || item.expires < Date.now()) return null;
    return item.data;
  }
  const { tasksCacheGet } = await import('./mongo');
  return tasksCacheGet(groupId);
}

async function tasksCacheSet(groupId: string, tasks: any[]): Promise<void> {
  if (isClient) {
    memoryCache.set(`tasks:${groupId}`, { data: tasks, expires: Date.now() + 30 * 1000 });
    return;
  }
  const { tasksCacheSet } = await import('./mongo');
  return tasksCacheSet(groupId, tasks);
}

async function taskInvalidate(taskId: string): Promise<void> {
  if (!isClient) {
    const { taskInvalidate } = await import('./mongo');
    return taskInvalidate(taskId);
  }
}

const WEBHOOK_URL = '/api/bitrix/';

export interface Bx24Task {
  id: string;
  title: string;
  description: string;
  status: string;
  subStatus: string;
  priority: string;
  createdDate: string;
  changedDate: string;
  deadline?: string;
  timeEstimate: number;
  timeSpentInLogs: number;
  groupId: string;
  groupName: string;
  responsibleId: string;
  responsibleName: string;
  responsibleIcon?: string;
  creatorId: string;
  creatorName: string;
  commentsCount: number;
  parentId?: string;
  stageId: string;
  stageName: string;
}

export interface Bx24Project {
  id: string;
  name: string;
  description: string;
  membersCount: number;
  image?: string;
}

export interface Bx24Stage {
  id: string;
  name: string;
  color: string;
  sort: number;
  systemType: string; // NEW, PROCESS, SUCCESS, etc.
  entityId: string;
}

export interface Bx24Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdDate: string;
}

export interface Bx24TimeEntry {
  id: string;
  userId: string;
  userName: string;
  date: string;
  seconds: number;
  description: string;
}

export interface Bx24User {
  id: string;
  name: string;
  email?: string;
  icon?: string;
}

const TASK_LIST_FIELDS = [
  'ID',
  'TITLE',
  'DESCRIPTION',
  'STATUS',
  'SUB_STATUS',
  'PRIORITY',
  'CREATED_DATE',
  'CHANGED_DATE',
  'DEADLINE',
  'TIME_ESTIMATE',
  'TIME_SPENT_IN_LOGS',
  'GROUP_ID',
  'GROUP_NAME',
  'RESPONSIBLE_ID',
  'RESPONSIBLE_NAME',
  'CREATED_BY',
  'PARENT_ID',
  'STAGE_ID',
];

function addTaskListFields(params: Record<string, string>) {
  TASK_LIST_FIELDS.forEach((field, index) => {
    params[`select[${index}]`] = field;
  });
}

export function mapBxPriority(priority: string): 'low' | 'medium' | 'high' | 'critical' {
  const p = parseInt(priority);
  if (p >= 4) return 'critical';
  if (p >= 2) return 'high';
  if (p >= 1) return 'medium';
  return 'low';
}

const UI_TO_BITRIX_PRIORITY: Record<string, string> = {
  low: '0',
  medium: '1',
  high: '2',
  // Bitrix24 REST has three levels only: 0 low, 1 medium, 2 high.
  critical: '2',
};

function toBitrixPriority(priority?: string): string {
  return UI_TO_BITRIX_PRIORITY[priority || ''] || priority || '1';
}

export function secondsToHours(seconds: number): number {
  return Math.round((seconds || 0) / 36) / 100;
}

export function hoursToSeconds(hours: number): number {
  return Math.round(hours * 3600);
}

// Получить member_id текущего пользователя из localStorage или URL
export function getMemberId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('member_id');
    if (fromUrl) {
      localStorage.setItem('bitrix_member_id', fromUrl);
      return fromUrl;
    }
    return localStorage.getItem('bitrix_member_id') || '';
  } catch {
    return '';
  }
}

async function bx24(method: string, params: Record<string, string> = {}): Promise<any> {
  const formData = new URLSearchParams(params).toString();
  const memberId = getMemberId();

  // Без retry - сразу вызываем
  const res = await fetch(WEBHOOK_URL + method, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Member-Id': memberId,
    },
    body: formData,
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return data.result;
}

// Пользователи (кеш 5 минут)
export async function fetchUsers(): Promise<Bx24User[]> {
  const cached = await cacheGet<Bx24User[]>('users:all');
  if (cached) return cached;

  try {
    const result = await bx24('user.get', { ACTIVE: 'true' });
    const users = (result || []).map((u: any): Bx24User => ({
      id: u.ID,
      name: `${u.NAME} ${u.LAST_NAME || ''}`.trim(),
      email: u.EMAIL,
      icon: u.PERSONAL_PHOTO,
    }));
    await cacheSet('users:all', users, 5 * 60);
    return users;
  } catch {
    return [];
  }
}

// Все проекты - кеш 5 минут в MongoDB
export async function fetchProjectList(): Promise<Bx24Project[]> {
  const cached = await cacheGet<Bx24Project[]>('projects:list:v2');
  if (cached) return cached;

  const groupsMap = new Map<string, Bx24Project>();

  try {
    const result = await bx24('sonet_group.get.json', {});
    for (const g of result || []) {
      groupsMap.set(g.ID, {
        id: g.ID,
        name: g.NAME || 'Project',
        description: g.DESCRIPTION || '',
        membersCount: parseInt(g.NUMBER_OF_MEMBERS) || 0,
        image: g.IMAGE || undefined,
      });
    }
  } catch (e) {
    console.warn('sonet_group.get failed:', e);
  }

  const projects = Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  await cacheSet('projects:list:v2', projects, 5 * 60);
  return projects;
}

// Стадии проекта - кеш 10 минут
export async function fetchProjectStages(entityId: string): Promise<Bx24Stage[]> {
  const cached = await stagesCacheGet(entityId);
  if (cached) {
    return cached.map(mapStage).sort((a, b) => a.sort - b.sort);
  }

  try {
    const result = await bx24('task.stages.get', { entityId });
    const stages = Object.values(result || {}) as any[];

    const mapped = stages.map(mapStage).sort((a, b) => a.sort - b.sort);

    await stagesCacheSet(entityId, stages);
    return mapped;
  } catch (e) {
    console.warn('task.stages.get failed:', e);
    return [];
  }
}

// The server proxy returns camelCase fields, while older cache records use
// Bitrix uppercase fields. Accept both so names never disappear after reload.
function mapStage(stage: any): Bx24Stage {
  return {
    id: stage.id || stage.ID,
    name: stage.name || stage.title || stage.TITLE || 'Без названия',
    color: stage.color || stage.COLOR || '47d1e2',
    sort: parseInt(stage.sort || stage.SORT) || 100,
    systemType: stage.systemType || stage.SYSTEM_TYPE || '',
    entityId: stage.entityId || stage.ENTITY_ID || '',
  };
}

// Задачи проекта с пагинацией и полной выборкой
export async function fetchTasksByProject(
  groupId: string,
  options: {
    limit?: number;
    offset?: number;
    status?: string; // active, all, completed
    filter?: {
      responsibleId?: string;
      priority?: string;
    };
  } = {},
): Promise<{ tasks: Bx24Task[]; hasMore: boolean; total: number }> {
  const { offset = 0, status = 'active', filter = {} } = options;

  const cacheKey = `tasks:v3:${groupId}:${offset}:${status}:${filter.responsibleId || ''}:${filter.priority || ''}`;

  // Для первой страницы - проверяем кеш MongoDB
  if (offset === 0 && status === 'all') {
    const cached = await tasksCacheGet(groupId);
    if (cached && cached.length > 0) {
      return { tasks: cached.map(mapTask), hasMore: false, total: cached.length };
    }
  }

  // In-memory кеш для быстрого доступа
  const cachedMem = await cacheGet<any>(cacheKey);
  if (cachedMem) return cachedMem;

  const params: Record<string, string> = {
    'order[ID]': 'DESC',
    start: offset.toString(),
  };
  addTaskListFields(params);

  if (groupId && groupId !== '0') params['filter[GROUP_ID]'] = groupId;
  if (filter.responsibleId) params['filter[RESPONSIBLE_ID]'] = filter.responsibleId;
  if (filter.priority) params['filter[PRIORITY]'] = filter.priority;

  // Активные задачи = незавершенные
  if (status === 'active') {
    params['filter[!STATUS]'] = '5';
  }

  try {
    const result = await bx24('tasks.task.list', params);
    const tasks = result.tasks || [];

    const mapped = tasks.map(mapTask);

    const result_data = {
      tasks: mapped,
      hasMore: result.next !== undefined && result.next !== null,
      total: Number(result.total) || tasks.length,
    };

    // Кешируем в MongoDB если это полная загрузка
    if (offset === 0 && status === 'all' && mapped.length > 0) {
      await tasksCacheSet(groupId, mapped as any);
    }

    // In-memory кеш 30 сек
    await cacheSet(cacheKey, result_data, 30);

    return result_data;
  } catch (e) {
    console.error('fetchTasksByProject failed:', e);
    return { tasks: [], hasMore: false, total: 0 };
  }
}

function mapTask(t: any): Bx24Task {
  return {
    id: t.id,
    title: t.title,
    description: t.description || '',
    status: t.status,
    subStatus: t.subStatus,
    priority: t.priority,
    createdDate: t.createdDate,
    changedDate: t.changedDate,
    deadline: t.deadline || undefined,
    timeEstimate: parseInt(t.timeEstimate) || 0,
    timeSpentInLogs: parseInt(t.timeSpentInLogs) || 0,
    groupId: t.groupId || t.group_id || '0',
    groupName: t.groupName || t.group_name || '',
    responsibleId: t.responsibleId || t.responsible_id || '',
    responsibleName: t.responsibleName || t.responsible_name || '',
    responsibleIcon: t.responsibleIcon,
    creatorId: t.creatorId || t.creator_id || '',
    creatorName: t.creatorName || t.creator_name || '',
    commentsCount: t.commentsCount || t.comments_count || 0,
    parentId: t.parentId,
    stageId: t.stageId || '0',
    stageName: '',
  };
}

// Поиск задач - кеш 30 секунд
export async function searchTasks(query: string): Promise<Bx24Task[]> {
  const key = `search:${query}`;
  const cached = await cacheGet<Bx24Task[]>(key);
  if (cached) return cached;

  try {
    const result = await bx24('tasks.task.list', {
      'order[ID]': 'DESC',
      start: '0',
      'filter[%TITLE]': query,
    });

    const tasks = (result.tasks || []).map((t: any): Bx24Task => mapTask(t));
    await cacheSet(key, tasks, 30);
    return tasks;
  } catch {
    return [];
  }
}

// Подзадачи
export async function fetchSubtasks(parentId: string): Promise<Bx24Task[]> {
  const key = `subtasks:${parentId}`;
  const cached = await cacheGet<Bx24Task[]>(key);
  if (cached) return cached;

  try {
    const result = await bx24('tasks.task.list', {
      'order[ID]': 'DESC',
      start: '0',
      'filter[PARENT_ID]': parentId,
    });

    const tasks = (result.tasks || []).map((t: any): Bx24Task => mapTask(t));
    await cacheSet(key, tasks, 60);
    return tasks;
  } catch {
    return [];
  }
}

// Комментарии
export async function fetchTaskComments(taskId: string): Promise<Bx24Comment[]> {
  const key = `comments:${taskId}`;
  const cached = await cacheGet<Bx24Comment[]>(key);
  if (cached) return cached;

  try {
    // New Bitrix task cards store comments in the linked IM chat.
    const taskResult = await bx24('tasks.task.get', { taskId });
    const task = taskResult?.task || taskResult;
    const chatId = task?.chatId || task?.CHAT_ID;
    if (!chatId) return [];
    const dialog = await bx24('im.dialog.messages.get', {
      DIALOG_ID: `chat${chatId}`,
      LIMIT: '50',
    });
    const comments = (dialog?.messages || []).map((message: any): Bx24Comment => ({
      id: String(message.id || message.ID),
      authorId: String(message.author_id || message.authorId || message.AUTHOR_ID || ''),
      authorName: message.author_name || message.authorName || 'Unknown',
      text: message.text || message.TEXT || '',
      createdDate: message.date || message.DATE || '',
    }));
    await cacheSet(key, comments, 60);
    return comments;
  } catch {
    return [];
  }
}

// Время по задаче
export async function fetchTaskTimeLog(taskId: string): Promise<Bx24TimeEntry[]> {
  const key = `time:${taskId}`;
  const cached = await cacheGet<Bx24TimeEntry[]>(key);
  if (cached) return cached;

  try {
    const result = await bx24('task.elapseditem.getlist', { TASKID: taskId });
    const entries = (result || []).map((el: any): Bx24TimeEntry => ({
      id: el.ID,
      userId: el.USER_ID,
      userName: el.USER_NAME || 'Unknown',
      date: el.DATE_PLAN || el.CREATED_DATE || '',
      seconds: parseInt(el.SECONDS) || 0,
      description: el.COMMENT_TEXT || '',
    }));
    await cacheSet(key, entries, 60);
    return entries;
  } catch {
    return [];
  }
}

// Обновление - инвалидирует кеш
export async function updateTaskStatus(
  taskId: string,
  status: string,
  subStatus: string,
): Promise<void> {
  await bx24('tasks.task.update', {
    taskId,
    fields: JSON.stringify({ status, subStatus }),
  });
  await cacheInvalidateByPrefix('tasks:');
  await cacheInvalidateByPrefix('subtasks:');
  await cacheInvalidateByPrefix('comments:');
  await cacheInvalidateByPrefix('time:');
  await taskInvalidate(taskId);
}

export async function updateTaskFull(taskId: string, fields: any): Promise<void> {
  const updateFields: Record<string, any> = {};

  if (fields.title !== undefined) updateFields.TITLE = fields.title;
  if (fields.description !== undefined) updateFields.DESCRIPTION = fields.description;
  if (fields.responsibleId !== undefined) updateFields.RESPONSIBLE_ID = fields.responsibleId;
  if (fields.priority !== undefined) updateFields.PRIORITY = toBitrixPriority(fields.priority);
  if (fields.deadline !== undefined) updateFields.DEADLINE = fields.deadline || null;
  if (fields.estimate !== undefined) updateFields.TIME_ESTIMATE = fields.estimate * 3600;
  if (fields.parentId !== undefined) updateFields.PARENT_ID = fields.parentId || 0;
  if (fields.stageId !== undefined) updateFields.STAGE_ID = fields.stageId;

  await bx24('tasks.task.update', {
    taskId,
    fields: JSON.stringify(updateFields),
  });
  await cacheInvalidateByPrefix('tasks:');
  await taskInvalidate(taskId);
}

export async function addTaskComment(taskId: string, text: string): Promise<string> {
  const result = await bx24('task.commentitem.add', {
    TASKID: taskId,
    'fields[POST_MESSAGE]': text,
  });
  await cacheInvalidate(`comments:${taskId}`);
  return result;
}

export async function addTimeEntry(
  taskId: string,
  seconds: number,
  description: string,
): Promise<void> {
  await bx24('task.elapseditem.add', {
    TASKID: taskId,
    'fields[SECONDS]': seconds.toString(),
    'fields[COMMENT_TEXT]': description,
  });
  await cacheInvalidate(`time:${taskId}`);
}

export async function createTask(fields: any): Promise<string> {
  const result = await bx24('tasks.task.add', {
    fields: JSON.stringify({
      TITLE: fields.title,
      DESCRIPTION: fields.description || '',
      GROUP_ID: fields.groupId || 0,
      RESPONSIBLE_ID: fields.responsibleId || 0,
      PRIORITY: toBitrixPriority(fields.priority),
      DEADLINE: fields.deadline || null,
      TIME_ESTIMATE: fields.estimate ? fields.estimate * 3600 : 0,
      PARENT_ID: fields.parentId || 0,
      STAGE_ID: fields.stageId || undefined,
    }),
  });
  await cacheInvalidateByPrefix('tasks:');
  return result.task.id;
}
