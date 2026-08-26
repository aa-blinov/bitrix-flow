'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, MoreHorizontal } from 'lucide-react';
import { BxTask, PRIORITY_LABELS } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import TaskModal from './TaskModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const controlClass =
  'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-input focus:border-input focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/30';
const inputDate = (value?: string) => (value ? value.slice(0, 10) : '');
const PAGE_SIZE = 50;

function EditableTitle({ task }: { task: BxTask }) {
  const updateTaskField = useKanbanStore((state) => state.updateTaskField);
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  const commit = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title)
      void updateTaskField(task.id, 'title', next).catch(() => setTitle(task.title));
  };
  return (
    <div className="min-w-0">
      <Input
        aria-label={`Название задачи ${task.id}`}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setTitle(task.title);
            event.currentTarget.blur();
          }
        }}
        className="h-8 border-transparent bg-transparent px-1 font-medium shadow-none hover:border-input focus-visible:border-input focus-visible:bg-background focus-visible:ring-2"
      />
      <div className="mt-1 flex gap-2 px-1 text-xs text-muted-foreground">
        <span>#{task.id}</span>
        {task.parentId && <span>↳ подзадача</span>}
      </div>
    </div>
  );
}

function FieldControls({ task, compact = false, readOnly = false }: { task: BxTask; compact?: boolean; readOnly?: boolean }) {
  const { users, stages, updateTaskField, moveTaskToStage } = useKanbanStore();
  const label = (name: string, child: React.ReactNode) => (
    <label className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted-foreground">
      <span>{name}</span>
      {child}
    </label>
  );
  const stageOptions = stages.length
    ? stages
    : [{ id: task.stageId, name: task.status === 'done' ? 'Завершена' : 'Без фазы' }];
  const phase = (
    <select
      aria-label="Фаза"
      value={task.stageId}
      onChange={(event) => void moveTaskToStage(task.id, event.target.value)}
      className={controlClass}
    >
      {stageOptions.map((stage) => (
        <option key={stage.id} value={stage.id}>
          {stage.name}
        </option>
      ))}
    </select>
  );
  const assignee = (
    <select
      aria-label="Исполнитель"
      value={task.assigneeId || ''}
      onChange={(event) => void updateTaskField(task.id, 'assigneeId', event.target.value)}
      className={controlClass}
    >
      <option value="">Не назначен</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </select>
  );
  const priority = (
    <select
      aria-label="Приоритет"
      value={task.priority}
      onChange={(event) => void updateTaskField(task.id, 'priority', event.target.value)}
      className={controlClass}
    >
      {Object.entries(PRIORITY_LABELS)
        .filter(([key]) => key !== 'critical')
        .map(([key, item]) => (
          <option key={key} value={key}>
            {item.label}
          </option>
        ))}
    </select>
  );
  const deadline = (
    <Input
      aria-label="Дедлайн"
      type="date"
      value={inputDate(task.dueDate)}
      onChange={(event) => void updateTaskField(task.id, 'deadline', event.target.value || null)}
      className={
        controlClass +
        (task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'
          ? ' text-destructive'
          : '')
      }
    />
  );
  const estimate = (
    <div className="relative">
      <Input
        aria-label="План, часы"
        type="number"
        min="0"
        step="0.5"
        value={task.estimate || ''}
        onChange={(event) =>
          void updateTaskField(task.id, 'estimate', Number(event.target.value) || 0)
        }
        className={controlClass + ' pr-7'}
      />
      <span className="pointer-events-none absolute right-2 top-2 text-xs text-muted-foreground">
        ч
      </span>
    </div>
  );
  if (readOnly) {
    return (
      <>
        <TableCell className="text-muted-foreground">
          {task.stageId === '0' ? '—' : `#${task.stageId}`}
        </TableCell>
        <TableCell>{assignee}</TableCell>
        <TableCell>{priority}</TableCell>
        <TableCell>{deadline}</TableCell>
        <TableCell className="text-muted-foreground">{task.estimate} ч</TableCell>
      </>
    );
  }

  if (!compact)
    return (
      <>
        <TableCell>{phase}</TableCell>
        <TableCell>{assignee}</TableCell>
        <TableCell>{priority}</TableCell>
        <TableCell>{deadline}</TableCell>
        <TableCell>{estimate}</TableCell>
      </>
    );
  return (
    <div className="grid gap-1.5">
      {label('Фаза', phase)}
      {label('Исполнитель', assignee)}
      {label('Приоритет', priority)}
      {label('Дедлайн', deadline)}
      {label('План, ч', estimate)}
      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted-foreground">
        <span>Факт</span>
        <span className="px-2 text-sm text-foreground">{task.actualTime || 0} ч</span>
      </div>
    </div>
  );
}

function TaskActions({ task }: { task: BxTask }) {
  const { setSelectedTask, moveTask } = useKanbanStore();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Действия для ${task.title}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Быстрые действия</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setSelectedTask(task.id)}>
          <ExternalLink />
          Открыть карточку
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void moveTask(task.id, task.status === 'done' ? 'new' : 'done')}
        >
          {task.status === 'done' ? <Circle /> : <CheckCircle2 />}
          {task.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненной'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function TaskGrid({
  tasks,
  showProject = false,
  title,
}: {
  tasks: BxTask[];
  showProject?: boolean;
  title?: string;
}) {
  const selectedTaskId = useKanbanStore((state) => state.selectedTaskId);
  const setSelectedTask = useKanbanStore((state) => state.setSelectedTask);
  const updateTaskField = useKanbanStore((state) => state.updateTaskField);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const stages = useKanbanStore((state) => state.stages);
  const projectById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [tasks, selectedTaskId],
  );
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'updated' | 'deadline' | 'priority' | 'title'>('updated');
  const [groupBy, setGroupBy] = useState<'none' | 'stage' | 'assignee'>('none');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const orderedTasks = useMemo(
    () =>
      [...tasks].sort((left, right) => {
        if (sortBy === 'title') return left.title.localeCompare(right.title, 'ru');
        if (sortBy === 'priority') return right.priority.localeCompare(left.priority);
        if (sortBy === 'deadline') return (left.dueDate || '9999').localeCompare(right.dueDate || '9999');
        return right.updatedDate.localeCompare(left.updatedDate);
      }),
    [tasks, sortBy],
  );
  const pageCount = Math.max(1, Math.ceil(orderedTasks.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageTasks = orderedTasks.slice(pageStart, pageStart + PAGE_SIZE);
  const groupedPageTasks = useMemo(() => {
    if (groupBy === 'none') return [{ label: '', tasks: pageTasks }];
    const labels = groupBy === 'stage'
      ? Object.fromEntries(stages.map((stage) => [stage.id, stage.name]))
      : Object.fromEntries(users.map((user) => [user.id, user.name]));
    return Object.entries(
      pageTasks.reduce<Record<string, BxTask[]>>((groups, task) => {
        const key = groupBy === 'stage' ? task.stageId : task.assigneeId || '';
        (groups[labels[key] || (groupBy === 'stage' ? 'Без фазы' : 'Не назначен')] ||= []).push(task);
        return groups;
      }, {}),
    ).map(([label, groupedTasks]) => ({ label, tasks: groupedTasks }));
  }, [groupBy, pageTasks, stages, users]);
  const pageNumbers = Array.from(
    new Set([1, page - 1, page, page + 1, pageCount].filter((value) => value >= 1 && value <= pageCount)),
  ).sort((left, right) => left - right);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [tasks, sortBy, groupBy]);

  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelectedIds((current) =>
      pageTasks.every((task) => current.has(task.id))
        ? new Set([...current].filter((id) => !pageTasks.some((task) => task.id === id)))
        : new Set([...current, ...pageTasks.map((task) => task.id)]),
    );
  const applyBulk = (field: 'assigneeId' | 'status', value: string) => {
    void Promise.all([...selectedIds].map((id) => updateTaskField(id, field, value)));
    setSelectedIds(new Set());
  };

  if (tasks.length === 0)
    return (
      <Card className="mx-4 mt-5 border-dashed sm:mx-6">
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground">
            <Circle className="size-6" />
          </div>
          <div>
            <h2 className="font-semibold">Нет задач</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showProject
                ? 'По выбранным фильтрам ничего не найдено.'
                : 'Измените фильтры или создайте первую задачу на доске.'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  const isReadOnly = showProject;
  return (
    <>
      <Card className="mx-4 mt-5 overflow-hidden shadow-sm sm:mx-6">
        <CardHeader className="gap-3 border-b bg-muted/30 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">{title ?? 'Задачи проекта'}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}
                className={controlClass + ' w-auto bg-background'}
                aria-label="Группировка"
              >
                <option value="none">Без группировки</option>
                <option value="stage">По фазе</option>
                <option value="assignee">По исполнителю</option>
              </select>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                className={controlClass + ' w-auto bg-background'}
                aria-label="Сортировка"
              >
                <option value="updated">По обновлению</option>
                <option value="deadline">По дедлайну</option>
                <option value="priority">По приоритету</option>
                <option value="title">По названию</option>
              </select>
            </div>
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 text-sm">
              <span className="font-medium">Выбрано: {selectedIds.size}</span>
              <select
                defaultValue=""
                onChange={(event) => event.target.value && applyBulk('assigneeId', event.target.value)}
                className={controlClass + ' w-auto bg-background'}
                aria-label="Назначить исполнителя"
              >
                <option value="" disabled>Назначить исполнителя…</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              <select
                defaultValue=""
                onChange={(event) => event.target.value && applyBulk('status', event.target.value)}
                className={controlClass + ' w-auto bg-background'}
                aria-label="Сменить статус"
              >
                <option value="" disabled>Сменить статус…</option>
                <option value="new">Новая</option>
                <option value="in_progress">В работе</option>
                <option value="done">Готово</option>
              </select>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Снять выбор</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y md:hidden">
            {pageTasks.map((task) => (
              <article
                key={task.id}
                className={`space-y-3 p-4 ${task.status === 'done' ? 'bg-muted/60 text-muted-foreground' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(task.id)}
                    onChange={() => toggleSelected(task.id)}
                    aria-label={`Выбрать задачу ${task.title}`}
                    className="mt-2 size-4 shrink-0 accent-primary"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-0.5 shrink-0"
                    aria-label="Открыть задачу"
                    onClick={() => setSelectedTask(task.id)}
                  >
                    {task.status === 'done' ? (
                      <CheckCircle2 className="text-primary" />
                    ) : (
                      <Circle />
                    )}
                  </Button>
                  <div className="min-w-0 flex-1">
                    <EditableTitle task={task} />
                    {showProject && (
                      <div className="mt-1 px-1 text-xs text-muted-foreground">
                        {projectById[task.projectId]?.name ?? '—'}
                      </div>
                    )}
                  </div>
                  <TaskActions task={task} />
                </div>
                <FieldControls task={task} compact readOnly={isReadOnly} />
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={pageTasks.length > 0 && pageTasks.every((task) => selectedIds.has(task.id))}
                      onChange={togglePage}
                      aria-label="Выбрать задачи на странице"
                      className="size-4 accent-primary"
                    />
                  </TableHead>
                  <TableHead className="min-w-72">Задача</TableHead>
                  {showProject && <TableHead>Проект</TableHead>}
                  <TableHead>Фаза</TableHead>
                  <TableHead>Исполнитель</TableHead>
                  <TableHead>Приоритет</TableHead>
                  <TableHead>Дедлайн</TableHead>
                  <TableHead>План</TableHead>
                  <TableHead>Факт</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Действия</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedPageTasks.map((group) => (
                  <Fragment key={group.label || 'all'}>
                    {groupBy !== 'none' && (
                      <TableRow className="bg-muted/60 hover:bg-muted/60">
                        <TableCell colSpan={showProject ? 10 : 9} className="font-medium text-foreground">
                          {group.label} · {group.tasks.length}
                        </TableCell>
                      </TableRow>
                    )}
                    {group.tasks.map((task) => (
                      <TableRow
                        key={task.id}
                        className={task.status === 'done' ? 'bg-muted/60 text-muted-foreground' : ''}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(task.id)}
                            onChange={() => toggleSelected(task.id)}
                            aria-label={`Выбрать задачу ${task.title}`}
                            className="size-4 accent-primary"
                          />
                        </TableCell>
                        <TableCell>
                          <EditableTitle task={task} />
                        </TableCell>
                        {showProject && (
                          <TableCell className="max-w-48 truncate text-muted-foreground">
                            {projectById[task.projectId]?.name ?? `—`}
                          </TableCell>
                        )}
                        <FieldControls task={task} readOnly={isReadOnly} />
                        <TableCell className="text-muted-foreground">
                          {task.actualTime || 0} ч
                        </TableCell>
                        <TableCell>
                          <TaskActions task={task} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        {pageCount > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 sm:px-6">
            <p className="text-sm text-muted-foreground">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, tasks.length)} из {tasks.length}
            </p>
            <div className="flex items-center gap-1" aria-label="Пагинация">
              <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page === 1}>
                Первая
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((value) => value - 1)} disabled={page === 1}>
                Назад
              </Button>
              {pageNumbers.map((number) => (
                <Button
                  key={number}
                  variant={number === page ? 'default' : 'outline'}
                  size="sm"
                  className="w-9 px-0"
                  onClick={() => setPage(number)}
                >
                  {number}
                </Button>
              ))}
              <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={page === pageCount}>
                Вперёд
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(pageCount)} disabled={page === pageCount}>
                Последняя
              </Button>
            </div>
          </div>
        )}
      </Card>
      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </>
  );
}
