'use client';

// Конструктор дашбордов: виджет собирается из метрики, разреза и фильтров, а не
// пишется кодом. Период общий на экран: ПМ сравнивает виджеты между собой, и разные
// периоды у соседей дали бы числа, которые нельзя сложить в одну картину.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
  type Dashboard,
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
  leadTime: () => t('Медиана дней до закрытия'),
  hours: () => t('Списано часов'),
};
const DIMENSION_LABEL: Record<Dimension, () => string> = {
  none: () => t('Итог'),
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

/** Стартовый набор: то, что ПМ спрашивает первым, чтобы экран не начинался с пустоты. */
const STARTER = (): Widget[] => [
  widget({ metric: 'closed' }),
  widget({ metric: 'overdue' }),
  widget({ metric: 'onTime' }),
  widget({ metric: 'hours' }),
  widget({ metric: 'closed', by: 'week', view: 'columns', wide: true }),
  widget({ metric: 'hours', by: 'project', view: 'bars' }),
  widget({ metric: 'overdue', by: 'user', view: 'bars' }),
];

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
    item.by !== 'none' ? DIMENSION_LABEL[item.by]().toLowerCase() : '',
    item.projectId ? names.project(item.projectId) : '',
    item.userId ? names.user(item.userId) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const LIMIT = 12;

function Chart({ item, result, names }: { item: Widget; result?: WidgetResult; names: Names }) {
  const [all, setAll] = useState(false);
  if (!result) return <div className="h-24 animate-pulse rounded-ui bg-surface-2" />;
  if (item.view === 'number' || item.by === 'none')
    return (
      <p className="text-3xl font-semibold tabular-nums text-ink">
        {formatValue(item.metric, result.total)}
      </p>
    );
  const points = result.points;
  if (!points.length) return <p className="text-sm text-ink-faint">{t('Нет данных за период')}</p>;
  const max = Math.max(...points.map((point) => point.value ?? 0), 0) || 1;

  if (item.view === 'columns')
    return (
      <div>
        <div className="flex h-40 items-end gap-1" role="list">
          {points.map((point) => (
            <div
              key={point.key}
              role="listitem"
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${names.key(item.by, point.key)}: ${formatValue(item.metric, point.value)}`}
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
            </div>
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
                <td className="py-1.5 pr-2 text-ink">{names.key(item.by, point.key)}</td>
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
      {/* Одна сетка на все строки: колонка значения общая, и дорожки полос одной длины. */}
      <div className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-x-2 gap-y-1.5 text-sm">
        {shown.map((point) => (
          <div key={point.key} className="contents">
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
          </div>
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
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <SelectField
            label={t('Что считать')}
            value={item.metric}
            onChange={(event) => update({ metric: event.target.value as Metric })}
            options={METRICS.map((metric) => ({ value: metric, label: METRIC_LABEL[metric]() }))}
          />
          <SelectField
            label={t('Разрез')}
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
          <Chart item={item} result={preview} names={names} />
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
  const [results, setResults] = useState<Record<string, WidgetResult>>({});
  const [collectedFrom, setCollectedFrom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Widget | null>(null);
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null);

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

  useEffect(() => {
    if (!memberId) return;
    fetch('/api/dashboards', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data) => setDashboards(data.dashboards))
      .catch(() => setError(t('Не удалось загрузить дашборды.')));
  }, [memberId]);

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
  useEffect(() => {
    if (!active?.widgets.length) return;
    let cancelled = false;
    query(active.widgets, from, to)
      .then((data) => {
        if (cancelled) return;
        setResults(data.results);
        setCollectedFrom(data.collectedFrom);
      })
      .catch(() => !cancelled && setError(t('Не удалось посчитать виджеты.')));
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
    const response = await fetch('/api/dashboards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dashboard),
    });
    if (!response.ok) setError(t('Не удалось сохранить дашборд.'));
  };

  const create = (name: string, widgets: Widget[]) => {
    const dashboard = { id: crypto.randomUUID(), name, widgets };
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
        {dashboards === null ? (
          <LoadingState />
        ) : !active ? (
          <EmptyState
            icon={<LayoutDashboard className="size-8" strokeWidth={1.5} />}
            title={t('Дашбордов пока нет')}
            description={t(
              'Начните с готового набора: закрыто, просрочено, в срок, часы, поток по неделям. Любой виджет потом можно поменять.',
            )}
            actions={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => create(t('Обзор'), STARTER())}>{t('Создать обзор')}</Button>
                <Button variant="secondary" onClick={() => setNaming({ id: '', name: '' })}>
                  {t('Пустой дашборд')}
                </Button>
              </div>
            }
          />
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
                onClick={() => setNaming({ id: '', name: '' })}
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
                    <Chart item={item} result={results[item.id]} names={names} />
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

      {naming && (
        <Modal
          open
          size="sm"
          onClose={() => setNaming(null)}
          title={naming.id ? t('Переименовать дашборд') : t('Новый дашборд')}
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
                  else create(name, []);
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
