'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, RefreshCw, X } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { SelectField } from '@/components/monos/SelectField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl } from '@/components/monos/toolbar';
import { DataTable, type DataTableFeatures } from '@/components/DataTable';
import { DetailTree, PivotCards, type MobilePivotRow } from '@/components/HoursMobile';
import { useIsMobile } from '@/hooks/useIsMobile';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { downloadCsv } from '@/lib/csv';
import {
  HOUR_CLASS_TAG,
  HOUR_CLASSES,
  UNASSIGNED,
  type HourClass,
  type HourClassOrUnassigned,
} from '@/lib/hour-class';
import { updateTaskFull } from '@/lib/bitrix24';
import { tagKey } from '@/lib/task-tags';
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
    hint: () => t('У задачи нет тега класса. Чем ближе к нулю, тем честнее картина'),
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
const CLASS_TAG_KEYS = new Set(HOUR_CLASSES.map((cls) => tagKey(HOUR_CLASS_TAG[cls])));

type DetailRow = HourRow & { project: string; user: string; classLabel: string };
type PivotRow = {
  projectId: string;
  project: string;
  total: number;
  plan: number;
  /** Факт минус план; undefined, когда плана нет и сравнивать не с чем. */
  variance?: number;
} & Record<HourClassOrUnassigned, number>;

const DETAIL_FIELDS = ['project', 'user', 'month', 'classLabel', 'task'] as const;
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
  // Итог класса показывает класс по всем проектам. Снимает фильтр класса только повторное
  // нажатие без проекта: иначе из разреза «проект плюс класс» он выключал бы класс.
  const showClassTotal = useCallback(
    (cls: string) =>
      setParams({ class: classFilter === cls && !projectFilter ? null : cls, project: null }),
    [setParams, classFilter, projectFilter],
  );
  // Клик по проекту или числу в сводной ведёт к задачам за этим числом: фильтр плюс
  // прокрутка к раскрытой детализации, иначе ответ оставался свёрнутым ниже экрана.
  const detailRef = useRef<HTMLElement>(null);
  const drill = useCallback(
    (projectId: string, hourClass?: HourClassOrUnassigned) => {
      setParams(hourClass ? { project: projectId, class: hourClass } : { project: projectId });
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    },
    [setParams],
  );

  const isMobile = useIsMobile();
  const memberId = useKanbanStore((state) => state.memberId);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);

  const [report, setReport] = useState<HoursReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

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

  // Класс ставится тегом в самом Битриксе: аналитика своей разметки не хранит. Прокси
  // обновляет зеркало до ответа, поэтому сразу после записи отчёт уже видит тег, а с ним
  // и подзадачи, которые наследуют класс.
  const [savingTask, setSavingTask] = useState('');
  const [classError, setClassError] = useState('');
  const assignClass = useCallback(
    async (taskId: string, cls: HourClass) => {
      const own = report?.taskTags?.[taskId] || [];
      const tags = [...own.filter((tag) => !CLASS_TAG_KEYS.has(tagKey(tag))), HOUR_CLASS_TAG[cls]];
      setSavingTask(taskId);
      setClassError('');
      try {
        await updateTaskFull(taskId, { tags });
        await load();
      } catch {
        setClassError(t('Не удалось поставить класс задаче #{0}', taskId));
      } finally {
        setSavingTask('');
      }
    },
    [report, load],
  );
  const classSelect = useCallback(
    (row: HourRow) => (
      <SelectField
        size="sm"
        variant="boxed"
        className="min-w-36"
        aria-label={t('Класс задачи {0}', row.task)}
        title={
          row.conflict
            ? t('На задаче два разных классовых тега')
            : row.inherited
              ? t('Класс взят с родительской задачи')
              : undefined
        }
        disabled={savingTask === row.taskId}
        value={row.hourClass === UNASSIGNED ? '' : row.hourClass}
        placeholder={row.conflict ? t('Два тега, выбрать') : t('Выбрать класс')}
        options={HOUR_CLASSES.map((cls) => ({
          value: cls,
          label:
            row.inherited && cls === row.hourClass
              ? t('{0}, от родителя', CLASS_INFO[cls].label())
              : CLASS_INFO[cls].label(),
        }))}
        onChange={(event) =>
          event.target.value && void assignClass(row.taskId, event.target.value as HourClass)
        }
      />
    ),
    [assignClass, savingTask],
  );

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
    // Сводная не сужается фильтром проекта: после перехода из ячейки остальные проекты
    // должны остаться на месте, иначе вернуться к сравнению можно только сбросом фильтра.
    for (const row of classFilter ? rows.filter((r) => r.hourClass === classFilter) : rows) {
      const entry = entryFor(row.projectId);
      entry[row.hourClass] += row.hours;
      entry.total += row.hours;
    }
    // Проект с планом и без списаний тоже строка: это работа, к которой не приступили.
    if (!classFilter) for (const projectId of Object.keys(plans)) entryFor(projectId);
    for (const entry of byProject.values())
      entry.variance = entry.plan > 0 ? entry.total - entry.plan : undefined;
    return [...byProject.values()];
  }, [rows, classFilter, projectName, plans]);

  const mobilePivot = useMemo(() => {
    const toCard = (
      row: Omit<PivotRow, 'projectId' | 'project'>,
      projectId: string,
      project: string,
    ): MobilePivotRow => ({
      projectId,
      project,
      total: row.total,
      plan: row.plan,
      variance: row.variance,
      classes: ALL_CLASSES.map((cls) => ({
        key: cls,
        label: CLASS_INFO[cls].label(),
        hours: row[cls],
      })),
    });
    const sum = (pick: (row: PivotRow) => number) =>
      pivot.reduce((total, row) => total + pick(row), 0);
    const totals = {
      total: sum((row) => row.total),
      plan: sum((row) => row.plan),
      variance: sum((row) => row.variance ?? 0),
      ...(Object.fromEntries(ALL_CLASSES.map((cls) => [cls, sum((row) => row[cls])])) as Record<
        HourClassOrUnassigned,
        number
      >),
    };
    return {
      rows: [...pivot]
        .sort((a, b) => b.total - a.total)
        .map((row) => toCard(row, row.projectId, row.project)),
      totals: toCard(totals, '', t('Итого')),
    };
  }, [pivot]);

  const pivotColumns = useMemo(
    () => [
      pivotHelper.accessor('project', {
        header: () => t('Проект'),
        cell: (info) => (
          <button
            type="button"
            className="min-w-40 text-left text-ink hover:underline"
            onClick={() => drill(info.row.original.projectId)}
          >
            {info.getValue()}
          </button>
        ),
        footer: () => t('Итого'),
      }),
      pivotHelper.accessor('total', {
        header: () => t('Всего'),
        cell: (info) => (
          <button
            type="button"
            className="text-ink hover:underline"
            onClick={() => drill(info.row.original.projectId)}
          >
            {fmt(info.getValue())}
          </button>
        ),
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
          cell: (info) =>
            info.getValue() ? (
              <button
                type="button"
                className="hover:text-ink hover:underline"
                onClick={() => drill(info.row.original.projectId, cls)}
              >
                {fmt(info.getValue())}
              </button>
            ) : (
              ''
            ),
          // Ноль в подвале не кнопка: фильтр по пустому классу показал бы пустые таблицы.
          footer: () => {
            const value = pivot.reduce((sum, row) => sum + row[cls], 0);
            return value ? (
              <button type="button" className="hover:underline" onClick={() => showClassTotal(cls)}>
                {fmt(value)}
              </button>
            ) : (
              ''
            );
          },
        }),
      ),
    ],
    [pivot, drill, classFilter, showClassTotal],
  );

  const detailColumns = useMemo(
    () => [
      detailHelper.accessor('project', { header: () => t('Проект') }),
      detailHelper.accessor('user', { header: () => t('Специалист') }),
      detailHelper.accessor('month', { header: () => t('Месяц') }),
      detailHelper.accessor('classLabel', {
        header: () => t('Класс'),
        cell: (info) =>
          info.row.getIsGrouped() ? info.getValue() : classSelect(info.row.original),
      }),
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
        cell: (info) => (
          <Link className="hover:underline" href={`/all-tasks?task=${info.row.original.taskId}`}>
            {fmt(info.getValue())}
          </Link>
        ),
        aggregatedCell: (info) => fmt(Number(info.getValue()) || 0),
      }),
    ],
    [classSelect],
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              disabled={isLoading}
              icon={
                <RefreshCw
                  className={isLoading ? 'animate-spin' : ''}
                  size={14}
                  strokeWidth={1.7}
                />
              }
            >
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

        {classError ? <Notice tone="danger">{classError}</Notice> : null}

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
                    <p className="mt-1 truncate text-xs text-ink-faint">
                      {cls === UNASSIGNED ? t('без тега') : `#${HOUR_CLASS_TAG[cls]}`}
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
                )}{' '}
                {t('Отклонение в итоге складывается только по проектам с планом.')}
              </p>
              {isMobile ? (
                <PivotCards
                  rows={mobilePivot.rows}
                  totals={mobilePivot.totals}
                  showPlan={!classFilter}
                  fmt={fmt}
                  onProject={(projectId) => drill(projectId)}
                  onCell={(projectId, cls) => drill(projectId, cls as HourClassOrUnassigned)}
                  onClassTotal={(cls) => showClassTotal(cls)}
                  emptyLabel={t('Списаний за период нет')}
                />
              ) : (
                <DataTable
                  caption={t('Проекты по классам')}
                  columns={pivotColumns}
                  data={pivot}
                  initialSorting={[{ id: 'total', desc: true }]}
                  numeric={[...ALL_CLASSES, 'total', 'plan', 'variance']}
                  emptyLabel={t('Списаний за период нет')}
                />
              )}
            </section>

            <section ref={detailRef} className="scroll-mt-4 space-y-2">
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
              {/* key пересоздаёт таблицу при смене разреза и фильтров: раскрытые группы прошлого разреза к новому не подходят, а выбранный проект раскрывается целиком. */}
              {isMobile ? (
                <DetailTree
                  key={`${groupingKey}|${projectFilter}|${classFilter}`}
                  rows={detail.map((row) => ({
                    taskId: row.taskId,
                    task: row.task,
                    hours: row.hours,
                    conflict: row.conflict,
                    // На телефоне выбор класса только там, где его нет: менять разметку
                    // удобнее на большом экране, а пробелы закрывать можно с телефона.
                    action:
                      row.hourClass === UNASSIGNED || row.conflict ? classSelect(row) : undefined,
                    fields: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, row[field]])),
                  }))}
                  levels={[...GROUPINGS[groupingKey]]}
                  leafFields={DETAIL_FIELDS.filter(
                    (field) =>
                      field !== 'task' &&
                      !(GROUPINGS[groupingKey] as readonly string[]).includes(field),
                  )}
                  expandAll={Boolean(projectFilter)}
                  fmt={fmt}
                  emptyLabel={t('Списаний за период нет')}
                />
              ) : (
                <DataTable
                  key={`${groupingKey}|${projectFilter}|${classFilter}`}
                  expandAll={Boolean(projectFilter)}
                  caption={t('Детализация часов')}
                  columns={detailColumns}
                  data={detail}
                  grouping={[...GROUPINGS[groupingKey]]}
                  initialSorting={[{ id: 'hours', desc: true }]}
                  numeric={['hours']}
                  emptyLabel={t('Списаний за период нет')}
                />
              )}
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
