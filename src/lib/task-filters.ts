// Словарь фильтров списка задач: типы, пустые значения и перевод в параметры
// /api/tasks/all. Живёт отдельно от UI, потому что одни и те же значения
// собирают и строка фильтров, и три страницы, которые ходят за страницей задач.

export type FilterFieldKey =
  | 'status'
  | 'deadline'
  | 'assignee'
  | 'creator'
  | 'accomplice'
  | 'auditor'
  | 'project'
  | 'stage'
  | 'tag'
  | 'priority'
  | 'hideDone';

export type FilterOption = { value: string; label: string; hint?: string };

export type FilterField = {
  key: FilterFieldKey;
  label: string;
  /** Значение «фильтр не задан»: чип для него не показываем. */
  empty: string;
  options: FilterOption[];
  /** Поле-переключатель: выбирается без списка значений. */
  toggle?: boolean;
  /** Как в Asana: одно поле можно фильтровать сразу по нескольким значениям. */
  multi?: boolean;
};

export type FilterValues = Record<FilterFieldKey, string>;

export type FilterPreset = {
  id: string;
  label: string;
  values: Partial<FilterValues>;
};

export const EMPTY_FILTERS: FilterValues = {
  status: 'all',
  deadline: 'all',
  assignee: 'all',
  creator: 'all',
  accomplice: 'all',
  auditor: 'all',
  project: 'all',
  stage: 'all',
  tag: 'all',
  priority: 'all',
  hideDone: 'off',
};

/** Значения мультиполя хранятся строкой «a,b,c» — так же уходят на сервер. */
export function splitValues(value: string, empty: string): string[] {
  return value === empty ? [] : value.split(',').filter(Boolean);
}

/** Имена параметров /api/tasks/all для каждого поля фильтра. */
const QUERY_KEYS: Record<Exclude<FilterFieldKey, 'hideDone'>, string> = {
  status: 'status',
  deadline: 'deadline',
  assignee: 'assigneeId',
  creator: 'creatorId',
  accomplice: 'accompliceId',
  auditor: 'auditorId',
  project: 'projectId',
  stage: 'stageId',
  tag: 'tag',
  priority: 'priority',
};

export function filterQueryParams(filters: FilterValues): Record<string, string> {
  const params: Record<string, string> = { hideDone: String(filters.hideDone === 'on') };
  for (const [key, name] of Object.entries(QUERY_KEYS)) {
    params[name] = filters[key as FilterFieldKey] ?? 'all';
  }
  return params;
}
