'use client';

// Конструктор дашбордов: виджет собирается из метрики, разреза и фильтров, а не
// пишется кодом. Период общий на экран: ПМ сравнивает виджеты между собой, и разные
// периоды у соседей дали бы числа, которые нельзя сложить в одну картину.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Checkbox } from '@/components/monos/Checkbox';
import { Drawer } from '@/components/monos/Drawer';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { EmptyState } from '@/components/monos/EmptyState';
import { IconButton } from '@/components/monos/IconButton';
import { Menu } from '@/components/monos/Menu';
import { Modal } from '@/components/monos/Modal';
import { Notice } from '@/components/monos/Notice';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { Tabs } from '@/components/monos/Tabs';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl } from '@/components/monos/toolbar';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { PRESETS, type Preset } from '@/components/PmReport';
import {
  dimensionsFor,
  METRICS,
  SNAPSHOT,
  type Dashboard,
  type DrillRow,
  type Dimension,
  type Metric,
  type View,
  type Widget,
  type WidgetResult,
} from '@/lib/dashboards';
import { dateFormat, numberFormat, t } from '@/lib/i18n';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { cn } from '@/lib/utils';
import { useKanbanStore } from '@/store/kanban';

const METRIC_LABEL: Record<Metric, () => string> = {
  created: () => t('Создано задач'),
  closed: () => t('Закрыто задач'),
  open: () => t('Открытые задачи сейчас'),
  overdue: () => t('Просрочено сейчас'),
  late: () => t('Закрыто с опозданием'),
  onTime: () => t('Доля закрытых в срок'),
  leadTime: () => t('Дней до закрытия'),
  hours: () => t('Списано часов'),
};
/** Подсказка под выбором метрики: что именно попадёт в число, без чтения кода. */
const METRIC_HINT: Record<Metric, () => string> = {
  created: () => t('Задачи, созданные в выбранном периоде.'),
  closed: () => t('Задачи, завершённые в выбранном периоде.'),
  open: () => t('Незакрытые задачи на сегодня, без отложенных. Период на число не влияет.'),
  overdue: () =>
    t('Незакрытые задачи, у которых срок уже прошёл, на сегодня. Период на число не влияет.'),
  late: () => t('Задачи со сроком, завершённые в периоде позже срока.'),
  onTime: () => t('Из задач со сроком, завершённых в периоде: какая часть закрыта до срока.'),
  leadTime: () =>
    t(
      'От создания до завершения, для задач, закрытых в периоде. Половина задач закрывается быстрее.',
    ),
  hours: () => t('Часы из списаний за период, по дню списания.'),
};
const DIMENSION_LABEL: Record<Dimension, () => string> = {
  none: () => t('Без группировки'),
  project: () => t('По проектам'),
  user: () => t('По людям'),
  status: () => t('По статусам'),
  class: () => t('По классам часов'),
  week: () => t('По неделям'),
  month: () => t('По месяцам'),
};
const VIEW_LABEL: Record<View, () => string> = {
  number: () => t('Число'),
  bars: () => t('Полосы'),
  columns: () => t('Столбики'),
  table: () => t('Таблица'),
};
const STATUS: Record<string, () => string> = {
  '1': () => t('Новая'),
  '2': () => t('Ждёт выполнения'),
  '3': () => t('В работе'),
  '4': () => t('Ждёт контроля'),
  '5': () => t('Завершена'),
  '6': () => t('Отложена'),
};
const CLASS: Record<string, () => string> = {
  commercial: () => t('Коммерческие'),
  defect: () => t('Брак'),
  internal: () => t('Внутренняя разработка'),
  presale: () => t('Пресейл'),
  other: () => t('Прочие'),
  unassigned: () => t('Нераспределено'),
};

const isTime = (by: Dimension) => by === 'week' || by === 'month';
/** Виды, которые подходят разрезу: итог это число, время это столбики. */
const viewsFor = (by: Dimension): View[] =>
  by === 'none' ? ['number'] : isTime(by) ? ['columns', 'table'] : ['bars', 'table'];

const HOURS = numberFormat({ maximumFractionDigits: 1 });
const COUNT = numberFormat({ maximumFractionDigits: 0 });
const PERCENT = numberFormat({ style: 'percent', maximumFractionDigits: 0 });
const DAY = dateFormat({ day: '2-digit', month: '2-digit' });
const MONTH = dateFormat({ month: '2-digit', year: 'numeric' });

function formatValue(metric: Metric, value: number | null) {
  if (value === null) return '—';
  if (metric === 'hours') return t('{0} ч', HOURS.format(value));
  if (metric === 'onTime') return PERCENT.format(value);
  if (metric === 'leadTime') return t('{0} дн', HOURS.format(value));
  return COUNT.format(value);
}

const shiftDay = (day: string, days: number) => {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** Неделя или месяц, попавшие в период не целиком: их столбик ниже не из-за работы. */
function isPartial(by: Dimension, key: string, from: string, to: string) {
  if (by === 'week') return key < from || shiftDay(key, 6) > to;
  if (by !== 'month') return false;
  const [year, month] = key.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return `${key}-01` < from || last > to;
}

const taskHref = (row: DrillRow) =>
  row.projectId && row.projectId !== NO_PROJECT_ID
    ? `/projects/${row.projectId}?task=${encodeURIComponent(row.id)}`
    : `/all-tasks?task=${encodeURIComponent(row.id)}`;

const newId = () => Math.random().toString(36).slice(2, 10);
const widget = (patch: Partial<Widget>): Widget => ({
  id: newId(),
  title: '',
  metric: 'closed',
  by: 'none',
  view: 'number',
  projectId: '',
  userId: '',
  wide: false,
  ...patch,
});

type Template = {
  id: string;
  name: () => string;
  description: () => string;
  /** Шаблон про один проект: все виджеты получают его фильтр. */
  needsProject?: boolean;
  widgets: () => Widget[];
};

const bars = (patch: Partial<Widget>) => widget({ view: 'bars', ...patch });
const weekly = (patch: Partial<Widget>) => widget({ by: 'week', view: 'columns', ...patch });

// Шаблоны отвечают на вопросы, с которыми ПМ приходит, а не перечисляют метрики:
// пустой конструктор пугает, готовый экран правят под себя.
const TEMPLATES: Template[] = [
  {
    id: 'overview',
    name: () => t('Обзор'),
    description: () => t('Главное за период: закрыто, просрочено, в срок, часы и ритм по неделям.'),
    widgets: () => [
      widget({ metric: 'closed' }),
      widget({ metric: 'overdue' }),
      widget({ metric: 'onTime' }),
      widget({ metric: 'hours' }),
      weekly({ metric: 'closed', wide: true }),
      bars({ metric: 'hours', by: 'project' }),
      bars({ metric: 'overdue', by: 'user' }),
    ],
  },
  {
    id: 'deadlines',
    name: () => t('Сроки и просрочка'),
    description: () => t('Где горят сроки, у кого просрочка и как часто закрываем вовремя.'),
    widgets: () => [
      widget({ metric: 'overdue' }),
      widget({ metric: 'late' }),
      widget({ metric: 'onTime' }),
      widget({ metric: 'leadTime' }),
      weekly({ metric: 'onTime', title: t('Доля в срок по неделям'), wide: true }),
      bars({ metric: 'overdue', by: 'user', title: t('Кто держит просрочку') }),
      bars({ metric: 'overdue', by: 'project', title: t('Где просрочка') }),
    ],
  },
  {
    id: 'hours',
    name: () => t('Часы команды'),
    description: () => t('Куда уходит время: по людям, проектам, классам работ и неделям.'),
    widgets: () => [
      widget({ metric: 'hours' }),
      weekly({ metric: 'hours', title: t('Часы по неделям'), wide: true }),
      bars({ metric: 'hours', by: 'user', title: t('Кто сколько списал') }),
      bars({ metric: 'hours', by: 'project', title: t('Часы по проектам') }),
      bars({ metric: 'hours', by: 'class', title: t('Часы по классам работ') }),
    ],
  },
  {
    id: 'flow',
    name: () => t('Поток задач'),
    description: () =>
      t('Успеваем ли разбирать входящее: создано против закрыто и скорость закрытия.'),
    widgets: () => [
      widget({ metric: 'created' }),
      widget({ metric: 'closed' }),
      widget({ metric: 'open' }),
      widget({ metric: 'leadTime' }),
      weekly({ metric: 'created', title: t('Создано по неделям') }),
      weekly({ metric: 'closed', title: t('Закрыто по неделям') }),
      bars({ metric: 'open', by: 'status', title: t('Открытые по статусам') }),
      bars({ metric: 'open', by: 'user', title: t('Открытые по людям') }),
    ],
  },
  {
    id: 'project',
    name: () => t('Один проект'),
    description: () => t('Всё о выбранном проекте: сроки, часы, кто над чем работает.'),
    needsProject: true,
    widgets: () => [
      widget({ metric: 'closed' }),
      widget({ metric: 'overdue' }),
      widget({ metric: 'onTime' }),
      widget({ metric: 'hours' }),
      weekly({ metric: 'closed', wide: true }),
      bars({ metric: 'hours', by: 'user', title: t('Кто сколько списал') }),
      bars({ metric: 'overdue', by: 'user', title: t('Кто держит просрочку') }),
      bars({ metric: 'open', by: 'status', title: t('Открытые по статусам') }),
    ],
  },
  {
    id: 'blank',
    name: () => t('Пустой'),
    description: () => t('Без виджетов: соберёте сами.'),
    widgets: () => [],
  },
];

/** Готовые вопросы в редакторе: один клик заполняет форму, дальше можно поправить. */
const QUESTIONS: { label: () => string; patch: Partial<Widget> }[] = [
  {
    label: () => t('Кто держит просрочку?'),
    patch: { metric: 'overdue', by: 'user', view: 'bars' },
  },
  {
    label: () => t('Сколько закрываем в неделю?'),
    patch: { metric: 'closed', by: 'week', view: 'columns' },
  },
  { label: () => t('Кто сколько списал?'), patch: { metric: 'hours', by: 'user', view: 'bars' } },
  { label: () => t('Куда уходят часы?'), patch: { metric: 'hours', by: 'project', view: 'bars' } },
  {
    label: () => t('Как часто успеваем в срок?'),
    patch: { metric: 'onTime', by: 'week', view: 'columns' },
  },
  {
    label: () => t('Сколько дней живёт задача?'),
    patch: { metric: 'leadTime', by: 'none', view: 'number' },
  },
];

const ONBOARDING = [
  () => t('Дашборд это набор виджетов. Он общий: команда видит то же, что и вы.'),
  () =>
    t(
      'Виджет отвечает на один вопрос: что считать, как группировать и по какому проекту или человеку.',
    ),
  () => t('Кликните по числу или столбику, и откроется список задач за ним.'),
];

/** Галерея шаблонов с названием: и онбординг на пустом экране, и окно нового дашборда. */
function TemplatePicker({ onCreate }: { onCreate: (name: string, widgets: Widget[]) => void }) {
  const projects = useKanbanStore((state) => state.projects);
  const [chosen, setChosen] = useState(TEMPLATES[0]);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const project = projects.find((item) => item.id === projectId);
  const fallbackName = chosen.needsProject && project ? project.name : chosen.name();
  const blocked = chosen.needsProject && !projectId;
  return (
    <div className="space-y-4 text-left">
      <div
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
        role="radiogroup"
        aria-label={t('Шаблон')}
      >
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={chosen.id === template.id}
            onClick={() => setChosen(template)}
            className={cn(
              'rounded-ui border p-3 text-left transition-colors',
              chosen.id === template.id
                ? 'border-accent bg-surface-2'
                : 'border-line hover:bg-surface-2',
            )}
          >
            <span className="block text-sm font-semibold text-ink">{template.name()}</span>
            <span className="mt-1 block text-xs text-ink-soft">{template.description()}</span>
            {template.widgets().length > 0 && (
              <span className="mt-2 block text-xs text-ink-faint">
                {t('Виджетов: {0}', template.widgets().length)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {chosen.needsProject && (
          <SelectField
            label={t('Проект')}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={[
              { value: '', label: t('Выберите проект') },
              ...projects
                .filter((item) => !item.isArchived)
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        )}
        <TextField
          label={t('Название')}
          placeholder={fallbackName}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button
          disabled={blocked}
          onClick={() =>
            onCreate(
              name.trim() || fallbackName,
              chosen.widgets().map((item) => ({ ...item, projectId: projectId || item.projectId })),
            )
          }
        >
          {t('Создать дашборд')}
        </Button>
      </div>
    </div>
  );
}

type Names = {
  key: (by: Dimension, key: string) => string;
  project: (id: string) => string;
  user: (id: string) => string;
};

function useNames(): Names {
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  return useMemo(() => {
    const project = (id: string) =>
      id === NO_PROJECT_ID
        ? t(NO_PROJECT_NAME)
        : projects.find((item) => item.id === id)?.name || t('Проект {0}', id);
    const user = (id: string) => users.find((item) => item.id === id)?.name || `#${id}`;
    const key = (by: Dimension, value: string) => {
      if (by === 'project') return project(value);
      if (by === 'user') return user(value);
      if (by === 'status') return STATUS[value]?.() || value;
      if (by === 'class') return CLASS[value]?.() || value;
      const [year, month, day] = value.split('-').map(Number);
      if (by === 'week') return DAY.format(new Date(year, month - 1, day));
      if (by === 'month') return MONTH.format(new Date(year, month - 1, 1));
      return value;
    };
    return { key, project, user };
  }, [projects, users]);
}

/** Подзаголовок виджета: что посчитано и с какими фильтрами. */
function describe(item: Widget, names: Names) {
  return [
    item.title ? METRIC_LABEL[item.metric]() : '',
    SNAPSHOT.includes(item.metric) ? t('на сегодня') : '',
    item.metric === 'leadTime' ? t('медиана') : '',
    item.by !== 'none' ? DIMENSION_LABEL[item.by]().toLowerCase() : '',
    item.projectId ? names.project(item.projectId) : '',
    item.userId ? names.user(item.userId) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const LIMIT = 12;

type ChartProps = {
  item: Widget;
  result?: WidgetResult;
  names: Names;
  from: string;
  to: string;
  /** Клик по числу или точке: null это весь итог. Без него график не кликается (превью). */
  onPick?: (key: string | null) => void;
};

/** Есть ли за числом задачи: 0% в срок или медиана 0 дней это задачи, а нет данных это null. */
const hasTasks = (metric: Metric, value: number | null) =>
  value !== null && (value > 0 || metric === 'onTime' || metric === 'leadTime');

const pickable =
  'rounded-ui text-left transition-colors hover:bg-surface-2 focus-visible:outline-2';

function Chart({ item, result, names, from, to, onPick }: ChartProps) {
  const [all, setAll] = useState(false);
  if (!result) return <div className="h-24 animate-pulse rounded-ui bg-surface-2" />;
  const label = (key: string) =>
    names.key(item.by, key) + (isPartial(item.by, key, from, to) ? ` (${t('неполная')})` : '');
  if (item.view === 'number' || item.by === 'none') {
    const value = (
      <span className="text-3xl font-semibold tabular-nums text-ink">
        {formatValue(item.metric, result.total)}
      </span>
    );
    return onPick && hasTasks(item.metric, result.total) ? (
      <button
        className={cn(pickable, '-mx-1 px-1')}
        onClick={() => onPick(null)}
        title={t('Показать задачи')}
      >
        {value}
      </button>
    ) : (
      <p>{value}</p>
    );
  }
  const points = result.points;
  if (!points.length) return <p className="text-sm text-ink-faint">{t('Нет данных за период')}</p>;
  const max = Math.max(...points.map((point) => point.value ?? 0), 0) || 1;
  const anyPartial = points.some((point) => isPartial(item.by, point.key, from, to));

  if (item.view === 'columns')
    return (
      <div>
        <div className="flex h-40 items-end gap-1">
          {points.map((point) => (
            <button
              key={point.key}
              type="button"
              disabled={!onPick || !hasTasks(item.metric, point.value)}
              onClick={() => onPick?.(point.key)}
              className={cn(
                'group relative flex h-full min-w-0 flex-1 flex-col justify-end',
                isPartial(item.by, point.key, from, to) && 'opacity-50',
              )}
              title={`${label(point.key)}: ${formatValue(item.metric, point.value)}`}
              aria-label={`${label(point.key)}: ${formatValue(item.metric, point.value)}`}
            >
              <span className="mb-1 truncate text-center text-[10px] tabular-nums text-ink-soft">
                {point.value === null
                  ? ''
                  : formatValue(item.metric, point.value).replace(/\s?(ч|h|дн|d)$/, '')}
              </span>
              <div
                className="w-full rounded-t-sm bg-accent transition-opacity group-hover:opacity-80"
                style={{
                  height: `${((point.value ?? 0) / max) * 100}%`,
                  minHeight: point.value ? 2 : 0,
                }}
              />
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-1 border-t border-line pt-1">
          {points.map((point, index) => (
            <span
              key={point.key}
              className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-faint"
            >
              {/* Подписи через одну, когда столбиков много: иначе они слипаются. */}
              {points.length > 14 && index % 2 ? '' : names.key(item.by, point.key)}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {t('Итого')}: {formatValue(item.metric, result.total)}
          {anyPartial && ` · ${t('бледные столбики попали в период не целиком')}`}
        </p>
      </div>
    );

  const shown = all ? points : points.slice(0, LIMIT);
  if (item.view === 'table')
    return (
      <div>
        <table className="w-full text-sm">
          <tbody>
            {shown.map((point) => (
              <tr key={point.key} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-2 text-ink">
                  {onPick && hasTasks(item.metric, point.value) ? (
                    <button className="text-left hover:underline" onClick={() => onPick(point.key)}>
                      {label(point.key)}
                    </button>
                  ) : (
                    label(point.key)
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink">
                  {formatValue(item.metric, point.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <More count={points.length} all={all} onToggle={() => setAll(!all)} />
      </div>
    );

  return (
    <div>
      {/* Колонка значения фиксированной ширины: иначе дорожки полос разной длины. */}
      <div className="space-y-0.5 text-sm">
        {shown.map((point) => (
          <button
            key={point.key}
            type="button"
            disabled={!onPick || !hasTasks(item.metric, point.value)}
            onClick={() => onPick?.(point.key)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5rem] items-center gap-2 py-0.5 text-left',
              onPick && pickable,
            )}
          >
            <span className="truncate text-ink" title={names.key(item.by, point.key)}>
              {names.key(item.by, point.key)}
            </span>
            <div className="h-2.5 overflow-hidden rounded-ui bg-surface-2">
              <div
                className="h-full rounded-ui bg-accent"
                style={{ width: `${((point.value ?? 0) / max) * 100}%` }}
              />
            </div>
            <span className="text-right tabular-nums text-ink-soft">
              {formatValue(item.metric, point.value)}
            </span>
          </button>
        ))}
      </div>
      <More count={points.length} all={all} onToggle={() => setAll(!all)} />
    </div>
  );
}

function More({ count, all, onToggle }: { count: number; all: boolean; onToggle: () => void }) {
  if (count <= LIMIT) return null;
  return (
    <button className="mt-1 text-xs text-ink-soft hover:text-ink" onClick={onToggle}>
      {all ? t('Свернуть') : t('Ещё {0}', count - LIMIT)}
    </button>
  );
}

async function drillQuery(item: Widget, from: string, to: string, key: string | null) {
  const response = await fetch('/api/dashboards/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widgets: [item], from, to, drill: { key } }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as { tasks: DrillRow[]; total: number };
}

function DrillValue({ metric, value }: { metric: Metric; value: number }) {
  if (metric === 'hours' || metric === 'leadTime')
    return <span className="tabular-nums text-ink-soft">{formatValue(metric, value)}</span>;
  if (metric === 'onTime')
    return (
      <span className={value ? 'text-ink-soft' : 'text-danger-text'}>
        {value ? t('в срок') : t('с опозданием')}
      </span>
    );
  return null;
}

/** Список задач за числом: тот же расчёт, что у виджета, поэтому строк столько же, сколько в числе. */
function DrillDrawer({
  drill,
  from,
  to,
  names,
  onClose,
}: {
  drill: { item: Widget; key: string | null } | null;
  from: string;
  to: string;
  names: Names;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ tasks: DrillRow[]; total: number } | 'error'>();
  useEffect(() => {
    if (!drill) return;
    let cancelled = false;
    drillQuery(drill.item, from, to, drill.key)
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setData('error'));
    return () => {
      cancelled = true;
      setData(undefined);
    };
  }, [drill, from, to]);
  if (!drill) return null;
  const { item, key } = drill;
  const title = item.title || METRIC_LABEL[item.metric]();
  return (
    <Drawer
      open
      onClose={onClose}
      title={key === null ? title : `${title}: ${names.key(item.by, key)}`}
      description={describe(item, names)}
      className="w-full sm:w-[28rem]"
    >
      {data === undefined ? (
        <LoadingState />
      ) : data === 'error' ? (
        <Notice tone="danger">{t('Не удалось загрузить задачи.')}</Notice>
      ) : !data.tasks.length ? (
        <p className="text-sm text-ink-faint">{t('Задач нет')}</p>
      ) : (
        <div className="space-y-1">
          <p className="mb-2 text-xs text-ink-soft">
            {data.total > data.tasks.length
              ? t('Показаны {0} из {1}', data.tasks.length, data.total)
              : t('Задач: {0}', data.total)}
          </p>
          {data.tasks.map((row) => (
            <Link
              key={row.id}
              href={taskHref(row)}
              className="flex items-start gap-3 rounded-ui px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-ink">{row.title}</span>
                <span className="block truncate text-xs text-ink-faint">
                  {names.project(row.projectId)} · {names.user(row.userId)}
                </span>
              </span>
              <DrillValue metric={item.metric} value={row.value} />
            </Link>
          ))}
        </div>
      )}
    </Drawer>
  );
}

async function query(widgets: Widget[], from: string, to: string) {
  const response = await fetch('/api/dashboards/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widgets, from, to }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as {
    results: Record<string, WidgetResult>;
    collectedFrom: string | null;
  };
}

function Editor({
  initial,
  isNew,
  from,
  to,
  names,
  onSave,
  onClose,
}: {
  initial: Widget;
  isNew: boolean;
  from: string;
  to: string;
  names: Names;
  onSave: (item: Widget) => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState(initial);
  const [preview, setPreview] = useState<WidgetResult>();
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const dims = dimensionsFor(item.metric);
  const views = viewsFor(item.by);

  // Смена метрики или разреза подтягивает допустимые разрез и вид, а не оставляет
  // сочетание, которое сервер молча превратит в итог.
  const update = (patch: Partial<Widget>) =>
    setItem((current) => {
      const next = { ...current, ...patch };
      if (!dimensionsFor(next.metric).includes(next.by)) next.by = 'none';
      if (!viewsFor(next.by).includes(next.view)) next.view = viewsFor(next.by)[0];
      return next;
    });

  // Название и ширина на расчёт не влияют: перезапрос на каждую букву был бы лишним.
  const { id, metric, by, projectId, userId } = item;
  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    query([{ ...widget({ metric, by, projectId, userId }), id }], from, to)
      .then((data) => !cancelled && setPreview(data.results[id]))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, metric, by, projectId, userId, from, to]);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? t('Новый виджет') : t('Виджет')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('Отмена')}
          </Button>
          <Button onClick={() => onSave(item)}>{t('Сохранить')}</Button>
        </div>
      }
    >
      {isNew && (
        <div className="mb-4">
          <p className="mb-2 text-xs text-ink-soft">
            {t('Начните с готового вопроса или соберите свой ниже')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUESTIONS.map((question) => (
              <button
                key={question.label()}
                type="button"
                onClick={() =>
                  update({ ...question.patch, title: question.label().replace(/\?$/, '') })
                }
                className="rounded-ui border border-line px-2.5 py-1 text-xs text-ink hover:bg-surface-2"
              >
                {question.label()}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <SelectField
            label={t('Что считать')}
            value={item.metric}
            onChange={(event) => update({ metric: event.target.value as Metric })}
            options={METRICS.map((metric) => ({ value: metric, label: METRIC_LABEL[metric]() }))}
          />
          <p className="-mt-1 text-xs text-ink-faint">{METRIC_HINT[item.metric]()}</p>
          <SelectField
            label={t('Группировать')}
            value={item.by}
            onChange={(event) => update({ by: event.target.value as Dimension })}
            options={dims.map((by) => ({ value: by, label: DIMENSION_LABEL[by]() }))}
          />
          {views.length > 1 && (
            <div className="space-y-1">
              <p className="text-xs text-ink-soft">{t('Вид')}</p>
              <SegmentedControl
                size="sm"
                value={item.view}
                onChange={(value) => update({ view: value as View })}
                options={views.map((view) => ({ value: view, label: VIEW_LABEL[view]() }))}
              />
            </div>
          )}
          <SelectField
            label={t('Проект')}
            value={item.projectId}
            onChange={(event) => update({ projectId: event.target.value })}
            options={[
              { value: '', label: t('Все проекты') },
              ...projects
                .filter((project) => !project.isArchived)
                .map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
          <SelectField
            label={item.metric === 'hours' ? t('Кто списал') : t('Исполнитель')}
            value={item.userId}
            onChange={(event) => update({ userId: event.target.value })}
            options={[
              { value: '', label: t('Все люди') },
              ...[...users]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((user) => ({ value: user.id, label: user.name })),
            ]}
          />
          <TextField
            label={t('Название')}
            placeholder={METRIC_LABEL[item.metric]()}
            value={item.title}
            maxLength={120}
            onChange={(event) => update({ title: event.target.value })}
          />
          <Checkbox
            checked={item.wide}
            onChange={(event) => update({ wide: event.target.checked })}
          >
            {t('На всю ширину')}
          </Checkbox>
        </div>
        <Card className="self-start">
          <p className="text-sm font-semibold text-ink">
            {item.title || METRIC_LABEL[item.metric]()}
          </p>
          <p className="mb-3 text-xs text-ink-faint">{describe(item, names)}</p>
          <Chart item={item} result={preview} names={names} from={from} to={to} />
        </Card>
      </div>
    </Modal>
  );
}

function DashboardsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const names = useNames();
  const memberId = useKanbanStore((state) => state.memberId);
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  // Ответ помнит, на какой запрос он пришёл: пока считается новый период, старое число
  // под новыми датами не показываем.
  const [computed, setComputed] = useState<{
    key: string;
    results: Record<string, WidgetResult>;
  }>();
  const [collectedFrom, setCollectedFrom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Widget | null>(null);
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [drill, setDrill] = useState<{ item: Widget; key: string | null } | null>(null);

  const fallback = PRESETS.month();
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const activeId = searchParams.get('d');
  const active = dashboards?.find((item) => item.id === activeId) || dashboards?.[0] || null;

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`?${next}`, { scroll: false });
    },
    [router, searchParams],
  );

  const [loadFailed, setLoadFailed] = useState(false);
  const versions = useRef<Record<string, number>>({});
  const saving = useRef(Promise.resolve());

  const load = useCallback(async () => {
    const response = await fetch('/api/dashboards', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { dashboards: Dashboard[] };
    versions.current = Object.fromEntries(data.dashboards.map((item) => [item.id, item.version]));
    setDashboards(data.dashboards);
  }, []);

  useEffect(() => {
    if (!memberId) return;
    load().catch(() => setLoadFailed(true));
  }, [memberId, load]);

  // Пересчёт только при смене состава виджетов или периода: подпись и ширина числа
  // не меняют, и перезапрос на каждую из них дёргал бы весь экран.
  const signature = JSON.stringify(
    active?.widgets.map(({ id, metric, by, projectId, userId }) => [
      id,
      metric,
      by,
      projectId,
      userId,
    ]),
  );
  const requestKey = `${signature}|${from}|${to}`;
  const results = computed?.key === requestKey ? computed.results : {};
  useEffect(() => {
    if (!active?.widgets.length) return;
    let cancelled = false;
    query(active.widgets, from, to)
      .then((data) => {
        if (cancelled) return;
        setComputed({ key: requestKey, results: data.results });
        setCollectedFrom(data.collectedFrom);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(
          String(reason?.message) === '400'
            ? t('Период слишком длинный: выберите не больше двух лет.')
            : t('Не удалось посчитать виджеты.'),
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, from, to]);

  const save = async (dashboard: Dashboard) => {
    setDashboards((list) =>
      list?.some((item) => item.id === dashboard.id)
        ? list.map((item) => (item.id === dashboard.id ? dashboard : item))
        : [...(list || []), dashboard],
    );
    // Сохранения идут по очереди: каждое берёт версию из ответа предыдущего, иначе две
    // быстрые правки подряд конфликтуют сами с собой.
    saving.current = saving.current.then(async () => {
      try {
        const response = await fetch('/api/dashboards', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...dashboard, version: versions.current[dashboard.id] || 0 }),
        });
        if (response.ok) {
          const data = (await response.json()) as { dashboard: Dashboard };
          versions.current[dashboard.id] = data.dashboard.version;
          return;
        }
        setError(
          response.status === 409
            ? t('Дашборд только что изменил кто-то ещё. Показана свежая версия, повторите правку.')
            : t('Не удалось сохранить дашборд. Показана последняя сохранённая версия.'),
        );
      } catch {
        setError(t('Не удалось сохранить дашборд. Показана последняя сохранённая версия.'));
      }
      await load().catch(() => {});
    });
    await saving.current;
  };

  const create = (name: string, widgets: Widget[]) => {
    const dashboard = { id: crypto.randomUUID(), name, widgets, version: 0 };
    void save(dashboard);
    setParams({ d: dashboard.id });
  };

  const setWidgets = (widgets: Widget[]) => active && void save({ ...active, widgets });

  const remove = async () => {
    if (!active) return;
    const ok = await confirm({
      title: t('Удалить дашборд «{0}»?', active.name),
      description: t('Виджеты пропадут у всей команды. Задачи и часы не трогаются.'),
      confirmLabel: t('Удалить'),
      destructive: true,
    });
    if (!ok) return;
    setDashboards((list) => list?.filter((item) => item.id !== active.id) || []);
    setParams({ d: null });
    await fetch(`/api/dashboards?id=${encodeURIComponent(active.id)}`, { method: 'DELETE' });
  };

  const move = (index: number, shift: number) => {
    if (!active) return;
    const widgets = [...active.widgets];
    const [item] = widgets.splice(index, 1);
    widgets.splice(index + shift, 0, item);
    setWidgets(widgets);
  };

  const preset = (Object.keys(PRESETS) as Preset[]).find((key) => {
    const value = PRESETS[key]();
    return value.from === from && value.to === to;
  });

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title={t('Дашборды')}
        description={t('Свои экраны из метрик и разрезов: задачи, сроки, часы')}
      />
      <div className="space-y-3 px-4 py-4 lg:px-6">
        {error && <Notice tone="danger">{error}</Notice>}
        {dashboards === null && loadFailed ? (
          <Notice tone="danger">
            {t('Не удалось загрузить дашборды.')}{' '}
            <button
              className="underline"
              onClick={() => {
                setLoadFailed(false);
                load().catch(() => setLoadFailed(true));
              }}
            >
              {t('Повторить')}
            </button>
          </Notice>
        ) : dashboards === null ? (
          <LoadingState />
        ) : !active ? (
          <Card>
            <div className="mb-4 flex items-start gap-3">
              <LayoutDashboard className="mt-0.5 size-6 shrink-0 text-ink-soft" strokeWidth={1.5} />
              <div>
                <p className="text-base font-semibold text-ink">{t('Соберите первый дашборд')}</p>
                <ol className="mt-2 space-y-1 text-sm text-ink-soft">
                  {ONBOARDING.map((step, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="tabular-nums text-ink-faint">{index + 1}.</span>
                      {step()}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <TemplatePicker onCreate={create} />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                variant="pill"
                label={t('Дашборды')}
                items={dashboards.map((item) => ({ id: item.id, label: item.name }))}
                value={active.id}
                onChange={(id) => setParams({ d: id })}
              />
              <IconButton
                label={t('Новый дашборд')}
                variant="ghost"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" strokeWidth={1.7} />
              </IconButton>
              <div className="ml-auto flex items-center gap-1">
                <Menu
                  label={t('Действия с дашбордом')}
                  align="end"
                  items={[
                    {
                      label: t('Переименовать'),
                      icon: <Pencil className="size-4" />,
                      onSelect: () => setNaming({ id: active.id, name: active.name }),
                    },
                    {
                      label: t('Удалить'),
                      icon: <Trash2 className="size-4" />,
                      danger: true,
                      onSelect: () => void remove(),
                    },
                  ]}
                  trigger={
                    <IconButton label={t('Действия с дашбордом')} variant="ghost" size="sm">
                      <MoreHorizontal className="size-4" strokeWidth={1.7} />
                    </IconButton>
                  }
                />
              </div>
            </div>

            <Card padding="none">
              <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <SegmentedControl
                  size="sm"
                  value={preset || ''}
                  onChange={(value) => setParams(PRESETS[value as Preset]())}
                  options={[
                    { value: 'month', label: t('Этот месяц') },
                    { value: 'previous', label: t('Прошлый месяц') },
                    { value: 'quarter', label: t('Квартал') },
                    { value: 'three', label: t('3 месяца') },
                  ]}
                />
                <TextField
                  type="date"
                  variant="boxed"
                  size="sm"
                  value={from}
                  max={to}
                  onChange={(event) =>
                    event.target.value && setParams({ from: event.target.value })
                  }
                  className={`${toolbarControl} w-full min-w-0 sm:w-36`}
                  aria-label={t('Начальная дата периода')}
                />
                <TextField
                  type="date"
                  variant="boxed"
                  size="sm"
                  value={to}
                  min={from}
                  onChange={(event) => event.target.value && setParams({ to: event.target.value })}
                  className={`${toolbarControl} w-full min-w-0 sm:w-36`}
                  aria-label={t('Конечная дата периода')}
                />
                <Button
                  size="sm"
                  className="sm:ml-auto"
                  icon={<Plus size={14} strokeWidth={1.7} />}
                  onClick={() => setEditing(widget({}))}
                >
                  {t('Виджет')}
                </Button>
              </div>
            </Card>

            {collectedFrom && from < collectedFrom && (
              <Notice tone="warning">
                {t('Списания в базе собраны с {0}: часы до этой даты не видны.', collectedFrom)}
              </Notice>
            )}

            {active.widgets.length === 0 ? (
              <EmptyState
                title={t('Виджетов пока нет')}
                description={t('Выберите, что считать и в каком разрезе: превью покажет сразу.')}
                actions={
                  <Button onClick={() => setEditing(widget({}))}>{t('Добавить виджет')}</Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {active.widgets.map((item, index) => (
                  <Card
                    key={item.id}
                    className={cn(
                      'min-w-0',
                      item.by !== 'none' && 'xl:col-span-2',
                      item.wide && 'md:col-span-2 xl:col-span-4',
                    )}
                  >
                    <div className="mb-3 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {item.title || METRIC_LABEL[item.metric]()}
                        </p>
                        <p className="truncate text-xs text-ink-faint">{describe(item, names)}</p>
                      </div>
                      <Menu
                        label={t('Действия с виджетом')}
                        align="end"
                        items={[
                          {
                            label: t('Изменить'),
                            icon: <Pencil className="size-4" />,
                            onSelect: () => setEditing(item),
                          },
                          {
                            label: t('Копия'),
                            icon: <Copy className="size-4" />,
                            onSelect: () =>
                              setWidgets([
                                ...active.widgets.slice(0, index + 1),
                                { ...item, id: newId() },
                                ...active.widgets.slice(index + 1),
                              ]),
                          },
                          {
                            label: t('Выше'),
                            icon: <ArrowUp className="size-4" />,
                            disabled: index === 0,
                            onSelect: () => move(index, -1),
                          },
                          {
                            label: t('Ниже'),
                            icon: <ArrowDown className="size-4" />,
                            disabled: index === active.widgets.length - 1,
                            onSelect: () => move(index, 1),
                          },
                          {
                            label: t('Удалить'),
                            icon: <Trash2 className="size-4" />,
                            danger: true,
                            onSelect: () =>
                              setWidgets(active.widgets.filter((other) => other.id !== item.id)),
                          },
                        ]}
                        trigger={
                          <IconButton label={t('Действия с виджетом')} variant="ghost" size="sm">
                            <MoreHorizontal className="size-4" strokeWidth={1.7} />
                          </IconButton>
                        }
                      />
                    </div>
                    <Chart
                      item={item}
                      result={results[item.id]}
                      names={names}
                      from={from}
                      to={to}
                      onPick={(key) => setDrill({ item, key })}
                    />
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {editing && active && (
        <Editor
          initial={editing}
          isNew={!active.widgets.some((other) => other.id === editing.id)}
          from={from}
          to={to}
          names={names}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            const exists = active.widgets.some((other) => other.id === item.id);
            setWidgets(
              exists
                ? active.widgets.map((other) => (other.id === item.id ? item : other))
                : [...active.widgets, item],
            );
            setEditing(null);
          }}
        />
      )}

      <DrillDrawer drill={drill} from={from} to={to} names={names} onClose={() => setDrill(null)} />

      {creating && (
        <Modal open size="xl" onClose={() => setCreating(false)} title={t('Новый дашборд')}>
          <TemplatePicker
            onCreate={(name, widgets) => {
              create(name, widgets);
              setCreating(false);
            }}
          />
        </Modal>
      )}

      {naming && (
        <Modal
          open
          size="sm"
          onClose={() => setNaming(null)}
          title={t('Переименовать дашборд')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setNaming(null)}>
                {t('Отмена')}
              </Button>
              <Button
                disabled={!naming.name.trim()}
                onClick={() => {
                  const name = naming.name.trim();
                  const current = dashboards?.find((item) => item.id === naming.id);
                  if (current) void save({ ...current, name });
                  setNaming(null);
                }}
              >
                {t('Сохранить')}
              </Button>
            </div>
          }
        >
          <TextField
            label={t('Название')}
            value={naming.name}
            maxLength={80}
            autoFocus
            onChange={(event) => setNaming({ ...naming, name: event.target.value })}
          />
        </Modal>
      )}
    </div>
  );
}

export default function Dashboards() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DashboardsView />
    </Suspense>
  );
}
