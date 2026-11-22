// Шаблоны задач портала: разбор tasks.template.list и параметры повтора (REPLICATE_PARAMS).

export type Recurrence =
  | { period: 'daily'; everyDay: number; workdayOnly: boolean; time: string }
  | { period: 'weekly'; weekDays: number[]; time: string }
  | { period: 'monthly'; monthDay: number; time: string };

export type TaskTemplate = {
  id: string;
  title: string;
  description: string;
  responsibleId: string;
  groupId: string;
  priority: string;
  accomplices: string[];
  auditors: string[];
  tags: string[];
  crm: string[];
  recurrence: Recurrence | null;
};

const ids = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const time = (value: unknown) => (/^\d{2}:\d{2}$/.test(String(value)) ? String(value) : '05:00');

// tasks.template.get отдаёт REPLICATE_PARAMS PHP-сериализованной строкой, а list пустым
// объектом. Повтор плоский: строки, числа и массив дней недели, их и достаём.
export function phpParams(value: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const entry = /s:\d+:"(\w+)";(?:s:\d+:"([^"]*)"|i:(-?\d+)|a:\d+:\{([^}]*)\}|N)/g;
  for (const [, key, text, int, list] of value.matchAll(entry))
    out[key] =
      text ?? (int !== undefined ? Number(int) : list !== undefined ? arrayValues(list) : null);
  return out;
}

// В массиве PHP ключи и значения чередуются: «i:0;i:3;i:1;i:5;» это [3, 5].
const arrayValues = (body: string) =>
  [...body.matchAll(/i:(-?\d+);/g)].map((match) => Number(match[1])).filter((_, i) => i % 2);

export function parseRecurrence(replicate: unknown, raw: any): Recurrence | null {
  const params = typeof raw === 'string' ? phpParams(raw) : raw;
  if (replicate !== 'Y' || !params || typeof params !== 'object') return null;
  if (params.PERIOD === 'weekly')
    return {
      period: 'weekly',
      weekDays: (params.WEEK_DAYS || []).map(Number),
      time: time(params.TIME),
    };
  if (params.PERIOD === 'monthly')
    return {
      period: 'monthly',
      monthDay: Number(params.MONTHLY_DAY_NUM) || 1,
      time: time(params.TIME),
    };
  return {
    period: 'daily',
    everyDay: Number(params.EVERY_DAY) || 1,
    workdayOnly: params.WORKDAY_ONLY === 'Y',
    time: time(params.TIME),
  };
}

export function normalizeTemplates(raw: any): TaskTemplate[] {
  const list = raw?.task_templates
    ? Object.values(raw.task_templates)
    : Array.isArray(raw)
      ? raw
      : [];
  return (list as any[])
    .map((item) => ({
      id: String(item?.ID ?? ''),
      title: String(item?.TITLE ?? ''),
      description: String(item?.DESCRIPTION ?? ''),
      responsibleId: String(item?.RESPONSIBLE_ID ?? ''),
      groupId: item?.GROUP_ID ? String(item.GROUP_ID) : '0',
      priority: String(item?.PRIORITY ?? '1'),
      accomplices: ids(item?.ACCOMPLICES),
      auditors: ids(item?.AUDITORS),
      tags: ids(item?.SE_TAG).filter(Boolean),
      crm: ids(item?.UF_CRM_TASK).filter(Boolean),
      recurrence: parseRecurrence(item?.REPLICATE, item?.REPLICATE_PARAMS),
    }))
    .filter((template) => template.id && template.title);
}

// Дата в формате портала «31.12.2026 00:00:00»: другой формат он молча не принимает.
export function portalDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} 00:00:00`;
}

/** Поля повтора для tasks.template.add/update: без конца, начиная с сегодня. */
export function replicateFields(recurrence: Recurrence | null, today = new Date()) {
  if (!recurrence) return { REPLICATE: 'N' };
  const common = {
    PERIOD: recurrence.period,
    TIME: recurrence.time,
    START_DATE: portalDay(today),
    REPEAT_TILL: 'endless',
  };
  const params =
    recurrence.period === 'daily'
      ? {
          ...common,
          EVERY_DAY: recurrence.everyDay,
          WORKDAY_ONLY: recurrence.workdayOnly ? 'Y' : 'N',
        }
      : recurrence.period === 'weekly'
        ? { ...common, EVERY_WEEK: 1, WEEK_DAYS: recurrence.weekDays }
        : {
            ...common,
            MONTHLY_TYPE: 1,
            MONTHLY_DAY_NUM: recurrence.monthDay,
            MONTHLY_MONTH_NUM_1: 1,
          };
  return { REPLICATE: 'Y', REPLICATE_PARAMS: params };
}
