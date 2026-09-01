'use client';
import Sidebar from '@/components/Sidebar';
import { useKanbanStore } from '@/store/kanban';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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

  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === '/connect') return;
    const storedMemberId = localStorage.getItem('bitrix_member_id') || '';
    void fetch('/api/oauth/check', {
      headers: { 'X-Member-Id': storedMemberId },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.session && !data.connected) {
          const next = `${window.location.pathname}${window.location.search}`;
          router.replace(`/connect?next=${encodeURIComponent(next)}`);
        }
      })
      .catch(() => {});
  }, [pathname, router]);

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
      <main className="md:pl-64 min-h-screen">{children}</main>
    </div>
  );
}
