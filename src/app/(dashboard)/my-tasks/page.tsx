'use client';
import { useKanbanStore } from '@/store/kanban';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import TaskGrid from '@/components/TaskGrid';

export default function MyTasksPage() {
  const { allTasks, currentUser, setCurrentUser, loadAllTasks, isLoadingAllTasks } =
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

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="pt-2 md:pt-0">
            <h1 className="text-xl font-semibold text-foreground">Мои задачи</h1>
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

      {isLoadingProfile || (isLoadingAllTasks && allTasks.length === 0) ? (
        <LoadingState label="Загружаем ваши задачи…" className="min-h-[60vh] bg-transparent" />
      ) : (
        <TaskGrid tasks={filteredTasks} showProject title={null} />
      )}
    </div>
  );
}
