'use client';
import { useKanbanStore } from '@/store/kanban';
import { CheckCircle2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LoadingState from '@/components/LoadingState';
import TaskGrid from '@/components/TaskGrid';
import TaskModal from '@/components/TaskModal';
import type { BxTask } from '@/types/bitrix';

export default function MyTasksPage() {
  return (
    <Suspense fallback={<LoadingState className="min-h-screen bg-muted/30" />}>
      <MyTasksContent />
    </Suspense>
  );
}

function MyTasksContent() {
  const {
    allTasks,
    currentUser,
    setCurrentUser,
    loadAllTasks,
    isLoadingAllTasks,
    setSelectedTask,
    openTransientTask,
    selectedTransientTask,
    clearTransientTask,
  } = useKanbanStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const notificationTaskId = searchParams.get('task');
  const [isLoadingProfile, setIsLoadingProfile] = useState(!currentUser.id);
  const [localTask, setLocalTask] = useState<BxTask | null>(null);

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

  useEffect(() => {
    if (!notificationTaskId) return;
    if (!allTasks.length) return;
    if (allTasks.some((task) => String(task.id) === String(notificationTaskId))) {
      setSelectedTask(notificationTaskId);
      const next = new URL(window.location.href);
      next.searchParams.delete('task');
      router.replace(`${next.pathname}${next.search ? `?${next.searchParams.toString()}` : ''}`);
      return;
    }
    // Задача ещё не в локальном зеркале: подтянем её одним запросом и
    // покажем в модалке, чтобы уведомление не висело «без ответа».
    void openTransientTask(notificationTaskId);
    void (async () => {
      try {
        const response = await fetch('/api/bitrix/tasks.task.get?taskId=' + encodeURIComponent(notificationTaskId), { method: 'POST' });
        const data = await response.json();
        const remote = data?.result?.task || data?.result;
        if (remote) {
          setLocalTask({
            id: String(remote.id ?? remote.ID),
            projectId: String(remote.groupId ?? remote.GROUP_ID ?? '0'),
            title: remote.title || remote.TITLE || '',
            description: remote.description || '',
            status: remote.status || remote.STATUS,
            priority: remote.priority || remote.PRIORITY,
            assigneeId: String(remote.responsibleId ?? remote.RESPONSIBLE_ID ?? ''),
            assigneeName: remote.responsible?.name || remote.responsibleName || '',
            createdDate: remote.createdDate || remote.CREATED_DATE,
            updatedDate: remote.changedDate || remote.CHANGED_DATE,
            dueDate: remote.deadline || undefined,
            comments: [],
            commentsCount: remote.commentsCount || 0,
            checklist: [],
            timeEntries: [],
            subtasks: [],
            stageId: String(remote.stageId || '0'),
            chatId: remote.chatId || remote.CHAT_ID,
            estimate: parseInt(remote.timeEstimate) || 0,
            actualTime: parseInt(remote.timeSpentInLogs) || 0,
          });
        }
      } catch (error) {
        console.error('Failed to load task for notification', error);
      }
    })();
    const next = new URL(window.location.href);
    next.searchParams.delete('task');
    router.replace(`${next.pathname}${next.search ? `?${next.searchParams.toString()}` : ''}`);
  }, [notificationTaskId, allTasks, setSelectedTask, openTransientTask, router]);

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
        <TaskGrid
          tasks={myTasks}
          transientTask={selectedTransientTask}
          showProject
          viewScope="my"
          title={null}
        />
      )}
      {localTask && (
        <TaskModal
          task={localTask}
          onClose={() => {
            setLocalTask(null);
            setSelectedTask(null);
            clearTransientTask();
          }}
        />
      )}
    </div>
  );
}
