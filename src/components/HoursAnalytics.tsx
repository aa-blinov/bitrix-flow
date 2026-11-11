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
  /** Факт минус план; undefined, когда плана нет или он неполный и сравнивать не с чем. */
  variance?: number;
  /** План есть, но покрывает меньше PARTIAL_PLAN_SHARE факта. */
  planPartial?: boolean;
} & Record<HourClassOrUnassigned, number>;

const DETAIL_FIELDS = ['project', 'user', 'month', 'classLabel', 'task'] as const;
// Две группы сверху и задачи листьями в каждом разрезе: при смене таба меняется только
// порядок групп, а не набор колонок. Раньше «Проекты» шли проект, задача, а под задачей
// строки по людям и месяцам, и в каждом табе своя глубина.
const GROUPINGS = {
  project: ['project', 'user'],
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

// ПМ смотрит часы месяцами и кварталами: даты руками набирают редко.
const PERIOD_PRESETS = {
  month: () => {
    const now = new Date();
    return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
  },
  previous: () => {
    const now = new Date();
    return {
      from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  },
  quarter: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    return { from: isoDay(start), to: isoDay(now) };
  },
  three: defaultPeriod,
};
type PeriodPreset = keyof typeof PERIOD_PRESETS;

// План, который покрывает меньше четверти факта, это не перерасход, а оценки, заведённые
// у малой части работы: «+756» при плане 7 ч пугал на самом видном месте сводной.
const PARTIAL_PLAN_SHARE = 0.25;

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

  // Ночной сбор видит списания только до вчерашнего дня: «Обновить» забирает их из
  // портала заново за весь период. Ошибка не прячет уже показанные цифры.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError('');
    try {
      const response = await fetch('/api/analytics/hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error === 'PERIOD_TOO_LONG'
            ? t('Свежие часы забираются максимум за полгода: сузьте период')
            : t('Не удалось забрать свежие часы из Битрикса'),
        );
      }
      setReport(await response.json());
    } catch (reason) {
      setRefreshError(
        reason instanceof Error ? reason.message : t('Не удалось забрать свежие часы из Битрикса'),
      );
    } finally {
      setRefreshing(false);
    }
  }, [from, to]);
  const periodPreset =
    (Object.keys(PERIOD_PRESETS) as PeriodPreset[]).find((key) => {
      const preset = PERIOD_PRESETS[key]();
      return preset.from === from && preset.to === to;
    }) || '';

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
      // Класс виден сразу: запись в портал, обновление зеркала и пересчёт отчёта идут
      // около секунды, и всё это время селект показывал старое значение, будто выбор не
      // сработал. Подзадачи, наследующие класс, догоняет перезагрузка отчёта ниже.
      setReport(
        (prev) =>
          prev && {
            ...prev,
            taskTags: { ...prev.taskTags, [taskId]: tags },
            rows: prev.rows.map((row) =>
              row.taskId === taskId
                ? { ...row, hourClass: cls, conflict: false, source: 'task' as const }
                : row,
            ),
          },
      );
      try {
        await updateTaskFull(taskId, { tags });
      } catch {
        setClassError(t('Не удалось поставить класс задаче #{0}', taskId));
      } finally {
        // И после успеха, и после ошибки: правда в портале, а не в оптимистичной копии.
        await load();
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
            : row.source === 'parent'
              ? t('Класс взят с родительской задачи')
              : row.source === 'project'
                ? t('Класс взят у проекта')
                : undefined
        }
        disabled={savingTask === row.taskId}
        value={row.hourClass === UNASSIGNED ? '' : row.hourClass}
        placeholder={row.conflict ? t('Два тега, выбрать') : t('Выбрать класс')}
        options={HOUR_CLASSES.map((cls) => ({
          value: cls,
          label:
            cls !== row.hourClass || row.source === 'task' || !row.source
              ? CLASS_INFO[cls].label()
              : row.source === 'parent'
                ? t('{0}, от родителя', CLASS_INFO[cls].label())
                : t('{0}, от проекта', CLASS_INFO[cls].label()),
        }))}
        onChange={(event) =>
          event.target.value && void assignClass(row.taskId, event.target.value as HourClass)
        }
      />
    ),
    [assignClass, savingTask],
  );

  // Класс проекта закрывает все его задачи без своего тега: размечать остаётся только
  // исключения. «Не выбран» возвращает проект к ручной разметке задач.
  const assignProjectClass = useCallback(
    async (projectId: string, cls: HourClass | null) => {
      setSavingTask(`project:${projectId}`);
      setClassError('');
      // Как и у задачи, класс проекта виден сразу. Он достаётся строкам без своего
      // класса и без конфликта, ровно как в resolveWithParents на сервере.
      setReport((prev) => {
        if (!prev) return prev;
        const projectClasses = { ...prev.projectClasses };
        if (cls) projectClasses[projectId] = cls;
        else delete projectClasses[projectId];
        return {
          ...prev,
          projectClasses,
          rows: prev.rows.map((row) =>
            row.projectId === projectId &&
            !row.conflict &&
            (row.source === 'project' || !row.source)
              ? {
                  ...row,
                  hourClass: cls ?? UNASSIGNED,
                  source: cls ? ('project' as const) : ('' as const),
                }
              : row,
          ),
        };
      });
      try {
        const response = await fetch('/api/analytics/project-class', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, hourClass: cls }),
        });
        if (!response.ok) throw new Error();
      } catch {
        setClassError(t('Не удалось поставить класс проекту'));
      } finally {
        await load();
        setSavingTask('');
      }
    },
    [load],
  );
  const projectClassSelect = useCallback(
    (projectId: string, project: string) =>
      projectId === NO_PROJECT_ID ? null : (
        <SelectField
          size="sm"
          variant="boxed"
          className="w-full"
          aria-label={t('Класс проекта {0}', project)}
          title={t('Задачи проекта без своего тега получают этот класс')}
          disabled={savingTask === `project:${projectId}`}
          value={report?.projectClasses?.[projectId] || ''}
          options={[
            { value: '', label: t('Класс не выбран') },
            ...HOUR_CLASSES.map((cls) => ({ value: cls, label: CLASS_INFO[cls].label() })),
          ]}
          onChange={(event) =>
            void assignProjectClass(projectId, (event.target.value as HourClass) || null)
          }
        />
      ),
    [assignProjectClass, savingTask, report],
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

  // Лист это задача: строки отчёта бьются ещё и по месяцам и людям, а в листе они
  // складываются в одну задачу внутри своей группы.
  const leaves = useMemo<DetailRow[]>(() => {
    const levels = GROUPINGS[groupingKey];
    const merged = new Map<string, DetailRow>();
    for (const row of detail) {
      const key = [...levels.map((level) => row[level]), row.taskId].join('|');
      const leaf = merged.get(key);
      if (leaf) leaf.hours += row.hours;
      else merged.set(key, { ...row });
    }
    return [...merged.values()];
  }, [detail, groupingKey]);

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
    for (const entry of byProject.values()) {
      entry.planPartial = entry.plan > 0 && entry.plan < entry.total * PARTIAL_PLAN_SHARE;
      entry.variance = entry.plan > 0 && !entry.planPartial ? entry.total - entry.plan : undefined;
    }
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
      action: projectId ? projectClassSelect(projectId, project) : undefined,
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
  }, [pivot, projectClassSelect]);

  const pivotColumns = useMemo(
    () => [
      pivotHelper.accessor('project', {
        header: () => t('Проект'),
        // Класс проекта под названием, а не своей колонкой: лишняя колонка выталкивала
        // «Нераспределено» за правый край на обычном ноутбучном экране.
        cell: (info) => (
          <div className="flex min-w-40 flex-col items-start gap-1 py-0.5">
            <button
              type="button"
              className="text-left text-ink hover:underline"
              onClick={() => drill(info.row.original.projectId)}
            >
              {info.getValue()}
            </button>
            {projectClassSelect(info.row.original.projectId, info.row.original.project)}
          </div>
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
                const row = info.row.original;
                if (row.planPartial)
                  return (
                    <span
                      className="text-xs text-ink-faint"
                      title={t(
                        'Оценки есть у малой части работы: план {0} ч при факте {1} ч',
                        fmt(row.plan),
                        fmt(row.total),
                      )}
                    >
                      {t('план неполный')}
                    </span>
                  );
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
    [pivot, drill, classFilter, showClassTotal, projectClassSelect],
  );

  const detailColumns = useMemo(
    () => [
      ...GROUPINGS[groupingKey].map((level) =>
        detailHelper.accessor(level, {
          header: () =>
            ({
              project: t('Проект'),
              user: t('Исполнитель'),
              month: t('Месяц'),
              classLabel: t('Класс'),
            })[level],
        }),
      ),
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
      ...((GROUPINGS[groupingKey] as readonly string[]).includes('classLabel')
        ? []
        : [
            detailHelper.accessor('classLabel', {
              header: () => t('Класс'),
              cell: (info) =>
                info.row.getIsGrouped() ? info.getValue() : classSelect(info.row.original),
            }),
          ]),
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
    [classSelect, groupingKey],
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
              onClick={() => void refresh()}
              disabled={isLoading || refreshing}
              title={t('Забрать свежие списания из Битрикса')}
              icon={
                <RefreshCw
                  className={isLoading || refreshing ? 'animate-spin' : ''}
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
            <SegmentedControl
              size="sm"
              value={periodPreset}
              onChange={(value) => setParams(PERIOD_PRESETS[value as PeriodPreset]())}
              options={[
                { value: 'month', label: t('Этот месяц') },
                { value: 'previous', label: t('Прошлый месяц') },
                { value: 'quarter', label: t('Квартал') },
                { value: 'three', label: t('3 месяца') },
              ]}
            />
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
        {refreshError ? <Notice tone="danger">{refreshError}</Notice> : null}

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
                {t(
                  'Отклонение считается, когда оценки покрывают хотя бы четверть факта; в итоге складываются только такие проекты.',
                )}
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
                  rows={leaves.map((row) => ({
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
                  leafFields={groupingKey === 'class' ? [] : ['classLabel']}
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
                  data={leaves}
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
