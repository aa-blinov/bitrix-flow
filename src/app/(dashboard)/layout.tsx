'use client';
import Sidebar from '@/components/Sidebar';
import { useKanbanStore } from '@/store/kanban';
import { useEffect } from 'react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const rehydrate = useKanbanStore((s) => s.rehydrateFromStorage);
  const setMemberId = useKanbanStore((s) => s.setMemberId);

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

  return (
    <div className="bg-white min-h-screen" suppressHydrationWarning>
      <Sidebar />
      <main className="md:pl-64 min-h-screen">{children}</main>
    </div>
  );
}
