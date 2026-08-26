'use client';
import { useKanbanStore } from '@/store/kanban';
import { PRIORITY_LABELS } from '@/types/bitrix';
import { Calendar, MessageSquare, Timer, User, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import TaskModal from '@/components/TaskModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function MyTasksPage() {
  const { allTasks, currentUser, setCurrentUser, setSelectedTask, loadAllTasks, isLoadingAllTasks } =
    useKanbanStore();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoadingProfile, setIsLoadingProfile] = useState(!currentUser.id);

  useEffect(() => {
    if (currentUser.id) {
      setIsLoadingProfile(false);
      return;
    }
    void fetch('/api/bitrix/user.current', { method: 'POST' })
      .then((response) => response.json())
      .then((data) => {
        const user = data.result;
        if (user?.ID || user?.id) {
          setCurrentUser({
            id: String(user.ID || user.id),
            name: `${user.NAME || user.name || ''} ${user.LAST_NAME || user.lastName || ''}`.trim(),
            photo: user.PERSONAL_PHOTO || user.personalPhoto,
          });
        }
      })
      .finally(() => setIsLoadingProfile(false));
  }, [currentUser.id, setCurrentUser]);

  useEffect(() => {
    if (allTasks.length === 0 && !isLoadingAllTasks) void loadAllTasks();
  }, [allTasks.length, isLoadingAllTasks, loadAllTasks]);

  const myTasks = allTasks.filter(
    (task) => String(task.assigneeId) === String(currentUser.id),
  );
  const filteredTasks =
    statusFilter === 'all' ? myTasks : myTasks.filter((t) => t.status === statusFilter);

  const stats = {
    total: myTasks.length,
    new: myTasks.filter((t) => t.status === 'new').length,
    inProgress: myTasks.filter((t) => t.status === 'in_progress').length,
    done: myTasks.filter((t) => t.status === 'done').length,
    overdue: myTasks.filter((t) => {
      if (!t.dueDate || t.status === 'done') return false;
      return new Date(t.dueDate) < new Date();
    }).length,
  };

  const selectedTask = useKanbanStore((s) =>
    s.selectedTaskId ? allTasks.find((task) => task.id === s.selectedTaskId) : null,
  );

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="pt-2 md:pt-0">
            <h1 className="text-xl font-semibold text-foreground">Мои задачи</h1>
            <p className="text-sm text-muted-foreground">
              Все задачи во всех проектах, где вы исполнитель · {currentUser.name}
            </p>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0">
            <Button
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('all')}
            >
              Все ({stats.total})
            </Button>
            <Button
              variant={statusFilter === 'new' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('new')}
            >
              Новые ({stats.new})
            </Button>
            <Button
              variant={statusFilter === 'in_progress' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('in_progress')}
            >
              В работе ({stats.inProgress})
            </Button>
            <Button
              variant={statusFilter === 'done' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('done')}
            >
              Готово ({stats.done})
            </Button>
          </div>
        </div>
      </header>

      {/* Stats */}
      {stats.overdue > 0 && (
        <div className="px-4 lg:px-6 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2 text-red-600">
          <CheckCircle2 size={16} />
          <span className="text-sm font-medium">
            {stats.overdue} просроченных задач требуют внимания
          </span>
        </div>
      )}

      {/* Task List */}
      <div className="p-4 lg:p-6">
        <div className="max-w-3xl space-y-3">
          {isLoadingProfile || (isLoadingAllTasks && allTasks.length === 0) ? (
            <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
              Загружаем ваши задачи…
            </div>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => {
              const isOverdue =
                task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

              return (
                <Card
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTask(task.id)}
                  onKeyDown={(event) => event.key === 'Enter' && setSelectedTask(task.id)}
                  className={`w-full cursor-pointer gap-0 p-4 text-left transition hover:ring-primary/20 hover:shadow-sm ${
                    isOverdue
                      ? 'border-l-4 border-l-red-500 border-t-red-100 border-b-red-100'
                      : 'border-border'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-3 h-3 rounded-full mt-1.5 ${
                        task.status === 'done'
                          ? 'bg-green-500'
                          : task.status === 'in_progress'
                            ? 'bg-blue-500'
                            : task.status === 'testing'
                              ? 'bg-yellow-500'
                              : 'bg-gray-400'
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <h3
                          className={`font-medium ${task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                        >
                          {task.title}
                        </h3>
                        <Badge
                          variant="secondary"
                          className={`whitespace-nowrap ${PRIORITY_LABELS[task.priority]?.bgColor} ${PRIORITY_LABELS[task.priority]?.color}`}
                        >
                          {PRIORITY_LABELS[task.priority]?.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="font-mono">#{task.id}</span>

                        {task.dueDate && (
                          <span
                            className={`flex items-center gap-1 ${isOverdue ? 'text-red-500' : ''}`}
                          >
                            <Calendar size={12} />
                            {new Date(task.dueDate).toLocaleDateString('ru-RU', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        )}

                        {task.actualTime > 0 && (
                          <span className="flex items-center gap-1">
                            <Timer size={12} />
                            {task.actualTime} ч
                          </span>
                        )}

                        {task.comments.length > 0 && (
                          <span className="flex items-center gap-1">
                            <MessageSquare size={12} />
                            {task.comments.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })
          ) : (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center text-muted-foreground py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <CheckCircle2 size={32} className="text-muted-foreground/70" />
              </div>
              <p className="text-lg font-medium">Нет задач</p>
              <p className="text-sm">
                {statusFilter === 'all'
                  ? 'У вас нет назначенных задач'
                  : `Нет задач со статусом «${statusFilter}»`}
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
