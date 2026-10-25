import { t } from '@/lib/i18n';
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
  | 'created'
  | 'changed'
  | 'overrun'
  | 'kind'
  | 'hideDone';

export type FilterOption = { value: string; label: string; hint?: string };

export type FilterPresetInput = { currentUserId?: string };

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
  created: 'all',
  changed: 'all',
  overrun: 'off',
  kind: 'all',
  hideDone: 'off',
};

/** Значения мультиполя хранятся строкой «a,b,c» — так же уходят на сервер. */
export function splitValues(value: string, empty: string): string[] {
  return value === empty ? [] : value.split(',').filter(Boolean);
}

/** Имена параметров /api/tasks/all для каждого поля фильтра. */
const QUERY_KEYS: Record<Exclude<FilterFieldKey, 'hideDone' | 'overrun'>, string> = {
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
  created: 'created',
  changed: 'changed',
  kind: 'kind',
};

export function filterQueryParams(filters: FilterValues): Record<string, string> {
  const params: Record<string, string> = {
    hideDone: String(filters.hideDone === 'on'),
    overrun: String(filters.overrun === 'on'),
  };
  for (const [key, name] of Object.entries(QUERY_KEYS)) {
    params[name] = filters[key as FilterFieldKey] ?? 'all';
  }
  return params;
}

// Набор полей строят и список, и доска: если собирать их в компонентах,
// фильтры снова разъедутся, как было до объединения.
export function taskFilterFields({
  users,
  tags,
  projects,
  stages,
  statusLabels,
}: {
  users: Array<{ id: string; name: string }>;
  tags: Array<{ tag: string; label: string; count: number }>;
  /** Только там, где список не привязан к одному проекту. */
  projects?: Array<{ id: string; name: string }>;
  /** Только в списке проекта: на доске стадии — это колонки. */
  stages?: Array<{ id: string; name: string }>;
  statusLabels: Record<string, string>;
}): FilterField[] {
  const userOptions = users.map((user) => ({ value: user.id, label: user.name }));
  return [
    {
      key: 'status',
      label: t('Статус'),
      empty: 'all',
      options: [
        { value: 'active', label: t('Активные') },
        ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
      ],
    },
    {
      // Срок отдельно от статуса: так можно спросить «в работе и просрочено».
      key: 'deadline',
      label: t('Срок'),
      empty: 'all',
      options: [
        { value: 'overdue', label: t('Просрочено') },
        { value: 'attention', label: t('Сегодня и завтра') },
        { value: 'week', label: t('На неделе') },
        { value: 'has', label: t('Есть срок') },
        { value: 'none', label: t('Без срока') },
      ],
    },
    {
      key: 'assignee',
      label: t('Исполнитель'),
      empty: 'all',
      multi: true,
      options: [{ value: 'none', label: t('Не назначен') }, ...userOptions],
    },
    { key: 'creator', label: t('Постановщик'), empty: 'all', multi: true, options: userOptions },
    {
      key: 'accomplice',
      label: t('Соисполнитель'),
      empty: 'all',
      multi: true,
      options: userOptions,
    },
    { key: 'auditor', label: t('Наблюдатель'), empty: 'all', multi: true, options: userOptions },
    ...(projects
      ? [
          {
            key: 'project' as const,
            label: t('Проект'),
            empty: 'all',
            multi: true,
            options: projects.map((project) => ({ value: project.id, label: project.name })),
          },
        ]
      : []),
    {
      key: 'tag',
      label: t('Тег'),
      empty: 'all',
      multi: true,
      options: tags.map((item) => ({
        value: item.tag,
        label: item.label,
        hint: `(${item.count})`,
      })),
    },
    ...(stages?.length
      ? [
          {
            key: 'stage' as const,
            label: t('Стадия'),
            empty: 'all',
            multi: true,
            options: stages.map((stage) => ({ value: stage.id, label: stage.name })),
          },
        ]
      : []),
    {
      key: 'priority',
      label: t('Приоритет'),
      empty: 'all',
      options: [
        { value: 'high', label: t('Высокий') },
        { value: 'normal', label: t('Обычный') },
        { value: 'low', label: t('Низкий') },
      ],
    },
    {
      key: 'created',
      label: t('Создана'),
      empty: 'all',
      options: [
        { value: 'today', label: t('Сегодня') },
        { value: 'week', label: t('За неделю') },
        { value: 'month', label: t('За месяц') },
      ],
    },
    {
      key: 'changed',
      label: t('Изменена'),
      empty: 'all',
      options: [
        { value: 'today', label: t('Сегодня') },
        { value: 'week', label: t('За неделю') },
        { value: 'month', label: t('За месяц') },
      ],
    },
    {
      key: 'kind',
      label: t('Тип задачи'),
      empty: 'all',
      options: [
        { value: 'root', label: t('Только корневые') },
        { value: 'subtask', label: t('Только подзадачи') },
      ],
    },
    {
      // Факт больше плана: где оценка не сошлась с реальностью.
      key: 'overrun',
      label: t('Переработка'),
      empty: 'off',
      toggle: true,
      options: [{ value: 'on', label: t('Переработка') }],
    },
    {
      key: 'hideDone',
      label: t('Скрыть закрытые'),
      empty: 'off',
      toggle: true,
      options: [{ value: 'on', label: t('Скрыть закрытые') }],
    },
  ];
}

export function taskFilterPresets(currentUserId?: string): FilterPreset[] {
  return [
    { id: 'mine', label: t('Мои'), values: { assignee: currentUserId || 'all' } },
    {
      id: 'created_by_me',
      label: t('Поставленные мной'),
      values: { creator: currentUserId || 'all' },
    },
    { id: 'overdue', label: t('Просроченные'), values: { deadline: 'overdue' } },
    { id: 'week', label: t('На неделе'), values: { deadline: 'week' } },
    { id: 'no_deadline', label: t('Без срока'), values: { deadline: 'none' } },
  ];
}

/** Ссылки приносят срок в параметре статуса (?status=overdue) — раскладываем. */
const DEADLINE_STATUSES = ['overdue', 'attention', 'week', 'no_deadline'];
export function initialFilterValues(
  status = 'all',
  assignee = 'all',
  project = 'all',
): FilterValues {
  const deadline = DEADLINE_STATUSES.includes(status)
    ? status === 'no_deadline'
      ? 'none'
      : status
    : 'all';
  return {
    ...EMPTY_FILTERS,
    status: deadline === 'all' ? status : 'all',
    deadline,
    assignee,
    project,
  };
}

/**
 * Сохранённые вью до объединения фильтров держали плоские поля
 * (statusFilter/assigneeFilter/...). Приводим их к общему набору один раз — в
 * API, чтобы клиент знал только актуальный формат.
 */
export function viewFilters(config: Record<string, unknown> | null | undefined): FilterValues {
  const saved = (config?.filters as Partial<FilterValues>) || {};
  const legacy = (key: string) =>
    typeof config?.[key] === 'string' ? (config[key] as string) : undefined;
  // Старый «статус» держал в себе и срок («week», «overdue»): раскладываем той
  // же функцией, что разбирает ссылки, иначе чип показал бы сырое значение.
  const legacyStatus = initialFilterValues(legacy('statusFilter') || EMPTY_FILTERS.status);
  return {
    ...EMPTY_FILTERS,
    ...saved,
    status: saved.status ?? legacyStatus.status,
    deadline: saved.deadline ?? legacyStatus.deadline,
    assignee: saved.assignee ?? legacy('assigneeFilter') ?? EMPTY_FILTERS.assignee,
    project: saved.project ?? legacy('projectFilter') ?? EMPTY_FILTERS.project,
    tag: saved.tag ?? legacy('tagFilter') ?? EMPTY_FILTERS.tag,
    hideDone: saved.hideDone ?? (config?.hideDone ? 'on' : EMPTY_FILTERS.hideDone),
  };
}

// Фильтры в ссылке: «status:active;assignee:9,15;deadline:overdue». Пишем
// только отличия от пустого набора — ссылка короткая и читаемая.
export function encodeFiltersParam(values: FilterValues): string {
  return (Object.keys(EMPTY_FILTERS) as FilterFieldKey[])
    .filter((key) => values[key] && values[key] !== EMPTY_FILTERS[key])
    .map((key) => `${key}:${values[key]}`)
    .join(';');
}

export function decodeFiltersParam(raw: string | null): Partial<FilterValues> {
  if (!raw) return {};
  const result: Partial<FilterValues> = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf(':');
    if (index <= 0) continue;
    const key = part.slice(0, index) as FilterFieldKey;
    const value = part.slice(index + 1).trim();
    // Неизвестные поля из чужой или старой ссылки молча пропускаем.
    if (key in EMPTY_FILTERS && value) result[key] = value;
  }
  return result;
}
