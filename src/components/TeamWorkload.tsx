'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { BxTask, Bx24Project, Bx24User } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

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

function dayKey(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : calendarDayKey(date);
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

function loadTone(count: number, hours: number) {
  if (count >= 5 || hours > 6)
    return 'border-red-300 bg-red-500/10 text-red-800 dark:border-red-900 dark:text-red-200';
  if (count >= 4 || hours >= 4)
    return 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-900 dark:text-amber-200';
  return 'border-emerald-300 bg-emerald-500/10 text-emerald-800 dark:border-emerald-900 dark:text-emerald-200';
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

function WorkloadValue({ tasks, actualHours }: { tasks: BxTask[]; actualHours?: number }) {
  const hours = tasks.reduce((sum, task) => sum + task.estimate, 0);
  if (tasks.length === 0 && actualHours === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-center gap-0.5 leading-tight">
      {tasks.length > 0 && (
        <>
          <strong className="font-semibold">
            {tasks.length} {taskLabel(tasks.length)}
          </strong>
          <span className="text-xs opacity-80">План {formatHours(hours)}</span>
        </>
      )}
      {actualHours !== undefined && (
        <span
          className={
            actualHours > 6
              ? 'text-xs font-medium text-red-700 dark:text-red-300'
              : 'text-xs opacity-80'
          }
        >
          Факт {formatHours(actualHours)}
        </span>
      )}
    </span>
  );
}

export default function TeamWorkload() {
  const { allTasks, users, projects, isLoadingAllTasks, loadAllTasks, loadProjects } =
    useKanbanStore();
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
  const [timeRefreshing, setTimeRefreshing] = useState(false);

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
  const openTasks = useMemo(() => allTasks.filter((task) => task.status !== 'done'), [allTasks]);
  // Bitrix user.get identifies company staff as USER_TYPE=employee. Extranet
  // users must not influence an internal workload plan.
  const employees = useMemo(
    () => users.filter((user) => user.userType !== 'extranet' && user.userType !== 'email'),
    [users],
  );
  const workloadTasks = useMemo(() => {
    const employeeIds = new Set(employees.map((user) => user.id));
    return openTasks.filter((task) => !task.assigneeId || employeeIds.has(task.assigneeId));
  }, [employees, openTasks]);
  const assignees = useMemo(() => {
    const ids = new Set(workloadTasks.map((task) => task.assigneeId || 'unassigned'));
    const known = employees
      .filter((user) => ids.has(user.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    return ids.has('unassigned')
      ? [...known, { id: 'unassigned', name: 'Без исполнителя' } as Bx24User]
      : known;
  }, [employees, workloadTasks]);

  const openTaskList = (assigneeId: string, workload: string) => {
    const params = new URLSearchParams({ from: 'workload', workload });
    params.set('assignee', assigneeId);
    router.push(`/all-tasks?${params.toString()}`);
  };

  const tasksFor = (assigneeId: string, key: string | null) =>
    workloadTasks.filter(
      (task) =>
        (task.assigneeId || 'unassigned') === assigneeId &&
        (key ? dayKey(task.dueDate) === key : !task.dueDate),
    );

  const weekTasks = useMemo(
    () =>
      workloadTasks.filter((task) => {
        const dueKey = dayKey(task.dueDate);
        return dueKey !== null && weekKeys.has(dueKey);
      }),
    [weekKeys, workloadTasks],
  );
  const noDeadlineCount = workloadTasks.filter((task) => !task.dueDate).length;
  const todayKey = calendarDayKey(new Date());
  const overdueTasks = workloadTasks.filter((task) => {
    const dueKey = dayKey(task.dueDate);
    return dueKey !== null && dueKey < todayKey;
  });
  const weekHours = weekTasks.reduce((sum, task) => sum + task.estimate, 0);

  return (
    <div className="min-h-screen bg-muted/30 pb-12">
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
                <p className="text-2xl font-semibold tabular-nums">{weekTasks.length}</p>
                <p className="text-sm text-muted-foreground">задач со сроком на текущую неделю</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Clock3 className="size-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{formatHours(weekHours)}</p>
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
                <p className="text-2xl font-semibold tabular-nums">{overdueTasks.length}</p>
                <p className="text-sm text-muted-foreground">просроченных задач</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-semibold">Календарь нагрузки</h2>
              <p className="text-sm text-muted-foreground">
                Красный: ≥5 задач или &gt;6 ч · жёлтый: ≥4 задачи или ≥4 ч
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
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

          {isLoadingAllTasks ? (
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
                  <div className="border-l px-2 py-3 text-center font-medium text-red-700 dark:text-red-300">
                    Просрочено
                  </div>
                </div>
                {assignees.map((assignee) => (
                  <div
                    key={assignee.id}
                    className="grid grid-cols-[minmax(170px,1.5fr)_repeat(7,minmax(90px,1fr))_minmax(115px,1fr)_minmax(115px,1fr)] border-b last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2 px-4 py-3">
                      <UserAvatar user={assignee} />
                      <span className="truncate text-sm font-medium">{assignee.name}</span>
                    </div>
                    {days.map((day) => {
                      const key = calendarDayKey(day);
                      const tasks = tasksFor(assignee.id, key);
                      const hours = tasks.reduce((sum, task) => sum + task.estimate, 0);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            const actual = actualHoursFor(assignee.id, key);
                            if (actual !== undefined)
                              setSelectedActual({ userId: assignee.id, day: key });
                            else if (tasks.length) openTaskList(assignee.id, key);
                          }}
                          className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${tasks.length ? `${loadTone(tasks.length, hours)} hover:ring-2 hover:ring-primary/30` : 'border-border bg-background/40 hover:bg-muted/70'}`}
                        >
                          <WorkloadValue
                            tasks={tasks}
                            actualHours={actualHoursFor(assignee.id, key)}
                          />
                        </button>
                      );
                    })}
                    {(() => {
                      const tasks = tasksFor(assignee.id, null);
                      const hours = tasks.reduce((sum, task) => sum + task.estimate, 0);
                      return (
                        <button
                          type="button"
                          onClick={() => tasks.length && openTaskList(assignee.id, 'no_deadline')}
                          className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${tasks.length ? `${loadTone(tasks.length, hours)} hover:ring-2 hover:ring-primary/30` : 'border-border bg-background/40 hover:bg-muted/70'}`}
                        >
                          <WorkloadValue tasks={tasks} />
                        </button>
                      );
                    })()}
                    {(() => {
                      const tasks = overdueTasks.filter(
                        (task) => (task.assigneeId || 'unassigned') === assignee.id,
                      );
                      const hours = tasks.reduce((sum, task) => sum + task.estimate, 0);
                      return (
                        <button
                          type="button"
                          onClick={() => tasks.length && openTaskList(assignee.id, 'overdue')}
                          className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${tasks.length ? 'border-red-300 bg-red-500/10 text-red-800 hover:ring-2 hover:ring-red-500/30 dark:border-red-900 dark:text-red-200' : 'border-border bg-background/40 hover:bg-muted/70'}`}
                        >
                          <WorkloadValue tasks={tasks} />
                        </button>
                      );
                    })()}
                  </div>
                ))}
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
                <div key={`${entry.taskId}-${index}`} className="rounded-lg border p-3">
                  <p className="font-medium">{task?.title || `Задача #${entry.taskId}`}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatHours(entry.seconds / 3600)} · #{entry.taskId}
                  </p>
                </div>
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
