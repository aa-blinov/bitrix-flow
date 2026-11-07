'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, RefreshCw, X } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl } from '@/components/monos/toolbar';
import { DataTable, type DataTableFeatures } from '@/components/DataTable';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { downloadCsv } from '@/lib/csv';
import { HOUR_CLASSES, UNASSIGNED, type HourClassOrUnassigned } from '@/lib/hour-class';
import type { HourRow, HoursReport } from '@/lib/hours';
import { dateFormat, numberFormat, t } from '@/lib/i18n';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { cn } from '@/lib/utils';
import { useKanbanStore } from '@/store/kanban';

const ALL_CLASSES: HourClassOrUnassigned[] = [...HOUR_CLASSES, UNASSIGNED];

// Подписи геттерами: язык известен только после монтирования.
const CLASS_INFO: Record<HourClassOrUnassigned, { label: () => string; hint: () => string }> = {
  commercial: {
    label: () => t('Коммерческие'),
    hint: () => t('Клиент платит, часы становятся выручкой'),
  },
  defect: { label: () => t('Брак'), hint: () => t('Сделано, но выставить нельзя') },
  internal: {
    label: () => t('Внутренняя разработка'),
    hint: () => t('Продукт, инфраструктура, свои сервисы'),
  },
  presale: { label: () => t('Пресейл'), hint: () => t('Офферы, пилоты, демо') },
  other: { label: () => t('Прочие'), hint: () => t('Аккаунтинг, отчётность, оргвопросы') },
  unassigned: {
    label: () => t('Нераспределено'),
    hint: () => t('Класс не проставлен. Чем ближе к нулю, тем честнее картина'),
  },
};

const HOURS = numberFormat({ maximumFractionDigits: 1 });
const PERCENT = numberFormat({ style: 'percent', maximumFractionDigits: 0 });
const COLLECTED = dateFormat({
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
const fmt = (value: number) => HOURS.format(value);

type DetailRow = HourRow & { project: string; user: string; classLabel: string };
type PivotRow = {
  projectId: string;
  project: string;
  total: number;
  plan: number;
  /** Факт минус план; undefined, когда плана нет и сравнивать не с чем. */
  variance?: number;
} & Record<HourClassOrUnassigned, number>;

const GROUPINGS = {
  project: ['project', 'task'],
  user: ['user', 'project'],
  month: ['month', 'project'],
  class: ['classLabel', 'project'],
} as const;
type GroupingKey = keyof typeof GROUPINGS;

const isoDay = (date: Date) => date.toLocaleDateString('en-CA');
function defaultPeriod() {
  const now = new Date();
  return { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: isoDay(now) };
}

const sumBy = (rows: HourRow[], pick: (row: HourRow) => boolean) =>
  rows.reduce((total, row) => (pick(row) ? total + row.hours : total), 0);

const detailHelper = createColumnHelper<DataTableFeatures, DetailRow>();
const pivotHelper = createColumnHelper<DataTableFeatures, PivotRow>();

// Фильтры живут в URL, как переменные дашборда в Grafana: ссылка открывает ровно
// тот же разрез, и Обновить в браузере его не сбрасывает.
function HoursAnalyticsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallback = useMemo(() => defaultPeriod(), []);
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const rawClass = searchParams.get('class');
  const classFilter = ALL_CLASSES.includes(rawClass as HourClassOrUnassigned)
    ? (rawClass as HourClassOrUnassigned)
    : null;
  const projectFilter = searchParams.get('project');
  const rawBy = searchParams.get('by') || '';
  const groupingKey: GroupingKey = rawBy in GROUPINGS ? (rawBy as GroupingKey) : 'project';

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
  const setClassFilter = (value: HourClassOrUnassigned | null) => setParams({ class: value });
  const setProjectFilter = useCallback(
    (value: string | null) => setParams({ project: value }),
    [setParams],
  );

  const memberId = useKanbanStore((state) => state.memberId);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);

  const [report, setReport] = useState<HoursReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsAdmin(data?.role === 'admin'))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!memberId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`/api/analytics/hours?${params}`);
      if (!response.ok) throw new Error(t('Не удалось получить часы'));
      setReport(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Не удалось получить часы'));
    } finally {
      setIsLoading(false);
    }
  }, [memberId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectName = useCallback(
    (id: string) =>
      id === NO_PROJECT_ID
        ? t(NO_PROJECT_NAME)
        : projects.find((project) => project.id === id)?.name || t('Проект {0}', id),
    [projects],
  );
  const userName = useCallback(
    (id: string) => users.find((user) => user.id === id)?.name || `#${id}`,
    [users],
  );

  const rows = useMemo(() => report?.rows ?? [], [report]);
  // Плитки смотрят только на фильтр проекта: иначе выбранный класс показывал бы 100%.
  const projectRows = useMemo(
    () => (projectFilter ? rows.filter((row) => row.projectId === projectFilter) : rows),
    [rows, projectFilter],
  );
  const total = useMemo(() => sumBy(projectRows, () => true), [projectRows]);
  const visible = useMemo(
    () => (classFilter ? projectRows.filter((row) => row.hourClass === classFilter) : projectRows),
    [projectRows, classFilter],
  );

  const detail = useMemo<DetailRow[]>(
    () =>
      visible.map((row) => ({
        ...row,
        project: projectName(row.projectId),
        user: userName(row.userId),
        classLabel: CLASS_INFO[row.hourClass].label(),
      })),
    [visible, projectName, userName],
  );

  const plans = useMemo(() => report?.projectPlans ?? {}, [report]);
  const pivot = useMemo<PivotRow[]>(() => {
    const byProject = new Map<string, PivotRow>();
    const entryFor = (projectId: string) => {
      let entry = byProject.get(projectId);
      if (!entry) {
        entry = {
          projectId,
          project: projectName(projectId),
          total: 0,
          plan: plans[projectId] || 0,
          ...(Object.fromEntries(ALL_CLASSES.map((cls) => [cls, 0])) as Record<
            HourClassOrUnassigned,
            number
          >),
        };
        byProject.set(projectId, entry);
      }
      return entry;
    };
    for (const row of classFilter ? visible : rows) {
      const entry = entryFor(row.projectId);
      entry[row.hourClass] += row.hours;
      entry.total += row.hours;
    }
    // Проект с планом и без списаний тоже строка: это работа, к которой не приступили.
    if (!classFilter) for (const projectId of Object.keys(plans)) entryFor(projectId);
    for (const entry of byProject.values())
      entry.variance = entry.plan > 0 ? entry.total - entry.plan : undefined;
    return [...byProject.values()];
  }, [rows, visible, classFilter, projectName, plans]);

  const setProjectClass = useCallback(
    async (projectId: string, hourClass: string) => {
      const response = await fetch('/api/analytics/project-class', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, hourClass: hourClass || null }),
      });
      if (response.ok) void load();
      else setError(t('Не удалось сохранить класс проекта'));
    },
    [load],
  );

  const pivotColumns = useMemo(
    () => [
      pivotHelper.accessor('project', {
        header: () => t('Проект'),
        cell: (info) => (
          <button
            type="button"
            className="min-w-40 text-left text-ink hover:underline"
            onClick={() => setProjectFilter(info.row.original.projectId)}
          >
            {info.getValue()}
          </button>
        ),
        footer: () => t('Итого'),
      }),
      pivotHelper.accessor('total', {
        header: () => t('Всего'),
        cell: (info) => <span className="text-ink">{fmt(info.getValue())}</span>,
        footer: () => fmt(pivot.reduce((sum, row) => sum + row.total, 0)),
      }),
      // План проектный, а факт с фильтром класса это лишь часть часов проекта:
      // такое сравнение врало бы, поэтому план виден только без фильтра класса.
      ...(classFilter
        ? []
        : [
            pivotHelper.accessor('plan', {
              header: () => t('План'),
              cell: (info) => (info.getValue() ? fmt(info.getValue()) : ''),
              footer: () => fmt(pivot.reduce((sum, row) => sum + row.plan, 0)),
            }),
            pivotHelper.accessor('variance', {
              header: () => t('Отклонение'),
              sortUndefined: 'last',
              footer: () => {
                const value = pivot.reduce((sum, row) => sum + (row.variance ?? 0), 0);
                return `${value > 0 ? '+' : ''}${fmt(value)}`;
              },
              cell: (info) => {
                const value = info.getValue();
                if (value === undefined) return '';
                return (
                  <span className={value > 0 ? 'text-danger-text' : ''}>
                    {value > 0 ? '+' : ''}
                    {fmt(value)}
                  </span>
                );
              },
            }),
          ]),
      ...ALL_CLASSES.map((cls) =>
        pivotHelper.accessor(cls, {
          header: () => CLASS_INFO[cls].label(),
          cell: (info) => (info.getValue() ? fmt(info.getValue()) : ''),
          footer: () => fmt(pivot.reduce((sum, row) => sum + row[cls], 0)),
        }),
      ),
      ...(isAdmin
        ? [
            pivotHelper.display({
              id: 'projectClass',
              header: () => t('Класс проекта'),
              cell: (info) => (
                <SelectField
                  size="sm"
                  variant="boxed"
                  className="w-44"
                  aria-label={t('Класс проекта по умолчанию')}
                  value={report?.projectClasses[info.row.original.projectId] || ''}
                  onChange={(event) =>
                    void setProjectClass(info.row.original.projectId, event.target.value)
                  }
                  options={[
                    { value: '', label: t('Не задан') },
                    ...HOUR_CLASSES.map((cls) => ({ value: cls, label: CLASS_INFO[cls].label() })),
                  ]}
                />
              ),
            }),
          ]
        : []),
    ],
    [pivot, isAdmin, report, setProjectClass, setProjectFilter, classFilter],
  );

  const detailColumns = useMemo(
    () => [
      detailHelper.accessor('project', { header: () => t('Проект') }),
      detailHelper.accessor('user', { header: () => t('Специалист') }),
      detailHelper.accessor('month', { header: () => t('Месяц') }),
      detailHelper.accessor('classLabel', { header: () => t('Класс') }),
      detailHelper.accessor('task', {
        header: () => t('Задача'),
        cell: (info) =>
          info.row.getIsGrouped() ? (
            info.getValue()
          ) : (
            <Link
              className="hover:underline"
              href={`/all-tasks?task=${info.row.original.taskId}`}
              title={info.row.original.conflict ? t('На задаче два разных классовых тега') : ''}
            >
              {info.row.original.conflict ? '! ' : ''}
              {info.getValue()}
            </Link>
          ),
      }),
      detailHelper.accessor('hours', {
        header: () => t('Часы'),
        aggregationFn: 'sum',
        cell: (info) => fmt(info.getValue()),
        aggregatedCell: (info) => fmt(Number(info.getValue()) || 0),
      }),
    ],
    [],
  );

  const exportCsv = () =>
    downloadCsv(`hours-${from}-${to}.csv`, [
      [t('Месяц'), t('Проект'), t('Специалист'), t('Класс'), t('Задача'), t('Часы')],
      ...detail.map((row) => [
        row.month,
        row.project,
        row.user,
        row.classLabel,
        row.task,
        Math.round(row.hours * 100) / 100,
      ]),
    ]);

  const missing = report?.missingWeeks ?? [];

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title={t('Аналитика часов')}
        description={t('Куда уходят часы: пять классов и то, что ещё не размечено')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              disabled={!detail.length}
              icon={<Download size={14} strokeWidth={1.7} />}
            >
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={isLoading}>
              <RefreshCw className={isLoading ? 'animate-spin' : ''} size={14} strokeWidth={1.7} />{' '}
              {t('Обновить')}
            </Button>
          </div>
        }
      />
      <div className="space-y-3 px-4 py-4 lg:px-6">
        <Card padding="none">
          <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="text-ink-soft">{t('Период:')}</span>
            <TextField
              type="date"
              variant="boxed"
              size="sm"
              value={from}
              max={to}
              onChange={(event) => event.target.value && setParams({ from: event.target.value })}
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
            {projectFilter ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setProjectFilter(null)}
                icon={<X size={14} strokeWidth={1.7} />}
              >
                {projectName(projectFilter)}
              </Button>
            ) : null}
            {classFilter ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setClassFilter(null)}
                icon={<X size={14} strokeWidth={1.7} />}
              >
                {CLASS_INFO[classFilter].label()}
              </Button>
            ) : null}
            {report?.collectedAt ? (
              <span className="text-xs text-ink-faint sm:ml-auto">
                {t('Данные на {0}', COLLECTED.format(new Date(report.collectedAt)))}
              </span>
            ) : null}
          </div>
        </Card>

        {missing.length > 0 ? (
          <Notice tone="warning">
            {t(
              'Нет списаний за {0} нед. между {1} и {2}: цифры за них занижены.',
              missing.length,
              missing[0],
              missing[missing.length - 1],
            )}
          </Notice>
        ) : null}

        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : isLoading && !report ? (
          <LoadingState className="min-h-72 bg-transparent" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {ALL_CLASSES.map((cls) => {
                const hours = sumBy(projectRows, (row) => row.hourClass === cls);
                const share = total ? hours / total : 0;
                return (
                  <Card
                    key={cls}
                    interactive
                    selected={classFilter === cls}
                    padding="sm"
                    aria-pressed={classFilter === cls}
                    onClick={() => setClassFilter(classFilter === cls ? null : cls)}
                    className={cn(cls === UNASSIGNED ? 'border-dashed' : '')}
                    title={CLASS_INFO[cls].hint()}
                  >
                    <p className="text-xs text-ink-soft">{CLASS_INFO[cls].label()}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                      {t('{0} ч', fmt(hours))}
                    </p>
                    <p
                      className={cn(
                        'text-xs tabular-nums',
                        cls === UNASSIGNED && share > 0.1 ? 'text-danger-text' : 'text-ink-faint',
                      )}
                    >
                      {PERCENT.format(share)}
                    </p>
                  </Card>
                );
              })}
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">{t('Проекты по классам, ч')}</h2>
              <p className="text-xs text-ink-soft">
                {t(
                  'Факт: списания за период. План: оценки корневых задач, у которых срок от создания до дедлайна задевает период.',
                )}
              </p>
              <DataTable
                caption={t('Проекты по классам')}
                columns={pivotColumns}
                data={pivot}
                initialSorting={[{ id: 'total', desc: true }]}
                numeric={[...ALL_CLASSES, 'total', 'plan', 'variance']}
                emptyLabel={t('Списаний за период нет')}
              />
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{t('Детализация')}</h2>
                <SegmentedControl
                  size="sm"
                  value={groupingKey}
                  onChange={(value) => setParams({ by: value === 'project' ? null : value })}
                  options={[
                    { value: 'project', label: t('Проекты') },
                    { value: 'user', label: t('Люди') },
                    { value: 'month', label: t('Месяцы') },
                    { value: 'class', label: t('Классы') },
                  ]}
                />
              </div>
              {/* key пересоздаёт таблицу при смене разреза: раскрытые группы прошлого разреза к новому не подходят. */}
              <DataTable
                key={groupingKey}
                caption={t('Детализация часов')}
                columns={detailColumns}
                data={detail}
                grouping={[...GROUPINGS[groupingKey]]}
                initialSorting={[{ id: 'hours', desc: true }]}
                numeric={['hours']}
                emptyLabel={t('Списаний за период нет')}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function HoursAnalytics() {
  // Suspense вокруг useSearchParams(): без него Next не пререндерит страницу.
  return (
    <Suspense fallback={<LoadingState />}>
      <HoursAnalyticsView />
    </Suspense>
  );
}
