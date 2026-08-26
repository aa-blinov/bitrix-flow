'use client';
import { useKanbanStore } from '@/store/kanban';
import { PRIORITY_LABELS } from '@/types/bitrix';
import { Calendar, MessageSquare, Timer, User, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import TaskModal from '@/components/TaskModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function MyTasksPage() {
  const { tasks, currentUser, setSelectedTask } = useKanbanStore();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
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
    s.selectedTaskId ? tasks.find((t) => t.id === s.selectedTaskId) : null,
  );

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="pt-2 md:pt-0">
            <h1 className="text-xl font-semibold text-foreground">Мои задачи</h1>
            <p className="text-sm text-muted-foreground">{currentUser.name}</p>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0">
            <Button
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('all')}
            >
              All ({stats.total})
            </Button>
            <Button
              variant={statusFilter === 'new' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('new')}
            >
              New ({stats.new})
            </Button>
            <Button
              variant={statusFilter === 'in_progress' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('in_progress')}
            >
              In Progress ({stats.inProgress})
            </Button>
            <Button
              variant={statusFilter === 'done' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('done')}
            >
              Done ({stats.done})
            </Button>
          </div>
        </div>
      </header>

      {/* Stats */}
      {stats.overdue > 0 && (
        <div className="px-4 lg:px-6 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2 text-red-600">
          <CheckCircle2 size={16} />
          <span className="text-sm font-medium">{stats.overdue} overdue tasks need attention</span>
        </div>
      )}

      {/* Task List */}
      <div className="p-4 lg:p-6">
        <div className="max-w-3xl space-y-3">
          {filteredTasks.length > 0 ? (
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
                      : 'border-gray-100'
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
                          className={`font-medium ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}
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

                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="font-mono">#{task.id}</span>

                        {task.dueDate && (
                          <span
                            className={`flex items-center gap-1 ${isOverdue ? 'text-red-500' : ''}`}
                          >
                            <Calendar size={12} />
                            {new Date(task.dueDate).toLocaleDateString('en', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        )}

                        {task.actualTime > 0 && (
                          <span className="flex items-center gap-1">
                            <Timer size={12} />
                            {task.actualTime}h
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
            <div className="text-center py-12 text-gray-400">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-gray-300" />
              </div>
              <p className="text-lg font-medium">No tasks</p>
              <p className="text-sm">
                {statusFilter === 'all'
                  ? 'You have no assigned tasks'
                  : `No ${statusFilter.replace('_', ' ')} tasks`}
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
