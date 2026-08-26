'use client';
import { useKanbanStore } from '@/store/kanban';
import { PRIORITY_LABELS } from '@/types/bitrix';
import { Search, X, MessageSquare, Timer, Calendar, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import TaskModal from '@/components/TaskModal';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export default function SearchPage() {
  const { search, searchResults, isSearching, searchQuery, setSelectedTask, tasks } =
    useKanbanStore();
  const [query, setQuery] = useState(searchQuery);
  const [selectedTaskId, setSelectedTaskLocal] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== searchQuery) {
        search(query);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  const openTask = (taskId: string) => {
    setSelectedTask(taskId);
    setSelectedTaskLocal(taskId);
  };
  const closeTask = () => {
    setSelectedTask(null);
    setSelectedTaskLocal(null);
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <h1 className="pt-2 text-xl font-semibold text-foreground md:pt-0">Поиск</h1>
        <p className="text-sm text-muted-foreground">Задачи во всех доступных проектах</p>
      </header>

      {/* Search Input */}
      <div className="border-b bg-background p-4 lg:p-6">
        <div className="relative max-w-2xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks by title..."
            className="h-11 pl-12 pr-12"
            autoFocus
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              <X size={18} />
            </Button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="p-4 lg:p-6">
        {isSearching ? (
          <div className="mx-auto max-w-2xl space-y-3 py-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">Найдено: {searchResults.length}</p>
            {searchResults.map((task) => (
              <Card
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => openTask(task.id)}
                onKeyDown={(event) => event.key === 'Enter' && openTask(task.id)}
                className="cursor-pointer gap-0 p-4 transition hover:ring-primary/20 hover:shadow-sm"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`w-2.5 h-2.5 rounded-full mt-1.5 ${
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
                    <h3 className="font-medium text-gray-900">{task.title}</h3>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span className="font-mono">#{task.id}</span>
                      <Badge
                        variant="secondary"
                        className={`${PRIORITY_LABELS[task.priority]?.bgColor} ${PRIORITY_LABELS[task.priority]?.color}`}
                      >
                        {PRIORITY_LABELS[task.priority]?.label}
                      </Badge>
                      {task.assigneeName && (
                        <span className="flex items-center gap-1">
                          <User size={12} />
                          {task.assigneeName}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {new Date(task.dueDate).toLocaleDateString()}
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
            ))}
          </div>
        ) : query ? (
          <div className="text-center py-8 text-gray-400">No tasks found for "{query}"</div>
        ) : (
          <div className="text-center py-8 text-gray-400">Start typing to search tasks</div>
        )}
      </div>

      {selectedTask && <TaskModal task={selectedTask} onClose={closeTask} />}
    </div>
  );
}
