// Гант проекта: где полоса начинается и кончается, и связи «финиш → старт» из портала.

export type GanttLink = { from: string; to: string; type: string };

const DAY = 86_400_000;

/**
 * Полоса задачи. Плановые даты есть у немногих задач, поэтому без них берём создание и срок,
 * как портал рисует задачу без плана. Без срока полоса в один день от начала.
 */
export function ganttSpan(task: {
  planStart?: string;
  planEnd?: string;
  createdDate?: string;
  dueDate?: string;
}): { start: number; end: number; planned: boolean } | null {
  const time = (value?: string) => {
    const parsed = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  };
  const planStart = time(task.planStart);
  const planEnd = time(task.planEnd);
  if (planStart !== null && planEnd !== null && planEnd >= planStart)
    return { start: planStart, end: planEnd, planned: true };
  const start = planStart ?? time(task.createdDate);
  const end = planEnd ?? time(task.dueDate);
  if (start === null && end === null) return null;
  const from = start ?? end! - DAY;
  const to = end !== null && end >= from ? end : from + DAY;
  return { start: from, end: to, planned: false };
}

// Ответ tasks.task.gantt.link.list (REST v3): taskId предшественник, dependentId зависимая.
export function normalizeLinks(raw: unknown): GanttLink[] {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.items)
      ? (raw as any).items
      : [];
  return items
    .map((item: any) => ({
      from: String(item?.taskId ?? ''),
      to: String(item?.dependentId ?? ''),
      type: String(item?.type || 'finish_start'),
    }))
    .filter((link: GanttLink) => link.from && link.to);
}
