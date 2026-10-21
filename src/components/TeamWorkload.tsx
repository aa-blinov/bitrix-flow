'use client';

import { useEffect, useMemo, useState } from 'react';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  CalendarOff,
  ClipboardList,
  Clock3,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { cn, pluralRu } from '@/lib/utils';
import { Bx24User } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { IconButton } from '@/components/monos/IconButton';
import { Modal } from '@/components/monos/Modal';
import { SelectField } from '@/components/monos/SelectField';

type WorkloadBucket = { userId: string; count: number; hours: number };
type WorkloadSummary = {
  days: Array<WorkloadBucket & { day: string }>;
  noDeadline: WorkloadBucket[];
  overdue: WorkloadBucket[];
};

const EMPTY_BUCKET: WorkloadBucket = { userId: '', count: 0, hours: 0 };
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const WEEK_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - day + 1);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const HOURS_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function formatHours(hours: number) {
  return hours % 1 === 0 ? `${hours} ч` : `${HOURS_FORMAT.format(hours)} ч`;
}

const taskLabel = (count: number) => pluralRu(count, ['задача', 'задачи', 'задач']);

// Пустая ячейка — фон, а не карточка: десятки рамок с «—» забивали сетку, и
// дни с задачами не выделялись.
const EMPTY_CELL = 'border-transparent text-ink-faint hover:bg-surface-2';
const FILLED_CELL = 'border-line bg-surface-2/50 hover:border-line-strong';
const OVERDUE_CELL = 'border-danger/30 bg-danger/10 text-danger-text hover:border-danger/60';

function UserAvatar({ user }: { user: Bx24User }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = user.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (user.icon && !imageFailed) {
    return (
      <img
        src={user.icon}
        alt=""
        className="size-7 shrink-0 rounded-full object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent-text">
      {initials || '—'}
    </span>
  );
}

function WorkloadValue({
  count,
  hours,
  actualHours,
}: {
  count: number;
  hours: number;
  actualHours?: number;
}) {
  // TODO: when hierarchy-aware planning is introduced, calculate an effective
  // estimate per task branch: use the recursive sum of estimated descendants;
  // if every descendant estimate is zero, fall back to the parent's estimate.
  // Sum only root branches so parent and subtasks are never counted twice.
  if (count === 0 && actualHours === undefined) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex flex-col items-center gap-0.5 leading-tight">
      {count > 0 && (
        <>
          <span>
            {count} {taskLabel(count)}
          </span>
          {/* Явный цвет вместо opacity: в ячейке с просрочкой текст наследует
              сигнальный, и приглушение опускало контраст ниже 4.5:1. */}
          <span className="text-xs text-ink-soft">План {formatHours(hours)}</span>
        </>
      )}
      {actualHours !== undefined && (
        <span className="text-xs text-ink-soft">Факт {formatHours(actualHours)}</span>
      )}
    </span>
  );
}

export default function TeamWorkload() {
  const allTasks = useKanbanStore((state) => state.allTasks);
  const users = useKanbanStore((state) => state.users);
  const projects = useKanbanStore((state) => state.projects);
  const loadAllTasks = useKanbanStore((state) => state.loadAllTasks);
  const loadProjects = useKanbanStore((state) => state.loadProjects);
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [timeRows, setTimeRows] = useState<Array<{ userId: string; day: string; seconds: number }>>(
    [],
  );
  const [timeDetails, setTimeDetails] = useState<
    Array<{ userId: string; day: string; seconds: number; taskId: string }>
  >([]);
  const [selectedActual, setSelectedActual] = useState<{ userId: string; day: string } | null>(
    null,
  );
  const [timeError, setTimeError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [timeRefreshing, setTimeRefreshing] = useState(false);
  const [summary, setSummary] = useState<WorkloadSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (allTasks.length === 0) void loadAllTasks();
    if (projects.length === 0) void loadProjects();
  }, [allTasks.length, loadAllTasks, loadProjects, projects.length]);

  const weekStartKey = calendarDayKey(weekStart);
  const weekEndKey = calendarDayKey(addDays(weekStart, 6));

  const loadActualTime = async () => {
    try {
      const response = await fetch(`/api/workload/time?start=${weekStartKey}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      setTimeRows(payload.data?.rows || []);
      setTimeDetails(payload.data?.details || []);
      setTimeRefreshing(Boolean(payload.refreshing));
      setTimeError(null);
    } catch (error) {
      console.error('[workload-time] failed to load actual time', error);
      setTimeError('Не удалось загрузить факт времени');
    }
  };

  useEffect(() => {
    setTimeRows([]);
    void loadActualTime();
  }, [weekStartKey]);

  // Счётчики ячеек приходят с сервера по всему зеркалу задач — теми же
  // фильтрами, что применит /all-tasks при клике.
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSummaryError(null);
    const params = new URLSearchParams({ start: weekStartKey, projectId: selectedProjectId });
    void fetch(`/api/workload/summary?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
        if (!cancelled) setSummary(payload);
      })
      .catch(() => {
        if (!cancelled) setSummaryError('Не удалось загрузить нагрузку');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, weekStartKey]);

  const refreshActualTime = async () => {
    setTimeRefreshing(true);
    await fetch('/api/workload/time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: weekStartKey, end: weekEndKey }),
    });
  };

  useEffect(() => {
    if (!timeRefreshing) return;
    const timer = window.setInterval(() => void loadActualTime(), 5000);
    return () => window.clearInterval(timer);
  }, [timeRefreshing, weekStartKey]);

  const actualHoursFor = (userId: string, day: string) => {
    const row = timeRows.find((item) => String(item.userId) === String(userId) && item.day === day);
    return row ? row.seconds / 3600 : undefined;
  };
  const selectedEntries = selectedActual
    ? timeDetails.filter(
        (entry) =>
          String(entry.userId) === String(selectedActual.userId) &&
          entry.day === selectedActual.day,
      )
    : [];

  const todayKey = calendarDayKey(new Date());
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const weekKeys = useMemo(() => new Set(days.map(calendarDayKey)), [days]);
  // Bitrix user.get identifies company staff as USER_TYPE=employee. Extranet
  // users must not influence an internal workload plan.
  const employees = useMemo(
    () => users.filter((user) => user.userType !== 'extranet' && user.userType !== 'email'),
    [users],
  );
  const dayBuckets = useMemo(() => {
    const map = new Map<string, WorkloadBucket>();
    for (const row of summary?.days || []) map.set(`${row.userId}|${row.day}`, row);
    return map;
  }, [summary]);
  const noDeadlineBuckets = useMemo(
    () => new Map((summary?.noDeadline || []).map((row) => [row.userId, row])),
    [summary],
  );
  const overdueBuckets = useMemo(
    () => new Map((summary?.overdue || []).map((row) => [row.userId, row])),
    [summary],
  );
  const bucketFor = (assigneeId: string, key: string | null) =>
    (key ? dayBuckets.get(`${assigneeId}|${key}`) : noDeadlineBuckets.get(assigneeId)) ||
    EMPTY_BUCKET;
  const assignees = useMemo(() => {
    const ids = new Set<string>(
      [...dayBuckets.values(), ...noDeadlineBuckets.values(), ...overdueBuckets.values()].map(
        (row) => row.userId,
      ),
    );
    const known = employees
      .filter((user) => ids.has(user.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    return ids.has('unassigned')
      ? [...known, { id: 'unassigned', name: 'Без исполнителя' } as Bx24User]
      : known;
  }, [dayBuckets, employees, noDeadlineBuckets, overdueBuckets]);

  const openTaskList = (assigneeId: string, workload: string) => {
    const params = new URLSearchParams({ from: 'workload', workload });
    params.set('assignee', assigneeId);
    // Календарь отфильтрован по проекту — список должен открыться так же,
    // иначе число задач по клику не совпадёт с числом в ячейке.
    if (selectedProjectId !== 'all') params.set('project', selectedProjectId);
    router.push(`/all-tasks?${params.toString()}`);
  };

  // Сводка суммирует только тех исполнителей, кто попал в таблицу: extranet
  // не влияет на внутренний план, иначе карточки не сходятся со строками.
  const visibleIds = useMemo(() => new Set(assignees.map((user) => user.id)), [assignees]);
  const sumOf = (rows: WorkloadBucket[]) => {
    const visible = rows.filter((row) => visibleIds.has(row.userId));
    return {
      count: visible.reduce((total, row) => total + row.count, 0),
      hours: visible.reduce((total, row) => total + row.hours, 0),
    };
  };
  const weekTotals = sumOf(summary?.days || []);
  const noDeadlineCount = sumOf(summary?.noDeadline || []).count;
  const overdueCount = sumOf(summary?.overdue || []).count;

  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'Все проекты' },
      { value: NO_PROJECT_ID, label: NO_PROJECT_NAME },
      ...projects
        .filter((project) => !project.isArchived)
        .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
        .map((project) => ({ value: project.id, label: project.name })),
    ],
    [projects],
  );

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title="Нагрузка команды"
        description="План по срокам: количество задач и часы на каждого исполнителя"
      />

      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Card className="flex items-center gap-3">
            <ClipboardList className="size-5 shrink-0 text-accent" strokeWidth={1.7} />
            <div>
              <p className="text-2xl font-bold tabular-nums">{weekTotals.count}</p>
              <p className="text-sm text-ink-soft">
                {taskLabel(weekTotals.count)} со сроком на этой неделе
              </p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <Clock3 className="size-5 shrink-0 text-accent" strokeWidth={1.7} />
            <div>
              <p className="text-2xl font-bold tabular-nums">{formatHours(weekTotals.hours)}</p>
              <p className="text-sm text-ink-soft">план на этой неделе</p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <CalendarOff className="size-5 shrink-0 text-ink-faint" strokeWidth={1.7} />
            <div>
              <p className="text-2xl font-bold tabular-nums">{noDeadlineCount}</p>
              <p className="text-sm text-ink-soft">{taskLabel(noDeadlineCount)} без срока</p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <TriangleAlert
              className={cn(
                'size-5 shrink-0',
                overdueCount ? 'text-danger-text' : 'text-ink-faint',
              )}
              strokeWidth={1.7}
            />
            <div>
              <p
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  overdueCount > 0 && 'text-danger-text',
                )}
              >
                {overdueCount}
              </p>
              <p className="text-sm text-ink-soft">
                {pluralRu(overdueCount, [
                  'просроченная задача',
                  'просроченные задачи',
                  'просроченных задач',
                ])}
              </p>
            </div>
          </Card>
        </div>

        <Card padding="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="font-bold">Календарь нагрузки</h2>
              <p className="text-sm text-ink-soft">План по срокам и списания времени</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SelectField
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                options={projectOptions}
                variant="boxed"
                size="md"
                className="w-52 shrink-0"
                aria-label="Проект"
              />
              <Button
                variant="secondary"
                onClick={() => void refreshActualTime()}
                disabled={timeRefreshing}
                icon={
                  <RefreshCw
                    className={timeRefreshing ? 'animate-spin' : ''}
                    size={14}
                    strokeWidth={1.7}
                  />
                }
              >
                Обновить факт
              </Button>
              <IconButton
                label="Предыдущая неделя"
                variant="outline"
                size="md"
                onClick={() => setWeekStart((current) => addDays(current, -7))}
              >
                <ChevronLeft className="size-4" strokeWidth={1.7} />
              </IconButton>
              <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>
                Сегодня
              </Button>
              <IconButton
                label="Следующая неделя"
                variant="outline"
                size="md"
                onClick={() => setWeekStart((current) => addDays(current, 7))}
              >
                <ChevronRight className="size-4" strokeWidth={1.7} />
              </IconButton>
            </div>
          </div>

          {/* Ошибка факта раньше записывалась в состояние и терялась: ячейки
              просто оставались без «Факт», как будто никто ничего не списывал. */}
          {timeError && (
            <p role="alert" className="border-b border-line px-4 py-2 text-sm text-danger-text">
              {timeError}. Нажмите «Обновить факт», чтобы повторить.
            </p>
          )}
          {summaryError ? (
            <p className="p-6 text-sm text-danger-text">{summaryError}</p>
          ) : !summary ? (
            <LoadingState className="min-h-80 bg-transparent" />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1090px]">
                <div className="grid grid-cols-[minmax(210px,1.5fr)_repeat(7,minmax(90px,1fr))_minmax(115px,1fr)_minmax(115px,1fr)] border-b border-line bg-surface-2 text-sm">
                  <div className="px-4 py-3 font-medium">Исполнитель</div>
                  {days.map((day, index) => (
                    <div
                      key={calendarDayKey(day)}
                      aria-current={calendarDayKey(day) === todayKey ? 'date' : undefined}
                      className="relative border-l border-line px-2 py-3 text-center"
                    >
                      <p className="font-medium">{DAY_NAMES[index]}</p>
                      <p className="text-xs text-ink-faint">{DAY_FORMATTER.format(day)}</p>
                      {/* Сегодняшний день отмечен чертой чернил — так же, как
                          набор отмечает выбранную вкладку. */}
                      {calendarDayKey(day) === todayKey ? (
                        <span
                          className="absolute inset-x-0 bottom-0 h-0.5 bg-ink"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  ))}
                  <div className="border-l border-line px-2 py-3 text-center font-medium">
                    Без срока
                  </div>
                  <div className="border-l border-line px-2 py-3 text-center font-medium">
                    Просрочено
                  </div>
                </div>
                {assignees.map((assignee) => {
                  const memberPlannedHours = (summary?.days || [])
                    .filter((row) => row.userId === assignee.id)
                    .reduce((sum, row) => sum + row.hours, 0);
                  const memberActualHours = timeRows
                    .filter(
                      (row) => String(row.userId) === String(assignee.id) && weekKeys.has(row.day),
                    )
                    .reduce((sum, row) => sum + row.seconds / 3600, 0);
                  return (
                    <div
                      key={assignee.id}
                      className="grid grid-cols-[minmax(210px,1.5fr)_repeat(7,minmax(90px,1fr))_minmax(115px,1fr)_minmax(115px,1fr)] border-b border-line last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-2 px-4 py-3">
                        <UserAvatar user={assignee} />
                        <div className="min-w-0">
                          {/* Имя обрезается колонкой — полное показываем подсказкой. */}
                          <span
                            className="block truncate text-sm font-medium"
                            title={assignee.name}
                          >
                            {assignee.name}
                          </span>
                          <span className="block text-xs whitespace-nowrap text-ink-faint tabular-nums">
                            План {formatHours(memberPlannedHours)} · факт{' '}
                            {formatHours(memberActualHours)}
                          </span>
                        </div>
                      </div>
                      {days.map((day) => {
                        const key = calendarDayKey(day);
                        const bucket = bucketFor(assignee.id, key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              const actual = actualHoursFor(assignee.id, key);
                              if (actual !== undefined)
                                setSelectedActual({ userId: assignee.id, day: key });
                              else if (bucket.count) openTaskList(assignee.id, key);
                            }}
                            className={`m-1 min-h-16 rounded-ui border px-1 py-2 text-center transition-colors duration-fast ${bucket.count || actualHoursFor(assignee.id, key) !== undefined ? FILLED_CELL : EMPTY_CELL}`}
                          >
                            <WorkloadValue
                              count={bucket.count}
                              hours={bucket.hours}
                              actualHours={actualHoursFor(assignee.id, key)}
                            />
                          </button>
                        );
                      })}
                      {(() => {
                        const bucket = bucketFor(assignee.id, null);
                        return (
                          <button
                            type="button"
                            onClick={() => bucket.count && openTaskList(assignee.id, 'no_deadline')}
                            className={`m-1 min-h-16 rounded-ui border px-1 py-2 text-center transition-colors duration-fast ${bucket.count ? FILLED_CELL : EMPTY_CELL}`}
                          >
                            <WorkloadValue count={bucket.count} hours={bucket.hours} />
                          </button>
                        );
                      })()}
                      {(() => {
                        const bucket = overdueBuckets.get(assignee.id) || EMPTY_BUCKET;
                        return (
                          <button
                            type="button"
                            onClick={() => bucket.count && openTaskList(assignee.id, 'overdue')}
                            className={`m-1 min-h-16 rounded-ui border px-1 py-2 text-center transition-colors duration-fast ${bucket.count ? OVERDUE_CELL : EMPTY_CELL}`}
                          >
                            <WorkloadValue count={bucket.count} hours={bucket.hours} />
                          </button>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={Boolean(selectedActual)}
        onClose={() => setSelectedActual(null)}
        title="Списания времени"
        description={
          selectedActual
            ? `${assignees.find((user) => user.id === selectedActual.userId)?.name || 'Сотрудник'}, ${selectedActual.day}`
            : ''
        }
        size="md"
      >
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {selectedEntries.map((entry, index) => {
            const task = allTasks.find((item) => item.id === entry.taskId);
            return (
              <button
                key={`${entry.taskId}-${index}`}
                type="button"
                className="w-full rounded-ui border border-line p-3 text-left transition-colors duration-fast hover:bg-surface-2"
                onClick={() => {
                  setSelectedActual(null);
                  router.push(`/team-workload?task=${entry.taskId}`);
                }}
              >
                <p className="font-medium">{task?.title || `Задача #${entry.taskId}`}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatHours(entry.seconds / 3600)}, задача #{entry.taskId}
                </p>
              </button>
            );
          })}
          {selectedEntries.length === 0 && (
            <p className="text-sm text-ink-soft">Списаний за этот день нет.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
