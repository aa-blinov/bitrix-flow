'use client';
import Sidebar from '@/components/Sidebar';
import { useKanbanStore } from '@/store/kanban';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSSE } from '@/hooks/useSSE';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const rehydrate = useKanbanStore((s) => s.rehydrateFromStorage);
  const setMemberId = useKanbanStore((s) => s.setMemberId);
  const memberId = useKanbanStore((s) => s.memberId);

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

  const pathname = usePathname();
  const router = useRouter();

  // Проверять подключение на каждой смене маршрута незачем: ответ один и тот
  // же, а запрос уходил по три раза за одно открытие проекта.
  const connectionChecked = useRef(false);
  useEffect(() => {
    if (pathname === '/connect' || connectionChecked.current) return;
    connectionChecked.current = true;
    const storedMemberId = localStorage.getItem('bitrix_member_id') || '';
    void fetch('/api/oauth/check', {
      headers: { 'X-Member-Id': storedMemberId },
    })
      .then((response) => response.json())
      .then((data) => {
        // Единственный надёжный источник member_id: сессия. В localStorage он
        // появляется только после OAuth-редиректа, а без него молчали и
        // уведомления, и подписка на события.
        if (data.member_id) setMemberId(data.member_id);
        if (data.session && !data.connected) {
          const next = `${window.location.pathname}${window.location.search}`;
          router.replace(`/connect?next=${encodeURIComponent(next)}`);
        }
      })
      .catch(() => {});
  }, [pathname, router, setMemberId]);

  useSSE(memberId, (event) => {
    if (
      event?.type === 'tasks-changed' &&
      (pathname === '/all-tasks' || pathname === '/my-tasks')
    ) {
      const state = useKanbanStore.getState();
      if (!state.isLoadingAllTasks) void state.loadAllTasks();
    }
  });

  return (
    <div className="min-h-screen bg-background" suppressHydrationWarning>
      <Sidebar />
      {/* Кнопка меню висит над контентом: снизу оставляем место, иначе она
          перекрывает последнюю карточку списка. */}
      <main className="min-h-screen pb-20 lg:pb-0 lg:pl-64">{children}</main>
    </div>
  );
}
