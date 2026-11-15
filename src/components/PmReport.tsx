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
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl, toolbarSelect } from '@/components/monos/toolbar';
import { DataTable, type DataTableFeatures } from '@/components/DataTable';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { downloadCsv } from '@/lib/csv';
import { dateFormat, numberFormat, t } from '@/lib/i18n';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import type { Cell, ReportResult, ReportRow } from '@/lib/pm-reports';
import type { ReportKind } from '@/lib/pm-reports-data';
import { cn } from '@/lib/utils';
import { useKanbanStore } from '@/store/kanban';

type Kind =
  | 'text'
  | 'task'
  | 'project'
  | 'user'
  | 'hours'
  | 'count'
  | 'days'
  | 'percent'
  | 'date'
  | 'week'
  | 'month'
  | 'status'
  | 'state'
  | 'reasons';
type Column = { id: string; label: () => string; kind: Kind };
type TableMeta = {
  id: string;
  title: () => string;
  columns: Column[];
  sort: { id: string; desc: boolean };
  /** Разрезы группировки: колонки, по которым таблица сворачивается. */
  groupings?: ('project' | 'user')[];
  empty: () => string;
};
type TileMeta = { id: string; label: () => string; kind: Kind; hint?: () => string };
type Meta = {
  title: () => string;
  description: () => string;
  period: boolean;
  /** Отчёт без проекта не строится. */
  needsProject?: boolean;
  /** Отчёт по людям: фильтр проекта к нему не относится. */
  noProject?: boolean;
  defaultPeriod: Preset;
  tiles: TileMeta[];
  tables: TableMeta[];
  notes?: () => string;
};

// Строки отчётов одинаковы по смыслу, подписи колонок общие.
const C = {
  project: { id: 'project', label: () => t('Проект'), kind: 'project' },
  task: { id: 'task', label: () => t('Задача'), kind: 'task' },
  user: { id: 'user', label: () => t('Исполнитель'), kind: 'user' },
  deadline: { id: 'deadline', label: () => t('Дедлайн'), kind: 'date' },
  closed: { id: 'closed', label: () => t('Закрыта'), kind: 'date' },
  status: { id: 'status', label: () => t('Статус'), kind: 'status' },
} satisfies Record<string, Column>;

export const PM_REPORTS: Record<ReportKind, Meta> = {
  'plan-fact': {
    title: () => t('План и факт'),
    description: () => t('Оценка задачи против списанных часов: где работа ушла за оценку'),
    period: true,
    defaultPeriod: 'three',
    tiles: [
      { id: 'plan', label: () => t('План'), kind: 'hours' },
      { id: 'fact', label: () => t('Факт'), kind: 'hours' },
      {
        id: 'overrun',
        label: () => t('Перерасход'),
        kind: 'hours',
        hint: () => t('Сумма превышений по задачам, где факт больше плана'),
      },
      { id: 'overTasks', label: () => t('Задач с перерасходом'), kind: 'count' },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи с оценкой'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'state', label: () => t('Состояние'), kind: 'state' },
          { id: 'plan', label: () => t('План, ч'), kind: 'hours' },
          { id: 'fact', label: () => t('Факт, ч'), kind: 'hours' },
          { id: 'delta', label: () => t('Разница, ч'), kind: 'hours' },
          { id: 'deltaShare', label: () => t('Разница'), kind: 'percent' },
        ],
        sort: { id: 'delta', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Задач с оценкой за период нет'),
      },
    ],
    notes: () =>
      t(
        'Открытые задачи и закрытые за период. Факт это все списания задачи и её подзадач без своей оценки; подзадача с оценкой идёт своей строкой.',
      ),
  },
  deadlines: {
    title: () => t('Сроки'),
    description: () => t('Что закрыли позже дедлайна и что просрочено сейчас'),
    period: true,
    defaultPeriod: 'month',
    tiles: [
      { id: 'closedWithDeadline', label: () => t('Закрыто с дедлайном'), kind: 'count' },
      { id: 'onTime', label: () => t('В срок'), kind: 'percent' },
      { id: 'late', label: () => t('Закрыто с опозданием'), kind: 'count' },
      {
        id: 'avgLate',
        label: () => t('Медиана опоздания, дн'),
        kind: 'days',
      },
      { id: 'overdue', label: () => t('Просрочено сейчас'), kind: 'count' },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Опоздания и просрочки'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'state', label: () => t('Состояние'), kind: 'state' },
          C.deadline,
          C.closed,
          { id: 'days', label: () => t('Дней сверх срока'), kind: 'days' },
        ],
        sort: { id: 'days', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Опозданий нет'),
      },
    ],
    notes: () =>
      t(
        'Опоздание: задача закрыта в периоде позже дедлайна. Просрочка: открытая задача с прошедшим дедлайном, отложенные не считаются.',
      ),
  },
  throughput: {
    title: () => t('Поток задач'),
    description: () => t('Сколько задач приходит и уходит по неделям и растёт ли хвост'),
    period: true,
    defaultPeriod: 'three',
    tiles: [
      { id: 'created', label: () => t('Создано'), kind: 'count' },
      { id: 'closed', label: () => t('Закрыто'), kind: 'count' },
      { id: 'net', label: () => t('Прирост хвоста'), kind: 'count' },
      { id: 'lead', label: () => t('Медиана до закрытия, дн'), kind: 'days' },
    ],
    tables: [
      {
        id: 'weeks',
        title: () => t('По неделям'),
        columns: [
          { id: 'week', label: () => t('Неделя'), kind: 'week' },
          { id: 'created', label: () => t('Создано'), kind: 'count' },
          { id: 'closed', label: () => t('Закрыто'), kind: 'count' },
          { id: 'net', label: () => t('Прирост'), kind: 'count' },
          { id: 'backlog', label: () => t('Открыто на конец недели'), kind: 'count' },
          { id: 'lead', label: () => t('Медиана до закрытия, дн'), kind: 'days' },
        ],
        sort: { id: 'week', desc: false },
        empty: () => t('Задач за период нет'),
      },
    ],
    notes: () => t('Удалённые задачи в зеркале не хранятся и в поток не входят.'),
  },
  defects: {
    title: () => t('Брак'),
    description: () => t('Доля брака в оплачиваемой работе по проектам и месяцам'),
    period: true,
    defaultPeriod: 'three',
    tiles: [
      { id: 'defect', label: () => t('Брак'), kind: 'hours' },
      { id: 'commercial', label: () => t('Коммерция'), kind: 'hours' },
      {
        id: 'share',
        label: () => t('Доля брака'),
        kind: 'percent',
        hint: () => t('Брак делённый на коммерцию плюс брак'),
      },
    ],
    tables: [
      {
        id: 'months',
        title: () => t('Проекты по месяцам'),
        columns: [
          C.project,
          { id: 'month', label: () => t('Месяц'), kind: 'month' },
          { id: 'commercial', label: () => t('Коммерция, ч'), kind: 'hours' },
          { id: 'defect', label: () => t('Брак, ч'), kind: 'hours' },
          { id: 'share', label: () => t('Доля брака'), kind: 'percent' },
        ],
        sort: { id: 'share', desc: true },
        groupings: ['project'],
        empty: () => t('Часов коммерции и брака за период нет'),
      },
    ],
    notes: () =>
      t('Классы часов те же, что в аналитике часов: тег задачи, тег предка или класс проекта.'),
  },
  timesheets: {
    title: () => t('Списание часов'),
    description: () => t('Кто списал меньше нормы и какие задачи закрыты без списаний'),
    period: true,
    noProject: true,
    defaultPeriod: 'month',
    tiles: [
      { id: 'fact', label: () => t('Списано'), kind: 'hours' },
      { id: 'norm', label: () => t('Норма'), kind: 'hours' },
      {
        id: 'below',
        label: () => t('Людей ниже 80% нормы'),
        kind: 'count',
      },
      { id: 'closedNoTime', label: () => t('Закрыто без списаний'), kind: 'count' },
    ],
    tables: [
      {
        id: 'weeks',
        title: () => t('Люди по неделям'),
        columns: [
          C.user,
          { id: 'week', label: () => t('Неделя'), kind: 'week' },
          { id: 'fact', label: () => t('Списано, ч'), kind: 'hours' },
          { id: 'norm', label: () => t('Норма, ч'), kind: 'hours' },
          { id: 'share', label: () => t('От нормы'), kind: 'percent' },
        ],
        sort: { id: 'share', desc: false },
        groupings: ['user'],
        empty: () => t('Людей нет'),
      },
      {
        id: 'closedNoTime',
        title: () => t('Закрыты без списаний'),
        columns: [C.project, C.task, C.user, C.closed],
        sort: { id: 'closed', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Все закрытые задачи со списаниями'),
      },
    ],
    notes: () =>
      t(
        'Норма: 8 ч в будний день периода, праздники не учтены. Люди: все, кто списывал часы, и исполнители открытых задач.',
      ),
  },
  stale: {
    title: () => t('Зависшие задачи'),
    description: () => t('Открытые задачи без движения, просроченные, без дедлайна или оценки'),
    period: false,
    defaultPeriod: 'three',
    tiles: [
      { id: 'idle', label: () => t('Без движения'), kind: 'count' },
      { id: 'overdue', label: () => t('Просрочены'), kind: 'count' },
      { id: 'noDeadline', label: () => t('Без дедлайна'), kind: 'count' },
      { id: 'noEstimate', label: () => t('Без оценки'), kind: 'count' },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи'),
        columns: [
          C.project,
          C.task,
          C.user,
          C.status,
          { id: 'activity', label: () => t('Последняя активность'), kind: 'date' },
          { id: 'idle', label: () => t('Дней без движения'), kind: 'days' },
          C.deadline,
          { id: 'reasons', label: () => t('Причины'), kind: 'reasons' },
        ],
        sort: { id: 'idle', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Зависших задач нет'),
      },
    ],
    notes: () =>
      t(
        'Активные задачи: всё, кроме завершённых и отложенных. Движение это последняя активность в Битриксе: комментарий, смена статуса, правка.',
      ),
  },
  client: {
    title: () => t('Отчёт клиенту'),
    description: () => t('Что сделано по проекту за период, что в работе и сколько часов'),
    period: true,
    needsProject: true,
    defaultPeriod: 'previous',
    tiles: [
      { id: 'done', label: () => t('Закрыто задач'), kind: 'count' },
      { id: 'open', label: () => t('В работе'), kind: 'count' },
      { id: 'hours', label: () => t('Часов за период'), kind: 'hours' },
    ],
    tables: [
      {
        id: 'done',
        title: () => t('Сделано'),
        columns: [
          C.task,
          C.user,
          C.closed,
          { id: 'periodHours', label: () => t('Часы за период'), kind: 'hours' },
        ],
        sort: { id: 'closed', desc: false },
        empty: () => t('За период ничего не закрыто'),
      },
      {
        id: 'open',
        title: () => t('В работе'),
        columns: [
          C.task,
          C.user,
          C.status,
          C.deadline,
          { id: 'periodHours', label: () => t('Часы за период'), kind: 'hours' },
        ],
        sort: { id: 'deadline', desc: false },
        empty: () => t('Открытых задач нет'),
      },
      {
        id: 'people',
        title: () => t('Часы по людям'),
        columns: [C.user, { id: 'hours', label: () => t('Часы'), kind: 'hours' }],
        sort: { id: 'hours', desc: true },
        empty: () => t('Списаний за период нет'),
      },
    ],
  },
};

const isoDay = (date: Date) => date.toLocaleDateString('en-CA');
const PRESETS = {
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
    return {
      from: isoDay(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)),
      to: isoDay(now),
    };
  },
  three: () => {
    const now = new Date();
    return { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: isoDay(now) };
  },
};
type Preset = keyof typeof PRESETS;

const HOURS = numberFormat({ maximumFractionDigits: 1 });
const COUNT = numberFormat({ maximumFractionDigits: 0 });
const DAYS = numberFormat({ maximumFractionDigits: 1 });
const PERCENT = numberFormat({ style: 'percent', maximumFractionDigits: 0 });
const DATE = dateFormat({ day: '2-digit', month: '2-digit', year: '2-digit' });
const MONTH = dateFormat({ month: '2-digit', year: 'numeric' });

const STATUS: Record<string, () => string> = {
  '1': () => t('Новая'),
  '2': () => t('Ждёт выполнения'),
  '3': () => t('В работе'),
  '4': () => t('Ждёт контроля'),
  '5': () => t('Завершена'),
  '6': () => t('Отложена'),
};
const STATE: Record<string, () => string> = {
  open: () => t('Открыта'),
  closed: () => t('Закрыта'),
  late: () => t('Закрыта с опозданием'),
  overdue: () => t('Просрочена'),
};
const REASON: Record<string, () => string> = {
  idle: () => t('без движения'),
  overdue: () => t('просрочена'),
  noDeadline: () => t('без дедлайна'),
  noEstimate: () => t('без оценки'),
};

/** Дата портала как есть: день из строки, без сдвига в пояс браузера. */
const portalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? DATE.format(new Date(+match[1], +match[2] - 1, +match[3])) : value;
};

function formatCell(kind: Kind, value: Cell): string {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'hours') return HOURS.format(Number(value));
  if (kind === 'count') return COUNT.format(Number(value));
  if (kind === 'days') return DAYS.format(Number(value));
  if (kind === 'percent') return PERCENT.format(Number(value));
  if (kind === 'date' || kind === 'week') return portalDate(String(value));
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
        helper.accessor((row) => row[column.id] as Cell, {
          id: column.id,
          header: () => column.label(),
          sortUndefined: 'last',
          ...(SUMMABLE.includes(column.kind) && column.id !== 'deltaShare'
            ? {
                aggregationFn: 'sum' as const,
                aggregatedCell: (info: { getValue: () => unknown }) =>
                  formatCell(column.kind, Number(info.getValue()) || 0),
              }
            : column.kind === 'days'
              ? // Дни не складываются: сумма просрочек по проекту ничего не значит,
                // а самая старая задача группы значит.
                {
                  aggregationFn: 'max' as const,
                  aggregatedCell: (info: { getValue: () => unknown }) =>
                    formatCell(column.kind, Number(info.getValue()) || 0),
                }
              : // Иначе таблица складывает любое число, и доли превращались в 300 %.
                { aggregatedCell: () => null }),
          cell: (info) => {
            const value = info.getValue();
            if (info.row.getIsGrouped()) return formatCell(column.kind, value);
            if (column.kind === 'task')
              return (
                <Link className="hover:underline" href={taskHref(info.row.original)}>
                  {String(value)}
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
        }),
      ),
    [meta],
  );

  const exportCsv = () =>
    downloadCsv(csvName, [
      meta.columns.map((column) => column.label()),
      ...rows.map((row) =>
        meta.columns.map((column) =>
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
        />
      )}
    </section>
  );
}

// На телефоне таблица в восемь колонок не читается: строка становится карточкой.
function MobileRows({ meta, rows }: { meta: TableMeta; rows: ReportRow[] }) {
  const sorted = useMemo(() => {
    const { id, desc } = meta.sort;
    return [...rows].sort((a, b) => {
      const x = a[id] ?? '';
      const y = b[id] ?? '';
      const order = x < y ? -1 : x > y ? 1 : 0;
      return desc ? -order : order;
    });
  }, [rows, meta.sort]);
  if (!rows.length)
    return <p className="py-6 text-center text-xs text-ink-faint">{meta.empty()}</p>;
  const title = meta.columns.find((column) => column.kind === 'task') || meta.columns[0];
  return (
    <ul className="space-y-2">
      {sorted.slice(0, 200).map((row, index) => (
        <li key={index} className="rounded-ui border border-line bg-surface p-3 text-sm">
          {title.kind === 'task' ? (
            <Link className="font-medium text-ink hover:underline" href={taskHref(row)}>
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
        </li>
      ))}
    </ul>
  );
}

type Response = ReportResult & { collectedFrom?: string | null };

function PmReportView({ kind }: { kind: ReportKind }) {
  const meta = PM_REPORTS[kind];
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallback = useMemo(() => PRESETS[meta.defaultPeriod](), [meta.defaultPeriod]);
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const projectId = meta.noProject ? null : searchParams.get('project');
  const reason = searchParams.get('reason');
  const days = searchParams.get('days') || '14';
  const by = searchParams.get('by');

  const memberId = useKanbanStore((state) => state.memberId);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
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
    if (reason) params.set('reason', reason);
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
  }, [memberId, kind, from, to, projectId, reason, days]);

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
  // Имена подставляются здесь: сервер отдаёт id, а люди и проекты уже лежат в сторе.
  const tables = useMemo(
    () =>
      (report?.tables || []).map((table) => ({
        ...table,
        rows: table.rows.map((row) => ({
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
    [report, projectName, userName],
  );

  const preset = (Object.keys(PRESETS) as Preset[]).find((key) => {
    const value = PRESETS[key]();
    return value.from === from && value.to === to;
  });
  const activeProjects = projects.filter((project) => !project.isArchived);
  const groupings = meta.tables[0]?.groupings || [];
  const grouping = by && (groupings as string[]).includes(by) ? by : null;
  const beforeCollected =
    report?.collectedFrom && from < report.collectedFrom ? report.collectedFrom : null;

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
              </>
            )}
            {!meta.noProject && (
              <SelectField
                size="sm"
                variant="boxed"
                className={`${toolbarSelect} w-full sm:w-56`}
                aria-label={t('Проект')}
                value={projectId || ''}
                onChange={(event) => setParams({ project: event.target.value || null })}
                options={[
                  {
                    value: '',
                    label: meta.needsProject ? t('Выберите проект') : t('Все проекты'),
                  },
                  ...activeProjects.map((project) => ({ value: project.id, label: project.name })),
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
                  onChange={(event) =>
                    setParams({ days: event.target.value === '14' ? null : event.target.value })
                  }
                  className={`${toolbarControl} w-20`}
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
        {beforeCollected && (
          <Notice tone="warning">
            {t(
              'Списания в базе собраны с {0}: часов раньше этой даты в отчёте нет.',
              portalDate(beforeCollected),
            )}
          </Notice>
        )}
        {report?.notes.includes('missingWeeks') && (
          <Notice tone="warning">
            {t('За часть недель периода списания не собраны: цифры за них занижены.')}
          </Notice>
        )}

        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : meta.needsProject && !projectId ? (
          <Notice>{t('Выберите проект, чтобы построить отчёт.')}</Notice>
        ) : isLoading && !report ? (
          <LoadingState className="min-h-72 bg-transparent" />
        ) : report ? (
          <div className={cn('space-y-4 transition-opacity', isLoading ? 'opacity-60' : '')}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {meta.tiles.map((tile) => {
                const value = report.tiles.find((item) => item.id === tile.id);
                const filter = value?.filter;
                const content = (
                  <>
                    <p className="text-xs text-ink-soft">{tile.label()}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                      {value?.value === null || value?.value === undefined
                        ? '—'
                        : tile.kind === 'hours'
                          ? t('{0} ч', formatCell(tile.kind, value.value))
                          : formatCell(tile.kind, value.value)}
                    </p>
                  </>
                );
                return filter ? (
                  <Card
                    key={tile.id}
                    interactive
                    padding="sm"
                    selected={reason === filter}
                    aria-pressed={reason === filter}
                    onClick={() => setParams({ reason: reason === filter ? null : filter })}
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
            {meta.tables.map((table, index) => (
              <ReportTableView
                key={table.id}
                meta={table}
                rows={tables.find((item) => item.id === table.id)?.rows || []}
                grouping={
                  index === 0 || table.groupings?.includes(grouping as 'project') ? grouping : null
                }
                csvName={`${kind}-${table.id}-${from}-${to}.csv`}
              />
            ))}
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
