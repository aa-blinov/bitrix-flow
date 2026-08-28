'use client';

import Link from 'next/link';
import { Bell, CheckCircle2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';

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

function noticeIcon(type: string) {
  if (type === 'comment_added') return <MessageSquareText className="size-4 text-sky-600" />;
  if (type === 'task_added') return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (type === 'task_deleted') return <Trash2 className="size-4 text-destructive" />;
  return <Pencil className="size-4 text-amber-600" />;
}

function noticeLabel(type: string) {
  if (type === 'comment_added') return 'Комментарий';
  if (type === 'task_added') return 'Новая задача';
  if (type === 'task_deleted') return 'Удаление задачи';
  return 'Изменение задачи';
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void fetch('/api/notifications?limit=200')
      .then((response) => response.json())
      .then((data) => setItems(data.notifications || []))
      .finally(() => setLoading(false));
  }, []);

  async function clearHistory() {
    if (!items.length || !window.confirm('Очистить всю историю уведомлений?')) return;
    setClearing(true);
    try {
      const response = await fetch('/api/notifications', { method: 'DELETE' });
      if (response.ok) setItems([]);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Bell className="size-5" />
            <div>
              <h1 className="text-xl font-semibold">Уведомления</h1>
              <p className="text-sm text-muted-foreground">Последние изменения в задачах Битрикс24</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void clearHistory()} disabled={!items.length || clearing}>
            Очистить
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4 lg:p-6">
        {loading ? (
          <LoadingState className="min-h-72 bg-transparent" />
        ) : items.length ? (
          <div className="space-y-2">
            {items.map((item) => {
              const href = item.projectId && item.taskId
                ? `/projects/${item.projectId}?task=${encodeURIComponent(item.taskId)}`
                : null;
              const createdAt = item.created_at || item.createdAt;
              const content = (
                <Card className={href ? 'transition-colors hover:bg-muted/50' : undefined}>
                  <CardContent className="flex gap-3 p-4">
                    <span className="mt-0.5">{noticeIcon(item.type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-medium">{item.title}</p>
                        <span className="text-xs text-muted-foreground">{noticeLabel(item.type)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {item.taskId && <span>Задача #{item.taskId}</span>}
                        {item.projectId && <span>Проект #{item.projectId}</span>}
                        {createdAt && (
                          <time dateTime={createdAt}>
                            {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(createdAt))}
                          </time>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              return href ? <Link key={item.id} href={href} className="block">{content}</Link> : <div key={item.id}>{content}</div>;
            })}
          </div>
        ) : (
          <Card>
            <CardHeader><CardTitle>Пока нет уведомлений</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Изменения задач и комментарии из Битрикс24 появятся здесь.</CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
