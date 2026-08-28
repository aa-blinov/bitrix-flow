'use client';

import { Bell, CheckCircle2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSSE } from '@/hooks/useSSE';
import { useKanbanStore } from '@/store/kanban';

type Notice = {
  id: string;
  type: string;
  title: string;
  message: string;
  taskId?: string;
  projectId?: string;
  created_at?: string;
  createdAt?: string;
};

function icon(type: string) {
  if (type === 'comment_added') return <MessageSquareText className="size-4 text-sky-600" />;
  if (type === 'task_added') return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (type === 'task_deleted') return <Trash2 className="size-4 text-destructive" />;
  return <Pencil className="size-4 text-amber-600" />;
}

export default function Notifications() {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const selectedProjectId = useKanbanStore((state) => state.selectedProjectId);
  const loadTasks = useKanbanStore((state) => state.loadTasks);
  const memberId =
    typeof window === 'undefined' ? '' : localStorage.getItem('bitrix_member_id') || '';

  const loadHistory = useCallback(async () => {
    if (!memberId) return;
    const response = await fetch(`/api/notifications?member_id=${encodeURIComponent(memberId)}`, {
      headers: { 'X-Member-Id': memberId },
    });
    if (!response.ok) return;
    const data = await response.json();
    setItems(data.notifications || []);
  }, [memberId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const onEvent = useCallback(
    (event: Notice) => {
      setItems((current) =>
        [{ ...event, id: `${event.createdAt || Date.now()}-${event.type}` }, ...current].slice(
          0,
          50,
        ),
      );
      if (selectedProjectId) void loadTasks(selectedProjectId, true);
    },
    [loadTasks, selectedProjectId],
  );

  useSSE(memberId, onEvent);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void loadHistory();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Уведомления" className="relative">
          <Bell className="size-4" />
          {items.length > 0 && (
            <Badge className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full p-0 text-[9px]">
              {Math.min(items.length, 9)}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <DropdownMenuLabel className="px-3 py-2.5">История изменений</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto p-1">
          {items.length ? (
            items.map((item) => {
              const href = item.projectId && item.taskId
                ? `/projects/${item.projectId}?task=${encodeURIComponent(item.taskId)}`
                : null;
              const row = (
                <>
                  <span className="mt-0.5">{icon(item.type)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
                  </div>
                </>
              );
              return href ? (
                <Link
                  key={item.id}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  {row}
                </Link>
              ) : (
                <div key={item.id} className="flex gap-2 rounded-md px-2 py-2.5 text-sm">
                  {row}
                </div>
              );
            })
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Изменений пока нет
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="block px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted"
        >
          Все уведомления
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
