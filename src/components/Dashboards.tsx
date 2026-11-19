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
  HelpCircle,
  Info,
  Copy,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { DateField } from '@/components/monos/DateField';
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
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl, toolbarSelect } from '@/components/monos/toolbar';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import {
  PRESETS,
  formatHours,
  formatShare,
  personName,
  projectOptions,
  weekList,
  type Preset,
} from '@/components/PmReport';
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
import { FONT } from '@/components/monos/scale';
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
  created: () =>
    t(
      'Задачи, созданные в выбранном периоде. Удалённые задачи не учитываются: зеркало хранит только живые.',
    ),
  closed: () =>
    t(
      'Задачи, завершённые в выбранном периоде, по текущему состоянию: переоткрытая задача уходит из закрытых.',
    ),
  open: () => t('Незакрытые задачи на сегодня, без отложенных. Период на число не влияет.'),
  overdue: () =>
    t(
      'Незакрытые задачи с прошедшим сроком на сегодня, без отложенных. Период на число не влияет.',
    ),
  late: () => t('Задачи со сроком, завершённые в периоде позже срока.'),
  onTime: () =>
    t(
      'Из задач со сроком, завершённых в периоде: какая часть закрыта не позднее срока. Задачи без срока не входят, под числом видно, из скольких задач доля.',
    ),
  leadTime: () =>
    t(
      'Медиана дней от создания до завершения для задач, закрытых в периоде: середина ряда, а не среднее.',
    ),
  hours: () =>
    t(
      'Часы из списаний за период, по дню списания. Проект и класс берутся по текущему состоянию задачи: перенос задачи переносит и её прошлые часы. Списания удалённых задач не учитываются.',
    ),
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

const DAYS = numberFormat({ maximumFractionDigits: 1 });
const COUNT = numberFormat({ maximumFractionDigits: 0 });
const DAY = dateFormat({ day: '2-digit', month: '2-digit' });
const COLLECTED = dateFormat({
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
const DAY_YEAR = dateFormat({ day: '2-digit', month: '2-digit', year: '2-digit' });
// Срок как в строке портала, а не в поясе браузера: у ПМ в UTC срок 03.11 00:30
// показывался как 02.11. Тот же день, по которому задача считается просроченной.
const portalDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(2)}` : value;
};
const MONTH = dateFormat({ month: '2-digit', year: 'numeric' });

function formatValue(metric: Metric, value: number | null) {
  if (value === null) return '—';
  if (metric === 'hours') return formatHours(value);
  // Вниз до десятой: 999 из 1000 в срок не должно читаться как ровно 100 %.
  if (metric === 'onTime') return formatShare(value);
  if (metric === 'leadTime') return t('{0} дн', DAYS.format(value));
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

/** Виджет с проектом экрана: 'all' снимает проект, пустой фильтр оставляет свой. */
const withProject = (item: Widget, projectFilter: string): Widget =>
  projectFilter ? { ...item, projectId: projectFilter === 'all' ? '' : projectFilter } : item;

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

/** Справка «Как пользоваться»: открыта при первом визите, дальше по кнопке в шапке. */
const GUIDE = [
  () => t('Выберите дашборд во вкладках. Под вкладками написано, на какой вопрос он отвечает.'),
  () =>
    t(
      'Задайте период: этот месяц, прошлый, квартал или свои даты. Метрики «на сегодня» от периода не зависят.',
    ),
  () =>
    t(
      'Кликните по числу, полосе или столбику: справа откроется список задач, из него можно перейти в задачу.',
    ),
  () => t('Значок i у виджета объясняет, что именно посчитано.'),
  () =>
    t(
      'Нужен свой вопрос: кнопка «Виджет», готовый вопрос или своя метрика. Свой экран: «+» рядом с вкладками. Дашборды общие для всей команды.',
    ),
];
const GUIDE_KEY = 'bitrix-flow-dashboards-guide';

/** Галерея шаблонов с названием: и онбординг на пустом экране, и окно нового дашборда. */
function TemplatePicker({
  onCreate,
}: {
  onCreate: (name: string, widgets: Widget[], description: string) => void;
}) {
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
            options={[{ value: '', label: t('Выберите проект') }, ...projectOptions(projects)]}
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
              chosen.needsProject && project
                ? t('Всё о проекте «{0}»: сроки, часы, кто над чем работает.', project.name)
                : chosen.id === 'blank'
                  ? ''
                  : chosen.description(),
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
  /** long: неделя с годом, для заголовков и периода через Новый год. */
  key: (by: Dimension, key: string, long?: boolean) => string;
  project: (id: string) => string;
  user: (id: string) => string;
  projects: { id: string; name: string; isArchived?: boolean }[];
};

function useNames(): Names {
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  return useMemo(() => {
    const project = (id: string) =>
      id === NO_PROJECT_ID
        ? t(NO_PROJECT_NAME)
        : projects.find((item) => item.id === id)?.name || t('Проект {0}', id);
    const user = (id: string) => personName(users, id);
    const key = (by: Dimension, value: string, long = false) => {
      if (by === 'project') return project(value);
      if (by === 'user') return user(value);
      if (by === 'status') return STATUS[value]?.() || value;
      if (by === 'class') return CLASS[value]?.() || value;
      const [year, month, day] = value.split('-').map(Number);
      if (by === 'week') return (long ? DAY_YEAR : DAY).format(new Date(year, month - 1, day));
      if (by === 'month') return MONTH.format(new Date(year, month - 1, 1));
      return value;
    };
    return { key, project, user, projects };
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

function Chart({ item, result, names, from, to: picked, onPick }: ChartProps) {
  const [all, setAll] = useState(false);
  if (!result) return <div className="h-24 animate-pulse rounded-ui bg-surface-2" />;
  // Сервер считает только до сегодня: неделя, обрезанная сегодняшним днём, тоже неполная,
  // иначе среда текущей недели читалась как падение темпа.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const to = picked > today ? today : picked;
  const crossesYear = from.slice(0, 4) !== to.slice(0, 4);
  const label = (key: string) =>
    names.key(item.by, key, true) +
    (isPartial(item.by, key, from, to) ? ` (${t('неполная')})` : '');
  // Доля и медиана без размера выборки врут: 100 % из одной задачи читались как «все в срок».
  const sample =
    item.metric === 'onTime'
      ? t('из {0} задач со сроком', result.count)
      : item.metric === 'leadTime'
        ? t('по {0} задачам', result.count)
        : '';
  if (item.view === 'number' || item.by === 'none') {
    const value = (
      <span className={FONT.metricLarge}>{formatValue(item.metric, result.total)}</span>
    );
    return (
      <div>
        {onPick && hasTasks(item.metric, result.total) ? (
          <button
            className={cn(pickable, '-mx-1 flex min-h-11 items-center px-1')}
            onClick={() => onPick(null)}
            title={t('Показать задачи')}
          >
            {value}
          </button>
        ) : (
          <p>{value}</p>
        )}
        {sample && result.total !== null && <p className="text-xs text-ink-soft">{sample}</p>}
      </div>
    );
  }
  const points = result.points;
  if (!points.length) return <p className="text-sm text-ink-faint">{t('Нет данных за период')}</p>;
  // Доля всегда в шкале до 100 %: иначе неделя с 20 % в срок выглядела полным столбиком.
  const max =
    item.metric === 'onTime' ? 1 : Math.max(...points.map((point) => point.value ?? 0), 0) || 1;
  const pointLabel = (point: { key: string; value: number | null; count: number }) =>
    `${label(point.key)}: ${
      point.value === null && item.metric === 'hours'
        ? t('нет данных')
        : formatValue(item.metric, point.value)
    }${sample && point.value !== null ? `, ${t('задач: {0}', point.count)}` : ''}`;
  const anyPartial = points.some((point) => isPartial(item.by, point.key, from, to));

  // Больше 26 столбиков в карточку не влезают: график прокручивается, а не сжимается в нитки.
  const scroll = points.length > 26;
  const anyMissing = points.some((point) => point.value === null && item.metric === 'hours');
  if (item.view === 'columns')
    return (
      <div>
        <div className={cn(scroll && 'overflow-x-auto pb-1')}>
          <div
            className="flex h-40 items-end gap-1"
            style={scroll ? { minWidth: points.length * 28 } : undefined}
          >
            {points.map((point) => (
              <button
                key={point.key}
                type="button"
                disabled={!onPick || !hasTasks(item.metric, point.value)}
                onClick={() => onPick?.(point.key)}
                className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
                title={pointLabel(point)}
                aria-label={pointLabel(point)}
              >
                <span className="mb-1 truncate text-center text-whisper tabular-nums text-ink-soft">
                  {point.value === null
                    ? ''
                    : formatValue(item.metric, point.value).replace(/\s?(ч|h|дн|d)$/, '')}
                </span>
                {/* Доля недели из одной задачи и из ста выглядит одинаково: число задач
                    видно под процентом, а не только при наведении, которого нет на телефоне. */}
                {sample && point.value !== null && (
                  <span className="mb-1 truncate text-center text-whisper tabular-nums text-ink-faint">
                    {t('из {0}', point.count)}
                  </span>
                )}
                {/* Бледнеет только столбик: подпись с ним падала ниже AA по контрасту. */}
                <div
                  className={cn(
                    'w-full rounded-t-sm bg-accent transition-opacity group-hover:opacity-80',
                    isPartial(item.by, point.key, from, to) && 'opacity-40',
                  )}
                  style={{
                    height: `${((point.value ?? 0) / max) * 100}%`,
                    minHeight: point.value ? 2 : 0,
                  }}
                />
              </button>
            ))}
          </div>
          <div
            className="mt-1 flex gap-1 border-t border-line pt-1"
            style={scroll ? { minWidth: points.length * 28 } : undefined}
          >
            {points.map((point, index) => (
              <span
                key={point.key}
                className="min-w-0 flex-1 truncate text-center text-whisper text-ink-faint"
              >
                {/* Подписи через одну, когда столбиков много: иначе они слипаются. */}
                {points.length > 14 && index % 2 ? '' : names.key(item.by, point.key, crossesYear)}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {t('Итого')}: {formatValue(item.metric, result.total)}
          {sample && ` ${sample}`}
          {anyPartial && ` · ${t('бледные столбики попали в период не целиком')}`}
          {anyMissing && ` · ${t('пустые недели не собраны, это не ноль')}`}
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
                    <button
                      className="w-full text-left hover:underline max-lg:min-h-11"
                      onClick={() => onPick(point.key)}
                    >
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
              'grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5rem] items-center gap-2 py-0.5 text-left max-lg:min-h-11',
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

async function drillQuery(
  item: Widget,
  from: string,
  to: string,
  projectId: string,
  key: string | null,
  offset: number,
) {
  const response = await fetch('/api/dashboards/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widgets: [item], from, to, projectId, drill: { key, offset } }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as { tasks: DrillRow[]; total: number };
}

function DrillValue({ metric, row }: { metric: Metric; row: DrillRow }) {
  const { value } = row;
  if (metric === 'overdue' && row.deadline)
    return (
      <span className="shrink-0 text-xs tabular-nums text-danger-text">
        {t('срок {0}', portalDay(row.deadline))}
      </span>
    );
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
  projectId,
  names,
  onClose,
}: {
  drill: { item: Widget; key: string | null } | null;
  from: string;
  to: string;
  projectId: string;
  names: Names;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ tasks: DrillRow[]; total: number } | 'error'>();
  const [loadingMore, setLoadingMore] = useState(false);
  // Номер открытой расшифровки: поздняя страница старой плитки не дописывается в новую.
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    if (!drill) return;
    let cancelled = false;
    drillQuery(drill.item, from, to, projectId, drill.key, 0)
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setData('error'));
    return () => {
      cancelled = true;
      setData(undefined);
    };
  }, [drill, from, to, projectId]);
  // Список дочитывается страницами: за числом 1 200 должны быть доступны все 1 200 задач.
  const loadMore = async () => {
    if (!drill || !data || data === 'error') return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const next = await drillQuery(drill.item, from, to, projectId, drill.key, data.tasks.length);
      if (current === generation.current)
        setData({ tasks: [...data.tasks, ...next.tasks], total: next.total });
    } catch {
      if (current === generation.current) setData('error');
    } finally {
      setLoadingMore(false);
    }
  };
  if (!drill) return null;
  const { item, key } = drill;
  const title = item.title || METRIC_LABEL[item.metric]();
  return (
    <Drawer
      open
      onClose={onClose}
      title={key === null ? title : `${title}: ${names.key(item.by, key, true)}`}
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
              : item.metric === 'hours'
                ? t('Строк: {0}', data.total)
                : t('Задач: {0}', data.total)}
          </p>
          {data.tasks.map((row) => (
            <Link
              key={`${row.id}|${row.userId}`}
              href={taskHref(row)}
              className="flex items-start gap-3 rounded-ui px-2 py-1.5 text-sm hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-ink">{row.title}</span>
                <span className="block truncate text-xs text-ink-faint">
                  {names.project(row.projectId)} · {names.user(row.userId)}
                </span>
              </span>
              <DrillValue metric={item.metric} row={row} />
            </Link>
          ))}
          {data.total > data.tasks.length && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {t('Показать ещё {0}', Math.min(200, data.total - data.tasks.length))}
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}

type Coverage = { missingWeeks: string[]; partialWeeks: string[]; collectedAt: string | null };

async function query(widgets: Widget[], from: string, to: string, projectId = '') {
  const response = await fetch('/api/dashboards/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widgets, from, to, projectId }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as {
    results: Record<string, WidgetResult>;
    coverage: Coverage | null;
    excludedUsers: number;
    emptyMirror: boolean;
    closedNoDate: number;
  };
}

function Editor({
  initial,
  isNew,
  from,
  to,
  projectFilter,
  names,
  onSave,
  onClose,
}: {
  initial: Widget;
  isNew: boolean;
  from: string;
  to: string;
  projectFilter: string;
  names: Names;
  onSave: (item: Widget) => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState(initial);
  const [excludedUsers, setExcludedUsers] = useState(0);
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
    query([{ ...widget({ metric, by, projectId, userId }), id }], from, to, projectFilter)
      .then((data) => {
        if (cancelled) return;
        setPreview(data.results[id]);
        setExcludedUsers(data.excludedUsers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, metric, by, projectId, userId, from, to, projectFilter]);

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
            options={[{ value: '', label: t('Все проекты') }, ...projectOptions(projects)]}
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
          {item.metric === 'hours' && excludedUsers > 0 && (
            <p className="mt-2 text-xs text-ink-faint">
              {t('Служебные учётки из настроек ({0}) в часах не учитываются.', excludedUsers)}
            </p>
          )}
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
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [excludedUsers, setExcludedUsers] = useState(0);
  const [emptyMirror, setEmptyMirror] = useState(false);
  const [closedNoDate, setClosedNoDate] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Widget | null>(null);
  const [naming, setNaming] = useState<{ id: string; name: string; description: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [hints, setHints] = useState<Record<string, boolean>>({});
  const [guide, setGuide] = useState(false);

  // Первый визит: справка открыта сама. Отметка в браузере, а не в базе: это не данные,
  // и без неё справка просто покажется ещё раз.
  useEffect(() => {
    try {
      if (!localStorage.getItem(GUIDE_KEY)) setGuide(true);
    } catch {}
  }, []);
  const closeGuide = () => {
    setGuide(false);
    try {
      localStorage.setItem(GUIDE_KEY, '1');
    } catch {}
  };
  const [drill, setDrill] = useState<{ item: Widget; key: string | null } | null>(null);

  const fallback = PRESETS.month();
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const activeId = searchParams.get('d');
  // Проект на весь экран, сильнее проекта виджета. Иначе для разбора одного проекта
  // приходилось править каждый виджет, и пропущенный показывал весь портал.
  const projectFilter = searchParams.get('project') || '';
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
  const requestKey = `${signature}|${from}|${to}|${projectFilter}`;
  const results = computed?.key === requestKey ? computed.results : {};
  useEffect(() => {
    if (!active?.widgets.length) return;
    let cancelled = false;
    query(active.widgets, from, to, projectFilter)
      .then((data) => {
        if (cancelled) return;
        setError('');
        setComputed({ key: requestKey, results: data.results });
        setCoverage(data.coverage);
        setExcludedUsers(data.excludedUsers);
        setEmptyMirror(data.emptyMirror);
        setClosedNoDate(data.closedNoDate);
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
  }, [signature, from, to, projectFilter]);

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

  const create = (name: string, widgets: Widget[], description = '') => {
    const dashboard = { id: crypto.randomUUID(), name, description, widgets, version: 0 };
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
        description={t(
          'Готовые и свои экраны: задачи, сроки, часы. Клик по числу открывает задачи.',
        )}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<HelpCircle size={14} strokeWidth={1.7} />}
            onClick={() => (guide ? closeGuide() : setGuide(true))}
          >
            {t('Как пользоваться')}
          </Button>
        }
      />
      <div className="space-y-3 px-4 py-4 lg:px-6">
        {error && <Notice tone="danger">{error}</Notice>}
        {/* На пустом экране свой онбординг, вторая справка рядом с ним лишняя. */}
        {guide && active && (
          <Card>
            <div className="flex items-start gap-3">
              <HelpCircle className="mt-0.5 size-5 shrink-0 text-ink-soft" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t('Как пользоваться дашбордами')}</p>
                <ol className="mt-2 space-y-1.5 text-sm text-ink-soft">
                  {GUIDE.map((step, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="tabular-nums text-ink-faint">{index + 1}.</span>
                      <span>{step()}</span>
                    </li>
                  ))}
                </ol>
                <Button size="sm" className="mt-3" onClick={closeGuide}>
                  {t('Понятно')}
                </Button>
              </div>
            </div>
          </Card>
        )}
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
                      label: t('Название и описание'),
                      icon: <Pencil className="size-4" />,
                      onSelect: () =>
                        setNaming({
                          id: active.id,
                          name: active.name,
                          description: active.description,
                        }),
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

            {active.description && <p className="text-sm text-ink-soft">{active.description}</p>}
            {/* Описание шаблона говорит о проекте, с которым дашборд создан: при другом
                проекте сверху видно, по чему считаются числа сейчас. */}
            {projectFilter && (
              <p className="text-xs text-ink-soft">
                {t(
                  'Сейчас все виджеты считаются по: {0}',
                  projectFilter === 'all' ? t('Все проекты') : names.project(projectFilter),
                )}
              </p>
            )}

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
                <DateField
                  variant="boxed"
                  size="sm"
                  value={from}
                  onChange={(value) => value && setParams({ from: value })}
                  className={`${toolbarControl} w-full min-w-0 sm:w-40`}
                  aria-label={t('Начальная дата периода')}
                />
                <DateField
                  variant="boxed"
                  size="sm"
                  value={to}
                  onChange={(value) => value && setParams({ to: value })}
                  className={`${toolbarControl} w-full min-w-0 sm:w-40`}
                  aria-label={t('Конечная дата периода')}
                />
                <SelectField
                  size="sm"
                  variant="boxed"
                  className={`${toolbarSelect} w-full sm:w-56`}
                  aria-label={t('Проект для всех виджетов')}
                  value={projectFilter}
                  onChange={(event) => setParams({ project: event.target.value || null })}
                  options={[
                    { value: '', label: t('Как в виджетах') },
                    { value: 'all', label: t('Все проекты') },
                    ...projectOptions(names.projects),
                  ]}
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

            {closedNoDate > 0 && (
              <Notice tone="warning">
                {t(
                  'Завершённых задач без даты закрытия: {0}. Их не отнести к периоду, в закрытые и долю в срок они не входят.',
                  closedNoDate,
                )}
              </Notice>
            )}
            {emptyMirror && (
              <Notice tone="warning">
                {t('Задачи из Битрикса ещё не загружены: нули в виджетах значат «нет данных».')}
              </Notice>
            )}
            {coverage?.collectedAt && (
              <p className="text-xs text-ink-soft">
                {t(
                  'Часы собраны не позже {0}: списаний, сделанных после, в виджетах может не быть.',
                  COLLECTED.format(new Date(coverage.collectedAt)),
                )}
              </p>
            )}
            {coverage && coverage.missingWeeks.length > 0 && (
              <Notice tone="warning">
                {t(
                  'Списания за недели с {0} не собраны: часов за них нет, это не ноль работы.',
                  weekList(coverage.missingWeeks),
                )}
              </Notice>
            )}
            {coverage && coverage.partialWeeks.length > 0 && (
              <Notice tone="warning">
                {t(
                  'Недели с {0} собраны не полностью: часть задач Битрикс не отдал, часы занижены.',
                  weekList(coverage.partialWeeks),
                )}
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
                        <div className="flex min-w-0 items-center gap-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {item.title || METRIC_LABEL[item.metric]()}
                          </p>
                          {/* Подсказка раскрывается в карточке: всплывашка у правого края
                              телефона уезжала за экран, а наведения там нет. */}
                          <button
                            type="button"
                            aria-label={t('Что считает виджет')}
                            aria-expanded={Boolean(hints[item.id])}
                            onClick={() => setHints({ ...hints, [item.id]: !hints[item.id] })}
                            className={cn(
                              'shrink-0 rounded-ui p-0.5 hover:text-ink max-lg:-my-[15px] max-lg:-mr-[15px] max-lg:p-[15px]',
                              hints[item.id] ? 'text-ink' : 'text-ink-faint',
                            )}
                          >
                            <Info className="size-3.5" strokeWidth={1.7} />
                          </button>
                        </div>
                        <p className="truncate text-xs text-ink-faint">
                          {describe(withProject(item, projectFilter), names)}
                        </p>
                        {hints[item.id] && (
                          <p className="mt-1.5 text-xs text-ink-soft">
                            {METRIC_HINT[item.metric]()}
                            {item.metric === 'hours' &&
                              excludedUsers > 0 &&
                              ` ${t('Служебные учётки из настроек ({0}) не учитываются.', excludedUsers)}`}
                          </p>
                        )}
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
                      onPick={(key) =>
                        setDrill({
                          item: withProject(item, projectFilter),
                          key,
                        })
                      }
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
          projectFilter={projectFilter}
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

      <DrillDrawer
        drill={drill}
        from={from}
        to={to}
        projectId={projectFilter}
        names={names}
        onClose={() => setDrill(null)}
      />

      {creating && (
        <Modal open size="xl" onClose={() => setCreating(false)} title={t('Новый дашборд')}>
          <TemplatePicker
            onCreate={(name, widgets, description) => {
              create(name, widgets, description);
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
          title={t('Название и описание')}
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
                  if (current)
                    void save({ ...current, name, description: naming.description.trim() });
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
          <TextArea
            className="mt-3"
            label={t('На какой вопрос отвечает')}
            value={naming.description}
            maxLength={300}
            rows={3}
            onChange={(event) => setNaming({ ...naming, description: event.target.value })}
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
