'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoadingState from '@/components/LoadingState';

export default function MyTasksPage() {
  const router = useRouter();
  useEffect(() => router.replace('/all-tasks?assignee=me'), [router]);
  return <LoadingState className="min-h-screen" />;
}
