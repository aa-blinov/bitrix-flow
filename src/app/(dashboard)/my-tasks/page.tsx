'use client';
import { useKanbanStore } from '@/store/kanban';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import LoadingState from '@/components/LoadingState';
import TaskGrid from '@/components/TaskGrid';

export default function MyTasksPage() {
  const { allTasks, currentUser, setCurrentUser, loadAllTasks, isLoadingAllTasks } =
    useKanbanStore();
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
  const overdueCount = myTasks.filter((t) => {
    if (!t.dueDate || t.status === 'done') return false;
    return new Date(t.dueDate) < new Date();
  }).length;

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <h1 className="pt-2 text-xl font-semibold text-foreground md:pt-0">Мои задачи</h1>
      </header>

      {/* Stats */}
      {overdueCount > 0 && (
        <div className="px-4 lg:px-6 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2 text-red-600">
          <CheckCircle2 size={16} />
          <span className="text-sm font-medium">
            {overdueCount} просроченных задач требуют внимания
          </span>
        </div>
      )}

      {isLoadingProfile || (isLoadingAllTasks && allTasks.length === 0) ? (
        <LoadingState className="min-h-[60vh] bg-transparent" />
      ) : (
        <TaskGrid tasks={myTasks} showProject title={null} />
      )}
    </div>
  );
}
