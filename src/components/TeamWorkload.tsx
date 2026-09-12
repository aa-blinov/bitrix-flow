'use client';

import { useEffect, useMemo, useState } from 'react';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { Bx24Project, Bx24User } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

function formatHours(hours: number) {
  return hours % 1 === 0
    ? `${hours} ч`
    : `${hours.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;
}

function taskLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'задач';
  if (last === 1) return 'задача';
  if (last >= 2 && last <= 4) return 'задачи';
  return 'задач';
}

function loadTone(_count: number, _hours: number) {
  return 'border-border bg-background/40 hover:bg-muted/70';
}

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
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
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
  if (count === 0 && actualHours === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-center gap-0.5 leading-tight">
      {count > 0 && (
        <>
          <span>
            {count} {taskLabel(count)}
          </span>
          <span className="text-xs opacity-80">План {formatHours(hours)}</span>
        </>
      )}
      {actualHours !== undefined && (
        <span className="text-xs opacity-80">Факт {formatHours(actualHours)}</span>
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

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader
        title="Нагрузка команды"
        description="План по срокам: количество задач и часы на каждого исполнителя"
      />

      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ClipboardList className="size-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{weekTotals.count}</p>
                <p className="text-sm text-muted-foreground">задач со сроком на текущую неделю</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Clock3 className="size-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatHours(weekTotals.hours)}
                </p>
                <p className="text-sm text-muted-foreground">плановая нагрузка на текущую неделю</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <UsersRound className="size-5 text-amber-600" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{noDeadlineCount}</p>
                <p className="text-sm text-muted-foreground">задач без срока</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ClipboardList className="size-5 text-red-600" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{overdueCount}</p>
                <p className="text-sm text-muted-foreground">просроченных задач</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-semibold">Календарь нагрузки</h2>
              <p className="text-sm text-muted-foreground">План по срокам и списания времени</p>
            </div>
            <div className="flex items-center gap-1">
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger aria-label="Проект" className="max-w-52">
                  <SelectValue placeholder="Все проекты" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">Все проекты</SelectItem>
                  <SelectItem value={NO_PROJECT_ID}>{NO_PROJECT_NAME}</SelectItem>
                  {projects
                    .filter((project) => !project.isArchived)
                    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
                    .map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => void refreshActualTime()}
                disabled={timeRefreshing}
              >
                <RefreshCw className={timeRefreshing ? 'animate-spin' : ''} /> Обновить факт
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Предыдущая неделя"
                onClick={() => setWeekStart((current) => addDays(current, -7))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
                Сегодня
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Следующая неделя"
                onClick={() => setWeekStart((current) => addDays(current, 7))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {summaryError ? (
            <p className="p-6 text-sm text-destructive">{summaryError}</p>
          ) : !summary ? (
            <LoadingState className="min-h-80 bg-transparent" />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1050px]">
                <div className="grid grid-cols-[minmax(170px,1.5fr)_repeat(7,minmax(90px,1fr))_minmax(115px,1fr)_minmax(115px,1fr)] border-b bg-muted/40 text-sm">
                  <div className="px-4 py-3 font-medium">Исполнитель</div>
                  {days.map((day, index) => (
                    <div key={calendarDayKey(day)} className="border-l px-2 py-3 text-center">
                      <p className="font-medium">{DAY_NAMES[index]}</p>
                      <p className="text-xs text-muted-foreground">{DAY_FORMATTER.format(day)}</p>
                    </div>
                  ))}
                  <div className="border-l px-2 py-3 text-center font-medium">Без срока</div>
                  <div className="border-l px-2 py-3 text-center font-medium">Просрочено</div>
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
                      className="grid grid-cols-[minmax(170px,1.5fr)_repeat(7,minmax(90px,1fr))_minmax(115px,1fr)_minmax(115px,1fr)] border-b last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-2 px-4 py-3">
                        <UserAvatar user={assignee} />
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {assignee.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            План {formatHours(memberPlannedHours)}, факт{' '}
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
                            className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${bucket.count ? `${loadTone(bucket.count, bucket.hours)} hover:ring-2 hover:ring-primary/30` : 'border-border bg-background/40 hover:bg-muted/70'}`}
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
                            className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${bucket.count ? `${loadTone(bucket.count, bucket.hours)} hover:ring-2 hover:ring-primary/30` : 'border-border bg-background/40 hover:bg-muted/70'}`}
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
                            className="m-1 min-h-16 rounded-lg border border-border bg-background/40 px-1 py-2 text-center transition-colors hover:bg-muted/70"
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

      <Dialog
        open={Boolean(selectedActual)}
        onOpenChange={(open) => !open && setSelectedActual(null)}
      >
        <DialogContent>
          <DialogTitle>Списания времени</DialogTitle>
          <DialogDescription>
            {selectedActual
              ? `${assignees.find((user) => user.id === selectedActual.userId)?.name || 'Сотрудник'}, ${selectedActual.day}`
              : ''}
          </DialogDescription>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {selectedEntries.map((entry, index) => {
              const task = allTasks.find((item) => item.id === entry.taskId);
              return (
                <button
                  key={`${entry.taskId}-${index}`}
                  type="button"
                  className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/70"
                  onClick={() => {
                    setSelectedActual(null);
                    router.push(`/team-workload?task=${entry.taskId}`);
                  }}
                >
                  <p className="font-medium">{task?.title || `Задача #${entry.taskId}`}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatHours(entry.seconds / 3600)}, задача #{entry.taskId}
                  </p>
                </button>
              );
            })}
            {selectedEntries.length === 0 && (
              <p className="text-sm text-muted-foreground">Списаний за этот день нет.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
