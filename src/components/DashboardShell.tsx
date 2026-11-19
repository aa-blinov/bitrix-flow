'use client';
import Sidebar from '@/components/Sidebar';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import ConnectionStatus from '@/components/ConnectionStatus';
import UpdateNotice from '@/components/UpdateNotice';
import { useKanbanStore } from '@/store/kanban';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSSE } from '@/hooks/useSSE';

export default function DashboardShell({
  children,
  isAdmin,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
}) {
  const rehydrate = useKanbanStore((s) => s.rehydrateFromStorage);
  const setMemberId = useKanbanStore((s) => s.setMemberId);
  const memberId = useKanbanStore((s) => s.memberId);

  // Кеш проектов и пользователя поднимаем до первой отрисовки: иначе сайдбар успевал
  // нарисовать «Нет проектов», потом крутилку и только потом список, и подвал прыгал.
  useLayoutEffect(() => {
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

  // Список сам перезапрашивает открытую страницу. Раньше здесь грузилась первая
  // полусотня задач и заменяла стор: строки других страниц и сортировок не
  // обновлялись, а своя инлайн-правка на экране откатывалась к старому значению.
  useSSE(memberId, (event) => {
    if (event?.type === 'tasks-changed') useKanbanStore.getState().bumpTasksVersion();
  });

  return (
    <div className="min-h-screen bg-canvas" suppressHydrationWarning>
      <Sidebar isAdmin={isAdmin} />
      {/* Кнопка меню висит над контентом: снизу оставляем место, иначе она
          перекрывает последнюю карточку списка. */}
      <KeyboardShortcuts />
      <ConnectionStatus />
      <UpdateNotice />
      <main className="min-h-screen pb-20 lg:pb-0 lg:pl-64">{children}</main>
    </div>
  );
}
