'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock3, ExternalLink, MoreHorizontal } from 'lucide-react';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

function FieldControls({ task, compact = false }: { task: BxTask; compact?: boolean }) {
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
  const { stages, setSelectedTask, moveTask, moveTaskToStage } = useKanbanStore();
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
        {stages.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Clock3 />
                Переместить в фазу
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {stages.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={item.id === task.stageId}
                    onClick={() => void moveTaskToStage(task.id, item.id)}
                  >
                    {item.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function TaskGrid({ tasks }: { tasks: BxTask[] }) {
  const selectedTaskId = useKanbanStore((state) => state.selectedTaskId);
  const setSelectedTask = useKanbanStore((state) => state.setSelectedTask);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [tasks, selectedTaskId],
  );
  if (tasks.length === 0)
    return (
      <Card className="mx-4 mt-5 border-dashed sm:mx-6">
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground">
            <Circle className="size-6" />
          </div>
          <div>
            <h2 className="font-semibold">В этой выборке нет задач</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Измените фильтры или создайте первую задачу на доске.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  return (
    <>
      <Card className="mx-4 mt-5 overflow-hidden shadow-sm sm:mx-6">
        <CardHeader className="border-b bg-muted/30 px-4 py-4 sm:px-6">
          <CardTitle className="text-base">Задачи проекта</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y md:hidden">
            {tasks.map((task) => (
              <article
                key={task.id}
                className={`space-y-3 p-4 ${task.status === 'done' ? 'bg-muted/60 text-muted-foreground' : ''}`}
              >
                <div className="flex items-start gap-2">
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
                  </div>
                  <TaskActions task={task} />
                </div>
                <FieldControls task={task} compact />
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-72">Задача</TableHead>
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
                {tasks.map((task) => (
                  <TableRow
                    key={task.id}
                    className={task.status === 'done' ? 'bg-muted/60 text-muted-foreground' : ''}
                  >
                    <TableCell>
                      <EditableTitle task={task} />
                    </TableCell>
                    <FieldControls task={task} />
                    <TableCell className="text-muted-foreground">
                      {task.actualTime || 0} ч
                    </TableCell>
                    <TableCell>
                      <TaskActions task={task} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </>
  );
}
