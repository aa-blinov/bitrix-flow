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
      label: 'Статус',
      empty: 'all',
      options: [
        { value: 'active', label: 'Активные' },
        ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
      ],
    },
    {
      // Срок отдельно от статуса: так можно спросить «в работе и просрочено».
      key: 'deadline',
      label: 'Срок',
      empty: 'all',
      options: [
        { value: 'overdue', label: 'Просрочено' },
        { value: 'attention', label: 'Сегодня и завтра' },
        { value: 'week', label: 'На неделе' },
        { value: 'has', label: 'Есть срок' },
        { value: 'none', label: 'Без срока' },
      ],
    },
    {
      key: 'assignee',
      label: 'Исполнитель',
      empty: 'all',
      multi: true,
      options: [{ value: 'none', label: 'Не назначен' }, ...userOptions],
    },
    { key: 'creator', label: 'Постановщик', empty: 'all', multi: true, options: userOptions },
    { key: 'accomplice', label: 'Соисполнитель', empty: 'all', multi: true, options: userOptions },
    { key: 'auditor', label: 'Наблюдатель', empty: 'all', multi: true, options: userOptions },
    ...(projects
      ? [
          {
            key: 'project' as const,
            label: 'Проект',
            empty: 'all',
            multi: true,
            options: projects.map((project) => ({ value: project.id, label: project.name })),
          },
        ]
      : []),
    {
      key: 'tag',
      label: 'Тег',
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
            label: 'Стадия',
            empty: 'all',
            multi: true,
            options: stages.map((stage) => ({ value: stage.id, label: stage.name })),
          },
        ]
      : []),
    {
      key: 'priority',
      label: 'Приоритет',
      empty: 'all',
      options: [
        { value: 'high', label: 'Высокий' },
        { value: 'normal', label: 'Обычный' },
        { value: 'low', label: 'Низкий' },
      ],
    },
    {
      key: 'hideDone',
      label: 'Скрыть закрытые',
      empty: 'off',
      toggle: true,
      options: [{ value: 'on', label: 'Скрыть закрытые' }],
    },
  ];
}

export function taskFilterPresets(currentUserId?: string): FilterPreset[] {
  return [
    { id: 'mine', label: 'Мои', values: { assignee: currentUserId || 'all' } },
    {
      id: 'created_by_me',
      label: 'Поставленные мной',
      values: { creator: currentUserId || 'all' },
    },
    { id: 'overdue', label: 'Просроченные', values: { deadline: 'overdue' } },
    { id: 'week', label: 'На неделе', values: { deadline: 'week' } },
    { id: 'no_deadline', label: 'Без срока', values: { deadline: 'none' } },
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
