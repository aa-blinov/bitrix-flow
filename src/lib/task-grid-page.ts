import { convertBxTask } from '@/store/kanban';
import { filterQueryParams } from '@/lib/task-filters';
import type { TaskGridPage, TaskGridPageQuery } from '@/components/TaskGrid';
import type { Bx24Task } from '@/lib/bitrix24';

// Один запрос страницы грида для всех экранов: раньше каждая страница
// собирала параметры и разбирала ответ своей копией кода.
export async function fetchTaskGridPage(
  request: TaskGridPageQuery,
  extra: Record<string, string> = {},
): Promise<TaskGridPage> {
  const params = new URLSearchParams({
    ...filterQueryParams(request.filters),
    page: String(request.page),
    limit: String(request.limit),
    query: request.query,
    sorts: request.sorts.map((sort) => `${sort.key}:${sort.direction}`).join(','),
    hierarchy: String(request.hierarchy),
    groupBy: request.groupBy,
    ...extra,
  });
  const response = await fetch(`/api/tasks/all?${params.toString()}`);
  if (!response.ok) throw new Error(`tasks/all HTTP ${response.status}`);
  const data = await response.json();
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return {
    // groupKey ставит сервер при группировке; convertBxTask о нём не знает.
    tasks: tasks.map((task: Bx24Task & { groupKey?: string }) => ({
      ...convertBxTask(task),
      groupKey: task.groupKey,
    })),
    ancestors: (Array.isArray(data.ancestors) ? data.ancestors : []).map(convertBxTask),
    total: Number(data.total) || 0,
    groups: Array.isArray(data.groups) ? data.groups : undefined,
  };
}
