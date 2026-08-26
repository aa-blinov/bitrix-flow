'use client';
import Sidebar from '@/components/Sidebar';
import { useKanbanStore } from '@/store/kanban';
import { useEffect } from 'react';
import { useSSE } from '@/hooks/useSSE';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const rehydrate = useKanbanStore((s) => s.rehydrateFromStorage);
  const setMemberId = useKanbanStore((s) => s.setMemberId);
  const memberId = useKanbanStore((s) => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('bitrix_member_id') || '';
  });

  useEffect(() => {
    rehydrate();

    const urlParams = new URLSearchParams(window.location.search);
    const memberIdFromUrl = urlParams.get('member_id');
    const memberIdFromStorage = localStorage.getItem('bitrix_member_id');

    if (memberIdFromUrl) {
      setMemberId(memberIdFromUrl);
    } else if (memberIdFromStorage) {
      setMemberId(memberIdFromStorage);
    }
  }, [rehydrate, setMemberId]);

  // Фоновая подписка на серверный SSE — когда бэкграунд-синк (src/lib/background-sync.ts)
  // обновляет задачи в MongoDB, сервер пушит сюда 'tasks-changed', и мы тихо
  // догружаем свежие данные в стор, без рефреша страницы.
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    const handleEvent = (event: any) => {
      if (cancelled) return;
      if (event?.type === 'tasks-changed') {
        void useKanbanStore.getState().loadAllTasks();
      }
    };
    // Лёгкий пуллер прямо в браузере (страховка на случай если SSE не подключился)
    const interval = setInterval(() => {
      if (!cancelled) void useKanbanStore.getState().loadAllTasks();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [memberId]);

  useSSE(memberId, (event) => {
    if (event?.type === 'tasks-changed') {
      void useKanbanStore.getState().loadAllTasks();
    }
  });

  return (
    <div className="min-h-screen bg-background" suppressHydrationWarning>
      <Sidebar />
      <main className="md:pl-64 min-h-screen">{children}</main>
    </div>
  );
}
