'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, Clock3, UsersRound } from 'lucide-react';
import { BxTask, Bx24Project, Bx24User } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const WEEK_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

type WorkloadCell = {
  assigneeName: string;
  dateLabel: string;
  tasks: BxTask[];
};

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

function loadTone(count: number, hours: number) {
  if (count >= 5 || hours >= 8)
    return 'border-red-300 bg-red-500/10 text-red-800 dark:border-red-900 dark:text-red-200';
  if (count >= 3 || hours >= 5)
    return 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-900 dark:text-amber-200';
  return 'border-emerald-300 bg-emerald-500/10 text-emerald-800 dark:border-emerald-900 dark:text-emerald-200';
}

function WorkloadValue({ tasks }: { tasks: BxTask[] }) {
  const hours = tasks.reduce((sum, task) => sum + task.estimate, 0);
  if (tasks.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-center gap-0.5 leading-tight">
      <strong className="font-semibold">
        {tasks.length} {tasks.length === 1 ? 'задача' : 'задач'}
      </strong>
      <span className="text-xs opacity-80">{formatHours(hours)}</span>
    </span>
  );
}

export default function TeamWorkload() {
  const { allTasks, users, projects, isLoadingAllTasks, loadAllTasks, loadProjects } =
    useKanbanStore();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedCell, setSelectedCell] = useState<WorkloadCell | null>(null);

  useEffect(() => {
    if (allTasks.length === 0) void loadAllTasks();
    if (projects.length === 0) void loadProjects();
  }, [allTasks.length, loadAllTasks, loadProjects, projects.length]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const weekKeys = useMemo(() => new Set(days.map(calendarDayKey)), [days]);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const openTasks = useMemo(() => allTasks.filter((task) => task.status !== 'done'), [allTasks]);
  const assignees = useMemo(() => {
    const ids = new Set(openTasks.map((task) => task.assigneeId || 'unassigned'));
    const known = users
      .filter((user) => ids.has(user.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    return ids.has('unassigned')
      ? [...known, { id: 'unassigned', name: 'Без исполнителя' } as Bx24User]
      : known;
  }, [openTasks, users]);

  const tasksFor = (assigneeId: string, key: string | null) =>
    openTasks.filter(
      (task) =>
        (task.assigneeId || 'unassigned') === assigneeId &&
        (key ? dayKey(task.dueDate) === key : !task.dueDate),
    );

  const weekTasks = useMemo(
    () =>
      openTasks.filter((task) => {
        const dueKey = dayKey(task.dueDate);
        return dueKey !== null && weekKeys.has(dueKey);
      }),
    [openTasks, weekKeys],
  );
  const noDeadlineCount = openTasks.filter((task) => !task.dueDate).length;
  const weekHours = weekTasks.reduce((sum, task) => sum + task.estimate, 0);

  return (
    <div className="min-h-screen bg-muted/30 pb-12">
      <PageHeader
        title="Нагрузка команды"
        description="План по срокам: количество задач и часы на каждого исполнителя"
      />

      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ClipboardList className="size-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{weekTasks.length}</p>
                <p className="text-sm text-muted-foreground">задач со сроком на неделю</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Clock3 className="size-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{formatHours(weekHours)}</p>
                <p className="text-sm text-muted-foreground">плановая нагрузка</p>
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
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-semibold">Календарь нагрузки</h2>
              <p className="text-sm text-muted-foreground">
                Красный: ≥5 задач или ≥8 ч · жёлтый: ≥3 задачи или ≥5 ч
              </p>
            </div>
            <div className="flex items-center gap-1">
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
              <div className="min-w-[1000px]">
                <div className="grid grid-cols-[minmax(190px,1.5fr)_repeat(7,minmax(105px,1fr))_minmax(130px,1fr)] border-b bg-muted/40 text-sm">
                  <div className="px-4 py-3 font-medium">Исполнитель</div>
                  {days.map((day, index) => (
                    <div key={calendarDayKey(day)} className="border-l px-2 py-3 text-center">
                      <p className="font-medium">{DAY_NAMES[index]}</p>
                      <p className="text-xs text-muted-foreground">{DAY_FORMATTER.format(day)}</p>
                    </div>
                  ))}
                  <div className="border-l px-2 py-3 text-center font-medium">Без срока</div>
                </div>
                {assignees.map((assignee) => (
                  <div
                    key={assignee.id}
                    className="grid grid-cols-[minmax(190px,1.5fr)_repeat(7,minmax(105px,1fr))_minmax(130px,1fr)] border-b last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2 px-4 py-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {assignee.name.charAt(0)}
                      </span>
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
                          onClick={() =>
                            tasks.length &&
                            setSelectedCell({
                              assigneeName: assignee.name,
                              dateLabel: DAY_FORMATTER.format(day),
                              tasks,
                            })
                          }
                          className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${tasks.length ? `${loadTone(tasks.length, hours)} hover:ring-2 hover:ring-primary/30` : 'border-transparent hover:bg-muted/70'}`}
                        >
                          <WorkloadValue tasks={tasks} />
                        </button>
                      );
                    })}
                    {(() => {
                      const tasks = tasksFor(assignee.id, null);
                      const hours = tasks.reduce((sum, task) => sum + task.estimate, 0);
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            tasks.length &&
                            setSelectedCell({
                              assigneeName: assignee.name,
                              dateLabel: 'Без срока',
                              tasks,
                            })
                          }
                          className={`m-1 min-h-16 rounded-lg border px-1 py-2 text-center transition-colors ${tasks.length ? `${loadTone(tasks.length, hours)} hover:ring-2 hover:ring-primary/30` : 'border-transparent hover:bg-muted/70'}`}
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

      <Dialog open={selectedCell !== null} onOpenChange={(open) => !open && setSelectedCell(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedCell?.assigneeName} · {selectedCell?.dateLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {selectedCell?.tasks.map((task) => (
              <div key={task.id} className="rounded-lg border p-3">
                <div className="mb-1 flex items-start justify-between gap-3">
                  <p className="font-medium leading-snug">{task.title}</p>
                  <Badge variant="secondary" className="shrink-0">
                    {formatHours(task.estimate)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  #{task.id} · {projectNames.get(task.projectId) || 'Без проекта'}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
