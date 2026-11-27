'use client';

// Один экран на все отчёты ПМ: расчёт на сервере (src/lib/pm-reports.ts), здесь только
// подписи, форматы и фильтры. Фильтры живут в URL, как в аналитике часов: ссылкой можно
// поделиться, и обновление страницы разрез не сбрасывает.
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button } from '@/components/monos/Button';
import { DateField } from '@/components/monos/DateField';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { DataTable, type DataTableFeatures } from '@/components/DataTable';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { downloadCsv } from '@/lib/csv';
import { dateFormat, numberFormat, t } from '@/lib/i18n';
import { FONT } from '@/components/monos/scale';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import type { Cell, ReportRow } from '@/lib/pm-reports';
import type { ReportKind, ReportResponse } from '@/lib/pm-reports-data';
import { cn } from '@/lib/utils';
import { useKanbanStore, useUserDirectory } from '@/store/kanban';

export { PM_REPORTS, PRESETS, type Preset } from '@/lib/pm-report-meta';
import {
  PM_REPORTS,
  PRESETS,
  REASON,
  STATE,
  STATUS,
  type Kind,
  type Preset,
  type TableMeta,
} from '@/lib/pm-report-meta';

// Две цифры после запятой: с одной списание в 0,04 ч выглядело нулём, а сумма строк
// расходилась с плиткой.
const HOURS = numberFormat({ maximumFractionDigits: 2 });
const COUNT = numberFormat({ maximumFractionDigits: 0 });
const DAYS = numberFormat({ maximumFractionDigits: 1 });
const PERCENT = numberFormat({ style: 'percent', maximumFractionDigits: 1 });
const DATE = dateFormat({ day: '2-digit', month: '2-digit', year: '2-digit' });
const DATE_TIME = dateFormat({
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});

/**
 * Часы для показа. Меньше 0,1 ч идут минутами: 20 секунд выглядели «0 ч», а строки по
 * 0,01 ч в сумме не сходились с итогом. unit: дописать «ч» к целым часам (плитки, графики).
 */
export function formatHours(value: number, unit = true) {
  if (value > 0 && value < 0.1) {
    const minutes = Math.round(value * 60);
    return minutes < 1 ? t('<1 мин') : t('{0} мин', minutes);
  }
  return unit ? t('{0} ч', HOURS.format(value)) : HOURS.format(value);
}

/** Доля вниз до десятой процента: 79,99 % у порога 80 % не должна показываться как 80 %. */
export const formatShare = (value: number) => PERCENT.format(Math.floor(value * 1000) / 1000);
const MONTH = dateFormat({ month: '2-digit', year: 'numeric' });

/** Дата портала как есть: день из строки, без сдвига в пояс браузера. */
const portalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? DATE.format(new Date(+match[1], +match[2] - 1, +match[3])) : value;
};

function formatCell(kind: Kind, value: Cell): string {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'hours') return formatHours(Number(value), false);
  if (kind === 'count') return COUNT.format(Number(value));
  if (kind === 'days') return DAYS.format(Number(value));
  if (kind === 'percent') return formatShare(Number(value));
  if (kind === 'date') return portalDate(String(value));
  // Дата и время как в строке портала, в её же поясе: по этому дню задача отбирается в
  // период, и перевод в Москву показывал закрытие 01.11 00:30 как 31.10 вне периода.
  if (kind === 'datetime') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
    return match
      ? `${match[3]}.${match[2]}.${match[1].slice(2)} ${match[4]}:${match[5]}`
      : portalDate(String(value));
  }
  if (kind === 'range') {
    const [start, end] = String(value).split('..');
    return end && end !== start ? `${portalDate(start)}–${portalDate(end)}` : portalDate(start);
  }
  if (kind === 'link') return '';
  if (kind === 'month') {
    const [year, month] = String(value).split('-').map(Number);
    return year && month ? MONTH.format(new Date(year, month - 1, 1)) : String(value);
  }
  if (kind === 'status') return STATUS[String(value)]?.() || String(value);
  if (kind === 'state') return STATE[String(value)]?.() || String(value);
  if (kind === 'reasons')
    return String(value)
      .split(',')
      .map((id) => REASON[id]?.() || id)
      .join(', ');
  return String(value);
}

/** Переход из строки брака в аналитику часов: тот же проект и месяц, все классы. */
const hoursHref = (row: ReportRow) =>
  `/analytics?${new URLSearchParams({
    from: String(row.from),
    to: String(row.to),
    project: String(row.projectId),
  })}`;

const taskHref = (row: ReportRow) =>
  row.projectId && row.projectId !== NO_PROJECT_ID
    ? `/projects/${row.projectId}?task=${encodeURIComponent(String(row.taskId))}`
    : `/all-tasks?task=${encodeURIComponent(String(row.taskId))}`;

const SUMMABLE: Kind[] = ['hours', 'count'];
const helper = createColumnHelper<DataTableFeatures, ReportRow>();

function ReportTableView({
  meta,
  rows,
  grouping,
  csvName,
}: {
  meta: TableMeta;
  rows: ReportRow[];
  grouping: string | null;
  csvName: string;
}) {
  const isMobile = useIsMobile();
  const columns = useMemo(
    () =>
      meta.columns.map((column) =>
        // Сортировка видит пустое как undefined, чтобы sortUndefined отправил его в конец
        // (null таблица ставила первым), а дату как момент: строки с разными смещениями
        // по тексту сортировались не по времени. Показ берёт исходное значение строки.
        helper.accessor(
          (row) => {
            const value = row[column.id];
            if (value === null || value === undefined || value === '') return undefined;
            return column.kind === 'datetime' ? Date.parse(String(value)) : (value as Cell);
          },
          {
            id: column.id,
            header: () => column.label(),
            sortUndefined: 'last',
            ...(SUMMABLE.includes(column.kind) && column.id !== 'deltaShare'
              ? {
                  aggregationFn: 'sum' as const,
                  aggregatedCell: (info: { getValue: () => unknown }) =>
                    formatCell(column.kind, Number(info.getValue()) || 0),
                }
              : column.kind === 'days' && column.id !== 'lead'
                ? // Дни не складываются: сумма просрочек по проекту ничего не значит,
                  // а самая старая задача группы значит. Длительность до закрытия не
                  // сворачивается: максимум под ней читался как типичный срок.
                  {
                    aggregationFn: 'max' as const,
                    aggregatedCell: (info: { getValue: () => unknown }) => {
                      const value = info.getValue();
                      return value === undefined || value === null
                        ? ''
                        : t('макс. {0}', formatCell(column.kind, Number(value)));
                    },
                  }
                : // Иначе таблица складывает любое число, и доли превращались в 300 %.
                  { aggregatedCell: () => null }),
            cell: (info) => {
              const value = info.row.original[column.id] as Cell;
              if (info.row.getIsGrouped()) return formatCell(column.kind, value);
              if (column.kind === 'task')
                return (
                  <Link
                    prefetch={false}
                    className="hover:underline"
                    href={taskHref(info.row.original)}
                  >
                    {String(value)}
                  </Link>
                );
              if (column.kind === 'link')
                return (
                  <Link
                    prefetch={false}
                    className="text-ink underline"
                    href={hoursHref(info.row.original)}
                  >
                    {t('Открыть')}
                  </Link>
                );
              // Причины короткие: каждая своей строкой без переноса. Через запятую в узкой
              // колонке они рвались посередине и раздували строку в пять этажей.
              if (column.kind === 'reasons')
                return (
                  <span className="flex flex-col whitespace-nowrap">
                    {formatCell(column.kind, value)
                      .split(', ')
                      .map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                  </span>
                );
              const text = formatCell(column.kind, value);
              const negative = column.id === 'delta' || column.id === 'deltaShare';
              return (
                <span className={cn(negative && Number(value) > 0 && 'text-danger-text')}>
                  {negative && Number(value) > 0 ? '+' : ''}
                  {text}
                </span>
              );
            },
          },
        ),
      ),
    [meta],
  );

  const csvColumns = meta.columns.filter((column) => column.kind !== 'link');
  const exportCsv = () =>
    downloadCsv(csvName, [
      csvColumns.map((column) => column.label()),
      ...rows.map((row) =>
        csvColumns.map((column) =>
          ['hours', 'count', 'days'].includes(column.kind)
            ? row[column.id]
            : formatCell(column.kind, row[column.id]),
        ),
      ),
    ]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          {meta.title()} <span className="font-normal text-ink-faint">{rows.length}</span>
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={exportCsv}
          disabled={!rows.length}
          icon={<Download size={14} strokeWidth={1.7} />}
        >
          CSV
        </Button>
      </div>
      {isMobile ? (
        <MobileRows meta={meta} rows={rows} />
      ) : (
        <DataTable
          key={grouping || 'flat'}
          caption={meta.title()}
          columns={columns}
          data={rows}
          grouping={grouping ? [grouping] : []}
          initialSorting={[meta.sort]}
          numeric={meta.columns
            .filter((column) => ['hours', 'count', 'days', 'percent'].includes(column.kind))
            .map((column) => column.id)}
          emptyLabel={meta.empty()}
          // 300 строк по восемь ячеек давали почти 5 тысяч узлов и долгую задачу на переходе;
          // остальное догружает «Показать ещё».
          pageSize={100}
        />
      )}
    </section>
  );
}

// На телефоне таблица в восемь колонок не читается: строка становится карточкой.
const MOBILE_PAGE = 100;

function MobileRows({ meta, rows }: { meta: TableMeta; rows: ReportRow[] }) {
  const [shown, setShown] = useState(MOBILE_PAGE);
  const sorted = useMemo(() => {
    const { id, desc } = meta.sort;
    // Пустые всегда в конце, как в таблице на десктопе: задача без срока не должна
    // оттеснять ближайшие сроки за кнопку «Показать ещё».
    return [...rows].sort((a, b) => {
      const x = a[id];
      const y = b[id];
      const empty = (value: Cell | undefined) =>
        value === null || value === undefined || value === '';
      if (empty(x) || empty(y)) return Number(empty(x)) - Number(empty(y));
      const order = x! < y! ? -1 : x! > y! ? 1 : 0;
      return desc ? -order : order;
    });
  }, [rows, meta.sort]);
  if (!rows.length)
    return <p className="py-6 text-center text-xs text-ink-faint">{meta.empty()}</p>;
  const title = meta.columns.find((column) => column.kind === 'task') || meta.columns[0];
  const link = meta.columns.some((column) => column.kind === 'link');
  return (
    <>
      <ul className="space-y-2">
        {sorted.slice(0, shown).map((row, index) => (
          <li key={index} className="relative rounded-ui border border-line bg-surface p-3 text-sm">
            {title.kind === 'task' ? (
              // Ссылка растянута на всю карточку: на телефоне в название высотой 18px не попасть.
              <Link
                prefetch={false}
                className="font-medium text-ink after:absolute after:inset-0 after:rounded-ui hover:underline"
                href={taskHref(row)}
              >
                {String(row.task)}
              </Link>
            ) : (
              <p className="font-medium text-ink">{formatCell(title.kind, row[title.id])}</p>
            )}
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {meta.columns
                .filter((column) => column !== title && formatCell(column.kind, row[column.id]))
                .map((column) => (
                  <div key={column.id} className="contents">
                    <dt className="text-ink-faint">{column.label()}</dt>
                    <dd className="text-right tabular-nums text-ink-soft">
                      {formatCell(column.kind, row[column.id])}
                    </dd>
                  </div>
                ))}
            </dl>
            {link && (
              <Link
                prefetch={false}
                className="mt-2 inline-flex min-h-11 items-center text-xs text-ink underline"
                href={hoursHref(row)}
              >
                {t('Задачи в аналитике часов')}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {/* Остаток не прячется молча: число в заголовке и плитке должно быть доступно целиком. */}
      {sorted.length > shown && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2 min-h-11 w-full"
          onClick={() => setShown(shown + MOBILE_PAGE)}
        >
          {t(
            'Показать ещё {0}, осталось {1}',
            Math.min(MOBILE_PAGE, sorted.length - shown),
            sorted.length - shown,
          )}
        </Button>
      )}
    </>
  );
}

type Response = ReportResponse;

/** Человек по id: пустой и нулевой это «без ответственного», а не технический «#0». */
export const personName = (users: { id: string; name: string }[], id: string) =>
  !id || id === '0'
    ? t('Без ответственного')
    : users.find((user) => user.id === id)?.name || `#${id}`;

/**
 * Варианты фильтра проекта: активные, «Без проекта», затем архивные с пометкой. Архивный
 * проект нужен для итогового отчёта за месяц, когда проект уже закрыли.
 */
export function projectOptions(projects: { id: string; name: string; isArchived?: boolean }[]) {
  return [
    ...projects
      .filter((project) => !project.isArchived)
      .map((project) => ({ value: project.id, label: project.name })),
    { value: NO_PROJECT_ID, label: t(NO_PROJECT_NAME) },
    ...projects
      .filter((project) => project.isArchived)
      .map((project) => ({ value: project.id, label: t('{0} (архив)', project.name) })),
  ];
}

/** Недели для предупреждения: дд.мм через запятую, длинный список сокращается. */
export const weekList = (weeks: string[]) =>
  weeks.length > 4
    ? t('{0} и ещё {1}', weeks.slice(0, 3).map(portalDate).join(', '), weeks.length - 3)
    : weeks.map(portalDate).join(', ');

function PmReportView({ kind }: { kind: ReportKind }) {
  const meta = PM_REPORTS[kind];
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallback = useMemo(() => PRESETS[meta.defaultPeriod](), [meta.defaultPeriod]);
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const projectId = meta.noProject ? null : searchParams.get('project');
  const filter = searchParams.get('filter');
  const days = searchParams.get('days') || '14';
  const by = searchParams.get('by');

  const memberId = useKanbanStore((state) => state.memberId);
  const projects = useKanbanStore((state) => state.projects);
  const users = useUserDirectory();
  const [report, setReport] = useState<Response | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

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
    let cancelled = false;
    const params = new URLSearchParams({ from, to, days });
    if (projectId) params.set('project', projectId);
    setIsLoading(true);
    setError('');
    fetch(`/api/reports/${kind}?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as Response;
        if (!cancelled) setReport(data);
      })
      .catch(() => !cancelled && setError(t('Не удалось построить отчёт.')))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [memberId, kind, from, to, projectId, days]);

  const projectName = useCallback(
    (id: string) =>
      id === NO_PROJECT_ID
        ? t(NO_PROJECT_NAME)
        : projects.find((project) => project.id === id)?.name || t('Проект {0}', id),
    [projects],
  );
  const userName = useCallback((id: string) => personName(users, id), [users]);
  // Имена подставляются здесь: сервер отдаёт id, а люди и проекты уже лежат в сторе.
  // Фильтр плитки оставляет строки с её ключом; таблица без таких строк скрывается.
  const tables = useMemo(
    () =>
      (report?.tables || []).map((table) => ({
        ...table,
        rows: table.rows
          .filter(
            (row) =>
              !filter ||
              String(row.filters || '')
                .split(',')
                .includes(filter),
          )
          .map((row) => ({
            ...row,
            project: row.projectId === undefined ? undefined : projectName(String(row.projectId)),
            user:
              row.userId !== undefined
                ? userName(String(row.userId))
                : row.responsibleId !== undefined
                  ? userName(String(row.responsibleId))
                  : undefined,
          })) as ReportRow[],
      })),
    [report, projectName, userName, filter],
  );

  const preset = (Object.keys(PRESETS) as Preset[]).find((key) => {
    const value = PRESETS[key]();
    return value.from === from && value.to === to;
  });
  const groupings = [...new Set(meta.tables.flatMap((table) => table.groupings || []))];
  const grouping = by && (groupings as string[]).includes(by) ? by : null;
  const coverage = report?.coverage;
  const filterTile = meta.tiles.find(
    (tile) => report?.tiles.find((item) => item.id === tile.id)?.filter === filter,
  );

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader title={meta.title()} description={meta.description()} />
      <div className="space-y-3 px-4 py-4 lg:px-6">
        <Card padding="none">
          <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
            {meta.period && (
              <>
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
                  className="w-full min-w-0 sm:w-40"
                  aria-label={t('Начальная дата периода')}
                />
                <DateField
                  variant="boxed"
                  size="sm"
                  value={to}
                  onChange={(value) => value && setParams({ to: value })}
                  className="w-full min-w-0 sm:w-40"
                  aria-label={t('Конечная дата периода')}
                />
              </>
            )}
            {!meta.noProject && (
              <SelectField
                size="sm"
                variant="boxed"
                className="w-full sm:w-56"
                aria-label={t('Проект')}
                value={projectId || ''}
                onChange={(event) => setParams({ project: event.target.value || null })}
                options={[
                  {
                    value: '',
                    label: meta.needsProject ? t('Выберите проект') : t('Все проекты'),
                  },
                  ...projectOptions(projects),
                ]}
              />
            )}
            {kind === 'stale' && (
              <label className="flex items-center gap-2 text-ink-soft">
                {t('Без движения от, дн')}
                <TextField
                  type="number"
                  variant="boxed"
                  size="sm"
                  min={1}
                  value={days}
                  onChange={(event) => {
                    // Порог меньше суток сервер не примет: в поле не держим число, по
                    // которому отчёт не считается.
                    const value = Math.floor(Number(event.target.value));
                    if (value >= 1) setParams({ days: value === 14 ? null : String(value) });
                  }}
                  className="w-20"
                />
              </label>
            )}
            {groupings.length > 0 && (
              <SegmentedControl
                size="sm"
                className="sm:ml-auto max-sm:hidden"
                value={grouping || 'none'}
                onChange={(value) => setParams({ by: value === 'none' ? null : value })}
                options={[
                  { value: 'none', label: t('Списком') },
                  ...groupings.map((value) => ({
                    value,
                    label: value === 'project' ? t('По проектам') : t('По людям'),
                  })),
                ]}
              />
            )}
          </div>
        </Card>

        {meta.notes && <p className="text-xs text-ink-soft">{meta.notes()}</p>}
        {report?.emptyMirror && (
          <Notice tone="warning">
            {t('Задачи из Битрикса ещё не загружены: нули в отчёте значат «нет данных».')}
          </Notice>
        )}
        {coverage?.collectedAt && (
          <p className="text-xs text-ink-soft">
            {t(
              'Часы собраны не позже {0}: списаний, сделанных после, в отчёте может не быть.',
              DATE_TIME.format(new Date(coverage.collectedAt)),
            )}
          </p>
        )}
        {Boolean(report?.closedNoDate) && (
          <Notice tone="warning">
            {t(
              'Завершённых задач без даты закрытия: {0}. Их не отнести к периоду, в закрытые и в хвост на конец недели они не входят.',
              report?.closedNoDate,
            )}
          </Notice>
        )}
        {report?.teamIncomplete && (
          <Notice tone="warning">
            {t(
              'Часть из 8 недель до периода не собрана: человек, списывавший только тогда, может не попасть в список.',
            )}
          </Notice>
        )}
        {coverage && coverage.missingWeeks.length > 0 && (
          <Notice tone="warning">
            {t(
              'Списания за недели с {0} не собраны: часов за них в отчёте нет, это не ноль работы.',
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
        {Boolean(report?.excludedUsers) && (
          <p className="text-xs text-ink-soft">
            {t('Служебные учётки из настроек ({0}) в часах не учитываются.', report?.excludedUsers)}
          </p>
        )}
        {filterTile && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>{t('Показаны задачи плитки «{0}»', filterTile.label())}</span>
            <Button variant="secondary" size="sm" onClick={() => setParams({ filter: null })}>
              {t('Показать все')}
            </Button>
          </div>
        )}

        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : meta.needsProject && !projectId ? (
          <Notice>{t('Выберите проект, чтобы построить отчёт.')}</Notice>
        ) : isLoading && !report ? (
          <LoadingState />
        ) : report ? (
          <div
            // Пока считается новый период или проект, прежние цифры бледные и не нажимаются:
            // по ним легко было принять старый проект за выбранный.
            className={cn(
              'space-y-4 transition-opacity',
              isLoading && 'pointer-events-none opacity-40',
            )}
            aria-busy={isLoading}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {meta.tiles.map((tile) => {
                const value = report.tiles.find((item) => item.id === tile.id);
                const tileFilter = value?.filter;
                const content = (
                  <>
                    <p className="text-xs text-ink-soft">{tile.label()}</p>
                    <p className={cn('mt-1', FONT.metric)}>
                      {value?.value === null || value?.value === undefined
                        ? '—'
                        : tile.kind === 'hours'
                          ? formatHours(value.value)
                          : formatCell(tile.kind, value.value)}
                    </p>
                  </>
                );
                return tileFilter ? (
                  <Card
                    key={tile.id}
                    interactive
                    padding="sm"
                    selected={filter === tileFilter}
                    aria-pressed={filter === tileFilter}
                    onClick={() => setParams({ filter: filter === tileFilter ? null : tileFilter })}
                    title={tile.hint?.()}
                  >
                    {content}
                  </Card>
                ) : (
                  <Card key={tile.id} padding="sm" title={tile.hint?.()}>
                    {content}
                  </Card>
                );
              })}
            </div>
            {meta.tables.map((table) => {
              const rows = tables.find((item) => item.id === table.id)?.rows || [];
              if (filter && !rows.length) return null;
              return (
                <ReportTableView
                  key={table.id}
                  meta={table}
                  rows={rows}
                  grouping={table.groupings?.includes(grouping as 'project') ? grouping : null}
                  csvName={`${kind}-${table.id}-${from}-${to}.csv`}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PmReport({ kind }: { kind: ReportKind }) {
  // Suspense вокруг useSearchParams(): без него Next не пререндерит страницу.
  return (
    <Suspense fallback={<LoadingState />}>
      <PmReportView kind={kind} />
    </Suspense>
  );
}
